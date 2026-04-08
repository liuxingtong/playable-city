/**
 * 将大徐家汇 OSM 边界 GeoJSON + 场域选址草稿 JSON 叠在 OSM 栅格底图上导出。
 * 遵守 OSM 使用政策：https://operations.osmfoundation.org/policies/tiles/
 * - 合理瓦片数量、顺序请求、明确 User-Agent；输出图稿须保留 © OpenStreetMap 署名。
 *
 * 用法（项目根目录）：
 *   node scripts/render-xujiahui-site-osm.mjs
 *   node scripts/render-xujiahui-site-osm.mjs --zoom 14 --draft data/site-selection-draft.json
 *   node scripts/render-xujiahui-site-osm.mjs --vector-only
 *   node scripts/render-xujiahui-site-osm.mjs --tiles carto-light
 *   node scripts/render-xujiahui-site-osm.mjs --tiles osm-de
 *     （org 超时常见；carto-light / osm-de 为备选，署名见输出图角）
 *   node scripts/render-xujiahui-site-osm.mjs --scale 5000 --dpi 300
 *     （按印刷比例尺与 DPI 自动算 zoom；与 --zoom 二选一优先 --zoom）
 *   node scripts/render-xujiahui-site-osm.mjs --tiles carto-light --scale 5000 --dpi 300 --strict-zoom --max-tiles 72
 *     （--strict-zoom：禁止为省瓦片自动降 zoom；瓦片数仍超上限则退出并提示）
 *
 * 产出：output/xujiahui-site-osm.png、output/xujiahui-site-overlay.svg
 */

import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as turf from '@turf/turf';
import sharp from 'sharp';

import {
  metersPerPixelFromScaleAndDpi,
  metersPerPixelAtLat,
  zoomFloatFromMetersPerPixel
} from './map-scale-math.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const OSM_TILE_UA =
  'xujiahui-cards-site-map-export/1.0 (midterm study; tiles per OSM policy)';

/** 瓦片源：osm 官方；carto-light 为 Carto 浅色（多网可连，数据仍来自 OSM） */
const TILE_PRESETS = {
  osm: {
    attribution:
      '底图 © OpenStreetMap contributors (ODbL) · 研究范围与标注：本项目数据',
    buildUrl(z, x, y) {
      return {
        hostname: 'tile.openstreetmap.org',
        path: `/${z}/${x}/${y}.png`
      };
    },
    buildFetchUrl(z, x, y) {
      return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
    }
  },
  /** 德国社区镜像，与 org 同源策略不同，部分网络下可通 */
  'osm-de': {
    attribution:
      '底图 © OpenStreetMap contributors（tile.openstreetmap.de，ODbL）· 研究范围与标注：本项目数据',
    buildUrl(z, x, y) {
      return {
        hostname: 'tile.openstreetmap.de',
        path: `/${z}/${x}/${y}.png`
      };
    },
    buildFetchUrl(z, x, y) {
      return `https://tile.openstreetmap.de/${z}/${x}/${y}.png`;
    }
  },
  'carto-light': {
    attribution:
      '底图 © CARTO / © OpenStreetMap contributors (ODbL) · 研究范围与标注：本项目数据',
    buildUrl(z, x, y) {
      const sub = 'abcd'[(x + y + z) % 4];
      return {
        hostname: `${sub}.basemaps.cartocdn.com`,
        path: `/light_all/${z}/${x}/${y}.png`
      };
    },
    buildFetchUrl(z, x, y) {
      const sub = 'abcd'[(x + y + z) % 4];
      return `https://${sub}.basemaps.cartocdn.com/light_all/${z}/${x}/${y}.png`;
    }
  }
};

