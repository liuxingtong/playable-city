/**
 * 浏览器可调用：转发 POST /v1/rag → 在 CASE_BASE_ROOT 下执行
 *   python scripts/rag_answer_glm.py "<query>" --k 6 --agent-id "<id>" --trace-id "<id>" --json
 * POST /v1/poi-around → 服务端请求 Overpass，返回周边 amenity/shop/leisure/tourism 节点列表（供 Agent 上下文）
 *
 * 环境变量：
 *   CASE_BASE_ROOT  默认 ../case-base（相对本仓库根）
 *   PYTHON          默认 python
 *   CASEBASE_RAG_PORT 默认 3851
 *   CASEBASE_EVENTS_UPSTREAM  案例库事件服务根 URL，默认 http://127.0.0.1:8787
 *     本代理转发 GET /events、GET /events/stream（带 CORS），供 8080 静态页跨源访问。
 *
 * 出错时返回 JSON { error }，HTTP 5xx，不抛未捕获异常。
 */
import http from "node:http";
import https from "node:https";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "./load-env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
loadDotEnv(ROOT);
const PORT = Number(process.env.CASEBASE_RAG_PORT) || 3851;
const PYTHON = process.env.PYTHON || "python";
const CASE_BASE_ROOT = process.env.CASE_BASE_ROOT || path.join(ROOT, "..", "case-base");
const SEMANTIC_LOG_DIR =
  process.env.AGENT_RECON_SEMANTIC_LOG_DIR || path.join(ROOT, "data", "agent-recon-semantic");
const SEMANTIC_LOG_FILE = process.env.AGENT_RECON_SEMANTIC_LOG_FILE || "semantic-events.jsonl";
const SEMANTIC_LOG_PATH = path.join(SEMANTIC_LOG_DIR, SEMANTIC_LOG_FILE);
const SEMANTIC_LIST_MAX = 2000;
const EVENTS_UPSTREAM_RAW = (process.env.CASEBASE_EVENTS_UPSTREAM || "http://127.0.0.1:8787").replace(/\/$/, "");

const DEFAULT_OVERPASS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

function overpassEndpoints() {
  const raw = process.env.OVERPASS_ENDPOINTS;
  if (raw && String(raw).trim()) {
    return String(raw)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return DEFAULT_OVERPASS;
}

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const p = Math.PI / 180;
  const dLat = (lat2 - lat1) * p;
  const dLon = (lon2 - lon1) * p;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * @param {number} lat
 * @param {number} lon
 * @param {number} radiusM
 * @param {number} maxItems
 */
async function queryOverpassPois(lat, lon, radiusM, maxItems) {
  const rad = Math.min(800, Math.max(50, Math.round(radiusM)));
  const maxOut = Math.min(100, Math.max(8, Math.round(maxItems)));
  const ql = `[out:json][timeout:20];
(
  node["amenity"](around:${rad},${lat},${lon});
  node["shop"](around:${rad},${lat},${lon});
  node["leisure"](around:${rad},${lat},${lon});
  node["tourism"](around:${rad},${lat},${lon});
);
out ${maxOut + 40};
`;
  const formBody = `data=${encodeURIComponent(ql)}`;
  let lastErr = /** @type {Error|null} */ (null);
  for (const ep of overpassEndpoints()) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 22000);
      const res = await fetch(ep, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody,
        signal: ac.signal,
      });
      clearTimeout(timer);
      const text = await res.text();
      if (!res.ok) {
        lastErr = new Error(`Overpass HTTP ${res.status} @ ${ep}`);
        continue;
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        lastErr = new Error("Overpass 响应非 JSON");
        continue;
      }
      const els = Array.isArray(data.elements) ? data.elements : [];
      const rows = [];
      for (const el of els) {
        if (el.type !== "node" || !Number.isFinite(el.lat) || !Number.isFinite(el.lon)) continue;
        const tags = el.tags && typeof el.tags === "object" ? el.tags : {};
        const kind = String(tags.amenity || tags.shop || tags.leisure || tags.tourism || tags.healthcare || "tagged").slice(
          0,
          48
        );
        const name = String(tags.name || tags["name:zh"] || tags["name:en"] || `未命名(${kind})`).slice(0, 96);
        rows.push({ name, kind, dist_m: Math.round(haversineM(lat, lon, el.lat, el.lon)) });
      }
      rows.sort((a, b) => a.dist_m - b.dist_m);
      const seen = new Set();
      const lines = [];
      for (const r of rows) {
        const key = `${r.name}\0${r.kind}\0${r.dist_m}`;
        if (seen.has(key)) continue;
        seen.add(key);
        lines.push(`${lines.length + 1}. ${r.name} [${r.kind}] ~${r.dist_m}m`);
        if (lines.length >= maxOut) break;
      }
      return { lines, remark: data.remark || null };
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr || new Error("Overpass 全部端点失败");
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

