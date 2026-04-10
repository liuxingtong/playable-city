/**
 * 一键启动 Agent 踏勘相关本地服务（静态页 + 案例库 RAG 代理；可选 GLM 代理与案例库事件进程）。
 *
 * 若设置 CASEBASE_EVENTS_CMD：
 *   1) 先 GET …/health：若已 HTTP 200 则**不**再清端口、**不**起子进程（避免多实例抢 8787）；
 *   2) 否则释放 CASEBASE_EVENTS_PORT（默认 8787）上旧监听，再启动事件子进程；
 *   3) 轮询健康检查，仅 HTTP 200 后再起 RAG 代理与静态站。
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

/** 用于日志展示：弱化命令中的敏感片段 */
function sanitizeDisplayCmd(cmd) {
  let s = String(cmd ?? "").trim();
  if (!s) return "";
  s = s.replace(/\b(api[_-]?key|password|secret|token)\s*=\s*\S+/gi, "$1=<redacted>");
  s = s.replace(/\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD))\s*=\s*\S+/g, "$1=<redacted>");
  return s;
}

async function fetchHealthOnce(url) {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 2500);
    const res = await fetch(url, { signal: ac.signal });
    clearTimeout(t);
    if (res.status === 200) return { ok: true, status: 200 };
    return { ok: false, status: res.status };
  } catch (e) {
    const code = e && typeof e === "object" && "cause" in e && e.cause && typeof e.cause === "object" && "code" in e.cause
      ? String(e.cause.code)
      : e && typeof e === "object" && "code" in e
        ? String(e.code)
        : "";
    const msg = e instanceof Error ? e.message : String(e);
    if (e?.name === "AbortError") return { ok: false, err: "request_timeout_2.5s" };
    return { ok: false, err: code ? `${code} (${msg})` : msg };
  }
}

function formatHealthFailure(h) {
  if (h.ok) return "HTTP 200";
  if (h.status != null) return `HTTP ${h.status}`;
  return h.err || "unknown_error";
}

async function waitForHttp200(url, maxMs, intervalMs) {
  const start = Date.now();
  let last = /** @type {{ ok: false; status?: number; err?: string }} */ ({ ok: false, err: "not_yet" });
  while (Date.now() - start < maxMs) {
    last = await fetchHealthOnce(url);
    if (last.ok) return { ok: true, last };
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { ok: false, last };
}

function waitSpawnOrError(cp) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    cp.once("error", (err) => done({ type: "error", err }));
    cp.once("spawn", () => done({ type: "spawn" }));
  });
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

    const displayCmd = sanitizeDisplayCmd(eventsCmd);
    console.log(`[casebase-events] 执行命令（脱敏）: ${displayCmd || "(空)"}`);
    console.log(`[casebase-events] cwd: ${eventsCwd}`);
    console.log(`[casebase-events] 健康检查 URL: ${healthUrl}`);

    const preHealth = await fetchHealthOnce(healthUrl);
    if (preHealth.ok) {
      console.log(
        `[casebase-events] 健康检查结果: HTTP 200 — 已有可用实例，跳过清端口与子进程启动（避免 8787 多实例冲突）。\n`
      );
    } else {
      console.log(
        `[casebase-events] 健康检查（启动前探测）: ${formatHealthFailure(preHealth)} — 将尝试释放端口并启动子进程。`
      );

      killListenersOnPort(EVENTS_PORT);

      const eventsCp = spawn(eventsCmd, [], {
        cwd: eventsCwd,
        stdio: "inherit",
        env: { ...process.env },
        shell: true,
        windowsHide: true,
      });

      const spawned = await waitSpawnOrError(eventsCp);
      if (spawned.type === "error") {
        console.error(
          `[casebase-events] 子进程 spawn 失败: ${spawned.err?.message || spawned.err}（请检查命令、PATH、以及 CASEBASE_EVENTS_CWD 是否为 case-base 根目录）`
        );
        process.exit(1);
      }

      let earlyExit = /** @type {{ code: number | null; signal: NodeJS.Signals | null } | null} */ (null);
      const onExit = (code, signal) => {
        earlyExit = { code: code ?? null, signal: signal ?? null };
      };
      eventsCp.on("exit", onExit);

      console.log(
        `[casebase-events] 轮询健康检查 GET ${healthUrl}（最长 ${Math.round(HEALTH_TIMEOUT_MS / 1000)}s，间隔 ${HEALTH_INTERVAL_MS}ms）…`
      );
      const healthWait = await waitForHttp200(healthUrl, HEALTH_TIMEOUT_MS, HEALTH_INTERVAL_MS);
      eventsCp.off("exit", onExit);

      if (!healthWait.ok) {
        const last = healthWait.last;
        console.error(`[casebase-events] 健康检查失败: 超时或始终非 200`);
        console.error(`[casebase-events] 健康检查 URL: ${healthUrl}`);
        console.error(
          `[casebase-events] 最后一次探测结果: ${formatHealthFailure(/** @type {*} */ (last))}`
        );
        if (earlyExit) {
          console.error(
            `[casebase-events] 子进程已退出: code=${earlyExit.code ?? "null"} signal=${earlyExit.signal ?? "null"}（若 code≠0 多为脚本/依赖错误；端口被占见 EADDRINUSE 类提示）`
          );
        } else if (String(last?.err ?? "").includes("ECONNREFUSED")) {
          console.error(
            `[casebase-events] 可能原因: 目标端口无监听（进程未起来或监听地址非 127.0.0.1）。`
          );
        }
        try {
          eventsCp.kill("SIGTERM");
        } catch {
          /* ignore */
        }
        process.exit(1);
      }
      console.log(`[casebase-events] 健康检查通过: GET ${healthUrl} → HTTP 200\n`);
      pushChild(eventsCp, "casebase-events");
    }
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