function parseArgs(argv) {
  const o = {
    zoom: null,
    scale: null,
    dpi: 300,
    boundary: path.join(ROOT, 'data/daxujiahui-four-streets-union.geojson'),
    draft: path.join(ROOT, 'data/site-selection-draft.json'),
    outDir: path.join(ROOT, 'output'),
    maxTiles: 48,
    tileDelayMs: 180,
    vectorOnly: false,
    tiles: 'osm',
    /** 为 true 时不因瓦片上限降低 zoom；若当前 zoom 所需瓦片数 > max-tiles 则直接退出并提示 */
    strictZoom: false
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--strict-zoom') {
      o.strictZoom = true;
    } else if (a === '--vector-only') {
      o.vectorOnly = true;
    } else if (a === '--tiles' && argv[i + 1]) {
      const t = String(argv[++i]).toLowerCase();
      if (t === 'carto-light' || t === 'carto') o.tiles = 'carto-light';
      else if (t === 'osm-de' || t === 'de') o.tiles = 'osm-de';
      else if (t === 'osm') o.tiles = 'osm';
      else {
        console.error('未知 --tiles，支持: osm | osm-de | carto-light');
        process.exit(1);
      }
    } else if (a === '--zoom' && argv[i + 1]) {
      const zz = parseInt(argv[++i], 10);
      if (Number.isFinite(zz)) o.zoom = zz;
    } else if (a === '--scale' && argv[i + 1]) {
      const s = parseInt(argv[++i], 10);
      if (Number.isFinite(s) && s >= 100) o.scale = s;
    } else if (a === '--dpi' && argv[i + 1]) {
      const d = parseInt(argv[++i], 10);
      if (Number.isFinite(d) && d >= 72 && d <= 1200) o.dpi = d;
    } else if (a === '--boundary' && argv[i + 1]) o.boundary = path.resolve(ROOT, argv[++i]);
    else if (a === '--draft' && argv[i + 1]) o.draft = path.resolve(ROOT, argv[++i]);
    else if (a === '--out' && argv[i + 1]) o.outDir = path.resolve(ROOT, argv[++i]);
    else if (a === '--max-tiles' && argv[i + 1]) o.maxTiles = Math.max(4, parseInt(argv[++i], 10) || 48);
  }
  return o;
}

function lonLatToWorldPx(lon, lat, z) {
  const s = 256 * 2 ** z;
  const x = ((lon + 180) / 360) * s;
  const latRad = (lat * Math.PI) / 180;
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * s;
  return [x, y];
}

