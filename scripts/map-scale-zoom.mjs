/**
 * 由「印刷比例尺 1:S」与「假定输出 DPI」推算 Web Mercator 下接近该分辨率的 zoom，
 * 及该 zoom 在指定纬度处的实际 m/px（与 Node 导出脚本公式一致）。
 *
 * 用法：
 *   node scripts/map-scale-zoom.mjs
 *   node scripts/map-scale-zoom.mjs --lat 31.19 --dpi 300
 *   node scripts/map-scale-zoom.mjs --lat 31.19 --scale 5000 --dpi 300
 */

import {
  metersPerPixelFromScaleAndDpi,
  metersPerPixelAtLat,
  zoomFloatFromMetersPerPixel
} from './map-scale-math.mjs';

function parseArgs(argv) {
  const o = { lat: 31.19, dpi: 300, scale: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--lat' && argv[i + 1]) o.lat = parseFloat(argv[++i]);
    else if (a === '--dpi' && argv[i + 1]) o.dpi = parseInt(argv[++i], 10);
    else if (a === '--scale' && argv[i + 1]) o.scale = parseInt(argv[++i], 10);
  }
  return o;
}

function main() {
  const opts = parseArgs(process.argv);
  const scales = opts.scale != null ? [opts.scale] : [5000, 2000, 500];

  console.log(
    `纬度 ${opts.lat.toFixed(4)}°，假定打印 DPI=${opts.dpi}（每英寸像素数）\n`
  );
  console.log('比例尺\t目标 m/px\t推荐 zoom\t该 zoom 实际 m/px\t说明');
  console.log('——————————————————————————————————————————————————————');

  for (const S of scales) {
    const target = metersPerPixelFromScaleAndDpi(S, opts.dpi);
    const zf = zoomFloatFromMetersPerPixel(opts.lat, target);
    let z = Math.round(zf);
    z = Math.max(10, Math.min(19, z));
    const actual = metersPerPixelAtLat(opts.lat, z);
    const impliedScale = (actual * opts.dpi) / 0.0254;
    let note = '';
    if (z === 19 && zf > 19.2) note = '栅格 zoom 上限，偏粗';
    else if (z === 10 && zf < 9.8) note = 'zoom 下限';
    else if (Math.abs(actual - target) / target > 0.2) note = '与目标偏差较大';

    console.log(
      `1:${S}\t${target.toFixed(4)}\t${z}\t\t${actual.toFixed(4)}\t\t≈1:${Math.round(impliedScale)} ${note}`
    );
  }

  console.log(`
说明：
  · 「目标 m/px」= (比例尺分母 × 0.0254) / DPI，对应印刷时一像素代表的地面米数。
  · OSM 栅格常用 zoom≤19；1:500 + 高 DPI 往往要求比 z=19 更细，需更大图幅、矢量或专业 GIS。
  · Node 导出：node scripts/render-xujiahui-site-osm.mjs --scale ${scales[0]} --dpi ${opts.dpi} ...
  · 浏览器：pages/xujiahui-site-selection-osm-light.html?zoom=推荐值&scaleHint=1
`);
}

main();
