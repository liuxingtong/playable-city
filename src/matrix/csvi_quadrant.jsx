import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import * as d3 from "d3";

/* ═══════════════════ THEME ═══════════════════ */
const T = {
  bg: "#0a0a0a", panel: "rgba(14,14,14,0.92)",
  accent: "#DA4BA3", accentDim: "rgba(218,75,163,0.25)",
  text: "#f0f0f0", textMid: "rgba(255,255,255,0.6)",
  textDim: "rgba(255,255,255,0.35)", border: "rgba(218,75,163,0.15)",
  font: "'DM Sans','Noto Sans SC',system-ui,sans-serif",
};

const Q_COLORS = {
  Q1: "rgba(218,75,163,0.10)", Q2: "rgba(140,55,170,0.08)",
  Q3: "rgba(30,15,35,0.06)",  Q4: "rgba(100,45,130,0.07)",
};
const Q_LABELS = {
  Q1: { cn: "双驱停留", en: "Dual Retention" },
  Q2: { cn: "老年专属", en: "Elder-Centric" },
  Q3: { cn: "双低衰退", en: "Dual Decline" },
  Q4: { cn: "工作主导", en: "Work-Dominated" },
};

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
  if (!data?.length) return data;
  const n = data.length;
  function rankKey(getVal, setKey) {
    if (n === 1) {
      data[0][setKey] = 0.5;
      return;
    }
    const idx = d3.range(n);
    idx.sort((ia, ib) => {
      const a = Number.isFinite(getVal(data[ia])) ? getVal(data[ia]) : 0;
      const b = Number.isFinite(getVal(data[ib])) ? getVal(data[ib]) : 0;
      return a - b;
    });
    const pr = new Array(n);
    let j = 0;
    while (j < n) {
      let k = j;
      const base = Number.isFinite(getVal(data[idx[j]])) ? getVal(data[idx[j]]) : 0;
      while (k + 1 < n) {
        const vb = Number.isFinite(getVal(data[idx[k + 1]])) ? getVal(data[idx[k + 1]]) : 0;
        if (vb !== base) break;
        k++;
      }
      const mid = (j + k) / 2;
      const p = mid / (n - 1);
      for (let t = j; t <= k; t++) pr[idx[t]] = p;
      j = k + 1;
    }
    for (let i = 0; i < n; i++) data[i][setKey] = pr[i];
  }
  rankKey((d) => d.W_elder, "p_elder");
  rankKey((d) => d.W_work, "p_work");
  return data;
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
    return {
      id: i, W_work, W_elder, CSVI, csvi_E, csvi_S_env, csvi_S_contact,
      csvi_AC_phys, ac_phys_tabular: csvi_AC_phys, hasAcDom: false,
      csvi_AC_social, S, AC, N_YP, N08,
    };
  });
  return attachPercentileRanks(arr);
}

/* ═══════════════════ PROCESS UPLOADED DATA ═══════════════════ */
function processUploadedRows(rows) {
  const out = rows.map((d, i) => {
    const N_YP = +d.N_YP || 0;
    const N08  = +d.N08 || 0;
    const csvi_E = +d.csvi_E || 0;
    const csvi_AC_phys_eff = effectiveAcPhysFromRow(d);
    const csvi_AC_phys_tab = Number(d.csvi_AC_phys) || 0;
    const hasAcDom = rowHasAcDomSplit(d);
    const csvi_AC_social = +d.csvi_AC_social || 0;
    const csvi_S_env = +d.csvi_S_env || 0;
    const csvi_S_contact = +d.csvi_S_contact || 0;
    const W_work = N_YP * N08;
    const W_elder = csvi_E * (csvi_AC_phys_eff + 1);
    const S = csvi_S_env + csvi_S_contact;
    const AC = csvi_AC_phys_eff * csvi_AC_social;
    const CSVI = (csvi_E * S) / (AC + 1);
    return {
      id: i, W_work, W_elder, CSVI, csvi_E, csvi_S_env, csvi_S_contact,
      csvi_AC_phys: csvi_AC_phys_eff, ac_phys_tabular: csvi_AC_phys_tab, hasAcDom,
      csvi_AC_social, S, AC, N_YP, N08, lon: +d.lon, lat: +d.lat,
    };
  });
  return attachPercentileRanks(out);
}

