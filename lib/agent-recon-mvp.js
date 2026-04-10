import { buildGlmEnhancedAdapters, generateCogViewImage } from "./agent-recon-glm.js";
import { mergeCaseLibraryIntoCaseList, buildCaseLibraryPack, buildSchemeImagePrompt } from "./agent-recon-caselib.js";
import { renderSchemeMosaicToDataURL } from "./agent-recon-scheme-canvas.js";

const PERSONAS = [
  { id: "elder", label: "Agent1 梧桐爷叔", wp: "Wp_elder", p: "p_elder" },
  { id: "student", label: "Agent2 高校学生", wp: "Wp_student", p: "p_student" },
  { id: "white", label: "Agent3 商圈白领", wp: "Wp_white", p: "p_white" },
  { id: "family", label: "Agent4 遛娃家庭", wp: "Wp_family", p: "p_family" },
  { id: "wander", label: "Agent5 文艺漫游者", wp: "Wp_wander", p: "p_wander" },
];

const PERSONA_WEIGHTS = {
  elder: [0.08, 0.18, 0.22, 0.05, 0.22, 0.05, 0.2],
  student: [0.32, 0.05, 0.1, 0.22, 0.08, 0.23, 0.0],
  white: [0.08, 0.2, 0.08, 0.32, 0.32, 0.0, 0.0],
  family: [0.12, 0.28, 0.25, 0.05, 0.3, 0.0, 0.0],
  wander: [0.38, 0.05, 0.08, 0.08, 0.09, 0.32, 0.0],
};

const DEFAULT_ADAPTERS = {
  async scoreWithVisionLLM() {
    return null;
  },
  async getAgentComment(payload) {
    return makeRuleComment(payload.agent, payload.row, payload.streetview, payload.llmScore);
  },
  async queryKnowledgeCases(payload) {
    const base = makeRuleCases(payload);
    try {
      return await mergeCaseLibraryIntoCaseList(payload.selectedRow, base);
    } catch {
      return base;
    }
  },
  async runDeepDiscussion(payload) {
    return makeRuleDiscussion(payload);
  },
  async queryExternalDatabase() {
    return null;
  },
  async queryMcpKnowledge() {
    return null;
  },
};

const glmCfg = typeof window !== "undefined" ? window.AgentReconGlmConfig : undefined;
let adapters = buildGlmEnhancedAdapters({ ...DEFAULT_ADAPTERS }, glmCfg);
adapters = { ...adapters, ...(typeof window !== "undefined" ? window.AgentReconAdapters || {} : {}) };

/** 勘探范围：上海市徐汇区天平路街道（OSM relation/13469980，见 data/tianping-road-street.geojson） */
const STUDY_BOUNDARY_URL = "../data/tianping-road-street.geojson";

const map = L.map("map", { preferCanvas: true }).setView([31.2035, 121.437], 14);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

const pointLayer = L.layerGroup().addTo(map);
const zoneLayer = L.layerGroup().addTo(map);
const boundaryLayer = L.layerGroup().addTo(map);

const personaSelect = document.getElementById("personaSelect");
const thresholdRange = document.getElementById("thresholdRange");
const thresholdText = document.getElementById("thresholdText");
const visibleCount = document.getElementById("visibleCount");
const sampleCount = document.getElementById("sampleCount");
const scoreLabel = document.getElementById("scoreLabel");
const zoneTableBody = document.getElementById("zoneTableBody");
const detailBox = document.getElementById("detailBox");
const radarSvg = document.getElementById("radarSvg");
const agentMessageList = document.getElementById("agentMessageList");
const streetviewCount = document.getElementById("streetviewCount");
const streetviewNearest = document.getElementById("streetviewNearest");
const discussionBtn = document.getElementById("discussionBtn");
const discussionBox = document.getElementById("discussionBox");
const studyScopeNote = document.getElementById("studyScopeNote");

