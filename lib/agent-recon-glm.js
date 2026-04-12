/**
 * 智谱 GLM（OpenAI 兼容 chat/completions）+ 多 Agent 串行协作讨论。
 * 配置：window.AgentReconGlmConfig（见 pages/agent-recon-mvp.html 占位示例）
 * 浏览器直连大模型可能受 CORS 限制，请使用 scripts/glm-proxy.mjs + GLM_API_KEY 环境变量。
 */
import { CASE_LIBRARY_SKILL_PROMPT } from "./agent-recon-skill-prompt.js";
import {
  generateTraceId,
  callCasebaseRagProxy,
  formatRagDimensionBlock,
} from "./agent-recon-casebase-sse.js";
import {
  DEFAULT_CASE_DIMENSIONS,
  normalizeDimensionKey,
  normalizeDimensionList,
  getDimensionLabel,
  buildDimensionGuideText,
  fallbackQueryForDimension,
} from "./agent-recon-dimensions.js";

const PLACEHOLDER_KEYS = new Set(["", "YOUR_GLM_API_KEY_PLACEHOLDER"]);

/** @param {unknown} k */
function isPlaceholderKey(k) {
  const s = String(k || "").trim();
  if (PLACEHOLDER_KEYS.has(s)) return true;
  if (/PLACEHOLDER/i.test(s)) return true;
  return false;
}

/** @param {Record<string, unknown>|undefined} c */
function normalizeGlmConfig(c) {
  return {
    enabled: Boolean(c?.enabled),
    apiKey: String(c?.apiKey ?? ""),
    model: String(c?.model ?? "glm-5.1"),
    visionModel: String(c?.visionModel ?? "glm-5v-turbo"),
    baseUrl: String(c?.baseUrl ?? "https://open.bigmodel.cn/api/paas/v4/chat/completions"),
    proxyUrl: String(c?.proxyUrl ?? "").trim(),
    maxTokensAgent: Number(c?.maxTokensAgent) > 0 ? Number(c.maxTokensAgent) : 1500,
    maxTokensDiscussion: Number(c?.maxTokensDiscussion) > 0 ? Number(c.maxTokensDiscussion) : 4096,
    temperature: Number.isFinite(Number(c?.temperature)) ? Number(c.temperature) : 0.65,
    enableSchemeImage: c?.enableSchemeImage !== false,
    imageModel: String(c?.imageModel ?? "cogview-3-flash"),
    imageGenUrl: String(c?.imageGenUrl ?? "https://open.bigmodel.cn/api/paas/v4/images/generations"),
    proxyImageUrl: String(c?.proxyImageUrl ?? "").trim(),
    /** 深化讨论是否走 SSE 流式；false 则整段返回后再刷新 UI，更稳 */
    discussionStream: c?.discussionStream !== false,
  };
}

/** @param {ReturnType<typeof normalizeGlmConfig>} cfg */
function glmReady(cfg) {
  if (!cfg.enabled) return false;
  if (cfg.proxyUrl) return true;
  return !isPlaceholderKey(cfg.apiKey);
}

/**
 * @param {Array<{role:string,content:unknown}>} messages
 * @param {ReturnType<typeof normalizeGlmConfig>} cfg
 * @param {{ model?: string; max_tokens?: number; temperature?: number }} [opts]
 */
async function glmChat(messages, cfg, opts = {}) {
  const url = cfg.proxyUrl || cfg.baseUrl;
  const headers = { "Content-Type": "application/json" };
  if (!cfg.proxyUrl && !isPlaceholderKey(cfg.apiKey)) {
    headers.Authorization = `Bearer ${cfg.apiKey}`;
  }
  const body = {
    model: opts.model || cfg.model,
    messages,
    temperature: opts.temperature ?? cfg.temperature,
    max_tokens: opts.max_tokens ?? cfg.maxTokensAgent,
    stream: false,
    // 关闭推理链输出，优先返回可见正文并降低 token 与延迟。
    thinking: { type: "disabled" },
  };
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GLM HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("GLM 响应非 JSON");
  }
  const choice = json?.choices?.[0];
  const message = choice?.message || {};
  const content = contentPartsToText(message?.content);
  const reasoning = contentPartsToText(message?.reasoning_content);
  const out = String(content || reasoning || "").trim();
  if (!out) {
    throw new Error("GLM 返回为空文本（choices[0].message.content/reasoning_content 为空）");
  }
  return out;
}

function contentPartsToText(content) {
  if (typeof content === "string") return content;
  if (content && typeof content === "object" && typeof content.text === "string") {
    return content.text;
  }
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        if (typeof p === "string") return p;
        if (p && typeof p.text === "string") return p.text;
        return "";
      })
      .join("");
  }
  return "";
}

/**
 * 流式 chat：逐 token 回调，返回完整文本。
 * 若上游不支持 SSE，则自动退回普通 JSON 并一次性回调。
 * @param {Array<{role:string,content:unknown}>} messages
 * @param {ReturnType<typeof normalizeGlmConfig>} cfg
 * @param {{ model?: string; max_tokens?: number; temperature?: number }} [opts]
 * @param {(token: string) => void} [onToken]
 */
