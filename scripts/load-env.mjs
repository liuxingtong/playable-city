import fs from "node:fs";
import path from "node:path";

function stripQuotes(v) {
  const s = String(v ?? "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * 轻量 .env 读取器（零依赖）：
 * - 默认读取仓库根 `.env`
 * - 仅在 key 未存在于 process.env 时写入（命令行显式变量优先）
 */
export function loadDotEnv(rootDir) {
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) return { loaded: false, path: envPath, count: 0 };
  const raw = fs.readFileSync(envPath, "utf8");
  const lines = raw.split(/\r?\n/);
  let count = 0;
  for (const line of lines) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const m = s.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    if (process.env[key] != null && String(process.env[key]).length > 0) continue;
    process.env[key] = stripQuotes(m[2]);
    count += 1;
  }
  return { loaded: true, path: envPath, count };
}

