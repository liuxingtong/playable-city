import {
  buildGlmEnhancedAdapters,
  generateCogViewImage,
  prefetchStreetviewImageDataUrl,
} from "./agent-recon-glm.js";
import {
  mergeCaseLibraryIntoCaseList,
  buildCaseLibraryPack,
  buildSchemeImagePrompt,
  loadAgentCaseLibrary,
} from "./agent-recon-caselib.js";
import {
  CaseRetrievalHighlighter,
} from "./agent-recon-casebase-sse.js";
import { renderCaseGraph } from "./agent-recon-case-graph.js";
import { renderSchemeMosaicToDataURL } from "./agent-recon-scheme-canvas.js";
import { fetchNearbyPoiContext } from "./agent-recon-poi.js";

const PERSONAS = [
  { id: "elder", label: "Agent1 梧桐爷叔", wp: "Wp_elder", p: "p_elder" },
  { id: "student", label: "Agent2 高校学生", wp: "Wp_student", p: "p_student" },
  { id: "white", label: "Agent3 商圈白领", wp: "Wp_white", p: "p_white" },
  { id: "family", label: "Agent4 遛娃家庭", wp: "Wp_family", p: "p_family" },
  { id: "wander", label: "Agent5 文艺漫游者", wp: "Wp_wander", p: "p_wander" },
];

