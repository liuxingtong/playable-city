import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import * as d3 from "d3";
import { PERSONA_AXES, attachPersonaScoresAndPercentiles } from "./personaFive.js";

/* ═══════════════════ THEME ═══════════════════ */
const T = {
  bg: "#0a0a0a", panel: "rgba(14,14,14,0.92)",
  accent: "#DA4BA3", accentDim: "rgba(218,75,163,0.25)",
  text: "#f0f0f0", textMid: "rgba(255,255,255,0.6)",
  textDim: "rgba(255,255,255,0.35)", border: "rgba(218,75,163,0.15)",
  font: "'DM Sans','Noto Sans SC',system-ui,sans-serif",
};

const P_KEYS = ["p_elder", "p_student", "p_white", "p_family", "p_wander"];
const WP_KEYS = ["Wp_elder", "Wp_student", "Wp_white", "Wp_family", "Wp_wander"];

/** 与 lib/ac-dom-aggregate.js 同步：五主导列齐全则五列均值；否则四列齐全则四列均值；否则 csvi_AC_phys */
const AC_DOM_KEYS = ["AC_med_dom", "AC_tech_dom", "AC_mkt_dom", "AC_sport_dom", "AC_soc_cul_dom"];
const AC_DOM_KEYS_LEGACY = ["AC_med_dom", "AC_tech_dom", "AC_mkt_dom", "AC_sport_dom"];
function acCellNum(d, k) {
  if (!d || d[k] === "" || d[k] == null) return NaN;
  const n = Number(d[k]);
  return Number.isFinite(n) ? n : NaN;
}
function effectiveAcPhysFromRow(d) {
  const vals5 = AC_DOM_KEYS.map((k) => acCellNum(d, k));
  if (vals5.every((v) => Number.isFinite(v)))
    return vals5.reduce((s, v) => s + v, 0) / 5;
  const vals4 = AC_DOM_KEYS_LEGACY.map((k) => acCellNum(d, k));
  if (vals4.every((v) => Number.isFinite(v)))
    return vals4.reduce((s, v) => s + v, 0) / 4;
  const p = Number(d.csvi_AC_phys);
  return Number.isFinite(p) ? p : 0;
}
function rowHasAcDomSplit(d) {
  return (
    AC_DOM_KEYS.every((k) => Number.isFinite(acCellNum(d, k))) ||
    AC_DOM_KEYS_LEGACY.every((k) => Number.isFinite(acCellNum(d, k)))
  );
}

/* ═══════════════════ COLOR SCALE ═══════════════════ */
const STOPS = [[0,[22,12,24]],[.25,[85,32,78]],[.5,[145,52,118]],[.75,[185,66,145]],[1,[218,75,163]]];
function csviRgb(v) {
  v = Math.max(0, Math.min(1, v));
  let lo = STOPS[0], hi = STOPS[STOPS.length-1];
  for (let i = 0; i < STOPS.length-1; i++) {
    if (v >= STOPS[i][0] && v <= STOPS[i+1][0]) { lo = STOPS[i]; hi = STOPS[i+1]; break; }
  }
  const t = (v - lo[0]) / (hi[0] - lo[0] + 1e-6);
  return [lo[1][0]+t*(hi[1][0]-lo[1][0]), lo[1][1]+t*(hi[1][1]-lo[1][1]), lo[1][2]+t*(hi[1][2]-lo[1][2])].map(Math.round);
}
function csviRgba(v, a=1) { const [r,g,b] = csviRgb(v); return `rgba(${r},${g},${b},${a})`; }

/* ═══════════════════ SYNTHETIC DATA ═══════════════════ */
/* ═══════════════════ EMPIRICAL PERCENTILE (same as map_intervention_nodes) ═══════════════════ */
function attachPercentileRanks(data) {
  return attachPersonaScoresAndPercentiles(data);
}

