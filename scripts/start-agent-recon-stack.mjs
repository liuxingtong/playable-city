/**
 * 一键启动 Agent 踏勘相关本地服务（静态页 + 案例库 RAG 代理；可选 GLM 代理与案例库事件进程）。
 *
 * 用法（仓库根）：
 *   npm run start:agent-recon
 *
 * 环境变量见 docs/agent-recon-contracts.md §2。
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const children = [];

const HTTP_PORT = Number(process.env.AGENT_RECON_HTTP_PORT) || 8080;
const PYTHON = process.env.PYTHON || "python";
const NODE = process.execPath;

function pushChild(cp, label) {
  children.push({ cp, label });
  cp.on("error", (err) => {
    console.error(`[${label}] 启动失败: ${err.message}`);
  });
  cp.on("exit", (code, signal) => {
    if (code != null && code !== 0) {
      console.error(`[${label}] 已退出 code=${code}`);
    }
    if (signal) console.error(`[${label}] 收到信号 ${signal}`);
  });
}

function shutdown() {
  for (const { cp, label } of children) {
    try {
      if (cp.pid && !cp.killed) {
        cp.kill("SIGTERM");
      }
    } catch {
      /* ignore */
    }
  }
  console.log("\n已发送退出信号给子进程（若仍有残留请手动结束）。");
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});

console.log("=== Agent 踏勘本地栈 ===\n");
console.log(`仓库根: ${ROOT}`);
console.log(`静态站: http://127.0.0.1:${HTTP_PORT}/pages/agent-recon-mvp.html`);
console.log(`RAG 代理: http://127.0.0.1:${Number(process.env.CASEBASE_RAG_PORT) || 3851}/v1/rag`);
if (process.env.START_WITH_GLM_PROXY === "1") {
  console.log(`GLM 代理: http://127.0.0.1:${Number(process.env.GLM_PROXY_PORT) || 3847}/v1/chat/completions`);
}
if (process.env.CASEBASE_EVENTS_CMD?.trim()) {
  console.log("案例库事件: 由 CASEBASE_EVENTS_CMD 启动（见控制台输出）");
} else {
  console.log("案例库事件: 未设置 CASEBASE_EVENTS_CMD，请另开终端启动 8787 服务（见契约文档）");
}
console.log("\nCtrl+C 结束本进程。\n");

const ragScript = path.join(ROOT, "scripts", "casebase-rag-proxy.mjs");
pushChild(
  spawn(NODE, [ragScript], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env },
    windowsHide: true,
  }),
  "casebase-rag-proxy"
);

if (process.env.START_WITH_GLM_PROXY === "1") {
  const glmScript = path.join(ROOT, "scripts", "glm-proxy.mjs");
  pushChild(
    spawn(NODE, [glmScript], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env },
      windowsHide: true,
    }),
    "glm-proxy"
  );
}

const eventsCmd = process.env.CASEBASE_EVENTS_CMD?.trim();
if (eventsCmd) {
  const cwd = process.env.CASEBASE_EVENTS_CWD?.trim() || process.env.CASE_BASE_ROOT || path.join(ROOT, "..", "case-base");
  pushChild(
    spawn(eventsCmd, [], {
      cwd,
      stdio: "inherit",
      env: { ...process.env },
      shell: true,
      windowsHide: true,
    }),
    "casebase-events"
  );
}

pushChild(
  spawn(PYTHON, ["-m", "http.server", String(HTTP_PORT)], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env },
    windowsHide: true,
  }),
  "http.server"
);
