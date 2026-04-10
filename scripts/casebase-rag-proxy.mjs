/**
 * 浏览器可调用：转发 POST /v1/rag → 在 CASE_BASE_ROOT 下执行
 *   python scripts/rag_answer_glm.py "<query>" --k 6 --agent-id "<id>" --trace-id "<id>" --json
 *
 * 环境变量：
 *   CASE_BASE_ROOT  默认 ../case-base（相对本仓库根）
 *   PYTHON          默认 python
 *   CASEBASE_RAG_PORT 默认 3851
 *
 * 出错时返回 JSON { error }，HTTP 5xx，不抛未捕获异常。
 */
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.CASEBASE_RAG_PORT) || 3851;
const PYTHON = process.env.PYTHON || "python";
const CASE_BASE_ROOT = process.env.CASE_BASE_ROOT || path.join(ROOT, "..", "case-base");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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
  if (req.url !== "/v1/rag" || req.method !== "POST") {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "POST /v1/rag only" }));
    return;
  }
  try {
    const raw = await readBody(req);
    let body;
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "invalid JSON body" }));
      return;
    }
    const query = String(body.query ?? "").trim();
    const agent_id = String(body.agent_id ?? "").trim();
    const trace_id = String(body.trace_id ?? "").trim();
    const k = Number(body.k) > 0 ? Number(body.k) : 6;
    if (!query || !agent_id || !trace_id) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "需要 query、agent_id、trace_id" }));
      return;
    }
    const result = await runRag(query, agent_id, trace_id, k);
    res.writeHead(result.status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(result.body));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: String(e?.message || e) }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`casebase RAG proxy http://127.0.0.1:${PORT}/v1/rag`);
  console.log(`CASE_BASE_ROOT=${CASE_BASE_ROOT}`);
});