function makeDemoData(n = 3000) {
  const rng = d3.randomNormal(0.5, 0.18);
  const rngS = d3.randomNormal(0.15, 0.06);
  const arr = Array.from({ length: n }, (_, i) => {
    const N_YP = Math.max(0, Math.min(1, rng()));
    const N08  = Math.max(0, Math.min(1, d3.randomNormal(0.42, 0.15)()));
    const csvi_E = Math.max(0, Math.min(1, d3.randomNormal(0.48, 0.18)()));
    const csvi_AC_phys = Math.max(0, Math.min(1, Math.abs(d3.randomNormal(0.04, 0.035)())));
    const csvi_AC_social = Math.max(0, Math.min(1, Math.abs(d3.randomNormal(0.12, 0.09)())));
    const csvi_S_env = Math.max(0, Math.min(1, rngS()));
    const csvi_S_contact = Math.max(0, Math.min(1, d3.randomNormal(0.35, 0.14)()));
    const W_work = N_YP * N08;
    const W_elder = csvi_E * (csvi_AC_phys + 1);
    const S = csvi_S_env + csvi_S_contact;
    const AC = csvi_AC_phys * csvi_AC_social;
    const CSVI = (csvi_E * S) / (AC + 1);
    const N_CD = Math.max(0, Math.min(1, d3.randomNormal(0.2, 0.12)() ));
    const N_OS = Math.max(0, Math.min(1, d3.randomNormal(0.35, 0.14)() ));
    return {
      id: i, W_work, W_elder, CSVI, csvi_E, csvi_S_env, csvi_S_contact,
      csvi_AC_phys, ac_phys_tabular: csvi_AC_phys, hasAcDom: false,
      csvi_AC_social, S, AC, N_YP, N08,
      cpvi_E: csvi_E, cpvi_S: S, cpvi_AC: csvi_AC_phys, N_UD: N_YP, N09: N08, N_CD, N_OS,
      acPhysEff: csvi_AC_phys,
    };
  });
  return attachPercentileRanks(arr);
}

/* ═══════════════════ PROCESS UPLOADED DATA ═══════════════════ */
function processUploadedRows(rows) {
  const out = rows.map((d, i) => {
    const N_YP = +d.N_YP || +d.N_UD || +d.pop_total || 0;
    const N08 = +d.N08 || +d.N09 || 0;
    const csvi_E = +d.csvi_E || +d.cpvi_E || 0;
    const csvi_AC_phys_eff = effectiveAcPhysFromRow(d);
    const csvi_AC_phys_tab = Number(d.csvi_AC_phys) || Number(d.cpvi_AC) || 0;
    const hasAcDom = rowHasAcDomSplit(d);
    const csvi_AC_social = +d.csvi_AC_social || 0;
    const csvi_S_env = +d.csvi_S_env || 0;
    const csvi_S_contact = +d.csvi_S_contact || 0;
    let cpvi_S = Number(d.cpvi_S);
    if (!Number.isFinite(cpvi_S)) cpvi_S = csvi_S_env + csvi_S_contact;
    const W_work = N_YP * N08;
    const W_elder = csvi_E * (csvi_AC_phys_eff + 1);
    const S = csvi_S_env + csvi_S_contact;
    const AC = csvi_AC_phys_eff * csvi_AC_social;
    const CSVI = (csvi_E * S) / (AC + 1);
    const N_CD = +d.N_CD || 0;
    const N_OS = +d.N_OS || 0;
    return {
      id: i, W_work, W_elder, CSVI, csvi_E, csvi_S_env, csvi_S_contact,
      csvi_AC_phys: csvi_AC_phys_eff, ac_phys_tabular: csvi_AC_phys_tab, hasAcDom,
      csvi_AC_social, S, AC, N_YP, N08, lon: +d.lon, lat: +d.lat,
      cpvi_E: csvi_E, cpvi_S, cpvi_AC: csvi_AC_phys_eff, N_UD: N_YP, N09: N08, N_CD, N_OS,
      acPhysEff: csvi_AC_phys_eff,
    };
  });
  return attachPercentileRanks(out);
}

/* ═══════════════════ RADAR · 五类在地智能体（Canvas） ═══════════════════ */
const MARGIN_R = { top: 52, right: 36, bottom: 48, left: 36 };