async function glmChatStream(messages, cfg, opts = {}, onToken) {
  const url = cfg.proxyUrl || cfg.baseUrl;
  const headers = { "Content-Type": "application/json" };
  if (!cfg.proxyUrl && !isPlaceholderKey(cfg.apiKey)) {
    headers.Authorization = `Bearer ${cfg.apiKey}`;
  }
  const body = {
    model: opts.model || cfg.model,
    messages,
    temperature: opts.temperature ?? cfg.temperature,
    max_tokens: opts.max_tokens ?? cfg.maxTokensAgent,
    stream: true,
    thinking: { type: "disabled" },
  };
  try {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`GLM HTTP ${res.status}: ${errText.slice(0, 400)}`);
    }
    const ct = String(res.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("text/event-stream") || !res.body) {
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error("GLM 流式回退解析失败：响应非 JSON");
      }
      const full = contentPartsToText(json?.choices?.[0]?.message?.content).trim();
      if (full && onToken) onToken(full);
      return full;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let full = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const events = buf.split(/\r\n\r\n|\n\n/);
      buf = events.pop() || "";
      for (const ev of events) {
        const lines = ev.split(/\r\n|\n/);
        for (const ln of lines) {
          if (!ln.startsWith("data:")) continue;
          const raw = ln.slice(5).trim();
          if (!raw || raw === "[DONE]") continue;
          let j;
          try {
            j = JSON.parse(raw);
          } catch {
            continue;
          }
          const delta = contentPartsToText(j?.choices?.[0]?.delta?.content);
          if (!delta) continue;
          full += delta;
          if (onToken) onToken(delta);
        }
      }
    }
    return full.trim();
  } catch (firstErr) {
    try {
      const full = await glmChat(messages, cfg, opts);
      if (full && onToken) onToken(full);
      return full;
    } catch {
      console.warn("[glmChatStream] 流式失败且非流式回退仍失败:", firstErr);
      throw firstErr;
    }
  }
}

function resolveImageGenEndpoint(cfg) {
  if (cfg.proxyImageUrl) return cfg.proxyImageUrl;
  return cfg.imageGenUrl || "https://open.bigmodel.cn/api/paas/v4/images/generations";
}

/**
 * 智谱 CogView 文生图（需可访问 image 端点；建议与 chat 一样走 glm-proxy）。
 * @param {string} prompt
 * @param {Record<string, unknown>|undefined} rawCfg
 * @returns {Promise<string|null>} 临时图片 URL 或 null
 */
export async function generateCogViewImage(prompt, rawCfg) {
  try {
    const cfg = normalizeGlmConfig(rawCfg || {});
    if (!glmReady(cfg)) return null;
    if (cfg.enableSchemeImage === false) return null;
    const p = String(prompt || "").trim();
    if (!p) return null;
    const url = resolveImageGenEndpoint(cfg);
    const headers = { "Content-Type": "application/json" };
    const viaProxy = Boolean(cfg.proxyImageUrl);
    if (!viaProxy && !isPlaceholderKey(cfg.apiKey)) {
      headers.Authorization = `Bearer ${cfg.apiKey}`;
    }
    const body = JSON.stringify({
      model: cfg.imageModel,
      prompt: p.slice(0, 1800),
      size: "1024x1024",
    });
    const res = await fetch(url, { method: "POST", headers, body });
    const text = await res.text();
    if (!res.ok) {
      console.warn("[CogView]", res.status, text.slice(0, 200));
      return null;
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return null;
    }
    const u = json?.data?.[0]?.url;
    return typeof u === "string" ? u : null;
  } catch (e) {
    console.warn("[CogView]", e?.message || e);
    return null;
  }
}

