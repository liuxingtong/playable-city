/**
 * 使用方式：
 * 1) 在 pages/agent-recon-mvp.html 的主脚本之前引入本文件（或你自己的实现）
 * 2) 将 API URL 改为你的后端代理
 * 3) 不要把真实 API Key 直接写在前端
 */
(function attachAgentReconAdapters() {
  async function postJson(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return res.json();
  }

  window.AgentReconAdapters = {
    async scoreWithVisionLLM(payload) {
      if (!payload?.streetview) return null;
      try {
        const out = await postJson("/api/agent/vision-score", payload);
        return { score: Number(out?.score) || 0, reason: out?.reason || "" };
      } catch (e) {
        return null;
      }
    },

    async getAgentComment(payload) {
      try {
        const out = await postJson("/api/agent/comment", payload);
        return { text: out?.text || "", source: "llm" };
      } catch (e) {
        return { text: "外接留言服务未响应，回退规则引擎。", source: "fallback" };
      }
    },

    async queryKnowledgeCases(payload) {
      try {
        const out = await postJson("/api/kb/cases", payload);
        return Array.isArray(out?.cases) ? out.cases : [];
      } catch (e) {
        return [];
      }
    },

    async runDeepDiscussion(payload) {
      try {
        const out = await postJson("/api/discussion/generate", payload);
        return out?.text || "";
      } catch (e) {
        return "讨论服务未响应，请检查后端代理。";
      }
    },

    async queryExternalDatabase(payload) {
      try {
        return await postJson("/api/db/query", payload);
      } catch (e) {
        return null;
      }
    },

    async queryMcpKnowledge(payload) {
      try {
        return await postJson("/api/mcp/query", payload);
      } catch (e) {
        return null;
      }
    },
  };
})();