function radarVertex(cx, cy, R, axisIndex, t) {
  const a = -Math.PI / 2 + (axisIndex * 2 * Math.PI) / 5;
  return [cx + R * t * Math.cos(a), cy + R * t * Math.sin(a)];
}

function tracePentagonPath(ctx, cx, cy, R, d) {
  for (let i = 0; i < 5; i++) {
    const t = Math.max(0, Math.min(1, d[P_KEYS[i]] ?? 0));
    const [x, y] = radarVertex(cx, cy, R, i, t);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function RadarCanvas({ data, width, height, hovered, setHovered }) {
  const canvasRef = useRef(null);
  const qtRef = useRef(null);
  const plotW = width - MARGIN_R.left - MARGIN_R.right;
  const plotH = height - MARGIN_R.top - MARGIN_R.bottom;
  const cx = MARGIN_R.left + plotW / 2;
  const cy = MARGIN_R.top + plotH / 2;
  const R = Math.min(plotW, plotH) * 0.36;

  const csviNorm = useMemo(() => {
    const cExt = d3.extent(data, (d) => d.CSVI);
    return d3.scaleLinear().domain(cExt[0] === cExt[1] ? [0, 1] : cExt).range([0, 1]).clamp(true);
  }, [data]);

  const meanP = useMemo(() => P_KEYS.map((k) => d3.mean(data, (d) => d[k]) || 0), [data]);

  const centroids = useMemo(() => {
    return data.map((d) => {
      let sx = 0,
        sy = 0;
      for (let i = 0; i < 5; i++) {
        const t = Math.max(0, Math.min(1, d[P_KEYS[i]] ?? 0));
        const [x, y] = radarVertex(cx, cy, R, i, t);
        sx += x;
        sy += y;
      }
      return { x: sx / 5, y: sy / 5, d };
    });
  }, [data, cx, cy, R]);

  useEffect(() => {
    qtRef.current = d3
      .quadtree()
      .x((p) => p.x)
      .y((p) => p.y)
      .addAll(centroids);
  }, [centroids]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    for (let g = 1; g <= 4; g++) {
      const rg = (R * g) / 4;
      ctx.beginPath();
      for (let i = 0; i <= 5; i++) {
        const ii = i % 5;
        const [x, y] = radarVertex(cx, cy, rg, ii, 1);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    for (let i = 0; i < 5; i++) {
      const [x, y] = radarVertex(cx, cy, R, i, 1);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x, y);
      ctx.strokeStyle = "rgba(218,75,163,0.22)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.font = `500 10px ${T.font}`;
      ctx.fillStyle = T.textMid;
      ctx.textAlign = "center";
      const lx = cx + (R + 28) * Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / 5);
      const ly = cy + (R + 28) * Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / 5);
      ctx.fillText(PERSONA_AXES[i].cn, lx, ly + 3);
    }

    const pool = data.length > 2400 ? d3.shuffle([...data]).slice(0, 2400) : data;
    const sorted = [...pool].sort((a, b) => a.CSVI - b.CSVI);
    for (const d of sorted) {
      const nv = csviNorm(d.CSVI);
      ctx.beginPath();
      tracePentagonPath(ctx, cx, cy, R, d);
      ctx.fillStyle = csviRgba(nv, 0.035);
      ctx.fill();
    }
    for (const d of sorted) {
      const nv = csviNorm(d.CSVI);
      ctx.beginPath();
      tracePentagonPath(ctx, cx, cy, R, d);
      ctx.strokeStyle = csviRgba(nv, 0.11);
      ctx.lineWidth = 0.4;
      ctx.stroke();
    }

    const meanD = { id: -1 };
    P_KEYS.forEach((k, i) => {
      meanD[k] = meanP[i];
    });
    ctx.beginPath();
    tracePentagonPath(ctx, cx, cy, R, meanD);
    ctx.fillStyle = "rgba(218,75,163,0.14)";
    ctx.fill();
    ctx.beginPath();
    tracePentagonPath(ctx, cx, cy, R, meanD);
    ctx.strokeStyle = "rgba(255,255,255,0.92)";
    ctx.lineWidth = 2.2;
    ctx.stroke();

    if (hovered && hovered.id !== -1) {
      ctx.beginPath();
      tracePentagonPath(ctx, cx, cy, R, hovered);
      ctx.fillStyle = "rgba(218,75,163,0.22)";
      ctx.fill();
      ctx.beginPath();
      tracePentagonPath(ctx, cx, cy, R, hovered);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.4;
      ctx.stroke();
    }

    ctx.fillStyle = T.textDim;
    ctx.font = `400 10px ${T.font}`;
    ctx.textAlign = "center";
    ctx.fillText(
      "五维雷达 · 各轴 = 一类人群的 W 分轴在边表上的分位 P(Wp) · 叠层 = 街段 · 白边 = 全体均值",
      width / 2,
      height - 12
    );
  }, [data, width, height, hovered, cx, cy, R, csviNorm, meanP]);

  const handleMouse = useCallback(
    (e) => {
      const canvas = canvasRef.current;
      if (!canvas || !qtRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const found = qtRef.current.find(mx, my, 24);
      setHovered(found ? found.d : null);
    },
    [setHovered]
  );

  return (
    <div style={{ position: "relative" }}>
      <canvas ref={canvasRef} style={{ width, height, cursor: "default" }} onMouseMove={handleMouse} onMouseLeave={() => setHovered(null)} />
      {hovered && hovered.id !== -1 && (
        <div
          style={{
            position: "absolute",
            right: 12,
            top: MARGIN_R.top + 4,
            background: T.panel,
            border: `1px solid ${T.accentDim}`,
            borderRadius: 8,
            padding: "10px 14px",
            pointerEvents: "none",
            backdropFilter: "blur(12px)",
            zIndex: 10,
            minWidth: 200,
            fontFamily: T.font,
            fontSize: 11,
            color: T.text,
            boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: T.accent, marginBottom: 6 }}>CPVI = {hovered.CSVI.toFixed(4)}</div>
          {PERSONA_AXES.map((ax, i) => (
            <Row
              key={ax.id}
              label={`W 分位 · ${ax.cn}`}
              val={`P=${(hovered[P_KEYS[i]] ?? 0).toFixed(3)} · Wp=${(hovered[WP_KEYS[i]] ?? 0).toFixed(3)}`}
            />
          ))}
          <Row label="E" val={hovered.csvi_E.toFixed(3)} />
          <Row label="S_env / S_con" val={`${hovered.csvi_S_env.toFixed(2)} / ${hovered.csvi_S_contact.toFixed(2)}`} />
          <Row label="AC（矩阵）" val={hovered.csvi_AC_phys.toFixed(4)} />
        </div>
      )}
    </div>
  );
}

function Row({ label, val }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 2, color: T.textDim }}>
      <span>{label}</span><b style={{ color: T.text, fontWeight: 500 }}>{val}</b>
    </div>
  );
}

