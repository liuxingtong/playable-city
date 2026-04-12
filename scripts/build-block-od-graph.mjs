/**
 * 从「地块轨迹样本」xlsx 构建地块有向 OD 网（相邻停留点连边，边权=轨迹条数），
 * 并计算：介数中心性（有向、无权最短路径）、整合度（调和接近性）、边权 PageRank。
 *
 * 用法: node scripts/build-block-od-graph.mjs
 * 输出: data/block-od-activity.csv
 *
 * 多文件合并时轨迹键为 `${stem}|${rn}`，避免不同表中 rn 重号。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_CSV = path.join(ROOT, "data", "block-od-activity.csv");

const INPUTS = [
  { file: path.join(ROOT, "data", "徐汇地块轨迹样本_工作日.xlsx"), key: "weekday" },
  { file: path.join(ROOT, "data", "徐汇地块轨迹样本_周末.xlsx"), key: "weekend" },
];

function rowLonLat(r) {
  const lon = Number(r.lon ?? r.lon_x);
  const lat = Number(r.lat ?? r.lat_x);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { lon, lat };
}

function loadTrajectories() {
  /** @type {Map<string, { id: string|number, stay_id: number }[]>} */
  const byTraj = new Map();
  /** @type {Map<string|number, { sumLon: number, sumLat: number, n: number }>} */
  const centroids = new Map();

  for (const { file, key } of INPUTS) {
    if (!fs.existsSync(file)) {
      console.warn("[build-block-od-graph] skip missing:", file);
      continue;
    }
    const wb = XLSX.readFile(file);
    const sh = wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sh], { defval: "" });
    const stem = path.basename(file, ".xlsx");

    for (const r of rows) {
      const ll = rowLonLat(r);
      if (!ll) continue;
      const id = String(r.Id).trim();
      if (!id) continue;
      const trajKey = `${stem}|${r.rn}`;
      const sid = Number(r.stay_id);
      if (!Number.isFinite(sid)) continue;
      if (!byTraj.has(trajKey)) byTraj.set(trajKey, []);
      byTraj.get(trajKey).push({ id, stay_id: sid });

      const c = centroids.get(id) ?? { sumLon: 0, sumLat: 0, n: 0 };
      c.sumLon += ll.lon;
      c.sumLat += ll.lat;
      c.n += 1;
      centroids.set(id, c);
    }
  }

  for (const arr of byTraj.values()) {
    arr.sort((a, b) => a.stay_id - b.stay_id);
  }

  return { byTraj, centroids };
}

/**
 * 累加有向边权（相邻停留点，跨点不连）
 */
function accumulateEdges(byTraj) {
  /** @type {Map<string, number>} */
  const w = new Map();
  for (const arr of byTraj.values()) {
    for (let i = 0; i < arr.length - 1; i++) {
      const a = String(arr[i].id);
      const b = String(arr[i + 1].id);
      if (a === b) continue;
      const key = `${a}>${b}`;
      w.set(key, (w.get(key) || 0) + 1);
    }
  }
  return w;
}

function buildNodeList(edgeW) {
  const nodes = new Set();
  for (const key of edgeW.keys()) {
    const [u, v] = key.split(">");
    nodes.add(u);
    nodes.add(v);
  }
  return [...nodes];
}

/** 有向图：存在边即视为弧（用于介数 BFS） */
function buildOutNeighbors(edgeW) {
  /** @type {Map<string, Set<string>>} */
  const out = new Map();
  for (const [key, wt] of edgeW) {
    if (wt <= 0) continue;
    const [u, v] = key.split(">");
    if (!out.has(u)) out.set(u, new Set());
    out.get(u).add(v);
  }
  return out;
}

/** 带权出边：u -> Map(v, weight) */
function buildOutWeighted(edgeW) {
  /** @type {Map<string, Map<string, number>>} */
  const out = new Map();
  for (const [key, wt] of edgeW) {
    if (wt <= 0) continue;
    const [u, v] = key.split(">");
    if (!out.has(u)) out.set(u, new Map());
    out.get(u).set(v, wt);
  }
  return out;
}

/**
 * Brandes 介数（有向、无权最短路径）
 * @param {string[]} nodes
 * @param {Map<string, Set<string>>} succ
 */
function betweennessDirected(nodes, succ) {
  const C = new Map(nodes.map((n) => [n, 0]));
  for (const s of nodes) {
    const S = [];
    /** @type {Map<string, string[]>} */
    const Pred = new Map();
    const sigma = new Map(nodes.map((n) => [n, 0]));
    const dist = new Map(nodes.map((n) => [n, -1]));
    sigma.set(s, 1);
    dist.set(s, 0);
    const Q = [s];
    for (let qi = 0; qi < Q.length; qi++) {
      const v = Q[qi];
      S.push(v);
      const nbrs = succ.get(v);
      if (!nbrs) continue;
      for (const w of nbrs) {
        if (dist.get(w) < 0) {
          Q.push(w);
          dist.set(w, dist.get(v) + 1);
        }
        if (dist.get(w) === dist.get(v) + 1) {
          sigma.set(w, sigma.get(w) + sigma.get(v));
          if (!Pred.has(w)) Pred.set(w, []);
          Pred.get(w).push(v);
        }
      }
    }
    const delta = new Map(nodes.map((n) => [n, 0]));
    while (S.length) {
      const w = S.pop();
      for (const v of Pred.get(w) || []) {
        delta.set(v, delta.get(v) + (sigma.get(v) / sigma.get(w)) * (1 + delta.get(w)));
      }
      if (w !== s) C.set(w, C.get(w) + delta.get(w));
    }
  }
  return C;
}

