/**
 * 智谱 GLM（OpenAI 兼容 chat/completions）+ 多 Agent 串行协作讨论。
 * 配置：window.AgentReconGlmConfig（见 pages/agent-recon-mvp.html 占位示例）
 * 浏览器直连大模型可能受 CORS 限制，请使用 scripts/glm-proxy.mjs + GLM_API_KEY 环境变量。
 */
import { CASE_LIBRARY_SKILL_PROMPT } from "./agent-recon-skill-prompt.js";

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
    maxTokensAgent: Number(c?.maxTokensAgent) > 0 ? Number(c.maxTokensAgent) : 640,
    maxTokensDiscussion: Number(c?.maxTokensDiscussion) > 0 ? Number(c.maxTokensDiscussion) : 3072,
    temperature: Number.isFinite(Number(c?.temperature)) ? Number(c.temperature) : 0.65,
    enableSchemeImage: c?.enableSchemeImage !== false,
    imageModel: String(c?.imageModel ?? "cogview-3-flash"),
    imageGenUrl: String(c?.imageGenUrl ?? "https://open.bigmodel.cn/api/paas/v4/images/generations"),
    proxyImageUrl: String(c?.proxyImageUrl ?? "").trim(),
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
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("GLM 无 choices[0].message.content");
  return content.trim();
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

const PERSONA_SYSTEM = {
  elder:
    "你是「梧桐爷叔」Agent：65–80 岁本地老人视角。关注铺装、座椅、遮阴、厕所、菜场药店拥挤度；适老友好、日常连续性、低门槛被动参与。回答简洁、口语化，2～5 句。",
  student:
    "你是「高校学生」Agent：18–25 岁数字原住民。关注社交传播、探索趣味、结伴打卡、非线性路径。回答简洁，2～5 句。",
  white:
    "你是「商圈白领」Agent：午休约 1h、时间紧。关注 500m 午餐圈、碎片化 5–15 分钟体验、释压与意外获得感。回答简洁，2～5 句。",
  family:
    "你是「遛娃家庭」Agent：父母 + 3–10 岁儿童。关注安全（人车分离、视线通透）、教育性、可重复玩；请顺带一句儿童视线约 1–1.5m 的提示。回答简洁，2～5 句。",
  wander:
    "你是「文艺漫游者」Agent：City Walk / 创作者。关注叙事密度、转角惊喜、出片条件与非常规视角。回答简洁，2～5 句。",
};

function siteContextBlock(row, nearest) {
  const lines = [
    `坐标: lat ${Number(row.lat).toFixed(6)}, lon ${Number(row.lon).toFixed(6)}`,
    `改造优先级 proxy priority=${Number(row.priority).toFixed(4)}`,
    `CPVI 分量 E=${Number(row.cpvi_E).toFixed(3)} S=${Number(row.cpvi_S).toFixed(3)} AC=${Number(row.cpvi_AC).toFixed(3)}`,
    `N_UD=${Number(row.N_UD).toFixed(3)} N09=${Number(row.N09).toFixed(3)} N_CD=${Number(row.N_CD).toFixed(3)} N_OS=${Number(row.N_OS).toFixed(3)}`,
  ];
  if (nearest?.id) {
    lines.push(
      `最近街景素材: id=${nearest.id} 距离约 ${Math.round(nearest.distM)}m 路径=${nearest.image || "无"}`
    );
  }
  return lines.join("\n");
}

/**
 * @param {Record<string, unknown>} baseAdapters
 * @param {Record<string, unknown>|undefined} rawCfg
 */
