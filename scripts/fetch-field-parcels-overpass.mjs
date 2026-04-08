/**
 * 从 Overpass 拉取 bbox 内 OSM landuse 闭合 way，写入 data/field-parcels.geojson。
 * 公共 Overpass 易 504：默认只用**很小**的徐家汇核心 bbox + 有限 landuse 取值；扩大范围请设环境变量或改下方常量。
 *
 * 用法:
 *   npm run fetch:field-parcels
 *   OVERPASS_BBOX=31.19,121.42,31.21,121.46 npm run fetch:field-parcels
 *   （顺序：南,西,北,东 — 越大越容易超时）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import osmtogeojson from 'osmtogeojson';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'field-parcels.geojson');

/** 默认：约 1km 级核心框（南,西,北,东），降低 504 概率 */
const DEFAULT_BBOX = { S: 31.1935, W: 121.431, N: 31.2015, E: 121.441 };

/**
 * 仅常见城市建设类 landuse，避免 `way["landuse"](bbox)` 全表爆炸
 * @see https://wiki.openstreetmap.org/wiki/Key:landuse
 */
const LANDUSE_REGEX =
  '^(residential|commercial|retail|industrial|construction|brownfield|allotments|recreation_ground|cemetery|garages)$';

const ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter'
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseBbox() {
  const raw = process.env.OVERPASS_BBOX;
  if (!raw || !raw.trim()) return DEFAULT_BBOX;
  const p = raw.split(/[\s,]+/).map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isFinite(x))) {
    console.warn('OVERPASS_BBOX 无效，使用默认小 bbox。格式：南,西,北,东');
    return DEFAULT_BBOX;
  }
  const [S, W, N, E] = p;
  return { S, W, N, E };
}

function buildQuery({ S, W, N, E }) {
  return `[out:json][timeout:240];
(
  way["landuse"~"${LANDUSE_REGEX}"](${S},${W},${N},${E});
);
out geom;`;
}

async function fetchOverpassOnce(endpoint, query) {
  const r = await fetch(endpoint, {
    method: 'POST',
    body: 'data=' + encodeURIComponent(query),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'cards-field-parcels/1.1 (academic; local)'
    }
  });
  const text = await r.text();
  if (r.status === 504 || r.status === 502 || r.status === 429) {
    const err = new Error(`Overpass HTTP ${r.status} @ ${endpoint}`);
    err.status = r.status;
    throw err;
  }
  if (!r.ok) {
    throw new Error(`Overpass HTTP ${r.status} @ ${endpoint}: ${text.slice(0, 200)}`);
  }
  let osm;
  try {
    osm = JSON.parse(text);
  } catch {
    throw new Error(`非 JSON 响应 @ ${endpoint}: ${text.slice(0, 200)}`);
  }
  return osm;
}

async function fetchOverpass(query) {
  let lastErr;
  for (const endpoint of ENDPOINTS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) await sleep(4000 * attempt);
        return await fetchOverpassOnce(endpoint, query);
      } catch (e) {
        lastErr = e;
        const st = e.status;
        if (st === 504 || st === 502 || st === 429) {
          console.warn(`第 ${attempt + 1} 次失败 (${st})，${endpoint}`);
          continue;
        }
        throw e;
      }
    }
    console.warn('换下一镜像…');
  }
  throw lastErr || new Error('Overpass 全部失败');
}

async function main() {
  const bbox = parseBbox();
  const { S, W, N, E } = bbox;
  const query = buildQuery(bbox);
  console.log('bbox 南,西,北,东 =', S, W, N, E, '| 更大范围请缩小或分片下载');

  const osm = await fetchOverpass(query);
  if (osm.remark) console.warn('Overpass:', osm.remark);
  if (osm.error) throw new Error('Overpass error: ' + (osm.error || JSON.stringify(osm)));

  const gj = osmtogeojson(osm, { flatProperties: true });
  const polys = gj.features.filter(
    (f) => f.geometry && ['Polygon', 'MultiPolygon'].includes(f.geometry.type)
  );
  const fc = { type: 'FeatureCollection', features: polys };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(fc, null, 2), 'utf8');
  console.log('已写入', OUT, '面要素数:', polys.length);
}

main().catch((e) => {
  console.error(e.message || e);
  console.error(
    '\n若仍超时：① 再缩小 OVERPASS_BBOX ② 分多块 bbox 各跑一次后合并 GeoJSON ③ 用 JOSM/Overpass 网页导出小区域'
  );
  process.exit(1);
});