/* ═══════════════════ DECOMPOSITION MINI-BARS ═══════════════════ */
function DecompCard({ label, labelEn, points, color }) {
  const metrics = useMemo(() => {
    if (!points.length) return null;
    return {
      E: d3.mean(points, d => d.csvi_E),
      S_env: d3.mean(points, d => d.csvi_S_env),
      S_con: d3.mean(points, d => d.csvi_S_contact),
      AC_p: d3.mean(points, d => d.csvi_AC_phys),
      AC_s: d3.mean(points, d => d.csvi_AC_social),
    };
  }, [points]);

  const bars = metrics ? [
    { key: "E", val: metrics.E, max: 1, c: "#DA4BA3" },
    { key: "S_env", val: metrics.S_env, max: 0.5, c: "#c44a8a" },
    { key: "S_con", val: metrics.S_con, max: 1, c: "#a54090" },
    { key: "AC_p", val: metrics.AC_p, max: 0.3, c: "#6d3580" },
    { key: "AC_s", val: metrics.AC_s, max: 0.5, c: "#553070" },
  ] : [];

  return (
    <div style={{
      background: color || T.panel, border: `1px solid ${T.border}`,
      borderRadius: 8, padding: "10px 12px", flex: "1 1 0",
      minWidth: 0, backdropFilter: "blur(8px)"
    }}>
      <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: "rgba(218,75,163,0.55)", marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 10, color: T.textDim, marginBottom: 8 }}>
        {labelEn} · n={points.length}
      </div>
      {bars.map(b => (
        <div key={b.key} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <span style={{ width: 40, fontSize: 9, color: T.textDim, textAlign: "right", flexShrink: 0 }}>{b.key}</span>
          <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.04)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{
              width: `${Math.min(100, (b.val / b.max) * 100)}%`,
              height: "100%", background: b.c, borderRadius: 3,
              transition: "width 0.4s ease"
            }} />
          </div>
          <span style={{ width: 36, fontSize: 9, color: T.textMid, textAlign: "right" }}>{b.val?.toFixed(3)}</span>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════ LEGEND ═══════════════════ */
function Legend() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    c.width = 200; c.height = 10;
    const ctx = c.getContext("2d");
    for (let x = 0; x < 200; x++) {
      const [r,g,b] = csviRgb(x/200);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, 0, 1, 10);
    }
  }, []);
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, padding: "14px 16px", backdropFilter: "blur(12px)" }}>
      <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "rgba(218,75,163,0.55)", marginBottom: 8 }}>CSVI · 颜色与大小</div>
      <canvas ref={canvasRef} style={{ width: "100%", height: 10, borderRadius: 5, marginBottom: 4 }} />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: T.textDim }}>
        <span>低 CSVI</span><span>高 CSVI</span>
      </div>
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)", fontSize: 10, color: T.textDim, lineHeight: 1.65, wordBreak: "keep-all", lineBreak: "strict" }}>
        <div style={{ whiteSpace: "nowrap" }}><span style={{ color: T.accent, fontWeight: 600 }}>CPVI / CSVI</span> = E × S ÷ (AC + 1)</div>
        <div style={{ opacity: 0.88, marginTop: 4 }}>
          五轴 = 停留意愿 <strong>W</strong> 按五类人群拆开：每轴一类人的 <strong>Wp</strong>（共享七维特征 × 该类权重），雷达显示表内分位 <strong>P(Wp)∈[0,1]</strong>（见 <code>personaFive.js</code>）。
        </div>
        <div style={{ opacity: 0.55, fontSize: 9, marginTop: 4, lineHeight: 1.5 }}>叙事上强调五类人群的<strong>相互干预与共现</strong>，不再用 W_urban×W_work 二轴对立。叠层颜色仍映射 CPVI。</div>
        <div style={{ opacity: 0.5, fontSize: 9, marginTop: 4 }}><strong>遛娃家庭</strong>轴含低 S（安全）、高 N09、高 AC 等代理，展陈时配合<strong>儿童眼高 1–1.5 m</strong>口述。</div>
      </div>
    </div>
  );
}

