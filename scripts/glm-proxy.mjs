/**
 * 本地 CORS 代理：将浏览器请求转发到智谱 chat/completions。
 *
 * 用法：
 *   set GLM_API_KEY=你的key
 *   npm run glm:proxy
 *
 * 前端：
 *   proxyUrl = http://127.0.0.1:3847/v1/chat/completions
 *   proxyImageUrl = http://127.0.0.1:3847/v1/images/generations
 * 浏览器 apiKey 可保持占位，由本服务注入 Authorization。
 */
import http from "node:http";

const PORT = Number(process.env.GLM_PROXY_PORT) || 3847;
const CHAT_UPSTREAM =
  process.env.GLM_API_BASE || "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const IMAGE_UPSTREAM =
  process.env.GLM_IMAGE_API_BASE || "https://open.bigmodel.cn/api/paas/v4/images/generations";
const API_KEY = process.env.GLM_API_KEY || "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const isChat = req.url === "/v1/chat/completions" && req.method === "POST";
  const isImage = req.url === "/v1/images/generations" && req.method === "POST";
  if (!isChat && !isImage) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("POST /v1/chat/completions or /v1/images/generations");
    return;
  }

  if (!API_KEY) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "缺少环境变量 GLM_API_KEY" }));
    return;
  }

  try {
    const raw = await readBody(req);
    const upstream = isChat ? CHAT_UPSTREAM : IMAGE_UPSTREAM;
    const r = await fetch(upstream, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: raw,
    });
    const text = await r.text();
    res.writeHead(r.status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(text);
  } catch (e) {
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: String(e?.message || e) }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`GLM proxy chat   http://127.0.0.1:${PORT}/v1/chat/completions -> ${CHAT_UPSTREAM}`);
  console.log(`GLM proxy image  http://127.0.0.1:${PORT}/v1/images/generations -> ${IMAGE_UPSTREAM}`);
});