let studyGeometry = null;
let allRows = [];
let streetviewAssets = [];
let currentPersona = PERSONAS[0];
let currentThreshold = Number(thresholdRange.value) / 100;
let zoneRows = [];
let selectedRow = null;
let selectToken = 0;

init();

async function init() {
  PERSONAS.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.label;
    personaSelect.appendChild(opt);
  });

  studyGeometry = await loadStudyBoundaryGeometry();
  if (studyGeometry) {
    addStudyBoundaryToMap(studyGeometry);
    if (studyScopeNote) {
      studyScopeNote.textContent =
        "勘探范围：上海市徐汇区天平路街道（边界已加载，仅显示界内边段与街景索引）。";
    }
  } else {
    console.warn(
      "[Agent踏勘] 未加载天平路街道边界，退回全表。可运行: node scripts/fetch-tianping-road-street.mjs"
    );
    if (studyScopeNote) {
      studyScopeNote.textContent =
        "勘探范围：未找到 data/tianping-road-street.geojson，当前为全表（请拉取边界后刷新）。";
    }
  }

  const csvUrl = "../data/cld_priority.csv";
  const rows = await d3.csv(csvUrl);
  allRows = preprocess(rows, studyGeometry);
  sampleCount.textContent = String(allRows.length);

  let sv = await loadStreetviewAssets();
  if (studyGeometry) {
    sv = sv.filter((s) => pointInStudyGeometry(s.lon, s.lat, studyGeometry));
  }
  streetviewAssets = sv;
  streetviewCount.textContent = String(streetviewAssets.length);

  personaSelect.addEventListener("change", () => {
    const persona = PERSONAS.find((p) => p.id === personaSelect.value);
    if (!persona) return;
    currentPersona = persona;
    render();
  });

  thresholdRange.addEventListener("input", () => {
    currentThreshold = Number(thresholdRange.value) / 100;
    render();
  });

  discussionBtn.addEventListener("click", async () => {
    if (!selectedRow) return;
    discussionBtn.disabled = true;
    discussionBox.innerHTML =
      '<div class="small">正在生成讨论建议（含案例库预选与四维拼接；GLM 开启时为多轮协作，可能需数十秒）…</div>';
    const caseLibPack = await buildCaseLibraryPack(selectedRow);
    const nearest = nearestStreetview(selectedRow.lat, selectedRow.lon);
    const cases = await adapters.queryKnowledgeCases({
      selectedRow,
      zoneRows,
      nearestStreetview: nearest,
      personas: PERSONAS,
      currentPersona,
    });
    const mcpExtra = await adapters.queryMcpKnowledge({ selectedRow, nearestStreetview: nearest });
    const dbExtra = await adapters.queryExternalDatabase({ selectedRow, nearestStreetview: nearest });
    const discussion = await adapters.runDeepDiscussion({
      selectedRow,
      cases,
      mcpExtra,
      dbExtra,
      currentPersona,
      nearestStreetview: nearest,
      personas: PERSONAS,
      caseLibraryPack: caseLibPack.formatted,
    });
    const mosaicUrl = renderSchemeMosaicToDataURL(
      caseLibPack.mosaicByDimension,
      `priority=${fmt(selectedRow.priority)} · ${currentPersona.label}`
    );
    let cogImgUrl = null;
    try {
      cogImgUrl = await generateCogViewImage(
        buildSchemeImagePrompt(caseLibPack, discussion),
        typeof window !== "undefined" ? window.AgentReconGlmConfig : undefined
      );
    } catch (e) {
      console.warn("[CogView]", e);
    }
    const imgBlock = (() => {
      let h = "";
      if (mosaicUrl) {
        h += `<div style="margin-top:10px"><div class="small" style="margin-bottom:4px;">四维拼接示意板（本地 Canvas）</div><a href="${mosaicUrl}" download="scheme-mosaic.png" style="font-size:11px;color:#7dd3fc">下载 PNG</a><br/><img src="${mosaicUrl}" style="max-width:100%;margin-top:6px;border-radius:8px;border:1px solid #2a3a4e" alt="mosaic"/></div>`;
      }
      if (cogImgUrl) {
        h += `<div style="margin-top:10px"><div class="small" style="margin-bottom:4px;">CogView 文生图（智谱临时链接，请及时另存）</div><img src="${cogImgUrl}" style="max-width:100%;border-radius:8px;border:1px solid #2a3a4e" alt="ai scheme" referrerpolicy="no-referrer"/></div>`;
      }
      return h;
    })();
    discussionBox.innerHTML = `
      <div style="margin-bottom:6px;"><strong>案例数：</strong>${Array.isArray(cases) ? cases.length : 0}（含 <span class="mono">data/agent-case-library.json</span> 按维预选）</div>
      <div style="white-space:pre-wrap;line-height:1.5;">${escapeHtml(String(discussion || "暂无讨论建议"))}</div>
      ${imgBlock}
    `;
    discussionBtn.disabled = false;
  });

  render();
}