/**
 * 将浏览器对 /events、/events/stream 的请求转发到案例库进程，并保留本服务已设置的 CORS 头。
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
function proxyCasebaseEvents(req, res) {
  let targetUrl;
  try {
    targetUrl = new URL(req.url || "/", `${EVENTS_UPSTREAM_RAW}/`);
  } catch {
    json(res, 500, { error: "invalid CASEBASE_EVENTS_UPSTREAM" });
    return;
  }
  const lib = targetUrl.protocol === "https:" ? https : http;
  const opts = {
    protocol: targetUrl.protocol,
    hostname: targetUrl.hostname,
    port: targetUrl.port || (targetUrl.protocol === "https:" ? 443 : 80),
    path: targetUrl.pathname + targetUrl.search,
    method: "GET",
    headers: {
      Accept: req.headers.accept || "text/event-stream, application/json",
    },
  };
  const pReq = lib.request(opts, (pRes) => {
    res.statusCode = pRes.statusCode || 502;
    for (const [k, v] of Object.entries(pRes.headers)) {
      const kl = k.toLowerCase();
      if (v == null || HOP_BY_HOP.has(kl) || kl.startsWith("access-control-")) continue;
      const val = Array.isArray(v) ? v.join(", ") : v;
      res.setHeader(k, val);
    }
    pRes.pipe(res);
  });
  pReq.on("error", (e) => {
    if (res.headersSent) {
      try {
        res.destroy();
      } catch {
        /* ignore */
      }
      return;
    }
    json(res, 502, { error: `events upstream: ${e.message}` });
  });
  pReq.end();
}

function nowIso() {
  return new Date().toISOString();
}

function asFiniteNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeSemanticEvent(body) {
  const score = asFiniteNumber(body?.score);
  if (score == null) return null;
  const lat = asFiniteNumber(body?.lat);
  const lon = asFiniteNumber(body?.lon);
  const priority = asFiniteNumber(body?.priority);
  const distM = asFiniteNumber(body?.streetview_dist_m);
  const occurredAtRaw = String(body?.occurred_at || "").trim();
  const occurred_at = occurredAtRaw || nowIso();
  return {
    event_type: "streetview_semantic",
    occurred_at,
    logged_at: nowIso(),
    trace_id: String(body?.trace_id || "").trim(),
    agent_id: String(body?.agent_id || "").trim(),
    agent_label: String(body?.agent_label || "").trim(),
    score: Math.max(0, Math.min(1, score)),
    reason: String(body?.reason || "").slice(0, 1200),
    model: String(body?.model || "").trim(),
    vision_model: String(body?.vision_model || "").trim(),
    streetview_id: String(body?.streetview_id || "").trim(),
    streetview_image: String(body?.streetview_image || "").trim(),
    streetview_dist_m: distM,
    lat,
    lon,
    priority,
    features: body?.features && typeof body.features === "object" && !Array.isArray(body.features) ? body.features : null,
    source: "agent-recon-glm",
  };
}

async function appendSemanticEvent(event) {
  await fs.promises.mkdir(SEMANTIC_LOG_DIR, { recursive: true });
  await fs.promises.appendFile(SEMANTIC_LOG_PATH, `${JSON.stringify(event)}\n`, "utf8");
}

async function readSemanticEvents(limit) {
  if (!fs.existsSync(SEMANTIC_LOG_PATH)) return [];
  const content = await fs.promises.readFile(SEMANTIC_LOG_PATH, "utf8");
  const lines = content.split(/\r?\n/).filter(Boolean);
  const max = Math.min(SEMANTIC_LIST_MAX, Math.max(1, Number(limit) || 100));
  const sliced = lines.slice(Math.max(0, lines.length - max));
  const out = [];
  for (const line of sliced) {
    try {
      out.push(JSON.parse(line));
    } catch {
      /* skip bad line */
    }
  }
  return out;
}