function tileRangeForBbox(minLon, minLat, maxLon, maxLat, z) {
  const corners = [
    [minLon, minLat],
    [minLon, maxLat],
    [maxLon, minLat],
    [maxLon, maxLat]
  ];
  let minTx = Infinity;
  let maxTx = -Infinity;
  let minTy = Infinity;
  let maxTy = -Infinity;
  for (const [lon, lat] of corners) {
    const [wx, wy] = lonLatToWorldPx(lon, lat, z);
    const tx = Math.floor(wx / 256);
    const ty = Math.floor(wy / 256);
    minTx = Math.min(minTx, tx);
    maxTx = Math.max(maxTx, tx);
    minTy = Math.min(minTy, ty);
    maxTy = Math.max(maxTy, ty);
  }
  return { minTx, maxTx, minTy, maxTy };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fetchTileHttps(z, x, y, preset) {
  const { hostname, path: tilePath } = preset.buildUrl(z, x, y);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        port: 443,
        path: tilePath,
        method: 'GET',
        headers: {
          'User-Agent': OSM_TILE_UA,
          Accept: 'image/png,*/*'
        }
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }
    );
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('请求超时'));
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchTile(z, x, y, preset) {
  const httpsTries = 3;
  let lastErr = '';
  for (let i = 0; i < httpsTries; i++) {
    try {
      return await fetchTileHttps(z, x, y, preset);
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      if (i < httpsTries - 1) await sleep(350 * (i + 1));
    }
  }
  for (let i = 0; i < 2; i++) {
    try {
      const url = preset.buildFetchUrl(z, x, y);
      const res = await fetch(url, {
        headers: { 'User-Agent': OSM_TILE_UA }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      if (i < 1) await sleep(400);
    }
  }
  throw new Error(lastErr);
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function linePath(pointsLatLng, z, ox, oy) {
  const parts = [];
  for (const [lat, lng] of pointsLatLng) {
    const [wx, wy] = lonLatToWorldPx(lng, lat, z);
    parts.push(`${(wx - ox).toFixed(2)},${(wy - oy).toFixed(2)}`);
  }
  return `M ${parts.join(' L ')}`;
}

function ringPath(pointsLatLng, z, ox, oy) {
  if (pointsLatLng.length < 3) return '';
  const base = linePath(pointsLatLng, z, ox, oy);
  const [lat0, lng0] = pointsLatLng[0];
  const [wx, wy] = lonLatToWorldPx(lng0, lat0, z);
  return `${base} L ${(wx - ox).toFixed(2)},${(wy - oy).toFixed(2)} Z`;
}

function polygonCentroidPx(pointsLatLng, z, ox, oy) {
  try {
    const ring = pointsLatLng.map(([lat, lng]) => [lng, lat]);
    if (ring.length < 3) return null;
    const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring
      : [...ring, ring[0]];
    const poly = turf.polygon([closed]);
    const c = turf.centroid(poly);
    const [lng, lat] = c.geometry.coordinates;
    const [wx, wy] = lonLatToWorldPx(lng, lat, z);
    return [wx - ox, wy - oy];
  } catch {
    return null;
  }
}

function boundaryPaths(feature, z, ox, oy) {
  const geom = feature.geometry;
  if (!geom) return [];
  const out = [];
  const pushRing = (ring) => {
    if (ring.length < 2) return;
    const ll = ring.map(([lng, lat]) => [lat, lng]);
    out.push(ringPath(ll, z, ox, oy));
  };
  if (geom.type === 'Polygon') {
    for (const ring of geom.coordinates) pushRing(ring);
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) {
      for (const ring of poly) pushRing(ring);
    }
  }
  return out.filter(Boolean);
}

async function main() {
  const opts = parseArgs(process.argv);
  const tilePreset = TILE_PRESETS[opts.tiles] || TILE_PRESETS.osm;
  const boundaryRaw = JSON.parse(fs.readFileSync(opts.boundary, 'utf8'));
  const draft = JSON.parse(fs.readFileSync(opts.draft, 'utf8'));

  if (draft.version !== 1) {
    console.warn('警告: 选址 JSON version 不是 1，仍尝试绘制。');
  }

  const study = boundaryRaw.type === 'FeatureCollection'
    ? boundaryRaw.features[0]
    : boundaryRaw;

  let [minLon, minLat, maxLon, maxLat] = turf.bbox(study);

  const expandDraftBbox = () => {
    const pts = [];
    for (const a of draft.axes || []) {
      for (const p of a.points || []) pts.push(p);
    }
    for (const a of draft.subAxes || []) {
      for (const p of a.points || []) pts.push(p);
    }
    for (const s of draft.selections || []) {
      for (const p of s.points || []) pts.push(p);
    }
    for (const [lat, lng] of pts) {
      minLon = Math.min(minLon, lng);
      maxLon = Math.max(maxLon, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
  };
  expandDraftBbox();

  const pad = 0.002;
  minLon -= pad;
  maxLon += pad;
  minLat -= pad;
  maxLat += pad;

  const centerLat = (minLat + maxLat) / 2;

  let z;
  if (opts.zoom != null) {
    z = Math.max(10, Math.min(19, opts.zoom));
  } else if (opts.scale != null) {
    const targetMpp = metersPerPixelFromScaleAndDpi(opts.scale, opts.dpi);
    const zFloat = zoomFloatFromMetersPerPixel(centerLat, targetMpp);
    z = Math.round(zFloat);
    z = Math.max(10, Math.min(19, z));
    if (zFloat > 19.4) {
      console.warn(
        '提示: 目标比 zoom=19 更细，已钳位到 19；真 1:' +
          opts.scale +
          ' 印刷需更大像素图或 GIS；可查 npm run map:scale'
      );
    }
    opts._scaleLog = {
      targetMpp,
      scale: opts.scale,
      dpi: opts.dpi,
      centerLat
    };
  } else {
    z = 14;
  }

  const zBeforeTileCap = z;
  let range = tileRangeForBbox(minLon, minLat, maxLon, maxLat, z);
  let tw = range.maxTx - range.minTx + 1;
  let th = range.maxTy - range.minTy + 1;
  let nTiles = tw * th;

  if (opts.strictZoom) {
    if (nTiles > opts.maxTiles) {
      console.error(
        `固定 zoom=${z} 需要 ${nTiles} 块瓦片，大于 --max-tiles ${opts.maxTiles}。\n` +
          `请加上：--max-tiles ${nTiles}（或更大），或去掉 --strict-zoom 以允许自动降低 zoom，或缩小边界/选址范围。\n` +
          `（请节制请求，遵守瓦片服务使用政策。）`
      );
      process.exit(1);
    }
  } else {
    while (nTiles > opts.maxTiles && z > 10) {
      z -= 1;
      range = tileRangeForBbox(minLon, minLat, maxLon, maxLat, z);
      tw = range.maxTx - range.minTx + 1;
      th = range.maxTy - range.minTy + 1;
      nTiles = tw * th;
    }

    if (z < zBeforeTileCap) {
      console.warn(
        `提示: 为不超过 --max-tiles ${opts.maxTiles}，zoom 从 ${zBeforeTileCap} 降至 ${z}，与目标比例尺会有偏差；可提高 --max-tiles（勿滥用瓦片服务）、加 --strict-zoom 强制报错、或缩小范围。`
      );
    }
  }

  if (opts._scaleLog) {
    const { targetMpp, scale, dpi, centerLat: clat } = opts._scaleLog;
    const actualMpp = metersPerPixelAtLat(clat, z);
    console.log(
      `比例尺 1:${scale} @ ${dpi} DPI → 目标 ${targetMpp.toFixed(4)} m/px；最终 zoom=${z}（实际约 ${actualMpp.toFixed(4)} m/px，中心纬度 ${clat.toFixed(4)}°）`
    );
  }

  if (nTiles > opts.maxTiles) {
    console.error(
      `瓦片数 ${nTiles} 超过 --max-tiles ${opts.maxTiles}。请缩小范围或提高 max-tiles（勿滥用 OSM 服务）。`
    );
    process.exit(1);
  }

  const { minTx, maxTx, minTy, maxTy } = range;
  const ox = minTx * 256;
  const oy = minTy * 256;
  const width = tw * 256;
  const height = th * 256;

  console.log(
    `zoom=${z} 瓦片网格 ${tw}×${th}=${nTiles}，画布 ${width}×${height}，瓦片源=${opts.tiles}`
  );

  fs.mkdirSync(opts.outDir, { recursive: true });

  let basePng;
  if (opts.vectorOnly) {
    console.log('模式: --vector-only（无底图栅格，浅灰底）');
    basePng = await sharp({
      create: { width, height, channels: 3, background: '#f0f0ec' }
    })
      .png()
      .toBuffer();
  } else {
    const composites = [];
    let tileFailCount = 0;
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        let buf;
        try {
          buf = await fetchTile(z, tx, ty, tilePreset);
        } catch (e) {
          console.warn(`瓦片 z=${z} ${tx}/${ty}: ${e.message || e}`);
          tileFailCount += 1;
          buf = await sharp({
            create: { width: 256, height: 256, channels: 3, background: '#e8e8e8' }
          })
            .png()
            .toBuffer();
        }
        composites.push({
          input: buf,
          left: (tx - minTx) * 256,
          top: (ty - minTy) * 256
        });
        await sleep(opts.tileDelayMs);
      }
    }
    if (tileFailCount === nTiles) {
      console.warn(
        '全部瓦片下载失败。可尝试：① node scripts/render-xujiahui-site-osm.mjs --tiles carto-light  ② 配置系统代理后重试  ③ 浏览器打开 pages/xujiahui-site-selection-osm-light.html 截图  ④ --vector-only 仅矢量'
      );
    }
    basePng = await sharp({
      create: { width, height, channels: 3, background: '#f5f5f5' }
    })
      .composite(composites)
      .png()
      .toBuffer();
  }

  const styles = {
    studyStroke: 'rgba(0,0,0,0.92)',
    studyWidth: 3,
    axisMain: 'rgba(180,40,40,0.95)',
    axisSub: 'rgba(120,80,160,0.88)',
    axisWidth: 2.5,
    subWidth: 1.8,
    resourceFill: 'rgba(200,30,90,0.18)',
    resourceStroke: 'rgba(180,25,80,0.9)',
    potentialFill: 'rgba(25,110,200,0.16)',
    potentialStroke: 'rgba(20,90,180,0.88)',
    selWidth: 1.6
  };

  const svgParts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="100%" height="100%" fill="none"/>`,
    `<g id="study-boundary" fill="none" stroke="${styles.studyStroke}" stroke-width="${styles.studyWidth}" stroke-linejoin="round" stroke-linecap="round">`
  ];
  for (const d of boundaryPaths(study, z, ox, oy)) {
    svgParts.push(`<path d="${d}"/>`);
  }
  svgParts.push('</g>');

  svgParts.push(
    `<g id="selections" stroke-linejoin="round" stroke-linecap="round" fill-rule="evenodd">`
  );
  for (const s of draft.selections || []) {
    if (!s.points || s.points.length < 3) continue;
    const isPot = s.kind === 'potential';
    const fill = isPot ? styles.potentialFill : styles.resourceFill;
    const stroke = isPot ? styles.potentialStroke : styles.resourceStroke;
    const d = ringPath(s.points, z, ox, oy);
    if (!d) continue;
    svgParts.push(
      `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${styles.selWidth}"/>`
    );
    const c = polygonCentroidPx(s.points, z, ox, oy);
    if (c) {
      const label = escapeXml((s.name || s.id || '').slice(0, 24));
      if (label) {
        svgParts.push(
          `<text x="${c[0].toFixed(1)}" y="${c[1].toFixed(1)}" text-anchor="middle" dominant-baseline="middle" ` +
            `font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="11" font-weight="600" ` +
            `fill="rgba(20,20,20,0.92)" stroke="rgba(255,255,255,0.85)" stroke-width="3" paint-order="stroke">${label}</text>`
        );
      }
    }
  }
  svgParts.push('</g>');

  svgParts.push(
    `<g id="axes" fill="none" stroke-linejoin="round" stroke-linecap="round">`
  );
  for (const a of draft.axes || []) {
    if (!a.points || a.points.length < 2) continue;
    const d = linePath(a.points, z, ox, oy);
    svgParts.push(
      `<path d="${d}" stroke="${styles.axisMain}" stroke-width="${styles.axisWidth}"/>`
    );
    const last = a.points[a.points.length - 1];
    const [wx, wy] = lonLatToWorldPx(last[1], last[0], z);
    svgParts.push(
      `<text x="${(wx - ox + 8).toFixed(1)}" y="${(wy - oy).toFixed(1)}" ` +
        `font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="12" font-weight="700" fill="${styles.axisMain}">${escapeXml(a.id)}</text>`
    );
  }
  for (const a of draft.subAxes || []) {
    if (!a.points || a.points.length < 2) continue;
    const d = linePath(a.points, z, ox, oy);
    svgParts.push(
      `<path d="${d}" stroke="${styles.axisSub}" stroke-width="${styles.subWidth}" stroke-dasharray="6 4"/>`
    );
  }
  svgParts.push('</g>');

  const attrText = opts.vectorOnly
    ? '无底图栅格 · 研究范围与选址标注：本项目数据'
    : tilePreset.attribution;
  svgParts.push(
    `<g id="attribution">`,
    `<rect x="8" y="${height - 36}" width="520" height="28" rx="4" fill="rgba(255,255,255,0.82)"/>`,
    `<text x="16" y="${height - 16}" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="11" fill="#222">` +
      `${escapeXml(attrText)}` +
      `</text>`,
    `</g>`,
    `</svg>`
  );

  const overlaySvg = svgParts.join('\n');
  const overlayPath = path.join(opts.outDir, 'xujiahui-site-overlay.svg');
  fs.writeFileSync(overlayPath, overlaySvg, 'utf8');

  const outPng = path.join(opts.outDir, 'xujiahui-site-osm.png');
  await sharp(basePng)
    .composite([{ input: Buffer.from(overlaySvg, 'utf8'), top: 0, left: 0 }])
    .png()
    .toFile(outPng);

  console.log(`已写入:\n  ${outPng}\n  ${overlayPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