/** 有街景视觉打分时，与规则画像分位的加权（街景解析计入综合分） */
const VISION_SCORE_WEIGHT = 0.35;

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
    return makeRuleComment(payload);
  },
  async queryKnowledgeCases(payload) {
    try {
      return await mergeCaseLibraryIntoCaseList(payload.selectedRow, []);
    } catch {
      return [];
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
const streetviewCfg = typeof window !== "undefined" ? window.AgentReconStreetviewConfig || {} : {};
let adapters = buildGlmEnhancedAdapters({ ...DEFAULT_ADAPTERS }, glmCfg);
adapters = { ...adapters, ...(typeof window !== "undefined" ? window.AgentReconAdapters || {} : {}) };

/** 勘探范围：上海市徐汇区天平路街道（OSM relation/13469980，见 data/tianping-road-street.geojson） */
const STUDY_BOUNDARY_URL = "../data/tianping-road-street.geojson";
const CLD_CSV_URL = "../data/cld_priority.csv";

/** 踏勘留言磁盘缓存格式版本（勿随意改，以免无法读取旧数据） */
const RECON_PERSIST_VERSION = 2;

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
const legendMinLabel = document.getElementById("legendMinLabel");
const legendMidLabel = document.getElementById("legendMidLabel");
const legendMaxLabel = document.getElementById("legendMaxLabel");
const streetviewFloatingTab = document.getElementById("streetviewFloatingTab");
const streetviewTabBody = document.getElementById("streetviewTabBody");
const streetviewCloseBtn = document.getElementById("streetviewCloseBtn");

let studyGeometry = null;
let allRows = [];
let streetviewAssets = [];
let currentPersona = PERSONAS[0];
let currentThreshold = Number(thresholdRange.value) / 100;
let zoneRows = [];
let selectedRow = null;
let selectToken = 0;
let casebaseHighlighter = null;
let lastRagTraceId = null;
/** @type {boolean} */
let batchReconRunning = false;

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

  const rows = await d3.csv(CLD_CSV_URL);
  allRows = preprocess(rows, studyGeometry);
  sampleCount.textContent = String(allRows.length);

  let sv = await loadStreetviewAssets();
  if (studyGeometry) {
    sv = sv.filter((s) => pointInStudyGeometry(s.lon, s.lat, studyGeometry));
  }
  streetviewAssets = sv;
  streetviewCount.textContent = String(streetviewAssets.length);

  const hydrated = hydrateReconCacheFromStorage();
  if (hydrated > 0) {
    console.log(`[Agent踏勘] 已从本地恢复 ${hydrated} 个点位的勘探缓存`);
  }

  const cbCfg = typeof window !== "undefined" ? window.AgentReconCasebaseConfig : null;
  const caseGraphSvg = document.getElementById("caseGraphSvg");
  const casebaseStatus = document.getElementById("casebaseStatus");
  let libraryCasesForGraph = [];

  function refreshCaseGraphFromHighlighter(h) {
    if (!caseGraphSvg || !h) return;
    const ids = h.getHighlightedCaseIds();
    const map = new Map(libraryCasesForGraph.map((c) => [c.id, c]));
    for (const id of ids) {
      if (!map.has(id)) map.set(id, { id, title: id, primary_dimension: "_default" });
    }
    renderCaseGraph(caseGraphSvg, [...map.values()], ids);
  }

  if (cbCfg?.enabled) {
    try {
      const lib = await loadAgentCaseLibrary();
      libraryCasesForGraph = lib.cases || [];
    } catch {
      libraryCasesForGraph = [];
    }
    casebaseHighlighter = new CaseRetrievalHighlighter({
      getSessionAgentId: () => (cbCfg.agentIdPrefix || "playable_") + (personaSelect?.value || "agent"),
      getActiveTraceId: () => lastRagTraceId,
      eventsApiBase: cbCfg.eventsApiBase || "http://127.0.0.1:3851",
      onHighlightChange: () => refreshCaseGraphFromHighlighter(casebaseHighlighter),
      onStatus: (m) => {
        if (casebaseStatus) casebaseStatus.textContent = m;
      },
    });
    casebaseHighlighter.start();
    renderCaseGraph(caseGraphSvg, libraryCasesForGraph, []);

    document.getElementById("casebaseReplayBtn")?.addEventListener("click", async () => {
      try {
        await casebaseHighlighter.fetchReplay(cbCfg.replayLimit ?? 100);
        if (casebaseStatus) casebaseStatus.textContent = "回放已应用到高亮队列";
        refreshCaseGraphFromHighlighter(casebaseHighlighter);
      } catch (e) {
        if (casebaseStatus) casebaseStatus.textContent = `回放失败: ${e.message || e}`;
      }
    });
  }

  personaSelect.addEventListener("change", () => {
    const persona = PERSONAS.find((p) => p.id === personaSelect.value);
    if (!persona) return;
    currentPersona = persona;
    render();
    if (casebaseHighlighter) refreshCaseGraphFromHighlighter(casebaseHighlighter);
  });

  thresholdRange.addEventListener("input", () => {
    currentThreshold = Number(thresholdRange.value) / 100;
    render();
  });

  discussionBtn.addEventListener("click", async () => {
    if (!selectedRow) return;
    discussionBtn.disabled = true;
    const live = {
      status: "准备中…",
      traceId: "",
      retrieval: [],
      turns: [],
      host: "",
      activeSpeaker: "",
      phase: "planning",
    };
    /** 流式 token 高频更新：避免每 token 全量 innerHTML（会卡死主线程） */
    let streamRaf = null;
    let streamThrottleTimer = null;
    const STREAM_THROTTLE_MS = 80;
    const flushLiveDiscussion = () => {
      streamRaf = null;
      try {
        renderLiveDiscussionNow();
      } catch (e) {
        console.warn("[discussion render]", e);
      }
    };
    const scheduleStreamRender = () => {
      if (streamRaf != null) return;
      streamRaf = requestAnimationFrame(flushLiveDiscussion);
    };
    const scheduleThrottledStreamRender = () => {
      if (streamThrottleTimer != null) return;
      streamThrottleTimer = setTimeout(() => {
        streamThrottleTimer = null;
        scheduleStreamRender();
      }, STREAM_THROTTLE_MS);
    };
    const renderLiveDiscussionNow = () => {
      const retrievalBlock = live.retrieval.length
        ? `<div class="meta" style="white-space:pre-wrap;">${escapeHtml(live.retrieval.join("\n"))}</div>`
        : "";
      const turnsBlock = live.turns
        .map((t) => {
          const typing = live.activeSpeaker === t.name ? '<span class="typing-cursor">|</span>' : "";
          return `<div class="turn"><div class="name">${escapeHtml(t.name)}</div><div class="body">${escapeHtml(t.text)}${typing}</div></div>`;
        })
        .join("");
      const hostBlock = live.host
        ? `<div class="turn host"><div class="name">主持人</div><div class="body">${escapeHtml(live.host)}${live.activeSpeaker === "主持人" ? '<span class="typing-cursor">|</span>' : ""}</div></div>`
        : "";
      const traceLine = live.traceId ? `<span class="trace">${escapeHtml(live.traceId)}</span>` : "待生成";
      discussionBox.innerHTML = `
        <div class="discussion-live" id="discussionLivePanel">
          <div class="meta">状态：${escapeHtml(live.status)}</div>
          <div class="meta">trace_id：${traceLine}</div>
          ${retrievalBlock}
          ${turnsBlock}
          ${hostBlock}
        </div>
      `;
      const panel = document.getElementById("discussionLivePanel");
      if (panel) panel.scrollTop = panel.scrollHeight;
    };
    const renderLiveDiscussionImmediate = () => {
      if (streamThrottleTimer != null) {
        clearTimeout(streamThrottleTimer);
        streamThrottleTimer = null;
      }
      if (streamRaf != null) {
        cancelAnimationFrame(streamRaf);
        streamRaf = null;
      }
      renderLiveDiscussionNow();
    };
    live.status = "正在实时生成：多维检索 + 多 Agent 讨论…";
    renderLiveDiscussionImmediate();
    let discussion = "";
    try {
      const caseLibPack = await buildCaseLibraryPack(selectedRow);
      const nearest = nearestStreetview(selectedRow.lat, selectedRow.lon);
      const poiContext = await fetchNearbyPoiContext(selectedRow.lat, selectedRow.lon);
      const cases = await adapters.queryKnowledgeCases({
        selectedRow,
        zoneRows,
        nearestStreetview: nearest,
        personas: PERSONAS,
        currentPersona,
        poiContext,
      });
      const mcpExtra = await adapters.queryMcpKnowledge({ selectedRow, nearestStreetview: nearest });
      const dbExtra = await adapters.queryExternalDatabase({ selectedRow, nearestStreetview: nearest });
      discussion = await adapters.runDeepDiscussion({
        selectedRow,
        cases,
        mcpExtra,
        dbExtra,
        currentPersona,
        nearestStreetview: nearest,
        personas: PERSONAS,
        caseLibraryPack: caseLibPack.formatted,
          caseLibraryDimensions: caseLibPack.dimensions,
        poiContext,
        hooks: {
          setActiveRagTraceId: (id) => {
            lastRagTraceId = id;
          },
          onDiscussionEvent: (evt) => {
            if (!evt || typeof evt !== "object") return;
            if (evt.type === "status") live.status = String(evt.text || live.status);
            if (evt.type === "trace") live.traceId = String(evt.traceId || "");
            if (evt.type === "retrieval") {
              live.retrieval.push(`[${evt.dimension}] ${evt.query || ""}`);
            }
            if (evt.type === "agent_turn_start") {
              const name = evt.agentName || evt.agentId || "Agent";
              const idx = live.turns.findIndex((t) => t.name === name);
              if (idx < 0) live.turns.push({ name, text: "" });
              live.activeSpeaker = name;
              live.phase = "agent";
            }
            if (evt.type === "agent_turn_token") {
              const name = evt.agentName || evt.agentId || "Agent";
              const idx = live.turns.findIndex((t) => t.name === name);
              if (idx < 0) live.turns.push({ name, text: String(evt.token || "") });
              else live.turns[idx].text += String(evt.token || "");
              live.activeSpeaker = name;
              live.phase = "agent";
              scheduleThrottledStreamRender();
              return;
            }
            if (evt.type === "agent_turn") {
              const name = evt.agentName || evt.agentId || "Agent";
              const idx = live.turns.findIndex((t) => t.name === name);
              if (idx < 0) live.turns.push({ name, text: String(evt.text || "") });
              else live.turns[idx].text = String(evt.text || live.turns[idx].text);
              live.activeSpeaker = "";
            }
            if (evt.type === "facilitator_turn_start") {
              live.host = "";
              live.activeSpeaker = "主持人";
              live.phase = "host";
            }
            if (evt.type === "facilitator_turn_token") {
              live.host += String(evt.token || "");
              live.activeSpeaker = "主持人";
              live.phase = "host";
              scheduleThrottledStreamRender();
              return;
            }
            if (evt.type === "facilitator_turn") {
              live.host = String(evt.text || "");
              live.activeSpeaker = "";
              live.phase = "done";
            }
            renderLiveDiscussionImmediate();
          },
        },
      });
      if (streamThrottleTimer != null) {
        clearTimeout(streamThrottleTimer);
        streamThrottleTimer = null;
      }
      if (streamRaf != null) {
        cancelAnimationFrame(streamRaf);
        streamRaf = null;
      }
      const mosaicUrl = renderSchemeMosaicToDataURL(
        caseLibPack.mosaicByDimension,
        `priority=${fmt(selectedRow.priority)} · ${currentPersona.label}`,
        caseLibPack.dimensions
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
          h += `<div style="margin-top:10px"><div class="small" style="margin-bottom:4px;">多维拼接示意板（本地 Canvas）</div><a href="${mosaicUrl}" download="scheme-mosaic.png" style="font-size:11px;color:#7dd3fc">下载 PNG</a><br/><img src="${mosaicUrl}" style="max-width:100%;margin-top:6px;border-radius:8px;border:1px solid #2a3a4e" alt="mosaic"/></div>`;
        }
        if (cogImgUrl) {
          h += `<div style="margin-top:10px"><div class="small" style="margin-bottom:4px;">CogView 文生图（智谱临时链接，请及时另存）</div><img src="${cogImgUrl}" style="max-width:100%;border-radius:8px;border:1px solid #2a3a4e" alt="ai scheme" referrerpolicy="no-referrer"/></div>`;
        }
        return h;
      })();
      discussionBox.innerHTML = `
      <div class="small" style="margin-bottom:6px;">已完成实时协作讨论（含主持人）。</div>
      <div style="white-space:pre-wrap;line-height:1.5;">${escapeHtml(String(discussion || "暂无讨论建议"))}</div>
      ${imgBlock}
    `;
    } catch (e) {
      if (streamThrottleTimer != null) {
        clearTimeout(streamThrottleTimer);
        streamThrottleTimer = null;
      }
      if (streamRaf != null) {
        cancelAnimationFrame(streamRaf);
        streamRaf = null;
      }
      discussionBox.innerHTML = `<div class="small">讨论生成失败：${escapeHtml(String(e?.message || e))}</div>`;
    }
    discussionBtn.disabled = false;
  });

  streetviewCloseBtn?.addEventListener("click", () => {
    hideStreetviewTab();
  });

  const batchReconBtn = document.getElementById("batchReconBtn");
  const batchReconStatus = document.getElementById("batchReconStatus");
  const reconCacheExportBtn = document.getElementById("reconCacheExportBtn");
  const reconCacheImportBtn = document.getElementById("reconCacheImportBtn");
  const reconCacheImportInput = document.getElementById("reconCacheImportInput");
  const reconCacheClearBtn = document.getElementById("reconCacheClearBtn");

  batchReconBtn?.addEventListener("click", async () => {
    if (batchReconRunning || !allRows.length) return;
    batchReconRunning = true;
    batchReconBtn.disabled = true;
    const total = allRows.length;
    let withSv = 0;
    let skipped = 0;
    try {
      for (let i = 0; i < allRows.length; i++) {
        const row = allRows[i];
        const nearest = nearestStreetview(row.lat, row.lon);
        if (nearest) withSv += 1;
        const key = reconCacheKey(row, nearest);
        if (
          row.__reconCache?.key === key &&
          Array.isArray(row.__reconCache.cards) &&
          row.__reconCache.cards.length === PERSONAS.length
        ) {
          skipped += 1;
          if (batchReconStatus) {
            batchReconStatus.textContent = `批量 ${i + 1}/${total}：跳过已缓存 ${skipped} 个 · 当前点命中街景 ${nearest ? "是" : "否"}…`;
          }
          continue;
        }
        if (batchReconStatus) {
          batchReconStatus.textContent = `批量勘探中 ${i + 1}/${total}（已跳过 ${skipped}）· 五 Agent 并行…`;
        }
        const poiContext = await fetchNearbyPoiContext(row.lat, row.lon);
        const cards = await buildAgentCards(row, nearest, poiContext);
        row.__reconCache = { key, cards };
        persistReconRowToStorage(row, nearest, cards);
      }
      if (batchReconStatus) {
        batchReconStatus.textContent = `批量完成：共 ${total} 点，新跑 ${total - skipped}，跳过 ${skipped}；${withSv} 点曾命中街景。结果已写入本机 localStorage，可导出 JSON 备份。`;
      }
    } catch (e) {
      if (batchReconStatus) {
        batchReconStatus.textContent = `批量中断：${String(e?.message || e)}（已成功写入的点位仍保留在本地缓存）`;
      }
    } finally {
      batchReconRunning = false;
      batchReconBtn.disabled = false;
    }
  });

  reconCacheExportBtn?.addEventListener("click", () => {
    const store = readReconPersistStore();
    const blob = new Blob([JSON.stringify(store, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `agent-recon-cache-${getReconStudySlug()}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    if (batchReconStatus) batchReconStatus.textContent = "已导出当前本地勘探缓存 JSON（含全部已存点位）。";
  });

  reconCacheImportBtn?.addEventListener("click", () => reconCacheImportInput?.click());
  reconCacheImportInput?.addEventListener("change", async () => {
    const f = reconCacheImportInput.files?.[0];
    reconCacheImportInput.value = "";
    if (!f) return;
    try {
      const text = await f.text();
      const j = JSON.parse(text);
      const merged = mergeReconImportIntoStore(j);
      writeReconPersistStore(merged);
      const n = hydrateReconCacheFromStorage();
      if (batchReconStatus) {
        batchReconStatus.textContent = `已合并导入：当前本地共 ${Object.keys(merged.byKey || {}).length} 条点位缓存，本次匹配恢复 ${n} 行。`;
      }
      if (selectedRow) {
        const nearest = nearestStreetview(selectedRow.lat, selectedRow.lon);
        const token = ++selectToken;
        await renderAgentMessages(selectedRow, nearest, token);
      }
    } catch (e) {
      if (batchReconStatus) batchReconStatus.textContent = `导入失败：${String(e?.message || e)}`;
    }
  });

  reconCacheClearBtn?.addEventListener("click", () => {
    if (!window.confirm("确定清空本机勘探缓存（localStorage）？不影响已导出的 JSON 文件。")) return;
    try {
      localStorage.removeItem(getReconPersistStorageKey());
    } catch {
      /* ignore */
    }
    for (const row of allRows) delete row.__reconCache;
    if (batchReconStatus) batchReconStatus.textContent = "已清空本地勘探缓存。";
    if (selectedRow) {
      agentMessageList.innerHTML = `<div class="empty">缓存已清空，请重新点击本点或运行批量勘探。</div>`;
    }
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
  const colorDomain = getRelativeColorDomain(shown, currentPersona.p);
  updateLegend(colorDomain);

  shown.forEach((r) => {
    const t = toNum(r[currentPersona.p]);
    const tRel = normalizeToDomain(t, colorDomain);
    const radius = 3 + 7 * tRel;
    const color = colorScale(tRel);
    const marker = L.circleMarker([r.lat, r.lon], {
      radius,
      color,
      weight: 1,
      fillColor: color,
      fillOpacity: 0.72,
    });
    marker.on("click", () => selectPoint(r, marker));
    marker.bindTooltip(
      `${currentPersona.label}<br>分位: ${fmt(t)}（相对: ${fmt(tRel)}）<br>priority: ${fmt(r.priority)}`,
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
  renderStreetviewTab(row, nearest);

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

/** 与街景命中、坐标绑定；数据或索引变更后缓存自然失效（可手动刷新页） */
function reconCacheKey(row, nearest) {
  return `${nearest?.id ?? "no_sv"}|${row.lat.toFixed(6)}|${row.lon.toFixed(6)}`;
}

function getReconStudySlug() {
  if (studyGeometry) {
    const name = String(STUDY_BOUNDARY_URL).split("/").pop() || "bounded";
    return name.replace(/\.[^.]+$/, "") || "bounded";
  }
  return "no-boundary";
}

function getReconPersistStorageKey() {
  return `playable-city:agent-recon:v${RECON_PERSIST_VERSION}:${getReconStudySlug()}`;
}

function emptyReconPersistStore() {
  return {
    version: RECON_PERSIST_VERSION,
    studySlug: getReconStudySlug(),
    csvUrl: CLD_CSV_URL,
    savedAt: new Date().toISOString(),
    byKey: /** @type {Record<string, { cards: ReturnType<typeof serializeReconCard>[]; savedAt: string }>} */ ({}),
  };
}

function readReconPersistStore() {
  try {
    const raw = localStorage.getItem(getReconPersistStorageKey());
    if (!raw) return emptyReconPersistStore();
    const j = JSON.parse(raw);
    if (!j || typeof j !== "object" || j.version !== RECON_PERSIST_VERSION || typeof j.byKey !== "object") {
      return emptyReconPersistStore();
    }
    return {
      ...emptyReconPersistStore(),
      ...j,
      byKey: j.byKey && typeof j.byKey === "object" ? j.byKey : {},
    };
  } catch {
    return emptyReconPersistStore();
  }
}

function writeReconPersistStore(store) {
  const body = {
    ...emptyReconPersistStore(),
    ...store,
    version: RECON_PERSIST_VERSION,
    studySlug: getReconStudySlug(),
    csvUrl: CLD_CSV_URL,
    savedAt: new Date().toISOString(),
    byKey: store.byKey && typeof store.byKey === "object" ? store.byKey : {},
  };
  try {
    localStorage.setItem(getReconPersistStorageKey(), JSON.stringify(body));
  } catch (e) {
    console.warn("[Agent踏勘] 写入 localStorage 失败（可能超限）:", e?.message || e);
  }
}

/** @param {object} c */
function serializeReconCard(c) {
  return {
    agentId: c.agent?.id || "elder",
    message: String(c.message || ""),
    source: String(c.source || ""),
    score: Number.isFinite(Number(c.score)) ? Number(c.score) : 0,
    scoreDetail:
      c.scoreDetail && typeof c.scoreDetail === "object"
        ? {
            rule: Number(c.scoreDetail.rule),
            vision: Number(c.scoreDetail.vision),
          }
        : null,
  };
}

/** @param {unknown[]} raw */
function deserializeReconCards(raw) {
  if (!Array.isArray(raw) || raw.length !== PERSONAS.length) return null;
  const byId = new Map(raw.map((x) => [String(x?.agentId || ""), x]));
  const out = [];
  for (const agent of PERSONAS) {
    const x = byId.get(agent.id);
    if (!x || typeof x !== "object") return null;
    const sd = x.scoreDetail;
    out.push({
      agent,
      message: String(x.message || ""),
      source: String(x.source || ""),
      score: Number.isFinite(Number(x.score)) ? Number(x.score) : 0,
      scoreDetail:
        sd && Number.isFinite(Number(sd.rule)) && Number.isFinite(Number(sd.vision))
          ? { rule: Number(sd.rule), vision: Number(sd.vision) }
          : null,
    });
  }
  return out;
}

function persistReconRowToStorage(row, nearest, cards) {
  const key = reconCacheKey(row, nearest);
  const store = readReconPersistStore();
  store.byKey[key] = {
    cards: cards.map(serializeReconCard),
    savedAt: new Date().toISOString(),
  };
  writeReconPersistStore(store);
}

/** @returns {number} 成功挂到 row.__reconCache 的条数 */
function hydrateReconCacheFromStorage() {
  if (!allRows.length) return 0;
  const store = readReconPersistStore();
  const keys = store.byKey || {};
  let n = 0;
  for (const row of allRows) {
    const nearest = nearestStreetview(row.lat, row.lon);
    const key = reconCacheKey(row, nearest);
    const entry = keys[key];
    if (!entry?.cards) continue;
    const cards = deserializeReconCards(entry.cards);
    if (!cards) continue;
    row.__reconCache = { key, cards };
    n += 1;
  }
  return n;
}

/** 将导入 JSON 合并进当前 store（按 reconCacheKey 覆盖写入） */
function mergeReconImportIntoStore(imported) {
  const base = readReconPersistStore();
  const incoming = imported && typeof imported === "object" ? imported : {};
  const inKeys = incoming.byKey && typeof incoming.byKey === "object" ? incoming.byKey : {};
  const merged = { ...base, byKey: { ...base.byKey } };
  for (const k of Object.keys(inKeys)) {
    const entry = inKeys[k];
    if (!entry?.cards || !Array.isArray(entry.cards)) continue;
    if (!deserializeReconCards(entry.cards)) continue;
    merged.byKey[k] = {
      cards: entry.cards.map((x) => ({
        agentId: String(x.agentId || ""),
        message: String(x.message || ""),
        source: String(x.source || ""),
        score: Number.isFinite(Number(x.score)) ? Number(x.score) : 0,
        scoreDetail:
          x.scoreDetail &&
          Number.isFinite(Number(x.scoreDetail.rule)) &&
          Number.isFinite(Number(x.scoreDetail.vision))
            ? { rule: Number(x.scoreDetail.rule), vision: Number(x.scoreDetail.vision) }
            : null,
      })),
      savedAt: String(entry.savedAt || new Date().toISOString()),
    };
  }
  return merged;
}

/**
 * 单点位：五位 Agent 并行；街景图仅下载一次为 data URL，供五次 vision 请求复用。
 * @param {object} row
 * @param {object|null} nearest
 * @param {string} poiContext
 */
async function buildAgentCards(row, nearest, poiContext) {
  const feats = rawTuple(row);
  const precomputedImageDataUrl = nearest ? await prefetchStreetviewImageDataUrl(nearest) : null;
  return Promise.all(
    PERSONAS.map(async (agent) => {
      let llmScore = null;
      if (nearest) {
        llmScore = await adapters.scoreWithVisionLLM({
          agent,
          row,
          streetview: nearest,
          features: feats,
          poiContext,
          precomputedImageDataUrl,
        });
      }
      const message = await adapters.getAgentComment({
        agent,
        row,
        streetview: nearest,
        llmScore,
        poiContext,
      });
      const ruleP = toNum(row[agent.p]);
      const visionS = llmScore?.score;
      const blended =
        nearest && Number.isFinite(visionS)
          ? VISION_SCORE_WEIGHT * visionS + (1 - VISION_SCORE_WEIGHT) * ruleP
          : ruleP;
      return {
        agent,
        message: message?.text || String(message || ""),
        source: message?.source || (llmScore ? "llm+rule" : "rule"),
        score: blended,
        scoreDetail: nearest && Number.isFinite(visionS) ? { rule: ruleP, vision: visionS } : null,
      };
    })
  );
}

function renderAgentCardList(cards) {
  agentMessageList.innerHTML = cards
    .map(
      (c) => `
        <div class="agent-msg">
          <div class="agent-msg-hd">
            <div class="agent-msg-name">${c.agent.label}</div>
            <div class="agent-msg-score">${
              c.scoreDetail
                ? `综合分: ${fmt(c.score)}（规则分位 ${fmt(c.scoreDetail.rule)} × ${(1 - VISION_SCORE_WEIGHT).toFixed(2)} + 街景解析 ${fmt(c.scoreDetail.vision)} × ${VISION_SCORE_WEIGHT.toFixed(2)}）`
                : `分位得分: ${fmt(c.score)}`
            }</div>
          </div>
          <div class="agent-msg-body">${escapeHtml(c.message || "暂无留言")}</div>
          <div class="agent-msg-meta">来源: ${escapeHtml(c.source)}</div>
        </div>
      `
    )
    .join("");
}

async function renderAgentMessages(row, nearest, token) {
  agentMessageList.innerHTML = `<div class="empty">正在生成 Agent 留言...</div>`;
  const key = reconCacheKey(row, nearest);
  if (row.__reconCache?.key === key) {
    if (token !== selectToken) return;
    renderAgentCardList(row.__reconCache.cards);
    return;
  }
  const poiContext = await fetchNearbyPoiContext(row.lat, row.lon);
  if (token !== selectToken) return;
  const cards = await buildAgentCards(row, nearest, poiContext);
  row.__reconCache = { key, cards };
  persistReconRowToStorage(row, nearest, cards);
  if (token !== selectToken) return;
  renderAgentCardList(cards);
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
  const candidates = Array.isArray(streetviewCfg.sourceCandidates)
    ? streetviewCfg.sourceCandidates.filter((x) => typeof x === "string" && x.trim())
    : [
        "../data/street-image/50上海_image_meta10_allfieldsb.csv",
        "../data/street-image/50上海.csv",
        "../data/50上海/index.geojson",
        "../data/50上海/index.csv",
        "../data/streetview_geo/index.geojson",
        "../data/streetview_geo/index.csv",
      ];
  const assets = [];
  const seen = new Set();
  for (const url of candidates) {
    const lower = String(url).toLowerCase();
    if (lower.endsWith(".geojson")) {
      const res = await tryLoadStreetviewGeojson(url);
      if (!res.loadedOk) continue;
      for (const a of res.assets) {
        const key = `${a.id}|${a.lon.toFixed(6)}|${a.lat.toFixed(6)}|${a.image || a.thumb || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        assets.push(a);
      }
      continue;
    }
    if (lower.endsWith(".csv")) {
      const rows = await tryLoadStreetviewCsv(url);
      for (const a of rows) {
        const key = `${a.id}|${a.lon.toFixed(6)}|${a.lat.toFixed(6)}|${a.image || a.thumb || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        assets.push(a);
      }
    }
  }
  return assets;
}

/** GeoJSON 文件存在且解析成功时返回 loadedOk:true（features 可为空，不再请求 CSV）。 */
async function tryLoadStreetviewGeojson(url) {
  try {
    const baseHref = new URL(".", new URL(url, window.location.href)).href;
    const gj = await d3.json(url);
    const feats = Array.isArray(gj?.features) ? gj.features : [];
    const assets = feats
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
          image: resolveAssetUrl(p.image || "", baseHref),
          thumb: resolveAssetUrl(p.thumb || "", baseHref),
          heading: toNum(p.heading),
          ts: p.ts || "",
        };
      })
      .filter(Boolean);
    return { loadedOk: true, assets };
  } catch {
    return { loadedOk: false, assets: [] };
  }
}

async function tryLoadStreetviewCsv(url) {
  try {
    const baseHref = new URL(".", new URL(url, window.location.href)).href;
    const rows = await d3.csv(url);
    return rows
      .map((r, idx) => {
        const lon = maybeNum(r.lon ?? r.x ?? r.WGS_X ?? r.WGSX ?? r.lng ?? r.LON ?? r.X);
        const lat = maybeNum(r.lat ?? r.y ?? r.WGS_Y ?? r.WGSY ?? r.latitude ?? r.LAT ?? r.Y);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
        const fileName =
          (typeof r.FileName === "string" && r.FileName.trim()) ||
          (typeof r.filename === "string" && r.filename.trim()) ||
          "";
        const imageRaw = (typeof r.image === "string" && r.image.trim()) || fileName;
        return {
          id: r.id || r.ID || r.PointID || r.FID || r.pid || `sv_${idx + 1}`,
          lon,
          lat,
          image: resolveAssetUrl(imageRaw, baseHref),
          thumb: resolveAssetUrl(r.thumb || "", baseHref),
          heading: maybeNum(r.heading ?? r.Heading) ?? 0,
          ts: r.ts || r.Time || r.Date || "",
        };
      })
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

function nearestStreetview(lat, lon) {
  if (!streetviewAssets.length) return null;
  const maxNearestDistM = Number.isFinite(Number(streetviewCfg.maxNearestDistM))
    ? Number(streetviewCfg.maxNearestDistM)
    : 180;
  let best = null;
  for (const s of streetviewAssets) {
    const d = haversineM(lat, lon, s.lat, s.lon);
    if (!best || d < best.distM) best = { ...s, distM: d };
  }
  if (!best || best.distM > maxNearestDistM) return null;
  return best;
}

function resolveAssetUrl(rawPath, baseHref) {
  if (typeof rawPath !== "string") return "";
  const trimmed = rawPath.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("data:")) return trimmed;
  const hasProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed) || trimmed.startsWith("//");
  const isBareFileName = !hasProtocol && !trimmed.includes("/") && !trimmed.includes("\\");
  try {
    if (isBareFileName) {
      return new URL(`images/${trimmed}`, baseHref || window.location.href).href;
    }
    return new URL(trimmed, baseHref || window.location.href).href;
  } catch {
    return trimmed;
  }
}

function hideStreetviewTab() {
  if (!streetviewFloatingTab || !streetviewTabBody) return;
  streetviewFloatingTab.classList.add("is-hidden");
  streetviewTabBody.innerHTML = "";
}

function renderStreetviewTab(row, nearest) {
  if (!streetviewFloatingTab || !streetviewTabBody || !row) return;
  if (!nearest) {
    streetviewTabBody.innerHTML = `<div class="streetview-tab-empty">该点位附近未命中可用街景图（或最近图超过阈值）。可在 <span class="mono">data/50上海</span> 或 <span class="mono">data/streetview_geo</span> 的索引里补充坐标与 image 路径。</div>`;
    streetviewFloatingTab.classList.remove("is-hidden");
    return;
  }
  const img = nearest.image || nearest.thumb;
  const meta = [
    `素材ID: ${escapeHtml(nearest.id || "-")}`,
    `距离: ${Math.round(nearest.distM)}m`,
    `坐标: ${nearest.lat.toFixed(6)}, ${nearest.lon.toFixed(6)}`,
    nearest.ts ? `时间: ${escapeHtml(String(nearest.ts))}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  if (!img) {
    streetviewTabBody.innerHTML = `
      <div class="streetview-tab-meta">${meta}</div>
      <div class="streetview-tab-empty">该街景点缺少 image/thumb 字段，暂无法预览图片。</div>
    `;
    streetviewFloatingTab.classList.remove("is-hidden");
    return;
  }
  streetviewTabBody.innerHTML = `
    <div class="streetview-tab-meta">${meta}</div>
    <img src="${img}" alt="streetview preview" class="streetview-tab-img" referrerpolicy="no-referrer" />
  `;
  streetviewFloatingTab.classList.remove("is-hidden");
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

function makeRuleComment(payload) {
  const { agent, row, streetview, llmScore, poiContext } = payload;
  const p = toNum(row[agent.p]);
  const level = p > 0.8 ? "高优先" : p > 0.6 ? "中高优先" : p > 0.4 ? "中优先" : "观察";
  const imageHint = streetview ? `已关联街景 ${streetview.id}（约${Math.round(streetview.distM)}m）` : "暂无街景素材";
  const llmHint = llmScore?.reason ? `；图像判断：${llmScore.reason}` : "";
  const poiHint =
    typeof poiContext === "string" && poiContext.trim()
      ? " 结合已拉取的周边 OSM 兴趣点核对动线与设施缺口。"
      : "";
  const childPov =
    agent.id === "family"
      ? " 孩子眼里（约 1～1.2 m）：请现场蹲低看一轮—车轮与路缘是否压视线、栏杆孔洞是否卡脚、有没有可摸可看的安全小趣味；家长再对照上述指标判断。"
      : "";
  const text = `${level}。建议优先核验界面渗透性、停留邀请感与可玩节点连续性，结合在地访谈确认真实障碍。${childPov}${imageHint}${llmHint}${poiHint}`;
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
    "- 对照案例库按当前维度（如场地感知/概念/造型/空间/功能/技术）选参考，再拼接为本地方案；",
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
  const stops = [
    { pos: 0, color: "#2a5fff" },
    { pos: 0.36, color: "#53c5ff" },
    { pos: 0.68, color: "#3ddc97" },
    { pos: 1, color: "#ffb347" },
  ];
  const x = clamp(t, 0, 1);
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (x <= b.pos) {
      const ratio = (x - a.pos) / Math.max(1e-6, b.pos - a.pos);
      return mixHex(a.color, b.color, ratio);
    }
  }
  return stops[stops.length - 1].color;
}

function getRelativeColorDomain(rows, scoreKey) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of rows) {
    const v = toNum(r[scoreKey]);
    if (!Number.isFinite(v)) continue;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    return { min: 0, max: 1 };
  }
  if (hi <= lo) {
    const pad = 0.02;
    return { min: clamp(lo - pad, 0, 1), max: clamp(hi + pad, 0, 1) };
  }
  return { min: lo, max: hi };
}

function normalizeToDomain(value, domain) {
  const v = toNum(value);
  const min = toNum(domain?.min);
  const max = toNum(domain?.max);
  if (!Number.isFinite(v) || !Number.isFinite(min) || !Number.isFinite(max)) return 0;
  if (max <= min) return 0.5;
  return clamp((v - min) / (max - min), 0, 1);
}

function updateLegend(domain) {
  if (!legendMinLabel || !legendMidLabel || !legendMaxLabel) return;
  const min = toNum(domain?.min);
  const max = toNum(domain?.max);
  const mid = (min + max) / 2;
  legendMinLabel.textContent = `低（${fmt(min)}）`;
  legendMidLabel.textContent = `中（${fmt(mid)}）`;
  legendMaxLabel.textContent = `高（${fmt(max)}）`;
}

function mixHex(hexA, hexB, t) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const k = clamp(t, 0, 1);
  const r = Math.round(a.r + (b.r - a.r) * k);
  const g = Math.round(a.g + (b.g - a.g) * k);
  const bCh = Math.round(a.b + (b.b - a.b) * k);
  return `rgb(${r}, ${g}, ${bCh})`;
}

function hexToRgb(hex) {
  const raw = String(hex || "").trim().replace(/^#/, "");
  const s = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const n = Number.parseInt(s, 16);
  if (!Number.isFinite(n)) return { r: 255, g: 255, b: 255 };
  return {
    r: (n >> 16) & 255,
    g: (n >> 8) & 255,
    b: n & 255,
  };
}

function plusNum(a, b) {
  return toNum(a) + toNum(b);
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function maybeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