function preprocess(rows, boundaryGeom) {
  let parsed = rows
    .map((r) => {
      const row = {
        lon: toNum(r.lon),
        lat: toNum(r.lat),
        priority: toNum(r.priority),
        cpvi_E: toNum(r.cpvi_E ?? r.csvi_E),
        cpvi_S: toNum(r.cpvi_S ?? plusNum(r.csvi_S_env, r.csvi_S_contact)),
        cpvi_AC: toNum(r.cpvi_AC ?? r.csvi_AC_phys),
        N_UD: toNum(r.N_UD ?? r.N_YP),
        N09: toNum(r.N09 ?? r.N08),
        N_CD: toNum(r.N_CD),
        N_OS: toNum(r.N_OS),
      };
      if (!Number.isFinite(row.lon) || !Number.isFinite(row.lat)) return null;
      return row;
    })
    .filter(Boolean);

  if (boundaryGeom) {
    const inside = parsed.filter((row) => pointInStudyGeometry(row.lon, row.lat, boundaryGeom));
    if (!inside.length) {
      console.warn("[Agent踏勘] 边界内无边段，退回未裁剪全表");
    } else {
      parsed = inside;
    }
  }

  const tuples = parsed.map(rawTuple);
  const ext = extent7(tuples);

  parsed.forEach((row) => {
    const z = toZ(rawTuple(row), ext);
    PERSONAS.forEach((p) => {
      row[p.wp] = dot(PERSONA_WEIGHTS[p.id], z);
    });
  });

  PERSONAS.forEach((p) => attachPercentile(parsed, p.wp, p.p));
  return parsed;
}

function render() {
  pointLayer.clearLayers();
  zoneLayer.clearLayers();
  zoneTableBody.innerHTML = "";

  thresholdText.textContent = `Top ${Math.round((1 - currentThreshold) * 100)}%`;
  scoreLabel.textContent = `${currentPersona.wp} / ${currentPersona.p}`;

  const shown = allRows.filter((r) => toNum(r[currentPersona.p]) >= currentThreshold);
  visibleCount.textContent = String(shown.length);

  shown.forEach((r) => {
    const t = toNum(r[currentPersona.p]);
    const radius = 3 + 7 * t;
    const color = colorScale(t);
    const marker = L.circleMarker([r.lat, r.lon], {
      radius,
      color,
      weight: 1,
      fillColor: color,
      fillOpacity: 0.72,
    });
    marker.on("click", () => selectPoint(r, marker));
    marker.bindTooltip(
      `${currentPersona.label}<br>分位: ${fmt(t)}<br>priority: ${fmt(r.priority)}`,
      { direction: "top" }
    );
    marker.addTo(pointLayer);
  });

  zoneRows = aggregateZones(shown, currentPersona);
  renderZoneTable(zoneRows);
  renderZones(zoneRows);
}

