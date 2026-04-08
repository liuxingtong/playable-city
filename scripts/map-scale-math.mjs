/**
 * Web Mercator 栅格：印刷比例尺 1:S、DPI 与 zoom、m/px 的换算（与导出脚本一致）。
 */

/** 印刷：1:S、DPI → 每像素对应地面长度（米） */
export function metersPerPixelFromScaleAndDpi(scaleDenominator, dpi) {
  return (scaleDenominator * 0.0254) / dpi;
}

/** 纬度 °、整数 zoom → m/px */
export function metersPerPixelAtLat(latDeg, z) {
  const latRad = (latDeg * Math.PI) / 180;
  return (40075016.686 * Math.cos(latRad)) / (256 * 2 ** z);
}

/** 目标 m/px、纬度 → 浮点 zoom */
export function zoomFloatFromMetersPerPixel(latDeg, mPerPx) {
  const latRad = (latDeg * Math.PI) / 180;
  return Math.log2((40075016.686 * Math.cos(latRad)) / (256 * mPerPx));
}
