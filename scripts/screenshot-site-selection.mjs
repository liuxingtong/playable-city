/**
 * 本地起静态服务，用无头浏览器打开场域选址页的「导出模式」并保存 PNG。
 * 浏览器走系统网络拉瓦片，常比 Node 直连 tile 服务器更通。
 *
 * 依赖：npm i -D playwright && npx playwright install chromium
 *
 * 用法（项目根目录；本地静态根即仓库根，打开 pages/xujiahui-site-selection*.html）：
 *   node scripts/screenshot-site-selection.mjs
 *   node scripts/screenshot-site-selection.mjs --clean --width 1600 --height 1000
 *   node scripts/screenshot-site-selection.mjs --light --clean
 *   node scripts/screenshot-site-selection.mjs --light --clean --bw --zoom 14
 *   node scripts/screenshot-site-selection.mjs --light --clean --zoom 15 --scale-hint
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.csv': 'text/csv; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon'
};

function safePathFromUrl(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const rel = path.normalize(decoded).replace(/^[/\\]+/, '');
  if (rel.includes('..')) return null;
  const abs = path.join(ROOT, rel);
  if (!abs.startsWith(ROOT)) return null;
  return abs;
}

function serveFile(res, absPath) {
  fs.readFile(absPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(absPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function parseArgs(argv) {
  const o = {
    clean: false,
    light: false,
    bw: false,
    zoom: null,
    scaleHint: false,
    width: 1600,
    height: 1000,
    waitMs: 3500,
    out: path.join(ROOT, 'output', 'xujiahui-site-selection-screenshot.png')
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--clean') o.clean = true;
    else if (a === '--light') o.light = true;
    else if (a === '--bw') o.bw = true;
    else if (a === '--scale-hint') o.scaleHint = true;
    else if (a === '--zoom' && argv[i + 1]) {
      const z = parseInt(argv[++i], 10);
      if (Number.isFinite(z) && z >= 10 && z <= 19) o.zoom = z;
    } else if (a === '--width' && argv[i + 1]) o.width = Math.max(400, parseInt(argv[++i], 10) || o.width);
    else if (a === '--height' && argv[i + 1]) o.height = Math.max(300, parseInt(argv[++i], 10) || o.height);
    else if (a === '--wait' && argv[i + 1]) o.waitMs = Math.max(500, parseInt(argv[++i], 10) || o.waitMs);
    else if (a === '--out' && argv[i + 1]) o.out = path.resolve(ROOT, argv[++i]);
  }
  return o;
}

async function main() {
  const opts = parseArgs(process.argv);

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error(
      '未找到 playwright。请执行：npm i -D playwright\n然后：npx playwright install chromium'
    );
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    let p = safePathFromUrl(req.url || '/');
    if (p && fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      p = path.join(p, 'index.html');
    }
    if (!p || !fs.existsSync(p) || !fs.statSync(p).isFile()) {
      if (req.url === '/' || req.url?.startsWith('/?')) {
        p = path.join(ROOT, 'pages', 'xujiahui-site-selection.html');
      }
    }
    if (!p || !fs.existsSync(p)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    serveFile(res, p);
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  const port = server.address().port;
  const pageName = opts.light
    ? 'pages/xujiahui-site-selection-osm-light.html'
    : 'pages/xujiahui-site-selection.html';
  const params = new URLSearchParams();
  params.set('export', opts.clean ? 'clean' : '1');
  if (opts.light) {
    if (opts.bw) params.set('bw', '1');
    if (opts.zoom != null) params.set('zoom', String(opts.zoom));
    if (opts.scaleHint) params.set('scaleHint', '1');
  }
  const url = `http://127.0.0.1:${port}/${pageName}?${params.toString()}`;

  fs.mkdirSync(path.dirname(opts.out), { recursive: true });

  const browser = await chromium
    .launch({ channel: 'chrome' })
    .catch(() => chromium.launch());

  try {
    const page = await browser.newPage({
      viewport: { width: opts.width, height: opts.height }
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await new Promise((r) => setTimeout(r, opts.waitMs));
    await page.screenshot({ path: opts.out, type: 'png' });
    console.log('已保存', opts.out);
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