/* ═══════════════════ STATS ═══════════════════ */
function StatsCard({ data }) {
  const stats = useMemo(() => {
    const meanPaxes =
      P_KEYS.reduce((s, k) => s + (d3.mean(data, (d) => d[k]) || 0), 0) / Math.max(1, P_KEYS.length);
    return {
      n: data.length,
      meanCSVI: d3.mean(data, (d) => d.CSVI) || 0,
      stdCSVI: d3.deviation(data, (d) => d.CSVI) || 0,
      maxCSVI: d3.max(data, (d) => d.CSVI) || 0,
      meanPaxes,
    };
  }, [data]);
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, padding: "14px 16px", backdropFilter: "blur(12px)" }}>
      <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "rgba(218,75,163,0.55)", marginBottom: 10 }}>统计</div>
      <StatRow label="Edges" val={stats.n.toLocaleString()} />
      <StatRow label="μ(CSVI)" val={stats.meanCSVI.toFixed(4)} />
      <StatRow label="σ(CSVI)" val={stats.stdCSVI.toFixed(4)} />
      <StatRow label="max(CSVI)" val={stats.maxCSVI.toFixed(4)} />
      <StatRow label="五轴 μ(P)" val={stats.meanPaxes.toFixed(3)} />
    </div>
  );
}
function StatRow({ label, val }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: T.textDim }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: T.accent }}>{val}</div>
    </div>
  );
}
/* ═══════════════════ MAIN APP ═══════════════════ */
const CLD_PRIORITY_CSV = `${import.meta.env.BASE_URL}cld_priority.csv`;