async function selectPoint(row, marker) {
  selectedRow = row;
  discussionBtn.disabled = false;
  discussionBox.textContent = "已选点位，可生成深化选址讨论建议。";

  const radarValues = PERSONAS.map((p) => toNum(row[p.p]));
  drawRadar(radarValues);

  const nearest = nearestStreetview(row.lat, row.lon);
  streetviewNearest.textContent = nearest ? `${nearest.id} (${Math.round(nearest.distM)}m)` : "无";

  detailBox.innerHTML = `
    <div class="kv"><span class="k">坐标</span><span class="v">${row.lat.toFixed(6)}, ${row.lon.toFixed(6)}</span></div>
    <div class="kv"><span class="k">priority</span><span class="v">${fmt(row.priority)}</span></div>
    <div class="kv"><span class="k">E / S / AC</span><span class="v">${fmt(row.cpvi_E)} / ${fmt(row.cpvi_S)} / ${fmt(row.cpvi_AC)}</span></div>
    <div class="kv"><span class="k">N_UD / N09</span><span class="v">${fmt(row.N_UD)} / ${fmt(row.N09)}</span></div>
    <div class="kv"><span class="k">N_CD / N_OS</span><span class="v">${fmt(row.N_CD)} / ${fmt(row.N_OS)}</span></div>
    <div class="kv"><span class="k">${currentPersona.label} 分位</span><span class="v">${fmt(row[currentPersona.p])}</span></div>
    <div class="kv"><span class="k">街景素材</span><span class="v">${nearest ? `${nearest.id} / ${Math.round(nearest.distM)}m` : "无"}</span></div>
  `;

  marker.openTooltip();
  const token = ++selectToken;
  await renderAgentMessages(row, nearest, token);
}

async function renderAgentMessages(row, nearest, token) {
  agentMessageList.innerHTML = `<div class="empty">正在生成 Agent 留言...</div>`;
  const cards = [];

  for (const agent of PERSONAS) {
    let llmScore = null;
    if (nearest) {
      llmScore = await adapters.scoreWithVisionLLM({
        agent,
        row,
        streetview: nearest,
        features: rawTuple(row),
      });
    }
    const message = await adapters.getAgentComment({
      agent,
      row,
      streetview: nearest,
      llmScore,
    });
    cards.push({
      agent,
      message: message?.text || String(message || ""),
      source: message?.source || (llmScore ? "llm+rule" : "rule"),
      score: Number.isFinite(llmScore?.score) ? llmScore.score : toNum(row[agent.p]),
    });
  }

  if (token !== selectToken) return;
  agentMessageList.innerHTML = cards
    .map(
      (c) => `
        <div class="agent-msg">
          <div class="agent-msg-hd">
            <div class="agent-msg-name">${c.agent.label}</div>
            <div class="agent-msg-score">score: ${fmt(c.score)}</div>
          </div>
          <div class="agent-msg-body">${escapeHtml(c.message || "暂无留言")}</div>
          <div class="agent-msg-meta">来源: ${escapeHtml(c.source)}</div>
        </div>
      `
    )
    .join("");
}

