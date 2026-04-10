/**
 * 从 Overpass 拉取徐汇区「天平路街道」OSM administrative relation 几何，
 * 写入 data/tianping-road-street.geojson（单 Feature，Polygon / MultiPolygon）
 *
 * OSM: relation/13469980
 * 用法: node scripts/fetch-tianping-road-street.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import osmtogeojson from 'osmtogeojson';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'tianping-road-street.geojson');

const RELATION_ID = 13469980;
const NAME = '天平路街道';

const query = `[out:json][timeout:90];
relation(${RELATION_ID});
out geom;`;

async function fetchViaOverpass() {
  const r = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: 'data=' + encodeURIComponent(query),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'playable-city-tianping/1.0 (academic; local)'
    }
  });
  if (!r.ok) throw new Error(`Overpass HTTP ${r.status}`);
  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('json')) {
    const t = await r.text();
    throw new Error(`Overpass 非 JSON: ${t.slice(0, 120)}`);
  }
  const osm = await r.json();
  if (osm.remark) console.warn('Overpass:', osm.remark);
  const gj = osmtogeojson(osm, { flatProperties: true });
  return gj.features.filter(
    (f) => f.geometry && ['Polygon', 'MultiPolygon'].includes(f.geometry.type)
  );
}

/** Nominatim 回退：按行政区划名称检索 polygon_geojson */
async function fetchViaNominatim() {
  const q = '上海市徐汇区天平路街道';
  const url =
    'https://nominatim.openstreetmap.org/search?' +
    new URLSearchParams({
      q,
      format: 'json',
      polygon_geojson: '1',
      limit: '5'
    });
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'playable-city-tianping/1.0 (academic; contact: local)',
      Accept: 'application/json'
    }
  });
  if (!r.ok) throw new Error(`Nominatim HTTP ${r.status}`);
  const arr = await r.json();
  if (!Array.isArray(arr) || !arr.length) throw new Error('Nominatim 无结果');
  const hit =
    arr.find((x) => x.geojson && ['Polygon', 'MultiPolygon'].includes(x.geojson.type)) || arr[0];
  const g = hit.geojson;
  if (!g || !['Polygon', 'MultiPolygon'].includes(g.type)) {
    throw new Error('Nominatim 结果无 polygon_geojson');
  }
  return [
    {
      type: 'Feature',
      geometry: g,
      properties: { display_name: hit.display_name, osm_type: hit.osm_type, osm_id: hit.osm_id }
    }
  ];
}

async function main() {
  let polys;
  try {
    polys = await fetchViaOverpass();
  } catch (e) {
    console.warn('Overpass 失败，改用 Nominatim:', e.message);
    polys = await fetchViaNominatim();
  }
  if (!polys.length) throw new Error('未解析出 Polygon/MultiPolygon');
  const feat = polys[0];
  feat.properties = {
    ...(feat.properties || {}),
    name: NAME,
    description: '上海市徐汇区天平路街道，OSM administrative boundary',
    source: 'OpenStreetMap',
    osm_relation_id: RELATION_ID,
    license: 'ODbL 1.0',
    generated: new Date().toISOString()
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(feat, null, 2), 'utf8');
  console.log('已写入', OUT);
  console.log('几何类型:', feat.geometry.type);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
