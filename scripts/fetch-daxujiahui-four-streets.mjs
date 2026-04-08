/**
 * 从 Overpass 拉取四个街道的 OSM relation 几何，并集为单一 MultiPolygon，
 * 写入 data/daxujiahui-four-streets-union.geojson
 *
 * 徐家汇 R13469990 · 天平路 R13469980 · 湖南路 R13469979 · 枫林路 R13470052
 *
 * 用法: node scripts/fetch-daxujiahui-four-streets.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import osmtogeojson from 'osmtogeojson';
import { union } from '@turf/turf';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'daxujiahui-four-streets-union.geojson');

const RELATIONS = [
  { id: 13469990, name: '徐家汇街道' },
  { id: 13469980, name: '天平路街道' },
  { id: 13469979, name: '湖南路街道' },
  { id: 13470052, name: '枫林路街道' }
];

const query = `[out:json][timeout:90];
(
  relation(13469990);
  relation(13469980);
  relation(13469979);
  relation(13470052);
);
out geom;`;

async function main() {
  const r = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: 'data=' + encodeURIComponent(query),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'cards-midterm-daxujiahui/1.0 (academic; contact: local)'
    }
  });
  if (!r.ok) throw new Error(`Overpass HTTP ${r.status}`);
  const osm = await r.json();
  if (osm.remark) console.warn('Overpass:', osm.remark);

  const gj = osmtogeojson(osm, { flatProperties: true });
  const polys = gj.features.filter(
    f => f.geometry && ['Polygon', 'MultiPolygon'].includes(f.geometry.type)
  );
  if (polys.length === 0) throw new Error('未解析出任何 Polygon/MultiPolygon');
  if (polys.length < RELATIONS.length) {
    console.warn(`警告: 仅得到 ${polys.length} 个面，期望 ${RELATIONS.length} 个`);
  }

  let merged = polys[0];
  for (let i = 1; i < polys.length; i++) {
    const fc = { type: 'FeatureCollection', features: [merged, polys[i]] };
    const u = union(fc);
    if (!u || !u.geometry) throw new Error(`turf.union 在第 ${i} 步失败`);
    merged = u;
  }

  merged.properties = {
    name: '大徐家汇（四街道并集）',
    description: '徐家汇街道 + 天平路街道 + 湖南路街道 + 枫林路街道，OSM administrative 边界 union',
    source: 'OpenStreetMap',
    relations: RELATIONS.map(x => `${x.name} (R${x.id})`).join('；'),
    osm_relation_ids: RELATIONS.map(x => x.id),
    license: 'ODbL 1.0',
    generated: new Date().toISOString()
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(merged, null, 2), 'utf8');
  console.log('已写入', OUT);
  console.log('几何类型:', merged.geometry.type);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