function bytesToBase64(bytes) {
  let bin = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/**
 * 供同一街景点多 Agent 复用：先拉取一次再并行 vision 请求，避免重复下载同图。
 * @param {{ image?: string }} streetview
 */
export async function prefetchStreetviewImageDataUrl(streetview) {
  return resolveImageDataUrl(streetview || {});
}

/** @param {{ image?: string }} streetview */
async function resolveImageDataUrl(streetview) {
  if (!streetview?.image || typeof streetview.image !== "string") return null;
  const raw = streetview.image.trim();
  if (!raw) return null;
  const abs = raw.startsWith("http") ? raw : new URL(raw, window.location.href).href;
  try {
    const r = await fetch(abs);
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    if (buf.byteLength > 6 * 1024 * 1024) return null;
    const ct = r.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
    return `data:${ct};base64,${bytesToBase64(new Uint8Array(buf))}`;
  } catch {
    return null;
  }
}

/** 七维特征：正文用中文名，代号仅作括号标注（与踏勘页 rawTuple 顺序一致） */
const FEATURE_DIMS = [
  { code: "E", name: "暴露度（人流与文化接触潜力）" },
  { code: "sInv", name: "敏感性折减分量（由车行道压力等推导，越高越利于慢行）" },
  { code: "AC", name: "适应能力（缓冲资源：开敞/文化/舒适街道等综合）" },
  { code: "N_UD", name: "城市密度" },
  { code: "N09", name: "街道舒适度" },
  { code: "N_CD", name: "文化场所密度" },
  { code: "N_OS", name: "开敞空间嵌入度" },
];

/**
 * @param {number[]|Record<string, number>|null|undefined} features
 * @returns {string}
 */
function formatFeaturesReadable(features) {
  if (Array.isArray(features) && features.length === 7) {
    return FEATURE_DIMS.map((d, i) => `${d.name}（${d.code}=${Number(features[i]).toFixed(3)}）`).join("\n");
  }
  if (features && typeof features === "object" && !Array.isArray(features)) {
    const o = /** @type {Record<string, number>} */ (features);
    return FEATURE_DIMS.map((d) => {
      const v = o[d.code];
      return Number.isFinite(Number(v)) ? `${d.name}（${d.code}=${Number(v).toFixed(3)}）` : "";
    })
      .filter(Boolean)
      .join("\n");
  }
  return "（特征向量缺失）";
}

const PERSONA_SYSTEM = {
  elder:
    "你是「梧桐爷叔」Agent：65–80 岁本地老人视角。关注铺装、座椅、遮阴、厕所、菜场药店拥挤度；适老友好、日常连续性、低门槛被动参与。",
  student:
    "你是「高校学生」Agent：18–25 岁数字原住民。关注社交传播、探索趣味、结伴打卡、非线性路径。",
  white:
    "你是「商圈白领」Agent：午休约 1h、时间紧。关注 500m 午餐圈、碎片化 5–15 分钟体验、释压与意外获得感。",
  family:
    "你是「遛娃家庭」Agent：父母带 3～10 岁儿童。除成人关切外，**每次输出必须包含一小段明确的「小孩视角」**（假想视线高度约 1～1.2 m）：写孩子这一高度能看到什么、会害怕什么、会觉得好玩或无聊什么—例如车尾与车轮是否挡路、栏杆缝隙、台阶、招牌与橱窗是否吸引、树荫与光影。安全（人车分离、视线通透）、可重复玩与教育性仍是家长判断核心。禁止只用成人一句话带过「对孩子也好」而不展开儿童视线。",
  wander:
    "你是「文艺漫游者」Agent：City Walk / 创作者。关注叙事密度、转角惊喜、出片条件与非常规视角。",
};

/**
 * 踏勘短留言任务说明。
 * 不预设空间要素列表，让 Agent 从人设与场地数据自主推断。
 * 若上下文中包含周边 POI 列表，Agent 可自行决定是否借助其理解周边氛围。
 */
const COMMENT_TASK_GUIDE =
  "请以自己的人设视角，结合场地平台指标，用 90～220 字给出踏勘留言。" +
  "**指标与数字格式（强制）**：凡写出平台指标的具体数值，必须使用「中文含义（代号=数值）」，数值**仅**出现在括号内，例如「遮阴条件好（N09=0.87）」「文化设施信号弱（N_CD=0）」；" +
  "禁止写成仅有代号无等号的「(N09)」「（N_CD）」；禁止在自然语言正文里单独出现与指标相关的阿拉伯数字或小数字面量（如 0.87、87%），综合叙述里非指标的数量词（如「两棵」「三五分钟」）除外。" +
  "① 若已关联街景或下方提供「街景辅助得分」，**留言中须先用一两句话概括你从街景/图像判断里得到的可见要素**（如人行道宽窄、绿化与遮阴、车辆占比、建筑界面是否通透、是否有可停留边缘等），并说明这些如何支撑或修正你的结论；不得只重复分数而不描述画面。" +
  "② 1～2 个你认为最值得关注的机会点（说清为什么，结合指标或周边环境）。" +
  "③ 1 个主要风险或你希望现场复核的问题。" +
  "避免空泛表扬，鼓励基于人设的具体判断。";

/**
 * 深化讨论轮：每位 Agent 的四步输出。
 * ① 自主选取案例并提炼精髓
 * ② 阐明自己的融合策略
 * ③ 给出一个自己设计的新案例草案
 * ④ 给出一个建筑单体概念方案（Archdaily 项目自述口径，概念深度）
 */
const DISCUSSION_AGENT_OUTPUT_GUIDE =
  "以自己的人设视角，在本轮发言中完成四件事：\n" +
  "① 【案例精选】从上下文提供的检索结果（或本地预选）中，自主决定引用几条（无固定数量，取决于你判断哪些真正相关）。" +
  "每条写清 case id，用一句话提炼其「可迁移精髓」（该案例解决了什么问题、核心操作手法是什么）。\n" +
  "② 【融合策略】说明你选中的这几条案例如何在本场地组合——它们之间是并置、叠加、序列激活还是其他关系；" +
  "结合场地指标说明为何组合成立：请用中文表述指标含义；若写出具体数值须用「中文（代号=数值）」，禁止仅有 (N_OS) 而无等号，禁止把指标数字写在括号外。\n" +
  "③ 【场地改造草案】基于以上学习，提出一个公共空间层面的改造建议：核心概念名称 + 2～5 个关键场地操作要点（铺地、绿化、装置、动线等），体现你的人设优先级。\n" +
  "④ 【建筑单体概念】在场地中为**一栋建筑单体**提出概念方案——可以是新建小型公共建筑，也可以是对场地内现有建筑的改造或加建。" +
  "写法参照 ArchDaily 建筑师自述，覆盖以下要点（不需要施工图细节，但要有清晰的建筑逻辑）：\n" +
  "  a) 项目名称与建筑类型（如：邻里书屋改造 / 底层商业加建 / 屋顶公共亭廊）；\n" +
  "  b) 设计出发点：这栋建筑回应了什么空间矛盾或使用缺口（结合场地指标与你的人设需求）；\n" +
  "  c) 核心空间策略：平面组织逻辑、剖面关系或体量操作（如：消解体量→庭院渗透 / 底层架空→连通街巷 / 局部玻璃盒子嵌入砖墙 / 悬挑遮阳平台等，2～3 句清晰描述）；\n" +
  "  d) 程序分布：主要功能如何分层或分区（1～2 句）；\n" +
  "  e) 材料与构造语言：选择 1～2 种主导材料，说明选择逻辑（如：延续原有清水砖肌理 / 轻钢桁架对比历史界面 / 竹木格栅作为过渡层）；\n" +
  "  f) 对历史街道界面的态度：立面操作、退让距离、开放性（结合衡复风貌区背景）。\n" +
  "禁止只罗列标题、禁止重复他人已提出的草案名称；④ 建筑概念须有可识别的空间逻辑，不得泛化为口号。";

/**
 * 主持人合成段落附加要求：输出一套完整改造建议（结构由案例与 Agent 讨论自然生成，不预设要素列表）。
 */
const FACILITATOR_SPATIAL_SECTION =
  "7）「综合场地改造建议」（由本次案例引用与 Agent 讨论自然推导，300～500 字）：" +
  "说明本场地应以哪几个核心案例的策略为基础、如何组合落地、各策略对应的空间范围或操作重点，以及分期与优先级建议。内容应由案例学习驱动，不要套用固定章节格式。\n" +
  "8）「建筑单体概念」（400～600 字）：" +
  "在五位 Agent 各自的建筑概念草案中，选择最具整合潜力的 1～2 个作为基础，合成一份面向建筑师可提交的概念方案文本，" +
  "内容参照 ArchDaily 建筑师自述口径，须包含：" +
  "① 方案名称与建筑类型；" +
  "② 规模估算（楼层数与建筑面积量级，如「2 层，约 400 m²」）；" +
  "③ 设计出发点（回应了什么空间矛盾或历史街区的使用缺口）；" +
  "④ 核心空间策略（平面组织逻辑 / 剖面关系 / 体量操作，3～5 句）；" +
  "⑤ 程序分布（功能分层或分区）；" +
  "⑥ 材料与构造语言（主导材料 + 选择逻辑）；" +
  "⑦ 对衡复历史街道界面的态度（立面退让、开放性、新旧关系处理原则）。" +
  "写法清晰有建筑立场，不堆砌口号，不重复场地改造层的内容。";

/** case-base 未返回规划 query 时的兜底检索句 */
function defaultQueryForDim(dim, row, persona) {
  return fallbackQueryForDimension(dim, row, persona);
}

function defaultAgentQuery(row, persona) {
  const label = persona?.label || "市民";
  const pri = Number(row?.priority);
  const p = Number.isFinite(pri) ? `priority≈${pri.toFixed(2)}` : "街道微更新";
  return `上海历史街区 ${p} ${label} 视角 可迁移空间策略 案例`;
}

function parseJsonObjectLoose(text) {
  const src = String(text || "").trim();
  if (!src) return null;
  try {
    return JSON.parse(src);
  } catch {
    /* ignore */
  }
  const fence = src.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* ignore */
    }
  }
  const direct = src.match(/\{[\s\S]*\}/);
  if (direct?.[0]) {
    try {
      return JSON.parse(direct[0]);
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * 并发限流映射：按输入顺序返回结果。
 * @template T,R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item:T, index:number)=>Promise<R>} worker
 * @returns {Promise<R[]>}
 */
