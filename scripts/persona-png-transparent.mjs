/**
 * 将 profiles/1.jpg … 5.jpg 转为 PNG，白底通过「从边缘泛洪」变透明。
 * 与叙事页嵌入顺序一致：1→独居 2→医疗 3→隔代照料 4→组织者 5→活跃新老年
 *
 * 用法：npm run persona:png
 * 可选环境变量：PERSONA_WHITE=248（RGB 均 ≥ 此值视为可泛洪的白）
 */
import sharp from 'sharp';
import { mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PROFILES = path.join(ROOT, 'profiles');

const WHITE = Math.min(255, Math.max(200, parseInt(process.env.PERSONA_WHITE || '246', 10)));

async function fileExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function floodWhiteToAlpha(data, width, height, channels, threshold) {
  const total = width * height;
  const visited = new Uint8Array(total);
  const q = new Array(total);
  let qh = 0,
    qt = 0;

  const idx = (x, y) => y * width + x;
  const off = (p) => p * channels;

  function nearWhite(p) {
    const i = off(p);
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    return r >= threshold && g >= threshold && b >= threshold;
  }

  function pushEdge(x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = idx(x, y);
    if (visited[p]) return;
    if (!nearWhite(p)) return;
    visited[p] = 1;
    q[qt++] = p;
  }

  for (let x = 0; x < width; x++) {
    pushEdge(x, 0);
    pushEdge(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    pushEdge(0, y);
    pushEdge(width - 1, y);
  }

  while (qh < qt) {
    const p = q[qh++];
    const i = off(p);
    data[i + 3] = 0;
    const x = p % width;
    const y = (p / width) | 0;
    const nbs = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];
    for (const [nx, ny] of nbs) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const np = idx(nx, ny);
      if (visited[np]) continue;
      if (!nearWhite(np)) continue;
      visited[np] = 1;
      q[qt++] = np;
    }
  }
}

async function convertJpgToPng(jpgName, pngName) {
  const inPath = path.join(PROFILES, jpgName);
  const outPath = path.join(PROFILES, pngName);
  if (!(await fileExists(inPath))) {
    console.warn(`跳过（找不到）: ${inPath}`);
    return false;
  }

  const { data, info } = await sharp(inPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (channels !== 4) throw new Error(`预期 RGBA，实际 channels=${channels}`);

  const buf = Buffer.from(data);
  floodWhiteToAlpha(buf, width, height, channels, WHITE);

  await sharp(buf, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(outPath);

  console.log(`OK  ${jpgName} → ${pngName}  (白阈=${WHITE})`);
  return true;
}

await mkdir(PROFILES, { recursive: true });

console.log('Persona 插图去底 → profiles/persona-illust-*.png\n');
for (let n = 1; n <= 5; n++) {
  await convertJpgToPng(`${n}.jpg`, `persona-illust-${n}.png`);
}