export function buildGlmEnhancedAdapters(baseAdapters, rawCfg) {
  const cfg = normalizeGlmConfig(rawCfg);
  if (!glmReady(cfg)) return baseAdapters;

  return {
    ...baseAdapters,

    async scoreWithVisionLLM(payload) {
      try {
        const { agent, row, streetview, features } = payload;
        const dataUrl = await resolveImageDataUrl(streetview || {});
        if (!dataUrl) return null;

        const sys =
          "你是城市空间视觉分析助手。根据街景图与数值特征，给出 0～1 的踏勘相关得分（可玩性/停留意愿倾向）和一句理由。必须只输出一行 JSON：{\"score\":0.xx,\"reason\":\"...\"}，不要其它文字。";
        const userContent = [
          { type: "text", text: `${PERSONA_SYSTEM[agent.id] || ""}\n${siteContextBlock(row, streetview)}\n特征向量(E,sInv,AC,N_UD,N09,N_CD,N_OS)=${JSON.stringify(features)}` },
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
        return { score: Math.max(0, Math.min(1, score)), reason };
      } catch {
        return null;
      }
    },

    async getAgentComment(payload) {
      try {
        const { agent, row, streetview, llmScore } = payload;
        const sys = PERSONA_SYSTEM[agent.id] || "你是城市更新踏勘 Agent。";
        let user = `【场地】\n${siteContextBlock(row, streetview)}\n`;
        if (llmScore && Number.isFinite(llmScore.score)) {
          user += `\n【图像辅助分】score=${llmScore.score} 理由=${llmScore.reason || "无"}\n`;
        }
        user +=
          "请给出踏勘留言：指出 1～2 个关键机会点 + 1 个主要风险或需复核点。总字数 80～180 字。";
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
      try {
        const base = await baseAdapters.queryKnowledgeCases(payload);
        const { selectedRow, currentPersona } = payload;
        const sys =
          "你是案例库检索员。根据场地指标，从「历史街区微更新、可玩城市、慢行与叙事、亲子友好、适老友好」类案例中虚构 2～3 条简短案例条目用于脑暴（可非真实项目名但要合理）。只输出 JSON 数组：[{\"id\",\"title\",\"focus\",\"relevance\"}] relevance 为 0～1。";
        const user = `当前视角 ${currentPersona?.label || "通用"}\n${siteContextBlock(selectedRow, payload.nearestStreetview)}\n已有草稿案例：${JSON.stringify(base)}`;
        const out = await glmChat(
          [
            { role: "system", content: sys },
            { role: "user", content: user },
          ],
          cfg,
          { max_tokens: 512, temperature: 0.5 }
        );
        let arr;
        try {
          const m = out.match(/\[[\s\S]*\]/);
          arr = JSON.parse(m ? m[0] : out);
        } catch {
          return base;
        }
        if (!Array.isArray(arr) || !arr.length) return base;
        return arr.map((x, i) => ({
          id: String(x.id || `glm_case_${i}`),
          title: String(x.title || "案例"),
          focus: String(x.focus || ""),
          relevance: Math.max(0, Math.min(1, Number(x.relevance) || 0.5)),
        }));
      } catch {
        return baseAdapters.queryKnowledgeCases(payload);
      }
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
        } = payload;
        const personas = Array.isArray(payload.personas) && payload.personas.length ? payload.personas : [];
        if (!personas.length) return baseAdapters.runDeepDiscussion(payload);
        const ctx = siteContextBlock(selectedRow, nearestStreetview);
        const caseText = Array.isArray(cases)
          ? cases.map((c, i) => `${i + 1}. ${c.title}（${c.focus}）相关度 ${c.relevance}`).join("\n")
          : "";
        const caseLibBlock = payload.caseLibraryPack
          ? String(payload.caseLibraryPack)
          : "（未传入结构化案例包）";

        const transcript = [];
        for (const agent of personas) {
          const prior =
            transcript.length === 0
              ? "（尚无）"
              : transcript.map((t) => `【${t.name}】${t.text}`).join("\n");
          const sys = PERSONA_SYSTEM[agent.id] || "你是讨论参与者。";
          const user = `【系统技能 · 案例库】\n${CASE_LIBRARY_SKILL_PROMPT}\n\n【共享场地上下文】\n${ctx}\n【案例库预选（按维度）】\n${caseLibBlock}\n【案例摘要列表】\n${caseText || "无"}\n【结构化补充】mcp=${JSON.stringify(mcpExtra ?? null)} db=${JSON.stringify(dbExtra ?? null)}\n【此前发言】\n${prior}\n请发表意见：可点名引用案例 id，并说明是否支持某种跨维度拼接。`;
          const text = await glmChat(
            [
              { role: "system", content: sys },
              { role: "user", content: user },
            ],
            cfg,
            { max_tokens: cfg.maxTokensAgent }
          );
          transcript.push({ id: agent.id, name: agent.label, text });
        }

        const facilitatorSys =
          "你是多 Agent 协作主持人（城市规划 + 参与式设计）。必须执行案例库技能：从 concept / site_treatment / material_sensory / program 四个维度各至少引用一条不同案例（写清 id），拼接为一套可落地的新方案，并说明组合逻辑与实施顺序。输出结构：1）共识 2）分歧 3）「四维拼接方案」（分四小节，每节：引用 id + 本地转译 + 与场地指标对应关系）4）短中长期行动 5）现场核验清单。总字数 500～1000 字。";
        const facUser = `当前主视角偏好：${currentPersona?.label || "无指定"}\n【案例库预选】\n${caseLibBlock}\n【五位 Agent 发言】\n${transcript.map((t) => `### ${t.name}\n${t.text}`).join("\n\n")}`;
        const summary = await glmChat(
          [
            { role: "system", content: facilitatorSys },
            { role: "user", content: facUser },
          ],
          cfg,
          { max_tokens: cfg.maxTokensDiscussion }
        );

        const header = `【多 Agent 协作纪要】GLM 模型 ${cfg.model}\n\n`;
        const rounds = transcript.map((t) => `## ${t.name}\n${t.text}`).join("\n\n");
        return `${header}${rounds}\n\n---\n## 主持人汇总\n${summary}`;
      } catch (e) {
        return baseAdapters.runDeepDiscussion(payload);
      }
    },
  };
}
