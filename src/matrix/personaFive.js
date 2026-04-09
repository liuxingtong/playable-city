/**
 * 停留意愿 **W 按五类人群拆成五根轴**：每轴 Wp_k = 模块三叙事权重 · 七维归一化特征（边表代理）。
 * 七维特征序：[E, 1−S压制, AC, N_UD, N09, N_CD, N_OS] —— **不是**「五个平台指标各占一轴」，而是 **同一套特征、五套权重** 得到五个 W 分轴。
 * 雷达顶点为各 Wp_k 在当次边集上的经验分位 p_*（0–1）。
 */
import * as d3 from "d3";

export const PERSONA_AXES = [
  { id: "elder", cn: "梧桐爷叔", en: "Local elder" },
  { id: "student", cn: "高校学生", en: "Campus youth" },
  { id: "white", cn: "商圈白领", en: "CBD white-collar" },
  { id: "family", cn: "遛娃家庭", en: "Family + child 1–1.5m" },
  { id: "wander", cn: "文艺漫游者", en: "City-walk / creator" },
];

/** 与 W_PERSONA_WEIGHTS 行顺序一致：E、sInv、AC、N_UD、N09、N_CD、N_OS */
export const W_FEATURE_LABELS = ["E", "1−S/压制", "AC", "N_UD", "N09", "N_CD", "N_OS"];

/**
 * 五类人 × 七维权重（行和为 1）；与模块三叙事优先级对齐，可调。
 * elder：适老/连续性/被动参与 → AC、N09、低 S、N_OS
 * student：传播/探索/结伴 → E、N_CD、N_UD
 * white：午餐圈/密度/释压 → N_UD、N09、低 S
 * family：安全/亲子/叙事深度 → 低 S、N09、AC（眼高 1–1.5 m 叙事层口述）
 * wander：叙事密度/发现/出片 → N_CD、E
 */
export const W_PERSONA_WEIGHTS = [
  [0.08, 0.18, 0.22, 0.05, 0.22, 0.05, 0.2],
  [0.32, 0.05, 0.1, 0.22, 0.08, 0.23, 0.0],
  [0.08, 0.2, 0.08, 0.32, 0.32, 0.0, 0.0],
  [0.12, 0.28, 0.25, 0.05, 0.3, 0.0, 0.0],
  [0.38, 0.05, 0.08, 0.08, 0.09, 0.32, 0.0],
];

const WP_KEYS = ["Wp_elder", "Wp_student", "Wp_white", "Wp_family", "Wp_wander"];
const P_KEYS = ["p_elder", "p_student", "p_white", "p_family", "p_wander"];

/** @param {Record<string, number>} d */
export function rawFeatureTuple(d) {
  const E = Number(d.cpvi_E ?? d.csvi_E) || 0;
  let S = Number(d.cpvi_S);
  if (!Number.isFinite(S)) S = (Number(d.csvi_S_env) || 0) + (Number(d.csvi_S_contact) || 0);
  S = Math.max(0, Math.min(1.5, S));
  const sInv = Math.max(0, Math.min(1, 1 - S / 1.2));
  const AC = Number.isFinite(Number(d.acPhysEff))
    ? Number(d.acPhysEff)
    : Number(d.csvi_AC_phys) || Number(d.cpvi_AC) || 0;
  const N_UD = Number(d.N_UD ?? d.N_YP ?? d.pop_total) || 0;
  const N09 = Number(d.N09 ?? d.N08) || 0;
  const N_CD = Number(d.N_CD) || 0;
  const N_OS = Number(d.N_OS) || 0;
  return [E, sInv, AC, N_UD, N09, N_CD, N_OS];
}

function extent7(data) {
  const lo = Array(7).fill(Infinity);
  const hi = Array(7).fill(-Infinity);
  for (let i = 0; i < data.length; i++) {
    const t = rawFeatureTuple(data[i]);
    for (let j = 0; j < 7; j++) {
      const v = t[j];
      if (Number.isFinite(v)) {
        if (v < lo[j]) lo[j] = v;
        if (v > hi[j]) hi[j] = v;
      }
    }
  }
  for (let j = 0; j < 7; j++) {
    if (!Number.isFinite(lo[j]) || !Number.isFinite(hi[j])) {
      lo[j] = 0;
      hi[j] = 1;
    }
    if (hi[j] <= lo[j]) {
      lo[j] -= 1;
      hi[j] += 1;
    }
  }
  return { lo, hi };
}

function zFromTuple(t, lo, hi) {
  const z = [];
  for (let j = 0; j < 7; j++) {
    const v = t[j];
    const L = lo[j];
    const H = hi[j];
    if (!Number.isFinite(v) || H <= L) z[j] = 0.5;
    else z[j] = Math.max(0, Math.min(1, (v - L) / (H - L)));
  }
  return z;
}

function dot7(w, z) {
  let s = 0;
  for (let j = 0; j < 7; j++) s += w[j] * z[j];
  return s;
}

function rankKey(data, getVal, setKey) {
  const n = data.length;
  if (n === 0) return;
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
    for (let t = j; t <= k; t++) data[idx[t]][setKey] = p;
    j = k + 1;
  }
}

/** 写入 Wp_*（五类 W 分轴合成值）与 p_*（各轴在表内经验分位） */
export function attachPersonaScoresAndPercentiles(data) {
  if (!data?.length) return data;
  const { lo, hi } = extent7(data);
  for (let i = 0; i < data.length; i++) {
    const t = rawFeatureTuple(data[i]);
    const z = zFromTuple(t, lo, hi);
    const row = data[i];
    for (let k = 0; k < 5; k++) row[WP_KEYS[k]] = dot7(W_PERSONA_WEIGHTS[k], z);
  }
  for (let k = 0; k < 5; k++) {
    rankKey(data, (d) => d[WP_KEYS[k]], P_KEYS[k]);
  }
  return data;
}
