import { getDimensionLabel } from "./agent-recon-dimensions.js";

/**
 * 生成多维「拼接方案」示意 PNG（本地、无 API）。
 * @param {Record<string, { id: string, title: string, summary: string, relevance: number }|null>} mosaicByDimension
 * @param {string} subtitle
 * @param {string[]} [dimensionOrder]
 * @returns {string} data:image/png;base64,...
 */
export function renderSchemeMosaicToDataURL(mosaicByDimension, subtitle, dimensionOrder = []) {
  const W = 920;
  const H = 640;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  ctx.fillStyle = "#0e141c";
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "#3d5a80";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

  ctx.fillStyle = "#8ab4f8";
  ctx.font = "bold 18px Segoe UI, PingFang SC, Microsoft YaHei, sans-serif";
  ctx.fillText("案例库 · 多维拼接方案板（示意）", 24, 36);

  ctx.fillStyle = "#9aaab9";
  ctx.font = "12px Segoe UI, PingFang SC, Microsoft YaHei, sans-serif";
  const sub = (subtitle || "").slice(0, 120);
  ctx.fillText(sub, 24, 56);

  const map = mosaicByDimension && typeof mosaicByDimension === "object" ? mosaicByDimension : {};
  const dims = Array.isArray(dimensionOrder) && dimensionOrder.length ? dimensionOrder : Object.keys(map);
  const n = Math.max(1, dims.length);
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const cw = (W - 48) / cols;
  const ch = (H - 88) / rows;
  const ox = 24;
  const oy = 72;

  dims.forEach((d, i) => {
    const gx = i % cols;
    const gy = Math.floor(i / cols);
    const x = ox + gx * cw;
    const y = oy + gy * ch;
    ctx.fillStyle = "#151d28";
    ctx.fillRect(x + 4, y + 4, cw - 8, ch - 8);
    ctx.strokeStyle = "#2a3f55";
    ctx.strokeRect(x + 4, y + 4, cw - 8, ch - 8);

    const c = map?.[d];
    const head = getDimensionLabel(d);
    ctx.fillStyle = "#7dd3fc";
    ctx.font = "bold 14px Segoe UI, PingFang SC, Microsoft YaHei, sans-serif";
    ctx.fillText(head, x + 14, y + 28);

    ctx.fillStyle = "#c5d4e0";
    ctx.font = "12px Segoe UI, PingFang SC, Microsoft YaHei, sans-serif";
    if (!c) {
      wrapText(ctx, "（无预选案例）", x + 14, y + 48, cw - 36, 16);
      return;
    }
    wrapText(ctx, `id: ${c.id}`, x + 14, y + 46, cw - 36, 16);
    ctx.fillStyle = "#e8f0fa";
    wrapText(ctx, `《${c.title}》`, x + 14, y + 64, cw - 36, 16);
    ctx.fillStyle = "#a8b8c8";
    wrapText(ctx, c.summary || "", x + 14, y + 84, cw - 36, 16);
    ctx.fillStyle = "#6b7c8f";
    wrapText(ctx, `匹配度 ${(Number(c.relevance) || 0).toFixed(2)}`, x + 14, y + ch - 24, cw - 36, 14);
  });

  return canvas.toDataURL("image/png");
}

function wrapText(context, text, x, y, maxWidth, lineHeight) {
  const words = String(text).split("");
  let line = "";
  let yy = y;
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n];
    const m = context.measureText(testLine);
    if (m.width > maxWidth && line.length > 0) {
      context.fillText(line, x, yy);
      line = words[n];
      yy += lineHeight;
      if (yy > y + lineHeight * 5) {
        context.fillText(line + "…", x, yy);
        return;
      }
    } else {
      line = testLine;
    }
  }
  if (line) context.fillText(line, x, yy);
}