/* ═══════════════════ QUADRANT CHART (CANVAS) ═══════════════════ */
const MARGIN = { top: 50, right: 48, bottom: 54, left: 58 };
const MARG_H = 44; // marginal histogram height

function QuadrantCanvas({ data, width, height, hovered, setHovered, thresholds }) {
  const canvasRef = useRef(null);
  const qtRef = useRef(null);
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom - MARG_H;

  const { xScale, yScale, csviNorm, sizeScale } = useMemo(() => {
    const xExt = d3.extent(data, d => d.W_work);
    const yExt = d3.extent(data, d => d.W_elder);
    const cExt = d3.extent(data, d => d.CSVI);
    const xPad = (xExt[1] - xExt[0]) * 0.05 || 0.01;
    const yPad = (yExt[1] - yExt[0]) * 0.05 || 0.001;
    return {
      xScale: d3.scaleLinear().domain([xExt[0]-xPad, xExt[1]+xPad]).range([0, plotW]),
      yScale: d3.scaleLinear().domain([yExt[0]-yPad, yExt[1]+yPad]).range([plotH, 0]),
      csviNorm: d3.scaleLinear().domain(cExt[0] === cExt[1] ? [0,1] : cExt).range([0,1]).clamp(true),
      sizeScale: d3.scaleSqrt().domain(cExt[0] === cExt[1] ? [0,1] : cExt).range([1.8, 7]).clamp(true),
    };
  }, [data, plotW, plotH]);

  // Build quadtree for hover detection
  useEffect(() => {
    qtRef.current = d3.quadtree()
      .x(d => xScale(d.W_work))
      .y(d => yScale(d.W_elder))
      .addAll(data);
  }, [data, xScale, yScale]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    ctx.save();
    ctx.translate(MARGIN.left, MARGIN.top + MARG_H);

    // — Quadrant backgrounds —
    const mx = xScale(thresholds.x), my = yScale(thresholds.y);
    ctx.fillStyle = Q_COLORS.Q2; ctx.fillRect(0, 0, mx, my);
    ctx.fillStyle = Q_COLORS.Q1; ctx.fillRect(mx, 0, plotW - mx, my);
    ctx.fillStyle = Q_COLORS.Q3; ctx.fillRect(0, my, mx, plotH - my);
    ctx.fillStyle = Q_COLORS.Q4; ctx.fillRect(mx, my, plotW - mx, plotH - my);

    // — Grid —
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 0.5;
    const xTicks = xScale.ticks(6), yTicks = yScale.ticks(6);
    for (const t of xTicks) { const x = xScale(t); ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,plotH); ctx.stroke(); }
    for (const t of yTicks) { const y = yScale(t); ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(plotW,y); ctx.stroke(); }

    // — Quadrant dividers —
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = "rgba(218,75,163,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(mx, 0); ctx.lineTo(mx, plotH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, my); ctx.lineTo(plotW, my); ctx.stroke();
    ctx.setLineDash([]);

    // — Quadrant labels —
    ctx.font = `500 10px ${T.font}`;
    ctx.textAlign = "center";
    const qlPos = [
      { x: (mx+plotW)/2, y: 16, q: "Q1" }, { x: mx/2, y: 16, q: "Q2" },
      { x: mx/2, y: plotH - 8, q: "Q3" }, { x: (mx+plotW)/2, y: plotH - 8, q: "Q4" },
    ];
    for (const p of qlPos) {
      ctx.fillStyle = "rgba(218,75,163,0.35)";
      ctx.fillText(`${p.q} ${Q_LABELS[p.q].cn}`, p.x, p.y);
    }

    // — KDE Contours —
    try {
      const contourGen = d3.contourDensity()
        .x(d => xScale(d.W_work))
        .y(d => yScale(d.W_elder))
        .size([plotW, plotH])
        .bandwidth(18)
        .thresholds(12);
      const contours = contourGen(data);
      const cMax = d3.max(contours, c => c.value) || 1;
      const pathGen = d3.geoPath().context(ctx);
      for (const c of contours) {
        const intensity = c.value / cMax;
        ctx.beginPath();
        pathGen(c);
        ctx.fillStyle = csviRgba(intensity * 0.6, intensity * 0.12);
        ctx.fill();
      }
    } catch(e) { /* contour can fail with too few points */ }

    // — Points (sorted: low CSVI first) —
    const sorted = [...data].sort((a, b) => a.CSVI - b.CSVI);
    for (const d of sorted) {
      const px = xScale(d.W_work);
      const py = yScale(d.W_elder);
      const nv = csviNorm(d.CSVI);
      const r = sizeScale(d.CSVI);
      const isHov = hovered && d.id === hovered.id;
      ctx.beginPath();
      ctx.arc(px, py, isHov ? r + 3 : r, 0, Math.PI * 2);
      ctx.fillStyle = csviRgba(nv, isHov ? 0.95 : 0.55);
      ctx.fill();
      if (isHov) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // — Axes ticks labels —
    ctx.fillStyle = T.textDim;
    ctx.font = `300 9px ${T.font}`;
    ctx.textAlign = "center";
    for (const t of xTicks) { ctx.fillText(t.toFixed(2), xScale(t), plotH + 14); }
    ctx.textAlign = "right";
    for (const t of yTicks) { ctx.fillText(t.toFixed(3), -8, yScale(t) + 3); }

    ctx.restore();

    // — Axis titles —
    ctx.fillStyle = T.textMid;
    ctx.font = `400 11px ${T.font}`;
    ctx.textAlign = "center";
    ctx.fillText("W_work  =  N_YP × Q    →    工作人口停留意愿", MARGIN.left + plotW / 2, height - 10);
    ctx.save();
    ctx.translate(14, MARGIN.top + MARG_H + plotH / 2);
    ctx.rotate(-Math.PI / 2);
      ctx.fillText("W_elder  =  E × (AC_agg+1)    →    老年人停留意愿", 0, 0);
    ctx.restore();

    // — Marginal: top (W_work density) —
    const margTop = MARGIN.top;
    ctx.save();
    ctx.translate(MARGIN.left, margTop);
    const kde = kernelDensityEstimator(kernelEpanechnikov(0.03), xScale.ticks(80));
    const densityX = kde(data.map(d => d.W_work));
    const dyMax = d3.max(densityX, d => d[1]) || 1;
    const dyScale = d3.scaleLinear().domain([0, dyMax]).range([MARG_H, 0]);
    ctx.beginPath();
    ctx.moveTo(xScale(densityX[0][0]), MARG_H);
    for (const [x, y] of densityX) { ctx.lineTo(xScale(x), dyScale(y)); }
    ctx.lineTo(xScale(densityX[densityX.length-1][0]), MARG_H);
    ctx.closePath();
    ctx.fillStyle = "rgba(218,75,163,0.12)";
    ctx.fill();
    ctx.strokeStyle = "rgba(218,75,163,0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < densityX.length; i++) {
      const [x, y] = densityX[i];
      i === 0 ? ctx.moveTo(xScale(x), dyScale(y)) : ctx.lineTo(xScale(x), dyScale(y));
    }
    ctx.stroke();
    ctx.restore();

    // — Marginal: right (W_elder density) —
    ctx.save();
    ctx.translate(MARGIN.left + plotW + 4, MARGIN.top + MARG_H);
    const kdeY = kernelDensityEstimator(kernelEpanechnikov(0.005), yScale.ticks(80));
    const densityY = kdeY(data.map(d => d.W_elder));
    const dxMax = d3.max(densityY, d => d[1]) || 1;
    const dxScale = d3.scaleLinear().domain([0, dxMax]).range([0, MARGIN.right - 4]);
    ctx.beginPath();
    ctx.moveTo(0, yScale(densityY[0][0]));
    for (const [y, v] of densityY) { ctx.lineTo(dxScale(v), yScale(y)); }
    ctx.lineTo(0, yScale(densityY[densityY.length-1][0]));
    ctx.closePath();
    ctx.fillStyle = "rgba(218,75,163,0.12)";
    ctx.fill();
    ctx.restore();

  }, [data, width, height, hovered, thresholds, xScale, yScale, csviNorm, sizeScale, plotW, plotH]);

  // Mouse handler
  const handleMouse = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas || !qtRef.current) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left - MARGIN.left;
    const my = e.clientY - rect.top - MARGIN.top - MARG_H;
    if (mx < 0 || mx > plotW || my < 0 || my > plotH) { setHovered(null); return; }
    const found = qtRef.current.find(mx, my, 15);
    setHovered(found || null);
  }, [plotW, plotH, setHovered]);

  return (
    <div style={{ position: "relative" }}>
      <canvas
        ref={canvasRef}
        style={{ width, height, cursor: hovered ? "crosshair" : "default" }}
        onMouseMove={handleMouse}
        onMouseLeave={() => setHovered(null)}
      />
      {hovered && (
        <div style={{
          position: "absolute",
          left: MARGIN.left + xScale(hovered.W_work) + 14,
          top: MARGIN.top + MARG_H + yScale(hovered.W_elder) - 60,
          background: T.panel, border: `1px solid ${T.accentDim}`,
          borderRadius: 8, padding: "10px 14px", pointerEvents: "none",
          backdropFilter: "blur(12px)", zIndex: 10, minWidth: 180,
          fontFamily: T.font, fontSize: 11, color: T.text,
          boxShadow: "0 4px 20px rgba(0,0,0,0.5)"
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.accent, marginBottom: 6 }}>
            CSVI = {hovered.CSVI.toFixed(4)}
          </div>
          <Row label="W_work" val={hovered.W_work.toFixed(4)} />
          <Row label="W_elder" val={hovered.W_elder.toFixed(5)} />
          <Row label="P_work（分位）" val={(hovered.p_work ?? 0).toFixed(3)} />
          <Row label="P_elder（分位）" val={(hovered.p_elder ?? 0).toFixed(3)} />
          <Row label="E (暴露)" val={hovered.csvi_E.toFixed(3)} />
          <Row label="S_env" val={hovered.csvi_S_env.toFixed(3)} />
          <Row label="S_contact" val={hovered.csvi_S_contact.toFixed(3)} />
          <Row label="AC_phys（矩阵用）" val={hovered.csvi_AC_phys.toFixed(4)} />
          {hovered.hasAcDom ? <Row label="AC_phys（表列）" val={hovered.ac_phys_tabular.toFixed(4)} /> : null}
          <Row label="AC_social" val={hovered.csvi_AC_social.toFixed(3)} />
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

/* ═══════════════════ KDE HELPERS ═══════════════════ */
function kernelDensityEstimator(kernel, ticks) {
  return (V) => ticks.map(t => [t, d3.mean(V, v => kernel(t - v)) || 0]);
}
function kernelEpanechnikov(k) {
  return (v) => Math.abs(v /= k) <= 1 ? 0.75 * (1 - v * v) / k : 0;
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
        <div style={{ whiteSpace: "nowrap" }}><span style={{ color: T.accent, fontWeight: 600 }}>CSVI</span> = E × S ÷ (AC + 1)</div>
        <div style={{ whiteSpace: "nowrap" }}>横轴 <span style={{ color: T.accent }}>W_work</span> = N_YP × Q</div>
        <div style={{ whiteSpace: "nowrap" }}>纵轴 <span style={{ color: T.accent }}>W_elder</span> = E × (AC_agg+1)</div>
        <div style={{ opacity: 0.55, fontSize: 9, marginTop: 3, lineHeight: 1.5 }}>AC_agg：表内五主导列（含 <code>AC_soc_cul_dom</code>）<strong>齐全</strong>时为五列算术平均；仅四列齐全时为四列平均；否则为 <code>csvi_AC_phys</code>（本矩阵不拆资源类型）。</div>
        <div style={{ opacity: 0.5, fontSize: 9, marginTop: 4 }}>点的大小与颜色表示 CSVI 高低。</div>
      </div>
    </div>
  );
}

/* ═══════════════════ STATS ═══════════════════ */
function StatsCard({ data }) {
  const stats = useMemo(() => ({
    n: data.length,
    meanCSVI: d3.mean(data, d => d.CSVI) || 0,
    stdCSVI: d3.deviation(data, d => d.CSVI) || 0,
    maxCSVI: d3.max(data, d => d.CSVI) || 0,
    corrR: pearsonR(data.map(d => d.W_work), data.map(d => d.W_elder)),
  }), [data]);
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, padding: "14px 16px", backdropFilter: "blur(12px)" }}>
      <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "rgba(218,75,163,0.55)", marginBottom: 10 }}>统计</div>
      <StatRow label="Edges" val={stats.n.toLocaleString()} />
      <StatRow label="μ(CSVI)" val={stats.meanCSVI.toFixed(4)} />
      <StatRow label="σ(CSVI)" val={stats.stdCSVI.toFixed(4)} />
      <StatRow label="max(CSVI)" val={stats.maxCSVI.toFixed(4)} />
      <StatRow label="ρ(W_work,W_elder)" val={stats.corrR.toFixed(3)} />
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
function pearsonR(x, y) {
  const n = x.length; if (n < 3) return 0;
  const mx = d3.mean(x), my = d3.mean(y);
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  return dx2 && dy2 ? num / Math.sqrt(dx2 * dy2) : 0;
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

  const thresholds = useMemo(() => ({
    x: d3.median(data, d => d.W_work) || 0.2,
    y: d3.median(data, d => d.W_elder) || 0.01,
  }), [data]);

  const quadrants = useMemo(() => {
    const q = { Q1: [], Q2: [], Q3: [], Q4: [] };
    for (const d of data) {
      if (d.W_elder >= thresholds.y) {
        (d.W_work >= thresholds.x ? q.Q1 : q.Q2).push(d);
      } else {
        (d.W_work >= thresholds.x ? q.Q4 : q.Q3).push(d);
      }
    }
    return q;
  }, [data, thresholds]);

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
    link.download = "csvi_quadrant.png";
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
            停留意愿 · 四象限
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
            <span style={{ color: T.accent }}>四象限</span>
            <span style={{ fontSize: 12, fontWeight: 400, color: T.textDim, marginLeft: 8 }}>CSVI 与停留结构</span>
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
          <QuadrantCanvas
            data={data} width={dims.w} height={dims.h}
            hovered={hovered} setHovered={setHovered}
            thresholds={thresholds}
          />
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
            各象限 · E / S / AC 均值
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <DecompCard label="Q2 · 老年专属" labelEn="Elder-Centric" points={quadrants.Q2} color="rgba(20,12,28,0.85)" />
            <DecompCard label="Q1 · 双驱停留" labelEn="Dual Retention" points={quadrants.Q1} color="rgba(28,14,28,0.85)" />
            <DecompCard label="Q3 · 双低衰退" labelEn="Dual Decline" points={quadrants.Q3} color="rgba(14,10,18,0.85)" />
            <DecompCard label="Q4 · 工作主导" labelEn="Work-Dominated" points={quadrants.Q4} color="rgba(18,12,24,0.85)" />
          </div>

          {/* Quadrant interpretation */}
          <div style={{
            background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8,
            padding: "10px 14px", fontSize: 10, color: T.textDim, lineHeight: 1.7,
            backdropFilter: "blur(8px)"
          }}>
            <span style={{ color: "rgba(218,75,163,0.55)", letterSpacing: 1.5, fontSize: 9, textTransform: "uppercase" }}>
              象限含义
            </span>
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
              <div><b style={{ color: T.accent }}>Q2 左上</b> 老年停留偏多、工作人群偏少 → 代际接触弱，<b style={{ color: T.text }}>优先改造</b></div>
              <div><b style={{ color: T.accent }}>Q1 右上</b> 两侧停留都高 → 潜力大，偏维护</div>
              <div><b style={{ color: T.accent }}>Q3 左下</b> 两侧都低 → 活力弱</div>
              <div><b style={{ color: T.accent }}>Q4 右下</b> 工作人群偏多、老年偏少 → 易被挤出</div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