/** 调和接近性（出向）：sum_{t!=s, reachable} 1/d(s,t) */
function harmonicCloseness(nodes, succ) {
  const H = new Map(nodes.map((n) => [n, 0]));
  for (const s of nodes) {
    const dist = new Map(nodes.map((n) => [n, -1]));
    dist.set(s, 0);
    const Q = [s];
    for (let qi = 0; qi < Q.length; qi++) {
      const v = Q[qi];
      const d = dist.get(v);
      const nbrs = succ.get(v);
      if (!nbrs) continue;
      for (const w of nbrs) {
        if (dist.get(w) < 0) {
          dist.set(w, d + 1);
          Q.push(w);
        }
      }
    }
    let sum = 0;
    for (const t of nodes) {
      if (t === s) continue;
      const d = dist.get(t);
      if (d > 0) sum += 1 / d;
    }
    H.set(s, sum);
  }
  return H;
}

function pageRankWeighted(nodes, outW, damping = 0.85, iters = 80) {
  const n = nodes.length;
  if (!n) return new Map();
  const rank = new Map(nodes.map((id) => [id, 1 / n]));
  const outSum = new Map();
  for (const u of nodes) {
    const m = outW.get(u);
    let s = 0;
    if (m) for (const w of m.values()) s += w;
    outSum.set(u, s);
  }

  for (let iter = 0; iter < iters; iter++) {
    const next = new Map(nodes.map((id) => [id, (1 - damping) / n]));
    let dangling = 0;
    for (const u of nodes) {
      const os = outSum.get(u) || 0;
      const ru = rank.get(u);
      if (os <= 0) dangling += ru;
      else {
        const m = outW.get(u);
        for (const [v, w] of m) {
          next.set(v, next.get(v) + (damping * ru * w) / os);
        }
      }
    }
    const leak = damping * (dangling / n);
    for (const id of nodes) next.set(id, next.get(id) + leak);
    for (const id of nodes) rank.set(id, next.get(id));
  }
  return rank;
}

function minMaxNormalize(map) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of map.values()) {
    if (!Number.isFinite(v)) continue;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  if (!Number.isFinite(lo) || hi <= lo) {
    return new Map([...map.keys()].map((k) => [k, 0.5]));
  }
  const out = new Map();
  for (const [k, v] of map) {
    out.set(k, (v - lo) / (hi - lo));
  }
  return out;
}

function main() {
  const { byTraj, centroids } = loadTrajectories();
  if (!byTraj.size) {
    console.error("[build-block-od-graph] no trajectory rows; abort");
    process.exit(1);
  }
  const edgeW = accumulateEdges(byTraj);
  const nodes = buildNodeList(edgeW);
  if (!nodes.length) {
    console.error("[build-block-od-graph] no edges; abort");
    process.exit(1);
  }

  const succ = buildOutNeighbors(edgeW);
  const outW = buildOutWeighted(edgeW);

  const bet = betweennessDirected(nodes, succ);
  const harm = harmonicCloseness(nodes, succ);
  const pr = pageRankWeighted(nodes, outW);

  const betN = minMaxNormalize(bet);
  const harmN = minMaxNormalize(harm);
  const prN = minMaxNormalize(pr);

  const lines = [
    "Id,lon,lat,betweenness_raw,harmonic_raw,pagerank_raw,od_composite,trip_starts,trip_ends,edge_out_w,edge_in_w",
  ];

  const starts = new Map();
  const ends = new Map();
  const outWsum = new Map(nodes.map((n) => [n, 0]));
  const inWsum = new Map(nodes.map((n) => [n, 0]));
  for (const [key, wt] of edgeW) {
    const [u, v] = key.split(">");
    outWsum.set(u, (outWsum.get(u) || 0) + wt);
    inWsum.set(v, (inWsum.get(v) || 0) + wt);
  }
  for (const arr of byTraj.values()) {
    if (arr.length) {
      const a0 = arr[0].id;
      const a1 = arr[arr.length - 1].id;
      starts.set(a0, (starts.get(a0) || 0) + 1);
      ends.set(a1, (ends.get(a1) || 0) + 1);
    }
  }

  for (const id of nodes) {
    const c = centroids.get(id);
    const lon = c && c.n ? c.sumLon / c.n : "";
    const lat = c && c.n ? c.sumLat / c.n : "";
    const b = betN.get(id) ?? 0;
    const h = harmN.get(id) ?? 0;
    const p = prN.get(id) ?? 0;
    const comp = (b + h + p) / 3;
    lines.push(
      [
        id,
        lon,
        lat,
        bet.get(id) ?? 0,
        harm.get(id) ?? 0,
        pr.get(id) ?? 0,
        comp,
        starts.get(id) || 0,
        ends.get(id) || 0,
        outWsum.get(id) || 0,
        inWsum.get(id) || 0,
      ].join(",")
    );
  }

  fs.mkdirSync(path.dirname(OUT_CSV), { recursive: true });
  fs.writeFileSync(OUT_CSV, lines.join("\n"), "utf8");
  console.log(
    `[build-block-od-graph] nodes=${nodes.length} edges=${edgeW.size} trajectories=${byTraj.size} -> ${OUT_CSV}`
  );
}

main();