function runRag(query, agentId, traceId, k) {
  const script = path.join(CASE_BASE_ROOT, "scripts", "rag_answer_glm.py");
  if (!fs.existsSync(script)) {
    return Promise.resolve({
      ok: false,
      status: 500,
      body: { error: `未找到脚本: ${script}，请设置 CASE_BASE_ROOT=${CASE_BASE_ROOT}` },
    });
  }
  const args = [script, query, "--k", String(k), "--agent-id", agentId, "--trace-id", traceId, "--json"];
  return new Promise((resolve) => {
    const proc = spawn(PYTHON, args, {
      cwd: CASE_BASE_ROOT,
      windowsHide: true,
      env: { ...process.env },
    });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => {
      out += d.toString("utf8");
    });
    proc.stderr.on("data", (d) => {
      err += d.toString("utf8");
    });
    proc.on("error", (e) => {
      resolve({
        ok: false,
        status: 500,
        body: { error: `spawn failed: ${e.message}`, stderr: err },
      });
    });
    proc.on("close", (code) => {
      const raw = out.trim() || err.trim();
      let json = null;
      try {
        json = JSON.parse(raw);
      } catch {
        const m = raw.match(/\{[\s\S]*\}\s*$/);
        if (m) {
          try {
            json = JSON.parse(m[0]);
          } catch {
            /* ignore */
          }
        }
      }
      if (code !== 0 && !json) {
        resolve({
          ok: false,
          status: 502,
          body: {
            error: `python exit ${code}`,
            stderr: err.slice(0, 2000),
            stdout: out.slice(0, 2000),
          },
        });
        return;
      }
      if (!json) {
        resolve({
          ok: false,
          status: 502,
          body: { error: "无法解析 JSON 输出", stdout: out.slice(0, 2000), stderr: err.slice(0, 500) },
        });
        return;
      }
      resolve({ ok: true, status: 200, body: json });
    });
  });
}

const server = http.createServer(async (req, res) => {
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const reqUrl = new URL(req.url || "/", "http://127.0.0.1");
  const pathname = reqUrl.pathname;
  try {
    if ((pathname === "/events/stream" || pathname === "/events") && req.method === "GET") {
      proxyCasebaseEvents(req, res);
      return;
    }

    if (pathname === "/v1/rag" && req.method === "POST") {
      const raw = await readBody(req);
      let body;
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        json(res, 400, { error: "invalid JSON body" });
        return;
      }
      const query = String(body.query ?? "").trim();
      const agent_id = String(body.agent_id ?? "").trim();
      const trace_id = String(body.trace_id ?? "").trim();
      const k = Number(body.k) > 0 ? Number(body.k) : 6;
      if (!query || !agent_id || !trace_id) {
        json(res, 400, { error: "需要 query、agent_id、trace_id" });
        return;
      }
      const result = await runRag(query, agent_id, trace_id, k);
      json(res, result.status, result.body);
      return;
    }

    if (pathname === "/v1/streetview-semantic/log" && req.method === "POST") {
      const raw = await readBody(req);
      let body;
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        json(res, 400, { error: "invalid JSON body" });
        return;
      }
      const event = normalizeSemanticEvent(body);
      if (!event) {
        json(res, 400, { error: "需要有效 score（number）" });
        return;
      }
      await appendSemanticEvent(event);
      json(res, 200, {
        ok: true,
        path: SEMANTIC_LOG_PATH,
        event_type: event.event_type,
        logged_at: event.logged_at,
      });
      return;
    }

    if (pathname === "/v1/streetview-semantic/events" && req.method === "GET") {
      const limit = Number(reqUrl.searchParams.get("limit")) || 100;
      const events = await readSemanticEvents(limit);
      json(res, 200, {
        count: events.length,
        path: SEMANTIC_LOG_PATH,
        events,
      });
      return;
    }

    if (pathname === "/v1/poi-around" && req.method === "POST") {
      const raw = await readBody(req);
      let body;
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        json(res, 400, { error: "invalid JSON body" });
        return;
      }
      const lat = Number(body.lat);
      const lon = Number(body.lon);
      const radius_m = Number(body.radius_m) > 0 ? Number(body.radius_m) : 280;
      const max_items = Number(body.max_items) > 0 ? Number(body.max_items) : 48;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        json(res, 400, { error: "需要有效 lat、lon（number）" });
        return;
      }
      try {
        const { lines, remark } = await queryOverpassPois(lat, lon, radius_m, max_items);
        json(res, 200, { ok: true, lines, count: lines.length, source: "openstreetmap/overpass", remark: remark || undefined });
      } catch (e) {
        json(res, 502, {
          ok: false,
          lines: [],
          error: String(e?.message || e),
          hint: "可检查网络、Overpass 限流，或设置 OVERPASS_ENDPOINTS 指向可用实例",
        });
      }
      return;
    }

    json(res, 404, {
      error:
        "routes: GET /events, GET /events/stream, POST /v1/rag, POST /v1/poi-around, POST /v1/streetview-semantic/log, GET /v1/streetview-semantic/events",
    });
  } catch (e) {
    json(res, 500, { error: String(e?.message || e) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`casebase RAG proxy http://127.0.0.1:${PORT}/v1/rag`);
  console.log(`POI around: POST http://127.0.0.1:${PORT}/v1/poi-around`);
  console.log(`events proxy GET /events /events/stream -> ${EVENTS_UPSTREAM_RAW}`);
  console.log(`CASE_BASE_ROOT=${CASE_BASE_ROOT}`);
  console.log(`semantic log: POST /v1/streetview-semantic/log -> ${SEMANTIC_LOG_PATH}`);
});