async function mapLimit(items, limit, worker) {
  const n = items.length;
  if (!n) return [];
  const out = new Array(n);
  const cap = Math.max(1, Math.min(limit || 1, n));
  let cursor = 0;
  async function run() {
    while (true) {
      const i = cursor++;
      if (i >= n) return;
      out[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: cap }, () => run()));
  return out;
}

/** 与 `agent-recon-mvp.js` 中 rawTuple 口径一致，避免上下文与特征向量不一致 */
function num0(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function buildSevenTupleFromRow(row) {
  const s = clamp(num0(row?.cpvi_S), 0, 1.5);
  const sInv = clamp(1 - s / 1.2, 0, 1);
  return [
    num0(row?.cpvi_E),
    sInv,
    num0(row?.cpvi_AC),
    num0(row?.N_UD),
    num0(row?.N09),
    num0(row?.N_CD),
    num0(row?.N_OS),
  ];
}

function siteContextBlock(row, nearest, poiContext, featuresTuple) {
  const tuple =
    Array.isArray(featuresTuple) && featuresTuple.length === 7 ? featuresTuple : buildSevenTupleFromRow(row);
  const lines = [
    `坐标: 纬度 ${Number(row.lat).toFixed(6)}, 经度 ${Number(row.lon).toFixed(6)}`,
    `改造优先级 proxy（priority）=${Number(row.priority).toFixed(4)}`,
    `CPVI 原始分量：暴露度 (E)=${num0(row.cpvi_E).toFixed(3)}，敏感性 (S)=${num0(row.cpvi_S).toFixed(3)}，适应能力 (AC)=${num0(row.cpvi_AC).toFixed(3)}`,
    "踏勘用七维特征（与画像权重、特征向量一致）：",
    formatFeaturesReadable(tuple),
  ];
  if (nearest?.id) {
    lines.push(
      `最近街景素材: 编号 ${nearest.id}，直线距离约 ${Math.round(nearest.distM)} m（供图像分析）`
    );
  }
  const poi = typeof poiContext === "string" ? poiContext.trim() : "";
  if (poi) lines.push("", poi);
  return lines.join("\n");
}

/** @param {number} v @param {number} lo @param {number} hi */
function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function resolveSemanticLogEndpoint() {
  const cb = typeof window !== "undefined" ? window.AgentReconCasebaseConfig : null;
  if (!cb?.enabled) return "";
  const custom = String(cb.semanticLogUrl || "").trim();
  if (custom) return custom;
  const base = String(cb.eventsApiBase || cb.ragProxyUrl || "")
    .trim()
    .replace(/\/$/, "");
  if (!base) return "";
  return `${base}/v1/streetview-semantic/log`;
}

function buildSemanticLogPayload({ agent, row, streetview, features, score, reason }, cfg) {
  const normalizedFeatures = Array.isArray(features)
    ? { vector: features }
    : features && typeof features === "object"
      ? features
      : {
          E: Number.isFinite(Number(features?.E)) ? Number(features.E) : null,
          sInv: Number.isFinite(Number(features?.sInv)) ? Number(features.sInv) : null,
          AC: Number.isFinite(Number(features?.AC)) ? Number(features.AC) : null,
          N_UD: Number.isFinite(Number(features?.N_UD)) ? Number(features.N_UD) : null,
          N09: Number.isFinite(Number(features?.N09)) ? Number(features.N09) : null,
          N_CD: Number.isFinite(Number(features?.N_CD)) ? Number(features.N_CD) : null,
          N_OS: Number.isFinite(Number(features?.N_OS)) ? Number(features.N_OS) : null,
        };
  return {
    trace_id: generateTraceId(),
    agent_id: String(agent?.id || ""),
    agent_label: String(agent?.label || ""),
    score,
    reason,
    model: cfg.model,
    vision_model: cfg.visionModel,
    streetview_id: String(streetview?.id || ""),
    streetview_image: String(streetview?.image || ""),
    streetview_dist_m: Number.isFinite(Number(streetview?.distM)) ? Number(streetview.distM) : null,
    lat: Number.isFinite(Number(row?.lat)) ? Number(row.lat) : null,
    lon: Number.isFinite(Number(row?.lon)) ? Number(row.lon) : null,
    priority: Number.isFinite(Number(row?.priority)) ? Number(row.priority) : null,
    occurred_at: new Date().toISOString(),
    features: normalizedFeatures,
  };
}

function postSemanticLogAsync(payload, cfg) {
  const url = resolveSemanticLogEndpoint();
  if (!url) return;
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildSemanticLogPayload(payload, cfg)),
    keepalive: true,
  }).catch(() => {
    /* semantic log is best-effort; never block scoring */
  });
}