function renderZoneTable(zones) {
  if (!zones.length) {
    zoneTableBody.innerHTML = `<tr><td colspan="3" class="empty">当前阈值下无候选地块</td></tr>`;
    return;
  }
  zones.forEach((z, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${idx + 1}</td><td>${z.lat.toFixed(4)}, ${z.lon.toFixed(4)}</td><td>${fmt(z.score)}</td>`;
    tr.style.cursor = "pointer";
    tr.addEventListener("click", () => {
      map.flyTo([z.lat, z.lon], 16, { duration: 0.6 });
    });
    zoneTableBody.appendChild(tr);
  });
}

function renderZones(zones) {
  zones.forEach((z) => {
    const c = L.circle([z.lat, z.lon], {
      radius: 75 + z.count * 8,
      color: "#ffcf4d",
      fillOpacity: 0.08,
      weight: 2,
    }).addTo(zoneLayer);
    c.bindTooltip(`候选地块<br>score: ${fmt(z.score)}<br>覆盖: ${z.count} 条边`, { direction: "top" });
    c.on("click", () => map.flyTo([z.lat, z.lon], 16, { duration: 0.6 }));
  });
}

function aggregateZones(rows, persona) {
  const meterToDegLat = 1 / 111320;
  const cell = 120 * meterToDegLat;
  const buckets = new Map();

  rows.forEach((r) => {
    const gx = Math.floor(r.lon / cell);
    const gy = Math.floor(r.lat / cell);
    const key = `${gx}_${gy}`;
    const item = buckets.get(key) ?? { sumLon: 0, sumLat: 0, n: 0, sumPersona: 0, sumPriority: 0 };
    item.sumLon += r.lon;
    item.sumLat += r.lat;
    item.n += 1;
    item.sumPersona += toNum(r[persona.wp]);
    item.sumPriority += toNum(r.priority);
    buckets.set(key, item);
  });

  return [...buckets.values()]
    .map((b) => {
      const pMean = b.sumPersona / Math.max(1, b.n);
      const priMean = b.sumPriority / Math.max(1, b.n);
      return {
        lon: b.sumLon / b.n,
        lat: b.sumLat / b.n,
        count: b.n,
        score: pMean * priMean * Math.log(1 + b.n),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function drawRadar(vals) {
  radarSvg.innerHTML = "";
  const cx = 110;
  const cy = 110;
  const R = 72;
  const axis = PERSONAS.length;

  for (let g = 1; g <= 4; g++) {
    const t = g / 4;
    const pts = [];
    for (let i = 0; i < axis; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / axis;
      pts.push(`${cx + Math.cos(a) * R * t},${cy + Math.sin(a) * R * t}`);
    }
    addSvg("polygon", { points: pts.join(" "), fill: "none", stroke: "#2d4158", "stroke-width": "1" });
  }

  for (let i = 0; i < axis; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / axis;
    const x = cx + Math.cos(a) * R;
    const y = cy + Math.sin(a) * R;
    addSvg("line", { x1: cx, y1: cy, x2: x, y2: y, stroke: "#2d4158", "stroke-width": "1" });
    addSvg(
      "text",
      {
        x: cx + Math.cos(a) * (R + 18),
        y: cy + Math.sin(a) * (R + 18),
        "text-anchor": "middle",
        "dominant-baseline": "middle",
      },
      PERSONAS[i].label.replace("Agent", "A")
    );
  }

  const ptsVal = vals.map((v, i) => {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / axis;
    return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v];
  });
  addSvg("polygon", {
    points: ptsVal.map(([x, y]) => `${x},${y}`).join(" "),
    fill: "rgba(83,197,255,0.26)",
    stroke: "#53c5ff",
    "stroke-width": "2",
  });
}

function addSvg(tag, attrs, text) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
  if (text) el.textContent = text;
  radarSvg.appendChild(el);
}

async function loadStreetviewAssets() {
  const fromGeojson = await tryLoadStreetviewGeojson("../data/streetview_geo/index.geojson");
  if (fromGeojson.length) return fromGeojson;
  return tryLoadStreetviewCsv("../data/streetview_geo/index.csv");
}

async function tryLoadStreetviewGeojson(url) {
  try {
    const gj = await d3.json(url);
    const feats = Array.isArray(gj?.features) ? gj.features : [];
    return feats
      .map((f, idx) => {
        const coords = f?.geometry?.coordinates || [];
        const p = f?.properties || {};
        const lon = toNum(coords[0]);
        const lat = toNum(coords[1]);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
        return {
          id: p.id || `sv_${idx + 1}`,
          lon,
          lat,
          image: p.image || "",
          thumb: p.thumb || "",
          heading: toNum(p.heading),
          ts: p.ts || "",
        };
      })
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

async function tryLoadStreetviewCsv(url) {
  try {
    const rows = await d3.csv(url);
    return rows
      .map((r, idx) => {
        const lon = toNum(r.lon);
        const lat = toNum(r.lat);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
        return {
          id: r.id || `sv_${idx + 1}`,
          lon,
          lat,
          image: r.image || "",
          thumb: r.thumb || "",
          heading: toNum(r.heading),
          ts: r.ts || "",
        };
      })
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

function nearestStreetview(lat, lon) {
  if (!streetviewAssets.length) return null;
  let best = null;
  for (const s of streetviewAssets) {
    const d = haversineM(lat, lon, s.lat, s.lon);
    if (!best || d < best.distM) best = { ...s, distM: d };
  }
  return best;
}

function rawTuple(r) {
  const s = clamp(toNum(r.cpvi_S), 0, 1.5);
  const sInv = clamp(1 - s / 1.2, 0, 1);
  return [toNum(r.cpvi_E), sInv, toNum(r.cpvi_AC), toNum(r.N_UD), toNum(r.N09), toNum(r.N_CD), toNum(r.N_OS)];
}

function extent7(tuples) {
  const lo = Array(7).fill(Infinity);
  const hi = Array(7).fill(-Infinity);
  tuples.forEach((t) => {
    for (let i = 0; i < 7; i++) {
      if (!Number.isFinite(t[i])) continue;
      lo[i] = Math.min(lo[i], t[i]);
      hi[i] = Math.max(hi[i], t[i]);
    }
  });
  for (let i = 0; i < 7; i++) {
    if (!Number.isFinite(lo[i]) || !Number.isFinite(hi[i]) || hi[i] <= lo[i]) {
      lo[i] = 0;
      hi[i] = 1;
    }
  }
  return { lo, hi };
}

function toZ(t, ext) {
  return t.map((v, i) => clamp((v - ext.lo[i]) / (ext.hi[i] - ext.lo[i]), 0, 1));
}

function dot(w, z) {
  let s = 0;
  for (let i = 0; i < w.length; i++) s += w[i] * z[i];
  return s;
}

function attachPercentile(rows, inKey, outKey) {
  const sorted = [...rows].sort((a, b) => toNum(a[inKey]) - toNum(b[inKey]));
  const n = sorted.length;
  if (!n) return;
  if (n === 1) {
    sorted[0][outKey] = 0.5;
    return;
  }
  let i = 0;
  while (i < n) {
    let j = i;
    const v = toNum(sorted[i][inKey]);
    while (j + 1 < n && toNum(sorted[j + 1][inKey]) === v) j += 1;
    const p = (i + j) / 2 / (n - 1);
    for (let k = i; k <= j; k++) sorted[k][outKey] = p;
    i = j + 1;
  }
}

function makeRuleComment(agent, row, streetview, llmScore) {
  const p = toNum(row[agent.p]);
  const level = p > 0.8 ? "高优先" : p > 0.6 ? "中高优先" : p > 0.4 ? "中优先" : "观察";
  const imageHint = streetview ? `已关联街景 ${streetview.id}（约${Math.round(streetview.distM)}m）` : "暂无街景素材";
  const llmHint = llmScore?.reason ? `；图像判断：${llmScore.reason}` : "";
  const text = `${level}。建议优先核验界面渗透性、停留邀请感与可玩节点连续性，结合在地访谈确认真实障碍。${imageHint}${llmHint}`;
  return { text, source: llmScore ? "llm+rule" : "rule" };
}

function makeRuleCases({ currentPersona, selectedRow }) {
  const pid = currentPersona?.id || "generic";
  const pri = toNum(selectedRow?.priority);
  return [
    {
      id: `${pid}_case_1`,
      title: "历史街区边界软化微更新",
      focus: "围墙退界、口袋停留点、低门槛互动节点",
      relevance: Math.min(0.95, 0.6 + pri * 0.3),
    },
    {
      id: `${pid}_case_2`,
      title: "慢行-叙事复合路径",
      focus: "非线性探索路径、街角叙事标记、分时活动",
      relevance: Math.min(0.9, 0.55 + pri * 0.25),
    },
  ];
}

function makeRuleDiscussion({ selectedRow, currentPersona, cases, caseLibraryPack }) {
  const cList = (cases || [])
    .map((c, i) => `${i + 1}. ${c.title}（相关度 ${fmt(c.relevance)}）`)
    .join("\n");
  const lines = [
    `当前点位 priority=${fmt(selectedRow.priority)}，以 ${currentPersona.label} 视角进入深化选址讨论。`,
    "建议讨论路径：",
    "- 先做街景+现场快速复核，确认交界面渗透、可停留性与安全约束；",
    "- 对照案例库按 concept / site_treatment / material_sensory / program 四维各选参考，再拼接为本地方案；",
    "- 以 5-15 分钟可体验单元为基准，配置连续节点并设置后评估指标。",
    "可参考案例：",
    cList || "- 暂无案例",
  ];
  if (caseLibraryPack) {
    lines.push("", "【案例库预选（结构化）】", String(caseLibraryPack));
  }
  return lines.join("\n");
}

function colorScale(t) {
  if (t < 0.4) return "#2a5fff";
  if (t < 0.6) return "#53c5ff";
  if (t < 0.8) return "#3ddc97";
  return "#ffb347";
}

function plusNum(a, b) {
  return toNum(a) + toNum(b);
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmt(v) {
  return Number.isFinite(v) ? v.toFixed(3) : "-";
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const p = Math.PI / 180;
  const dLat = (lat2 - lat1) * p;
  const dLon = (lon2 - lon1) * p;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function loadStudyBoundaryGeometry() {
  try {
    const j = await d3.json(STUDY_BOUNDARY_URL);
    let geom = null;
    if (j.type === "Feature" && j.geometry) geom = j.geometry;
    else if (j.type === "FeatureCollection" && j.features?.[0]?.geometry) geom = j.features[0].geometry;
    else if (j.type === "Polygon" || j.type === "MultiPolygon") geom = j;
    if (!geom || !["Polygon", "MultiPolygon"].includes(geom.type)) return null;
    return geom;
  } catch (e) {
    return null;
  }
}

function addStudyBoundaryToMap(geometry) {
  boundaryLayer.clearLayers();
  const gj = L.geoJSON(
    { type: "Feature", geometry, properties: { name: "天平路街道" } },
    {
      interactive: true,
      style: {
        color: "#9b7dff",
        weight: 2,
        opacity: 0.95,
        fillColor: "#9b7dff",
        fillOpacity: 0.07,
        dashArray: "9 6",
      },
      onEachFeature(_f, layer) {
        layer.bindTooltip("勘探范围：上海市徐汇区天平路街道", { sticky: true, direction: "center" });
      },
    }
  );
  boundaryLayer.addLayer(gj);
  const b = gj.getBounds();
  if (b.isValid()) map.fitBounds(b.pad(0.08));
}

/** GeoJSON 环为 [lon, lat][] */
function pointInRing(lon, lat, ring) {
  let inside = false;
  const n = ring.length;
  if (n < 3) return false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if ((yi > lat) !== (yj > lat)) {
      const xinters = ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (lon < xinters) inside = !inside;
    }
  }
  return inside;
}

function pointInPolygonCoords(lon, lat, polygonCoords) {
  const outer = polygonCoords[0];
  if (!pointInRing(lon, lat, outer)) return false;
  for (let h = 1; h < polygonCoords.length; h++) {
    if (pointInRing(lon, lat, polygonCoords[h])) return false;
  }
  return true;
}

function pointInStudyGeometry(lon, lat, geometry) {
  if (geometry == null) return true;
  if (geometry.type === "Polygon") {
    return pointInPolygonCoords(lon, lat, geometry.coordinates);
  }
  if (geometry.type === "MultiPolygon") {
    const polys = geometry.coordinates;
    for (let p = 0; p < polys.length; p++) {
      if (pointInPolygonCoords(lon, lat, polys[p])) return true;
    }
    return false;
  }
  return false;
}

function escapeHtml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