export default function App() {
  const [data, setData] = useState([]);
  const [hovered, setHovered] = useState(null);
  const [dataSource, setDataSource] = useState("loading");
  const containerRef = useRef(null);
  const [dims, setDims] = useState({ w: 900, h: 600 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(CLD_PRIORITY_CSV);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const rows = d3.csvParse(text.replace(/^\uFEFF/, ""));
        if (cancelled) return;
        const processed = processUploadedRows(rows);
        if (processed.length) {
          setData(processed);
          setDataSource("cld");
        } else {
          setData(makeDemoData(3000));
          setDataSource("demo");
        }
      } catch {
        if (!cancelled) {
          setData(makeDemoData(3000));
          setDataSource("demo");
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        setDims({ w: Math.max(400, width * 0.58), h: Math.max(400, height - 90) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const personaBuckets = useMemo(() => {
    const b = { elder: [], student: [], white: [], family: [], wander: [] };
    const keys = ["elder", "student", "white", "family", "wander"];
    for (const d of data) {
      let bi = 0;
      for (let j = 1; j < 5; j++) {
        if ((d[P_KEYS[j]] ?? 0) > (d[P_KEYS[bi]] ?? 0)) bi = j;
      }
      b[keys[bi]].push(d);
    }
    return b;
  }, [data]);

  const handleFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'csv') {
      const text = await file.text();
      const rows = d3.csvParse(text.replace(/^\uFEFF/, ''));
      setData(processUploadedRows(rows));
      setDataSource("upload");
    } else if (ext === 'xlsx' || ext === 'xls') {
      const mod = await import("xlsx");
      const XLSX = mod.default ?? mod;
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws);
      setData(processUploadedRows(rows));
      setDataSource("upload");
    }
  }, []);

  const handleExport = useCallback(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = "persona_five_radar.png";
    link.href = canvas.toDataURL("image/png", 1.0);
    link.click();
  }, []);

  if (dataSource === "loading" || data.length === 0) {
    return (
      <div style={{
        width: "100%", height: "100vh", background: T.bg,
        fontFamily: T.font, color: T.text, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
      }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,700;1,9..40,300&family=Noto+Sans+SC:wght@300;400;500;700&display=swap');`}</style>
        <div style={{ fontSize: 13, color: T.textDim, letterSpacing: 0.5 }}>
          正在加载 <span style={{ color: T.accent }}>cld_priority.csv</span>…
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{
      width: "100%", height: "100vh", background: T.bg,
      fontFamily: T.font, color: T.text, display: "flex", flexDirection: "column", overflow: "hidden",
      wordBreak: "keep-all", lineBreak: "strict",
    }}>
      {/* — Google Fonts — */}
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,700;1,9..40,300&family=Noto+Sans+SC:wght@300;400;500;700&display=swap');`}</style>

      {/* — HEADER — */}
      <header style={{
        padding: "16px 24px 12px", flexShrink: 0,
        background: "linear-gradient(180deg, rgba(10,10,10,0.95) 0%, rgba(10,10,10,0.7) 100%)",
        borderBottom: `1px solid ${T.border}`,
        display: "flex", justifyContent: "space-between", alignItems: "flex-end"
      }}>
        <div>
          <div style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: "rgba(218,75,163,0.6)", marginBottom: 2 }}>
            五类在地智能体 · 五维雷达
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
            <span style={{ color: T.accent }}>雷达投影</span>
            <span style={{ fontSize: 12, fontWeight: 400, color: T.textDim, marginLeft: 8 }}>关切分位 · CPVI 叠色 · 相互干预叙事</span>
          </h1>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {dataSource === "cld" && (
            <span style={{ fontSize: 10, color: "rgba(218,75,163,0.75)", background: "rgba(218,75,163,0.1)", padding: "3px 10px", borderRadius: 20, letterSpacing: 1 }} title={CLD_PRIORITY_CSV}>
              CLD · cld_priority.csv
            </span>
          )}
          {dataSource === "demo" && (
            <span style={{ fontSize: 10, color: "rgba(218,75,163,0.5)", background: "rgba(218,75,163,0.08)", padding: "3px 10px", borderRadius: 20, letterSpacing: 1 }}>
              DEMO DATA（未读到 CLD 文件）
            </span>
          )}
          {dataSource === "upload" && (
            <span style={{ fontSize: 10, color: "rgba(218,75,163,0.75)", background: "rgba(218,75,163,0.1)", padding: "3px 10px", borderRadius: 20, letterSpacing: 1 }}>
              已上传文件
            </span>
          )}
          <label style={{
            fontSize: 10, color: T.textMid, cursor: "pointer",
            border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 12px",
            transition: "border-color 0.2s"
          }}>
            上传 CSV / XLSX
            <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} style={{ display: "none" }} />
          </label>
          <button onClick={handleExport} style={{
            fontSize: 10, color: T.accent, background: "transparent",
            border: `1px solid ${T.accentDim}`, borderRadius: 6, padding: "6px 12px",
            cursor: "pointer", transition: "background 0.2s",
          }}>
            导出 PNG
          </button>
        </div>
      </header>

      {/* — MAIN — */}
      <main style={{ flex: 1, display: "flex", gap: 0, overflow: "hidden", minHeight: 0 }}>
        {/* Chart area */}
        <div style={{ flex: "0 0 58%", minWidth: 0, padding: "12px 0 12px 12px" }}>
          <RadarCanvas data={data} width={dims.w} height={dims.h} hovered={hovered} setHovered={setHovered} />
        </div>

        {/* Side panels */}
        <div style={{
          flex: 1, display: "flex", flexDirection: "column", gap: 10,
          padding: "12px 16px 12px 12px", overflowY: "auto", minWidth: 0,
        }}>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}><StatsCard data={data} /></div>
            <div style={{ flex: 1 }}><Legend /></div>
          </div>

          <div style={{
            fontSize: 9, letterSpacing: 2, textTransform: "uppercase",
            color: "rgba(218,75,163,0.5)", padding: "4px 0 0",
          }}>
            各智能体主导子集 · E / S / AC 均值（argmax P 归属）
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <DecompCard label="主导 · 梧桐爷叔" labelEn="Elder axis" points={personaBuckets.elder} color="rgba(20,12,28,0.85)" />
            <DecompCard label="主导 · 高校学生" labelEn="Student axis" points={personaBuckets.student} color="rgba(28,14,28,0.85)" />
            <DecompCard label="主导 · 商圈白领" labelEn="White-collar" points={personaBuckets.white} color="rgba(18,12,26,0.85)" />
            <DecompCard label="主导 · 遛娃家庭" labelEn="Family + 1–1.5m" points={personaBuckets.family} color="rgba(22,16,24,0.85)" />
            <DecompCard label="主导 · 文艺漫游" labelEn="City-walk" points={personaBuckets.wander} color="rgba(16,12,22,0.85)" />
          </div>

          <div style={{
            background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8,
            padding: "10px 14px", fontSize: 10, color: T.textDim, lineHeight: 1.7,
            backdropFilter: "blur(8px)"
          }}>
            <span style={{ color: "rgba(218,75,163,0.55)", letterSpacing: 1.5, fontSize: 9, textTransform: "uppercase" }}>
              叙事：相互干预
            </span>
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
              <div>五轴<strong>非对立</strong>：同一街段可在多类关切上同时偏高；装置与治理需协调<strong>爷叔日常连续性 × 白领碎片解压 × 学生传播 × 家庭安全（儿童视角）× 漫游叙事</strong>。</div>
              <div>雷达叠层表达「谁在此段相对更被满足」；<b style={{ color: T.accent }}>CPVI</b> 颜色仍标示可玩—认知脆弱性优先级。</div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
