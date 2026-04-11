export const DEFAULT_CASE_DIMENSIONS = ["site_perception", "concept", "form", "space", "function", "technology"];

const DIMENSION_META = {
  site_perception: {
    label: "场地感知",
    brief: "这里发生过什么、此刻压抑什么、身体第一反应",
  },
  concept: {
    label: "概念",
    brief: "选择要回应的矛盾，用一句可被反驳的话表达",
  },
  form: {
    label: "造型",
    brief: "形从哪里生长、用了什么手法、如何回应概念",
  },
  space: {
    label: "空间",
    brief: "组织空间序列与节奏，明确可被记住的瞬间",
  },
  function: {
    label: "功能",
    brief: "布局与流线如何安排，如何支撑真实使用",
  },
  technology: {
    label: "技术",
    brief: "材料、结构、构造与前沿技术如何支撑方案",
  },
  _default: {
    label: "默认维度",
    brief: "未归类维度",
  },
};

const DIMENSION_ALIAS = {
  // New six-dimension schema
  "场地感知": "site_perception",
  "场地_感知": "site_perception",
  site_perception: "site_perception",
  siteperception: "site_perception",
  perception: "site_perception",
  "site-perception": "site_perception",
  "site perception": "site_perception",

  "概念": "concept",
  concept: "concept",

  "造型": "form",
  form: "form",

  "空间": "space",
  space: "space",

  "功能": "function",
  function: "function",

  "技术": "technology",
  technology: "technology",
  tech: "technology",

};

export function normalizeDimensionKey(raw) {
  const src = String(raw || "").trim();
  if (!src) return "";
  const lower = src.toLowerCase();
  return DIMENSION_ALIAS[src] || DIMENSION_ALIAS[lower] || src;
}

export function normalizeDimensionList(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = normalizeDimensionKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function getDimensionLabel(key) {
  const k = normalizeDimensionKey(key) || "_default";
  return DIMENSION_META[k]?.label || k;
}

export function getDimensionBrief(key) {
  const k = normalizeDimensionKey(key) || "_default";
  return DIMENSION_META[k]?.brief || "";
}

export function buildDimensionGuideText(dims) {
  const normalized = normalizeDimensionList(dims);
  if (!normalized.length) return "（未提供维度定义）";
  return normalized.map((d) => `- ${getDimensionLabel(d)} (${d})：${getDimensionBrief(d) || "按本地案例库定义执行"}`).join("\n");
}

export function fallbackQueryForDimension(dim, row, persona) {
  const d = normalizeDimensionKey(dim);
  const label = persona?.label || "市民";
  const personaKey = String(persona?.id || "").trim();
  const personaCueMap = {
    elder: "适老 低门槛 邻里连续性",
    student: "青年传播 打卡 社交探索",
    white: "午休碎片时间 快速释压",
    family: "亲子安全 可重复玩 看护视线",
    wander: "叙事密度 城市漫游 出片视角",
  };
  const personaCue = personaCueMap[personaKey] || "在地使用体验";
  const pri = Number(row?.priority);
  const p = Number.isFinite(pri) ? `priority≈${pri.toFixed(2)}` : "街区微更新";
  const map = {
    site_perception: `历史街区 场地记忆 冲突压抑 身体感受 行走体验 ${personaCue} ${p}`,
    concept: `上海衡复历史街区 公共空间核心矛盾 设计概念 可玩性 ${label} ${personaCue}`,
    form: `历史街区 建筑体量 造型策略 形体生成 立面手法 ${personaCue} ${p}`,
    space: `街区空间序列 节奏 停留节点 记忆点 场景体验 ${personaCue} ${p}`,
    function: `历史街区 公共服务功能 布局 流线 复合使用 ${label} ${personaCue}`,
    technology: `历史街区 更新改造 材料 结构 构造 可持续技术 ${personaCue} ${p}`,
  };
  return map[d] || `城市微更新 ${d} ${p}`;
}