/**
 * @param {Record<string, unknown>} baseAdapters
 * @param {Record<string, unknown>|undefined} rawCfg
 */
export function buildGlmEnhancedAdapters(baseAdapters, rawCfg) {
  const cfg = normalizeGlmConfig(rawCfg);
  if (!glmReady(cfg)) return baseAdapters;
  const emit = (payload, evt) => {
    try {
      payload?.hooks?.onDiscussionEvent?.(evt);
    } catch {
      /* ignore hook errors */
    }
  };

  return {
    ...baseAdapters,

    async scoreWithVisionLLM(payload) {
      try {
        const { agent, row, streetview, features, poiContext, precomputedImageDataUrl } = payload;
        const dataUrl =
          typeof precomputedImageDataUrl === "string" && precomputedImageDataUrl.startsWith("data:")
            ? precomputedImageDataUrl
            : await resolveImageDataUrl(streetview || {});
        if (!dataUrl) return null;

        const sys =
          "你是城市空间视觉分析助手。请**同时**阅读街景图与上下文中的七维平台指标，给出 0～1 的踏勘得分（可玩性/停留意愿倾向）。得分必须反映：**① 你从街景中直接观察到的要素**（人行道、绿化与遮阴、车辆与通行压力、建筑界面与通透度、可停留边缘与障碍等）；**② 与人设相关的平台指标高低**。" +
          "只输出一行 JSON：{\"score\":0.xx,\"reason\":\"...\"}，不要其它文字。" +
          "其中 reason 用通顺中文：先简述街景里看到了什么、对行人与停留意味着什么，再衔接指标判断。" +
          "**reason 内指标写法（强制）**：凡引用平台指标的具体数值，必须使用「中文含义（代号=数值）」，且**数值仅出现在括号内**，例如「绿视与遮阴条件好（N09=0.87）」「文化界面弱（N_CD=0）」；" +
          "禁止「(N09)」「（N_CD）」等无等号形式；禁止在自然语言正文里单独写出与指标相关的阿拉伯数字（非指标的数量描述如「两三辆车」除外）。";
        const userContent = [
          {
            type: "text",
            text: `${PERSONA_SYSTEM[agent.id] || ""}\n${siteContextBlock(row, streetview, poiContext, features)}\n（特征向量顺序与上表七行一致，数值已列出，请勿在输出中重复罗列数字。）`,
          },
          { type: "image_url", image_url: { url: dataUrl } },
        ];
        const out = await glmChat(
          [
            { role: "system", content: sys },
            { role: "user", content: userContent },
          ],
          cfg,
          { model: cfg.visionModel, max_tokens: 256, temperature: 0.3 }
        );
        let parsed;
        try {
          const m = out.match(/\{[\s\S]*\}/);
          parsed = JSON.parse(m ? m[0] : out);
        } catch {
          return null;
        }
        const score = Number(parsed.score);
        const reason = String(parsed.reason || "");
        if (!Number.isFinite(score)) return null;
        const normalizedScore = Math.max(0, Math.min(1, score));
        postSemanticLogAsync({ agent, row, streetview, features, score: normalizedScore, reason }, cfg);
        return { score: normalizedScore, reason };
      } catch {
        return null;
      }
    },

    async getAgentComment(payload) {
      try {
        const { agent, row, streetview, llmScore, poiContext } = payload;
        const sys = PERSONA_SYSTEM[agent.id] || "你是城市更新踏勘 Agent。";
        let user = `【场地】\n${siteContextBlock(row, streetview, poiContext)}\n`;
        if (llmScore && Number.isFinite(llmScore.score)) {
          user +=
            `\n【街景辅助得分（已纳入踏勘综合分，与规则分位加权）】（综合辅助分=${llmScore.score.toFixed(3)}）。` +
            `模型对街景的图像判断（供你展开成自然语言，勿照抄）：${llmScore.reason || "无"}\n`;
        }
        user += COMMENT_TASK_GUIDE;
        if (agent.id === "family") {
          user +=
            "\n【遛娃家庭硬性要求】正文里必须出现单独成段的「小孩视角」2～4 句（可用「孩子眼里：」等开头），与家长的利弊分析区分开，不得省略。\n";
        }
        const text = await glmChat(
          [
            { role: "system", content: sys },
            { role: "user", content: user },
          ],
          cfg,
          { max_tokens: cfg.maxTokensAgent }
        );
        return { text, source: "glm" };
      } catch (e) {
        return baseAdapters.getAgentComment(payload);
      }
    },

    async queryKnowledgeCases(payload) {
      // 仅在外部 case-base 已接入时返回本地结构化预选（供 caseLibraryPack 注入讨论上下文）。
      // 若无 case-base，不虚构案例——让每个 Agent 在讨论轮中自主从检索结果学习并自行设计。
      const cb =
        typeof window !== "undefined" &&
        window.AgentReconCasebaseConfig?.enabled &&
        window.AgentReconCasebaseConfig?.ragProxyUrl;
      if (cb) {
        return baseAdapters.queryKnowledgeCases(payload);
      }
      return null;
    },

    async runDeepDiscussion(payload) {
      try {
        const {
          selectedRow,
          cases,
          mcpExtra,
          dbExtra,
          currentPersona,
          nearestStreetview,
          poiContext,
        } = payload;
        const personas = Array.isArray(payload.personas) && payload.personas.length ? payload.personas : [];
        if (!personas.length) return baseAdapters.runDeepDiscussion(payload);
        const ctx = siteContextBlock(selectedRow, nearestStreetview, poiContext, buildSevenTupleFromRow(selectedRow));
        // cases 为 null 表示未接 case-base 且不虚构，讨论中标为"无预选"
        const caseText =
          Array.isArray(cases) && cases.length
            ? cases.map((c, i) => `${i + 1}. ${c.title}（${c.focus}）相关度 ${c.relevance}`).join("\n")
            : "（无预选案例，各 Agent 请完全基于检索结果学习）";
        const caseLibBlock = payload.caseLibraryPack
          ? String(payload.caseLibraryPack)
          : "（无本地结构化案例包）";
        const caseDimensions = normalizeDimensionList(payload.caseLibraryDimensions || []);
        const activeDims = caseDimensions.length ? caseDimensions : [...DEFAULT_CASE_DIMENSIONS];
        const dimGuide = buildDimensionGuideText(activeDims);

        const cb =
          typeof window !== "undefined" ? window.AgentReconCasebaseConfig : null;
        const casebaseOn =
          Boolean(cb?.enabled) && String(cb?.ragProxyUrl || "").trim().length > 0;
        emit(payload, { type: "status", text: "正在启动多 Agent 讨论…" });

        const ragProxyUrl = String(cb?.ragProxyUrl || "").replace(/\/$/, "");
        const defaultQueryCap = Math.min(6, Math.max(3, activeDims.length));
        const ragMaxQueriesPerAgent = Math.max(
          1,
          Math.min(8, Number(cb?.ragMaxQueriesPerAgent) || defaultQueryCap)
        );
        const agentParallelism = Math.max(1, Math.min(5, Number(cb?.agentParallelism) || 3));
        const transcriptRows = await mapLimit(personas, agentParallelism, async (agent, idx) => {
          try {
            emit(payload, { type: "status", text: `${agent.label} 正在规划独立检索策略…` });
            const agentId = `${cb?.agentIdPrefix || "playable_"}${agent.id || "agent"}`;
            const traceId = generateTraceId();
            payload.hooks?.setActiveRagTraceId?.(traceId);
            emit(payload, { type: "trace", traceId });

            let retrievalBlock = "";
            if (casebaseOn) {
              const plannerSys =
                "你是案例检索策略规划员。请结合给定维度定义，为该 Agent 规划 2~6 条检索。每条必须带 dimension（来自给定维度 key）、query、k（1~4）、reason。优先覆盖更多关键维度，避免重复同质 query。务必结合该 Agent 人设生成差异化 query，并说明一句 fusion_strategy。只输出 JSON：{\"queries\":[{\"dimension\":\"concept\",\"query\":\"...\",\"k\":2,\"reason\":\"...\"}],\"fusion_strategy\":\"...\"}。";
              const plannerUser =
                `Agent: ${agent.label}\n` +
                `人设：${PERSONA_SYSTEM[agent.id] || "通用城市更新参与者"}\n` +
                `${ctx}\n` +
                `【案例库预选（本地 JSON）】\n${caseLibBlock}\n` +
                `【当前维度定义】\n${dimGuide}\n` +
                `要求：按该 Agent 视角自主决定重点，但请尽量覆盖不同维度，避免检索集中在同一维度。`;
              let plan = { queries: [], fusion_strategy: "" };
              try {
                const out = await glmChat(
                  [
                    { role: "system", content: plannerSys },
                    { role: "user", content: plannerUser },
                  ],
                  cfg,
                  { max_tokens: 700, temperature: 0.45 }
                );
                const parsed = parseJsonObjectLoose(out);
                if (parsed && typeof parsed === "object") plan = parsed;
              } catch {
                plan = { queries: [], fusion_strategy: "" };
              }

              /** @type {Array<{dimension:string,query:string,k:number,reason:string}>} */
              let qRows = Array.isArray(plan.queries) ? plan.queries : [];
              qRows = qRows
                .map((q) => ({
                  dimension: normalizeDimensionKey(q?.dimension || ""),
                  query: String(q?.query || "").trim(),
                  k: Math.min(4, Math.max(1, Number(q?.k) || (Number(cb?.ragKPerDim) > 0 ? Number(cb.ragKPerDim) : 3))),
                  reason: String(q?.reason || "").trim(),
                }))
                .filter((q) => q.query)
                .filter((q) => !q.dimension || activeDims.includes(q.dimension));

              const seenQuery = new Set();
              qRows = qRows.filter((q) => {
                const sig = q.query.replace(/\s+/g, " ").trim().toLowerCase();
                if (!sig || seenQuery.has(sig)) return false;
                seenQuery.add(sig);
                return true;
              });

              if (qRows.length > ragMaxQueriesPerAgent) qRows = qRows.slice(0, ragMaxQueriesPerAgent);
              const covered = new Set(qRows.map((q) => q.dimension).filter(Boolean));
              for (const dim of activeDims) {
                if (qRows.length >= ragMaxQueriesPerAgent) break;
                if (covered.has(dim)) continue;
                qRows.push({
                  dimension: dim,
                  query: defaultQueryForDim(dim, selectedRow, agent),
                  k: Math.min(4, Math.max(1, Number(cb?.ragKPerDim) || 3)),
                  reason: "兜底补齐维度覆盖",
                });
                covered.add(dim);
              }
              if (!qRows.length) {
                qRows = [
                  {
                    dimension: activeDims[0] || "generic",
                    query: defaultAgentQuery(selectedRow, agent),
                    k: 2,
                    reason: "兜底单检索",
                  },
                ];
              }

              emit(payload, { type: "status", text: `${agent.label} 检索 ${qRows.length} 条案例中…` });
              const settled = await Promise.all(
                qRows.map(async (q) => {
                  try {
                    const json = await callCasebaseRagProxy({
                      ragProxyUrl,
                      query: q.query,
                      agentId,
                      traceId,
                      k: q.k,
                    });
                    return { ok: true, q, json };
                  } catch (e) {
                    return { ok: false, q, error: String(e?.message || e) };
                  }
                })
              );

              const lines = [
                `【${agent.label} 独立检索】trace_id=${traceId}`,
                `融合策略（规划）：${String(plan.fusion_strategy || "（模型未给出，交由本轮 Agent 自行判断）")}`,
              ];
              settled.forEach((it, idx) => {
                const dimKey = it.q.dimension || `q${idx + 1}`;
                const dimLabel = it.q.dimension ? getDimensionLabel(it.q.dimension) : `query#${idx + 1}`;
                lines.push(`— ${dimLabel}(${dimKey}): ${it.q.query}`);
                if (it.ok) {
                  const block = formatRagDimensionBlock(`${dimLabel} / ${dimKey}`, it.json);
                  lines.push(block);
                  emit(payload, { type: "retrieval", dimension: dimKey, query: it.q.query, block });
                } else {
                  lines.push(`【${dimLabel} / ${dimKey}】检索失败: ${it.error}`);
                }
              });
              retrievalBlock = lines.join("\n\n");
            } else {
              retrievalBlock = "【外部 case-base 未启用】本轮不做检索，请仅基于已有上下文给出判断。";
            }

            const sys = `${PERSONA_SYSTEM[agent.id] || "你是讨论参与者。"}\n${DISCUSSION_AGENT_OUTPUT_GUIDE}`;
            const user = `【系统技能 · 案例库】\n${CASE_LIBRARY_SKILL_PROMPT}\n\n【共享场地上下文】\n${ctx}\n\n${retrievalBlock}\n\n【案例库预选（本地 JSON，按维度）】\n${caseLibBlock}\n【案例摘要列表】\n${caseText || "无"}\n【结构化补充】mcp=${JSON.stringify(mcpExtra ?? null)} db=${JSON.stringify(dbExtra ?? null)}\n\n请按系统说明完成三步：案例精选 → 融合策略 → 我的设计草案。`;
            emit(payload, { type: "agent_turn_start", agentId: agent.id, agentName: agent.label });
            const text = await glmChat(
              [
                { role: "system", content: sys },
                { role: "user", content: user },
              ],
              cfg,
              { max_tokens: cfg.maxTokensAgent }
            );
            const safeText = String(text || "").trim() || "（本轮模型未返回可见文本）";
            emit(payload, { type: "agent_turn", agentId: agent.id, agentName: agent.label, text: safeText });
            return { idx, id: agent.id, name: agent.label, text: safeText };
          } catch (agentErr) {
            const msg = `（${agent.label} 本轮生成失败：${String(agentErr?.message || agentErr)}）`;
            emit(payload, { type: "agent_turn_start", agentId: agent.id, agentName: agent.label });
            emit(payload, { type: "agent_turn", agentId: agent.id, agentName: agent.label, text: msg });
            return { idx, id: agent.id, name: agent.label, text: msg };
          }
        });
        const transcript = transcriptRows.sort((a, b) => a.idx - b.idx);
        emit(payload, { type: "status", text: "主持人正在汇总共识与分歧…" });

        const facilitatorSys = casebaseOn
          ? `你是多 Agent 协作主持人（城市规划 + 参与式设计）。五位 Agent 已各自完成案例学习，并各提出了一个独立的设计草案。你的任务是：在这五个草案之间找出共识与分歧，从中综合出一个更完整的整合方案——而非另起炉灶或重新罗列案例。必须明确指出你吸取了哪位 Agent 草案中的哪个核心判断，以及为何舍弃或调整了其他部分。输出结构：1）五份草案的核心共识（1～3 条跨草案反复出现的判断）2）主要分歧与取舍理由 3）「整合方案」：在五份草案的基础上命名一个新方案，说明它如何融合各方核心策略（写清来源草案），以及与场地条件的关系——凡写出指标具体数值须用「中文含义（代号=数值）」，禁止仅有 (N09) 而无等号，禁止把指标数字写在括号外4）短中长期行动建议 5）现场核验清单。${FACILITATOR_SPATIAL_SECTION} 全文总字数 1400～2400 字。`
          : `你是多 Agent 协作主持人（城市规划 + 参与式设计）。五位 Agent 已各自完成案例学习，并各提出了一个独立的设计草案。你的任务是：在这五个草案之间找出共识与分歧，从中综合出一个更完整的整合方案——而非另起炉灶。必须明确指出你吸取了哪位 Agent 草案中的哪个核心判断，以及为何舍弃或调整了其他部分。输出结构：1）核心共识 2）主要分歧与取舍 3）「整合方案」（来自五份草案的融合，写清来源与策略组合逻辑；指标数值须「中文（代号=数值）」，禁止括号外写指标数字）4）短中长期行动 5）现场核验清单。${FACILITATOR_SPATIAL_SECTION} 全文总字数 1200～2200 字。`;
        const facUser = `当前主视角偏好：${currentPersona?.label || "无指定"}\n【场地与周边上下文】\n${ctx}\n\n【案例库预选】\n${caseLibBlock}\n【五位 Agent 发言】\n${transcript.map((t) => `### ${t.name}\n${t.text}`).join("\n\n")}`;
        emit(payload, { type: "facilitator_turn_start", agentName: "主持人" });
        let summary;
        if (cfg.discussionStream) {
          summary = await glmChatStream(
            [
              { role: "system", content: facilitatorSys },
              { role: "user", content: facUser },
            ],
            cfg,
            { max_tokens: cfg.maxTokensDiscussion },
            (token) => emit(payload, { type: "facilitator_turn_token", agentName: "主持人", token })
          );
        } else {
          summary = await glmChat(
            [
              { role: "system", content: facilitatorSys },
              { role: "user", content: facUser },
            ],
            cfg,
            { max_tokens: cfg.maxTokensDiscussion }
          );
        }
        const safeSummary = String(summary || "").trim() || "（主持人未返回可见文本）";
        emit(payload, { type: "facilitator_turn", agentName: "主持人", text: safeSummary });

        const modeLine = casebaseOn
          ? `模式：每 Agent 多维检索（/v1/rag）+ 融合 + 合成新案例`
          : `模式：本地 JSON 预选（未启用 /v1/rag 检索）`;
        const header = `【多 Agent 协作纪要】GLM ${cfg.model} · ${modeLine}\n\n`;
        const rounds = transcript.map((t) => `## ${t.name}\n${t.text}`).join("\n\n");
        emit(payload, { type: "done" });
        return `${header}${rounds}\n\n---\n## 主持人汇总\n${safeSummary}`;
      } catch (e) {
        return baseAdapters.runDeepDiscussion(payload);
      }
    },
  };
}
