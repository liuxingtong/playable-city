const LIB_URL = "../data/agent-case-library.json";

let libraryCache = null;

export async function loadAgentCaseLibrary() {
  if (libraryCache) return libraryCache;
  try {
    const j = await fetch(LIB_URL, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));
    if (!j?.cases?.length) {
      libraryCache = { cases: [], dimensions: [] };
      return libraryCache;
    }
    libraryCache = {
      version: j.version,
      dimensions: Array.isArray(j.dimensions) ? j.dimensions : [],
      cases: j.cases.map((c) => ({
        id: String(c.id),
        title: String(c.title || ""),
        summary: String(c.summary || ""),
        primary_dimension: String(c.primary_dimension || "concept"),
        secondary_dimensions: Array.isArray(c.secondary_dimensions) ? c.secondary_dimensions.map(String) : [],
        keywords: Array.isArray(c.keywords) ? c.keywords.map(String) : [],
        fit_when: String(c.fit_when || ""),
      })),
    };
    return libraryCache;
  } catch {
    libraryCache = { cases: [], dimensions: [] };
    return libraryCache;
  }
}

/** @param {Record<string, number>} row */
function relevanceScore(caseItem, row) {
  let s = 0.45;
  const E = Number(row.cpvi_E) || 0;
  const S = Number(row.cpvi_S) || 0;
  const AC = Number(row.cpvi_AC) || 0;
  const N_CD = Number(row.N_CD) || 0;
  const N_OS = Number(row.N_OS) || 0;
  const N09 = Number(row.N09) || 0;
  const pri = caseItem.primary_dimension;

  if (pri === "concept" && N_CD > 0.28) s += 0.18;
  if (pri === "site_treatment" && S > 0.22) s += 0.18;
  if (pri === "material_sensory" && (N_OS > 0.45 || N09 > 0.55)) s += 0.16;
  if (pri === "program" && E > 0.45 && S < 0.35) s += 0.14;
  if (pri === "program" && N_CD > 0.2) s += 0.08;
  if (pri === "material_sensory" && S > 0.28) s += 0.1;
  if (AC < 0.45 && (pri === "concept" || pri === "site_treatment")) s += 0.08;
  return Math.max(0, Math.min(1, s));
}

const DIM_LABELS = {
  concept: "概念",
  site_treatment: "场地处理",
  material_sensory: "材料与感官",
  program: "程序与使用模式",
};

/**
 * 每维取分最高的一条（主维度匹配），保证四象限拼接素材齐全。
 * @param {Record<string, number>} selectedRow
 */
export async function buildCaseLibraryPack(selectedRow) {
  const lib = await loadAgentCaseLibrary();
  const dims = ["concept", "site_treatment", "material_sensory", "program"];
  const scored = lib.cases.map((c) => ({
    ...c,
    relevance: relevanceScore(c, selectedRow),
  }));

  const mosaicByDimension = {};
  for (const d of dims) {
    const pool = scored.filter((c) => c.primary_dimension === d || c.secondary_dimensions.includes(d));
    const list = pool.length ? pool : scored;
    list.sort((a, b) => b.relevance - a.relevance);
    mosaicByDimension[d] = list[0] || null;
  }

  const lines = [];
  lines.push("【案例库 · 按维度预选（讨论须引用 id）】");
  for (const d of dims) {
    const c = mosaicByDimension[d];
    const label = DIM_LABELS[d] || d;
    if (!c) {
      lines.push(`- ${label}(${d}): （库中无匹配，可从其它维借用）`);
      continue;
    }
    lines.push(
      `- ${label}(${d}) id=${c.id} rel=${c.relevance.toFixed(2)} 《${c.title}》 ${c.summary} 适用提示：${c.fit_when}`
    );
  }

  const formatted = lines.join("\n");
  const flatPicks = dims.map((d) => mosaicByDimension[d]).filter(Boolean);

  return {
    formatted,
    mosaicByDimension,
    flatPicks,
    allRanked: [...scored].sort((a, b) => b.relevance - a.relevance),
  };
}

/**
 * 转为与 queryKnowledgeCases 一致的条目，合并进列表。
 * @param {Record<string, number>} selectedRow
 * @param {Array<{id:string,title:string,focus:string,relevance:number}>} baseList
 */
export async function mergeCaseLibraryIntoCaseList(selectedRow, baseList) {
  const pack = await buildCaseLibraryPack(selectedRow);
  const out = [...(baseList || [])];
  const seen = new Set(out.map((x) => x.id));
  for (const c of pack.flatPicks) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({
      id: c.id,
      title: c.title,
      focus: `[${c.primary_dimension}] ${c.summary.slice(0, 80)}`,
      relevance: c.relevance,
    });
  }
  return out;
}

/** 供 CogView 的短 prompt */
export function buildSchemeImagePrompt(pack, discussionSnippet) {
  const titles = pack?.flatPicks?.map((c) => c.title).filter(Boolean).join("、") || "历史街区微更新";
  const ctx = (discussionSnippet || "").replace(/\s+/g, " ").slice(0, 400);
  return `建筑插画风格，俯视略透视，上海衡复历史街区街道更新概念拼贴：四象限分区展示 ${titles}。柔和色块与简洁线稿，无文字无水印。设计说明氛围：${ctx}`;
}
