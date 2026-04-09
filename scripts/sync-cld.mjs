import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "data", "cld_priority.csv");
const dest = path.join(root, "public", "cld_priority.csv");
const boundary = path.join(root, "data", "daxujiahui-four-streets-union.geojson");
const filterScript = path.join(root, "scripts", "filter-cld-daxujiahui.mjs");

fs.mkdirSync(path.dirname(dest), { recursive: true });

if (!fs.existsSync(src)) {
  console.error("sync:cld: 缺少源文件", path.relative(root, src));
  process.exit(1);
}

if (fs.existsSync(boundary)) {
  execFileSync(process.execPath, [filterScript, "--input", src, "--output", dest], {
    cwd: root,
    stdio: "inherit",
  });
} else {
  console.warn(
    "sync:cld: 未找到大徐家汇边界，跳过裁剪，整表复制:",
    path.relative(root, boundary)
  );
  fs.copyFileSync(src, dest);
}
