# Agent 踏勘：统一接口与运行契约

**主入口页面**：`pages/agent-recon-mvp.html`  
**核心逻辑**：`lib/agent-recon-mvp.js`  

本文档合并原 `agent-recon-integration.md` 与 `agent-recon-casebase-integration.md` 的契约说明；后两者仅作索引跳转，**以本文件为准**。

---

## 1. 范围与代码索引

| 能力 | 主要文件 |
|------|----------|
| 地图、规则评分、五类画像 | `lib/agent-recon-mvp.js` |
| 智谱 GLM / 多 Agent 讨论 / CogView | `lib/agent-recon-glm.js` |
| 本地静态案例库合并 | `lib/agent-recon-caselib.js` |
| 外部 case-base：RAG 代理调用 + SSE 高亮 + 回放 | `lib/agent-recon-casebase-sse.js`、`lib/agent-recon-case-graph.js` |
| RAG 子进程代理（Node） | `scripts/casebase-rag-proxy.mjs` |
| GLM CORS 代理（Node） | `scripts/glm-proxy.mjs` |
| 一键本地栈 | `scripts/start-agent-recon-stack.mjs` |
| 案例 Skill（讨论注入） | `docs/skills/agent-recon-case-library.md` |

---

## 2. 一键启动

在 **本仓库根目录**：

```bash
npm run start:agent-recon
```

默认会拉起：

1. **`python -m http.server`**（端口由 `AGENT_RECON_HTTP_PORT` 指定，默认 **8080**），站点根为本仓库根。  
2. **案例库 RAG 代理** `node scripts/casebase-rag-proxy.mjs`（默认 **3851**）。

浏览器打开：

`http://127.0.0.1:8080/pages/agent-recon-mvp.html`（端口以实际为准）。

### 2.1 环境变量（一键启动与子进程）

| 变量 | 作用 |
|------|------|
| `AGENT_RECON_HTTP_PORT` | 静态 HTTP 端口，默认 `8080`。 |
| `PYTHON` | 运行 `http.server` 的解释器，默认 `python`。 |
| `CASE_BASE_ROOT` | case-base 仓库根（RAG 脚本所在目录）。默认：`playable-city` 的上一级目录下的 `case-base`。 |
| `CASEBASE_RAG_PORT` | RAG 代理端口，默认 `3851`。 |
| `START_WITH_GLM_PROXY` | 设为 `1` 时额外启动 `glm-proxy.mjs`（需配置 `GLM_API_KEY` 等）。 |
| `GLM_PROXY_PORT` | GLM 代理端口，默认 `3847`。 |
| `CASEBASE_EVENTS_CMD` | **可选**：整条 shell 命令，用于启动案例库 **SSE 事件服务**（如监听 **8787**）。不设则仅打印提示，需另开终端启动。 |
| `CASEBASE_EVENTS_CWD` | 与 `CASEBASE_EVENTS_CMD` 配合的工作目录；默认 `CASE_BASE_ROOT`，再默认 `../case-base`。 |

PowerShell 示例（案例库在固定盘符、并随栈启动事件服务时，将 `CASEBASE_EVENTS_CMD` 换成你方 case-base 文档中的真实命令）：

```powershell
$env:CASE_BASE_ROOT = "F:\Aworks\2026studio\xujiahui\case-base"
# $env:CASEBASE_EVENTS_CMD = "python -m your_casebase.events"   # 按 case-base 仓库说明填写
npm run start:agent-recon
```

### 2.2 与「仅起单项」的关系

| 命令 | 用途 |
|------|------|
| `npm run casebase:rag-proxy` | 仅 RAG 代理。 |
| `npm run glm:proxy` | 仅 GLM 代理。 |
| `python -m http.server 8080` | 仅静态站（需在仓库根执行）。 |

---

## 3. 勘探范围与街景目录

- 默认仅使用 **上海市徐汇区天平路街道** 多边形裁剪边段与街景索引。  
- 边界：`data/tianping-road-street.geojson`（缺失时退回全表并控制台告警）。  
- 更新边界：`npm run fetch:tianping-street`  
- 街景索引目录：`data/streetview_geo/` — `index.geojson`（推荐）或 `index.csv`；可先空文件后补数据。

---

## 4. 智谱 GLM

实现：`lib/agent-recon-glm.js`（由 `agent-recon-mvp.js` 中 `buildGlmEnhancedAdapters` 合并）。

### 4.1 `window.AgentReconGlmConfig`

| 字段 | 说明 |
|------|------|
| `enabled` | 为 `true` 且具备 Key 或代理时才走模型 |
| `apiKey` | 智谱 Key；可占位 `YOUR_GLM_API_KEY_PLACEHOLDER`，此时须配 `proxyUrl` |
| `model` | 文本模型，默认 `glm-5.1` |
| `visionModel` | 街景辅助分，默认 `glm-5v-turbo` |
| `baseUrl` | 直连完整 chat URL |
| `proxyUrl` | 本地代理，如 `http://127.0.0.1:3847/v1/chat/completions` |
| `proxyImageUrl` | 文生图，如 `http://127.0.0.1:3847/v1/images/generations` |

本地代理：`set GLM_API_KEY=...` 后 `npm run glm:proxy`（或与一键启动配合 `START_WITH_GLM_PROXY=1`）。可选环境变量：`GLM_PROXY_PORT`、`GLM_API_BASE`、`GLM_IMAGE_API_BASE`。

---

## 5. 前端适配器 `window.AgentReconAdapters`

页面加载前可注入全局对象，脚本会将默认规则实现与注入对象 **merge**。

