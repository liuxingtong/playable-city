/**
 * 过滤 cld_priority.csv：仅保留 (lon, lat) 落在大徐家汇四街道并集内的行。
 * 边界默认与地图相同：data/daxujiahui-four-streets-union.geojson
 * （npm run fetch:daxujiahui-4 可重新拉取 OSM 并集）
 *
 * 用法:
 *   node scripts/filter-cld-daxujiahui.mjs
 *   node scripts/filter-cld-daxujiahui.mjs --input data/cld/cld_priority.csv --output cld_priority_daxujiahui.csv
 *   node scripts/filter-cld-daxujiahui.mjs --boundary ./other.geojson
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BOUNDARY = path.join(root, "data", "daxujiahui-four-streets-union.geojson");

function parseArgs(argv) {
  const o = {
    input: path.join(root, "data", "cld", "cld_priority.csv"),
    output: path.join(root, "cld_priority_daxujiahui.csv"),
    boundary: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input" && argv[i + 1]) o.input = path.resolve(root, argv[++i]);
    else if (a === "--output" && argv[i + 1]) o.output = path.resolve(root, argv[++i]);
    else if (a === "--boundary" && argv[i + 1]) o.boundary = path.resolve(root, argv[++i]);
    else if (a === "-h" || a === "--help") {
      console.log(`用法: node scripts/filter-cld-daxujiahui.mjs [选项]
  --input <path>    默认 data/cld/cld_priority.csv
  --output <path>   默认 cld_priority_daxujiahui.csv
  --boundary <path>  自定义 Polygon/MultiPolygon GeoJSON（默认 data/daxujiahui-four-streets-union.geojson）`);
      process.exit(0);
    }
  }
  return o;
}

function inRing(lon, lat, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1];
    const xj = ring[j][0],
      yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function inPolygonCoords(lon, lat, rings) {
  if (!rings?.length) return false;
  if (!inRing(lon, lat, rings[0])) return false;
  for (let h = 1; h < rings.length; h++) {
    if (inRing(lon, lat, rings[h])) return false;
  }
  return true;
}

function inMultiPolygon(lon, lat, coordinates) {
  for (const poly of coordinates) {
    if (inPolygonCoords(lon, lat, poly)) return true;
  }
  return false;
}

function pointInGeometry(lon, lat, geom) {
  if (!geom) return false;
  if (geom.type === "Polygon") return inPolygonCoords(lon, lat, geom.coordinates);
  if (geom.type === "MultiPolygon") return inMultiPolygon(lon, lat, geom.coordinates);
  return false;
}

function geometryFromParsedJSON(raw, label) {
  if (Array.isArray(raw) && raw[0]?.geojson) return raw[0].geojson;
  if (raw.type === "FeatureCollection" && raw.features?.[0]) {
    return raw.features[0].geometry;
  }
  if (raw.type === "Feature") return raw.geometry;
  if (raw.type === "Polygon" || raw.type === "MultiPolygon") return raw;
  throw new Error(`${label} 中无法解析 Polygon/MultiPolygon`);
}

function loadGeometryFromGeoJSONFile(filePath) {
  const s = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const raw = JSON.parse(s);
  return geometryFromParsedJSON(raw, filePath);
}

function bboxFromGeometry(geom) {
  let minLon = Infinity,
    minLat = Infinity,
    maxLon = -Infinity,
    maxLat = -Infinity;
  function visitRing(ring) {
    for (const [x, y] of ring) {
      minLon = Math.min(minLon, x);
      maxLon = Math.max(maxLon, x);
      minLat = Math.min(minLat, y);
      maxLat = Math.max(maxLat, y);
    }
  }
  if (geom.type === "Polygon") {
    for (const ring of geom.coordinates) visitRing(ring);
  } else if (geom.type === "MultiPolygon") {
    for (const poly of geom.coordinates) for (const ring of poly) visitRing(ring);
  }
  return { minLon, minLat, maxLon, maxLat };
}

function inBBox(lon, lat, b) {
  return lon >= b.minLon && lon <= b.maxLon && lat >= b.minLat && lat <= b.maxLat;
}

function parseCsvLine(line) {
  const parts = [];
  let cur = "";
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '"') {
      i++;
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          cur += line[i++];
        }
      }
    } else if (ch === ",") {
      parts.push(cur);
      cur = "";
      i++;
    } else {
      cur += ch;
      i++;
    }
  }
  parts.push(cur);
  return parts;
}

function main() {
  const opts = parseArgs(process.argv);
  const boundaryPath = opts.boundary || DEFAULT_BOUNDARY;
  if (!fs.existsSync(boundaryPath)) {
    console.error(
      `缺少边界文件: ${path.relative(root, boundaryPath)}\n可先运行: npm run fetch:daxujiahui-4`
    );
    process.exit(1);
  }
  console.error(`边界: ${path.relative(root, boundaryPath)}`);

  const geom = loadGeometryFromGeoJSONFile(boundaryPath);
  const bbox = bboxFromGeometry(geom);
  const text = fs.readFileSync(opts.input, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) throw new Error("空文件");

  const header = lines[0];
  const cols = parseCsvLine(header);
  const li = cols.indexOf("lon");
  const lai = cols.indexOf("lat");
  if (li < 0 || lai < 0) throw new Error('CSV 需包含列 "lon" 与 "lat"');

  const out = [header];
  let kept = 0,
    dropped = 0,
    skipped = 0;

  for (let r = 1; r < lines.length; r++) {
    const row = parseCsvLine(lines[r]);
    if (row.length !== cols.length) {
      skipped++;
      continue;
    }
    const lon = Number(row[li]);
    const lat = Number(row[lai]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      skipped++;
      continue;
    }
    const inside = inBBox(lon, lat, bbox) && pointInGeometry(lon, lat, geom);
    if (inside) {
      out.push(lines[r]);
      kept++;
    } else dropped++;
  }

  fs.writeFileSync(opts.output, out.join("\n") + "\n", "utf8");
  console.error(
    `输入 ${lines.length - 1} 行 → 保留 ${kept}，剔除 ${dropped}（大徐家汇外），列不齐/无效坐标 ${skipped}`
  );
  console.error(`已写入: ${path.relative(root, opts.output)}`);
}

main();
