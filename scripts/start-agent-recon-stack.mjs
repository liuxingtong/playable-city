/**
 * 一键启动 Agent 踏勘相关本地服务（静态页 + 案例库 RAG 代理；可选 GLM 代理与案例库事件进程）。
 *
 * 若设置 CASEBASE_EVENTS_CMD：
 *   1) 先释放 CASEBASE_EVENTS_PORT（默认 8787）上旧监听，避免多实例空响应；
 *   2) 启动事件子进程后轮询 GET …/health，仅 HTTP 200 后再起 RAG 代理与 http.server。
 *
 * 用法（仓库根）：
 *   npm run start:agent-recon
 *
 * 环境变量见 docs/agent-recon-contracts.md §2。
 */
import { spawn, execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "./load-env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
loadDotEnv(ROOT);
const children = [];

const HTTP_PORT = Number(process.env.AGENT_RECON_HTTP_PORT) || 8080;
const PYTHON = process.env.PYTHON || "python";
const NODE = process.execPath;
const EVENTS_PORT = Number(process.env.CASEBASE_EVENTS_PORT) || 8787;
const HEALTH_TIMEOUT_MS = Number(process.env.CASEBASE_EVENTS_HEALTH_TIMEOUT_MS) || 30_000;
const HEALTH_INTERVAL_MS = Number(process.env.CASEBASE_EVENTS_HEALTH_INTERVAL_MS) || 400;

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

/**
 * 结束占用指定 TCP 端口的监听进程（避免 8787 多实例导致空响应）。
 */
function killListenersOnPort(port) {
  if (process.env.CASEBASE_SKIP_KILL_PORT === "1") {
    console.log(`[port ${port}] 已跳过清端口（CASEBASE_SKIP_KILL_PORT=1）`);
    return;
  }
  if (!Number.isFinite(port) || port <= 0) return;
  try {
    if (process.platform === "win32") {
      execSync(
        `powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue; if ($c) { $c | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }"`,
        { stdio: "ignore", windowsHide: true }
      );
    } else {
      const out = execSync(`lsof -ti :${port} 2>/dev/null || true`, {
        encoding: "utf8",
        windowsHide: true,
      });
      for (const pid of out.trim().split(/\n/).filter(Boolean)) {
        try {
          process.kill(Number(pid), "SIGTERM");
        } catch {
          /* ignore */
        }
      }
    }
    console.log(`[port ${port}] 已尝试释放监听进程`);
  } catch {
    /* 无监听或权限不足时忽略 */
  }
}

async function waitForHttp200(url, maxMs, intervalMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 2500);
      const res = await fetch(url, { signal: ac.signal });
      clearTimeout(t);
      if (res.status === 200) return true;
    } catch {
      /* 连接拒绝、超时等 */
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

function shutdown() {
  for (const { cp } of children) {
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

async function main() {
  console.log("=== Agent 踏勘本地栈 ===\n");
  console.log(`playable-city 根: ${ROOT}`);
  console.log(`静态站: http://127.0.0.1:${HTTP_PORT}/pages/agent-recon-mvp.html`);
  console.log(`RAG 代理: http://127.0.0.1:${Number(process.env.CASEBASE_RAG_PORT) || 3851}/v1/rag`);
  const startGlmProxy = process.env.START_WITH_GLM_PROXY === "1" || Boolean(process.env.GLM_API_KEY);
  if (startGlmProxy) {
    console.log(`GLM 代理: http://127.0.0.1:${Number(process.env.GLM_PROXY_PORT) || 3847}/v1/chat/completions`);
  }

  const eventsCmd = process.env.CASEBASE_EVENTS_CMD?.trim();
  const eventsCwd =
    process.env.CASEBASE_EVENTS_CWD?.trim() || process.env.CASE_BASE_ROOT || path.join(ROOT, "..", "case-base");

  if (eventsCmd) {
    const healthBase =
      process.env.CASEBASE_EVENTS_HEALTH_BASE?.replace(/\/$/, "") ||
      `http://127.0.0.1:${EVENTS_PORT}`;
    const healthUrl =
      process.env.CASEBASE_EVENTS_HEALTH_URL?.trim() || `${healthBase}/health`;

    console.log(`案例库事件: ${eventsCmd}`);
    console.log(`案例库工作目录: ${eventsCwd}`);
    console.log(`健康检查: GET ${healthUrl}（200 后才启动 RAG / 静态站）\n`);

    killListenersOnPort(EVENTS_PORT);

    const eventsCp = spawn(eventsCmd, [], {
      cwd: eventsCwd,
      stdio: "inherit",
      env: { ...process.env },
      shell: true,
      windowsHide: true,
    });

    eventsCp.on("error", (err) => {
      console.error(`[casebase-events] 启动失败: ${err.message}`);
    });

    console.log(`[casebase-events] 等待健康检查（最长 ${Math.round(HEALTH_TIMEOUT_MS / 1000)}s）…`);
    const healthy = await waitForHttp200(healthUrl, HEALTH_TIMEOUT_MS, HEALTH_INTERVAL_MS);
    if (!healthy) {
      console.error(
        `[casebase-events] 健康检查未通过: ${healthUrl} 未在超时内返回 HTTP 200，已终止事件进程，未启动 RAG/静态站。`
      );
      try {
        eventsCp.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      process.exit(1);
    }
    console.log(`[casebase-events] 健康检查通过（200）\n`);
    pushChild(eventsCp, "casebase-events");
  } else {
    console.log("案例库事件: 未设置 CASEBASE_EVENTS_CMD（8787 需自行启动，见 README）\n");
  }

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

  if (startGlmProxy) {
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

  const staticServer = path.join(ROOT, "scripts", "serve-static-robust.py");
  pushChild(
    spawn(PYTHON, [staticServer, String(HTTP_PORT)], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env },
      windowsHide: true,
    }),
    "http.server (robust)"
  );

  console.log("Ctrl+C 结束本进程。\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