```html
<script>
  window.AgentReconAdapters = {
    async scoreWithVisionLLM(payload) { /* ... */ },
    async getAgentComment(payload) { /* ... */ },
    async queryKnowledgeCases(payload) { /* ... */ },
    async runDeepDiscussion(payload) { /* ... */ },
    async queryExternalDatabase(payload) { /* ... */ },
    async queryMcpKnowledge(payload) { /* ... */ }
  };
</script>
```

### 5.1 函数契约摘要

| 函数 | 输入（要点） | 输出（要点） |
|------|----------------|-------------|
| `scoreWithVisionLLM` | `{ agent, row, streetview, features }` | `null` 或 `{ score, reason }` |
| `getAgentComment` | `{ agent, row, streetview, llmScore }` | `{ text, source? }` 或字符串 |
| `queryKnowledgeCases` | `{ selectedRow, zoneRows, nearestStreetview, personas, currentPersona }` | `{ id, title, focus, relevance }[]` |
| `runDeepDiscussion` | `{ selectedRow, cases, mcpExtra, dbExtra, currentPersona, nearestStreetview, personas }` | 讨论字符串 |
| `queryExternalDatabase` | `{ selectedRow, nearestStreetview }` | 任意 JSON |
| `queryMcpKnowledge` | `{ selectedRow, nearestStreetview }` | 任意 JSON |

静态密钥勿进浏览器；生产环境建议改为调用同源后端代理（见 §8）。

---

<a id="case-base-integration"></a>

## 6. 外部案例库（case-base）：RAG + SSE + 图高亮

与 **`case-base`** 仓库配合：每次本地 RAG **必须**传 **`trace_id`**（前端每次点击生成 UUID）与 **`agent_id`**（`agentIdPrefix` + 当前画像 id）。

### 6.1 调用链

1. 浏览器 `POST` **`http://127.0.0.1:3851/v1/rag`**（可配置），JSON：`{ query, agent_id, trace_id, k }`。  
2. `scripts/casebase-rag-proxy.mjs` 在 `CASE_BASE_ROOT` 下执行：  
   `python scripts/rag_answer_glm.py "<query>" --k 6 --agent-id "<agent_id>" --trace-id "<trace_id>" --json`  
3. 案例库侧应维护可追溯的 **`retrieval_events` / `compose_history`**；本前端只读消费返回中的 **`compose_id` / `event_id` / `trace_id` / `refs`** 等字段展示，**不改变**其语义。

### 6.2 事件服务（SSE + 回放）

- **SSE**：`GET http://127.0.0.1:8787/events/stream`（根 URL 可配置）。  
  - 监听 **`event: retrieval`**，`data` 为 JSON，需含 **`case_ids`**（数组），建议含 **`trace_id`、`agent_id`、`event_id`**。  
  - 断线重连时带查询参数 **`since_event_id`**（取已见最大 `event_id` 或 SSE `id:` 行）。  
- **回放**：`GET /events?limit=100`（limit 可配置）。响应可为 JSON 数组，或 `{ events }` / `{ data }` / `{ items }`；事件体可为 `{ type, data: { case_ids, ... } }` 扁平结构。

### 6.3 `window.AgentReconCasebaseConfig`

| 字段 | 含义 |
|------|------|
| `enabled` | `true` 时连接 SSE、加载图、绑定 RAG/回放 |
| `eventsApiBase` | 事件根 URL，默认 `http://127.0.0.1:8787` |
| `ragProxyUrl` | RAG 代理根，默认 `http://127.0.0.1:3851` |
| `agentIdPrefix` | 与画像下拉值拼成 `agent_id` |
| `ragK` | 对应 `--k`，默认 6 |
| `replayLimit` | `GET /events?limit=` |

### 6.4 高亮规则与隔离

- 仅当 retrieval 的 **`agent_id` 等于当前会话 Agent**，或 **`trace_id` 等于最近一次 RAG 的 trace** 时，对 **`case_id`** 高亮。  
- 高亮 **TTL 30s**，过期自动恢复。  
- 图数据来自 `data/agent-case-library.json`；缺失的 `case_id` 仍占位显示以便对齐。  
- **SSE / 回放 / 解析失败** 不影响主地图与 RAG 回答返回；错误仅体现在状态行或结果区。

---

## 7. 案例库静态 JSON 与讨论 Skill

- 数据：`data/agent-case-library.json`（四维 `concept` / `site_treatment` / `material_sensory` / `program`）。  
- 逻辑：`lib/agent-recon-caselib.js` 合并进 `queryKnowledgeCases` 并传入 GLM 讨论。  
- Skill 全文：`docs/skills/agent-recon-case-library.md`（与《徐家汇数据分析完整手册》第四章物理层融合维度对齐）。  
- 示意图：`lib/agent-recon-scheme-canvas.js`；可选 CogView（`lib/agent-recon-glm.js`）。

---

## 8. 建议的后端代理（生产）

静态页不直接暴露密钥，可收口为同源 API，例如：

- `POST /api/agent/vision-score`  
- `POST /api/agent/comment`  
- `POST /api/kb/cases`  
- `POST /api/discussion/generate`  
- `POST /api/db/query`  
- `POST /api/mcp/query`  

前端适配器内只请求上述接口。

---

## 9. 多 Agent 讨论流程（GLM 开启时）

1. 五位画像 Agent **依次**调用同一文本模型，后一位可见前面摘要。  
2. 再调 **主持人** system prompt，输出共识、分歧、建议与核验清单。  
3. 任一步失败则回退规则引擎 `makeRuleDiscussion`。

---

*文档合并维护：原 `agent-recon-integration.md` + `agent-recon-casebase-integration.md` · 与仓库脚本保持同步*
