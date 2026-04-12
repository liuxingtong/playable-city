/**
 * 浏览器可调用：POST /v1/rag —— 不经案例库向量库，直接拉取公开网页检索摘要（与 casebase 代理 JSON 形状兼容）。
 *
 * 环境变量：
 *   WEB_RAG_PORT        默认 3852
 *   WEB_RAG_TIMEOUT_MS  单次外联超时，默认 18000
 *   WEB_RAG_USER_AGENT  可选，自定义 UA
 *
 * 返回字段与深化讨论消费端对齐：answer、refs（title/url/snippet），并回显 trace_id、agent_id、query。
 * 网络不可达或解析失败时仍返回 HTTP 200，refs 可为空，answer 含简短说明，避免打断 GLM 讨论链。
 */
import http from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadDotEnv } from "./load-env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
loadDotEnv(ROOT);

const PORT = Number(process.env.WEB_RAG_PORT) || 3852;
const TIMEOUT_MS = Number(process.env.WEB_RAG_TIMEOUT_MS) || 18_000;
const USER_AGENT =
  process.env.WEB_RAG_USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 playable-city-web-rag/1.0";

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

function stripHtml(s) {
  return String(s)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function unwrapRedirectUrl(href) {
  const h = String(href || "").trim();
  if (!h) return "";
  try {
    const u = new URL(h.startsWith("//") ? `https:${h}` : h);
    if (u.hostname.includes("duckduckgo.com") && (u.pathname.includes("/l/") || u.searchParams.has("uddg"))) {
      const uddg = u.searchParams.get("uddg") || u.searchParams.get("u");
      if (uddg) return decodeURIComponent(uddg);
    }
    return u.href;
  } catch {
    return h;
  }
}

/**
 * @param {string} html
 * @param {number} maxK
 * @returns {{ title: string, url: string, snippet: string }[]}
 */
function parseDdgHtmlResults(html, maxK) {
  const refs = [];
  const seen = new Set();
  const linkRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null && refs.length < maxK) {
    const url = unwrapRedirectUrl(m[1]);
    const title = stripHtml(m[2]);
    if (!url || !title) continue;
    const key = url.slice(0, 200);
    if (seen.has(key)) continue;
    seen.add(key);
    const pos = m.index + m[0].length;
    const tail = html.slice(pos, pos + 1400);
    const snMatch = tail.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\//i);
    const snippet = snMatch ? stripHtml(snMatch[1]) : "";
    refs.push({
      title: title.slice(0, 200),
      url: url.slice(0, 2000),
      snippet: snippet.slice(0, 500),
    });
  }
  return refs;
}

/**
 * @param {string} html
 * @param {number} maxK
 */
function parseDdgLiteResults(html, maxK) {
  const refs = [];
  const seen = new Set();
  const linkRe = /<a[^>]*class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null && refs.length < maxK) {
    const url = unwrapRedirectUrl(m[1]);
    const title = stripHtml(m[2]);
    if (!url || !title || url.includes("duckduckgo.com")) continue;
    const key = url.slice(0, 200);
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ title: title.slice(0, 200), url: url.slice(0, 2000), snippet: "" });
  }
  return refs;
}

async function fetchWithTimeout(url, init) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * @param {string} query
 * @param {number} k
 */
async function searchWeb(query, k) {
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  };

  const bodyHtml = `q=${encodeURIComponent(query)}`;
  let errHtml = "";
  try {
    const res = await fetchWithTimeout("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: bodyHtml,
      redirect: "follow",
    });
    const text = await res.text();
    if (res.ok) {
      const refs = parseDdgHtmlResults(text, k);
      if (refs.length) return { refs, engine: "duckduckgo_html" };
    }
  } catch (e) {
    errHtml = e instanceof Error ? e.message : String(e);
  }

  let errLite = "";
  try {
    const liteUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const res2 = await fetchWithTimeout(liteUrl, { method: "GET", headers, redirect: "follow" });
    const text2 = await res2.text();
    if (res2.ok) {
      const refs = parseDdgLiteResults(text2, k);
      if (refs.length) return { refs, engine: "duckduckgo_lite" };
    }
  } catch (e) {
    errLite = e instanceof Error ? e.message : String(e);
  }

  return {
    refs: [],
    engine: "none",
    error: errHtml || errLite || "search_unreachable_or_empty",
  };
}

function buildAnswerFromRefs(refs) {
  if (!refs.length) return "";
  return refs
    .map((r, i) => {
      const sn = r.snippet ? `\n${r.snippet}` : "";
      return `${i + 1}. ${r.title}${sn}\n   ${r.url}`;
    })
    .join("\n\n");
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
    if (pathname === "/health" && req.method === "GET") {
      json(res, 200, { ok: true, service: "web-rag-proxy", port: PORT });
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
      const k = Number(body.k) > 0 ? Math.min(12, Number(body.k)) : 6;
      if (!query || !agent_id || !trace_id) {
        json(res, 400, { error: "需要 query、agent_id、trace_id" });
        return;
      }

      const { refs, engine, error } = await searchWeb(query, k);
      const answer = refs.length
        ? `【网页检索摘要 · ${engine}】\n${buildAnswerFromRefs(refs)}`
        : `【网页检索】当前无可用结果（${error || "empty"}）。请结合场地上下文与本地案例包继续讨论。`;

      json(res, 200, {
        answer,
        refs,
        source: "web_search",
        engine: engine || undefined,
        trace_id,
        agent_id,
        query,
        web_rag_error: refs.length ? undefined : error,
      });
      return;
    }

    json(res, 404, { error: "routes: GET /health, POST /v1/rag" });
  } catch (e) {
    json(res, 500, { error: String(e?.message || e) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`web RAG proxy http://127.0.0.1:${PORT}/v1/rag (DuckDuckGo HTML/Lite)`);
  console.log(`health: GET http://127.0.0.1:${PORT}/health`);
});
