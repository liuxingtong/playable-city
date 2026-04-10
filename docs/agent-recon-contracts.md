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
| 外部 case-base：/v1/rag 代理、深化内 Agent 四维检索、SSE 高亮 + 回放 | `lib/agent-recon-casebase-sse.js`、`lib/agent-recon-case-graph.js` |
| case-base RAG 子进程代理（Node，单 endpoint 多用途） | `scripts/casebase-rag-proxy.mjs` |
| GLM CORS 代理（Node） | `scripts/glm-proxy.mjs` |
| 一键本地栈 | `scripts/start-agent-recon-stack.mjs` |
| 案例 Skill（讨论注入） | `docs/skills/agent-recon-case-library.md` |

---

## 2. 一键启动

在 **本仓库根目录**：

```bash
npm run start:agent-recon
```

启动顺序（**设了 `CASEBASE_EVENTS_CMD` 时**）：

1. **释放 `CASEBASE_EVENTS_PORT`（默认 8787）** 上已有监听进程，避免多实例导致空响应（可用 `CASEBASE_SKIP_KILL_PORT=1` 跳过）。  
2. **启动案例库事件子进程**（`CASEBASE_EVENTS_CMD`，工作目录 `CASEBASE_EVENTS_CWD`）。  
3. **健康检查**：轮询 `GET` **`CASEBASE_EVENTS_HEALTH_URL`**，默认 `http://127.0.0.1:8787/health`，**仅 HTTP 200** 才继续；超时则结束事件子进程并以非零码退出（**不会**再启动 RAG 与静态站）。  
4. **案例库 RAG 代理**（默认 **3851**）。  
5. （可选）**GLM 代理**（`START_WITH_GLM_PROXY=1`）。  
6. **`python -m http.server`**（默认 **8080**），站点根为 **playable-city** 仓库根。

未设 `CASEBASE_EVENTS_CMD` 时：直接执行步骤 4–6。

浏览器打开踏勘页：`http://127.0.0.1:8080/pages/agent-recon-mvp.html`（端口以环境变量为准）。

**case-base 服务常用 URL（默认 8787）**：

| 用途 | 地址 |
|------|------|
| 健康检查 | `http://127.0.0.1:8787/health` |
| Demo 页 | `http://127.0.0.1:8787/demo` |
| SSE 事件流 | `http://127.0.0.1:8787/events/stream` |
| 历史事件 | `http://127.0.0.1:8787/events?limit=100` |

### 2.1 环境变量（一键启动与子进程）

| 变量 | 作用 |
|------|------|
| `AGENT_RECON_HTTP_PORT` | 静态 HTTP 端口，默认 `8080`。 |
| `PYTHON` | 运行 `http.server` 的解释器，默认 `python`。 |
| `CASE_BASE_ROOT` | case-base 仓库根（RAG 脚本所在目录）。默认：`playable-city` 的上一级目录下的 `case-base`。 |
| `CASEBASE_RAG_PORT` | RAG 代理端口，默认 `3851`。 |
| `START_WITH_GLM_PROXY` | 设为 `1` 时额外启动 `glm-proxy.mjs`（需配置 `GLM_API_KEY` 等）。 |
| `GLM_PROXY_PORT` | GLM 代理端口，默认 `3847`。 |
| `CASEBASE_EVENTS_CMD` | **可选**：整条 shell 命令，启动案例库 **SSE/事件服务**（如监听 **8787**）。 |
| `CASEBASE_EVENTS_CWD` | 与 `CASEBASE_EVENTS_CMD` 配合的工作目录（一般为 **case-base 仓库根**）。默认 `CASE_BASE_ROOT`，再默认 `../case-base`。 |
| `CASEBASE_EVENTS_PORT` | 清端口与健康检查默认主机口，默认 `8787`（与 `retrieval_events_sse.py --port` 保持一致）。 |
| `CASEBASE_EVENTS_HEALTH_URL` | 健康检查完整 URL；默认 `http://127.0.0.1:${CASEBASE_EVENTS_PORT}/health`。 |
| `CASEBASE_EVENTS_HEALTH_BASE` | 若不想写完整 URL，可只设基址（无尾斜杠），默认 `http://127.0.0.1:${CASEBASE_EVENTS_PORT}`，实际请求 `${BASE}/health`。 |
| `CASEBASE_EVENTS_HEALTH_TIMEOUT_MS` | 健康检查超时（毫秒），默认 `30000`。 |
| `CASEBASE_EVENTS_HEALTH_INTERVAL_MS` | 健康检查轮询间隔，默认 `400`。 |
| `CASEBASE_SKIP_KILL_PORT` | 设为 `1` 时**不**在启动事件服务前尝试释放 `CASEBASE_EVENTS_PORT`。 |

**Windows（PowerShell）可用配置示例**（路径按本机修改）：

```powershell
cd F:\Aworks\2026studio\xujiahui\playable-city
$env:CASE_BASE_ROOT = "F:\Aworks\2026studio\xujiahui\case-base"
$env:CASEBASE_EVENTS_CWD = "F:\Aworks\2026studio\xujiahui\case-base"
$env:CASEBASE_EVENTS_CMD = "python scripts/retrieval_events_sse.py --host 127.0.0.1 --port 8787"
npm run start:agent-recon
```

### 2.2 与「仅起单项」的关系

| 命令 | 用途 |
|------|------|
| `npm run casebase:rag-proxy` | 仅 RAG 代理。 |
| `npm run glm:proxy` | 仅 GLM 代理。 |
| `python -m http.server 8080` | 仅静态站（需在仓库根执行）。 |
| `npm run serve:static` / `python scripts/serve-static-robust.py 8080` | 同上，**推荐 Windows**：避免浏览器取消请求时出现 `ConnectionAbortedError` / **WinError 10053** 刷屏。 |
| `npm run start:agent-recon` | 内置静态站已改用 `serve-static-robust.py`。 |

### 2.3 Windows：`WinError 10053`（本机软件中止连接）

常见于 **`python -m http.server`**：标签页刷新、大文件中断、DevTools 取消请求时，对端断开而服务端仍在 `write`，会抛出 `ConnectionAbortedError`。**不影响**已成功返回的请求，多为控制台噪声。

处理：**优先**使用 `scripts/serve-static-robust.py` 或 `npm run serve:static`；或使用 **`npm run start:agent-recon`**（栈内静态站已接该脚本）。若错误来自 **case-base** 进程或数据库客户端，需在对应仓库查防火墙/代理/连接超时。

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
| `runDeepDiscussion` | `{ selectedRow, cases, mcpExtra, dbExtra, currentPersona, nearestStreetview, personas, caseLibraryPack?, hooks? }` | 讨论字符串 |
| `queryExternalDatabase` | `{ selectedRow, nearestStreetview }` | 任意 JSON |
| `queryMcpKnowledge` | `{ selectedRow, nearestStreetview }` | 任意 JSON |

静态密钥勿进浏览器；生产环境建议改为调用同源后端代理（见 §8）。

### 5.2 `runDeepDiscussion` 可选 `hooks`

| 字段 | 说明 |
|------|------|
| `hooks.setActiveRagTraceId(traceId)` | 当 GLM 增强实现触发 **深化讨论内** case-base 四维检索时，在发起检索前调用一次，传入本次讨论共用的 `trace_id`，便于 Case 图高亮与「最近一次 trace」对齐（见 §6.3）。自定义后端适配器可忽略。 |

---

<a id="case-base-integration"></a>

## 6. 外部案例库（case-base）：深化 Agent 检索 + 可选手动 RAG + SSE + 图高亮

与 **`case-base`** 仓库配合：任意一次 `POST /v1/rag` **必须**传 **`trace_id`** 与 **`agent_id`**（`agentIdPrefix` + 当前画像 id）。

设计原则：**不把「单次向量 RAG 长答案」当作深化讨论的主输入**。主路径是 GLM 在 **`lib/agent-recon-glm.js` 的 `runDeepDiscussion`** 内：

1. **规划**：根据场地上下文 + 本地四维预选（`caseLibraryPack`），由模型输出四条检索 `query`（键名固定为 `concept` / `site_treatment` / `material_sensory` / `program`）。解析失败时用脚本内兜底 query。  
2. **检索**：对每条 `query` 各调用一次同一代理 **`POST /v1/rag`**，**共用**本次讨论的一个 `trace_id`、**同一** `agent_id`，每维 `k` 由 `ragKPerDim` 或 `min(4, ragK)` 控制。实现见 **`retrieveCasesByDimensionQueries`**（`lib/agent-recon-casebase-sse.js`）。  
3. **讨论与合成**：五类 Agent 与主持人可见「各维检索摘要 + refs」，在主持人段必须输出 **「合成新案例」**（整合式方案名、四维各自借鉴的 case id 与贡献、与本地预选的衔接），而非复述某一次 RAG 的单一答案。

侧栏 **「执行 RAG」** 按钮保留为 **手动单次** 调试；与深化链路共用 endpoint，语义不变。

### 6.1 `/v1/rag` 代理调用链（深化与手动共用）

1. 浏览器 `POST` **`http://127.0.0.1:3851/v1/rag`**（可配置），JSON：`{ query, agent_id, trace_id, k }`。  
2. `scripts/casebase-rag-proxy.mjs` 在 `CASE_BASE_ROOT` 下执行：  
   `python scripts/rag_answer_glm.py "<query>" --k <k> --agent-id "<agent_id>" --trace-id "<trace_id>" --json`  
3. 案例库侧应维护可追溯的 **`retrieval_events` / `compose_history`**；本前端只读消费返回中的 **`compose_id` / `event_id` / `trace_id` / `refs`**（及 `answer` 等）拼入讨论上下文，**不改变**其语义。

### 6.2 事件服务（SSE + 回放）

- **案例库进程**（通常 **8787**）：`GET …/events/stream`、`GET …/events?limit=…`。  
- **浏览器**：宜将 `eventsApiBase` 设为 **RAG 代理根**（默认 `http://127.0.0.1:3851`），由 `scripts/casebase-rag-proxy.mjs` **转发**至 `CASEBASE_EVENTS_UPSTREAM`（默认 `http://127.0.0.1:8787`），避免 **8080 静态页 → 8787** 的跨源 CORS。直连 8787 需在案例库服务上自行返回 `Access-Control-Allow-Origin` 等头。  
- **SSE**：`GET http://127.0.0.1:8787/events/stream`（经代理时路径仍为 `/events/stream`）。  
  - 监听 **`event: retrieval`**，`data` 为 JSON，需含 **`case_ids`**（数组），建议含 **`trace_id`、`agent_id`、`event_id`**。  
  - 断线重连时带查询参数 **`since_event_id`**（取已见最大 `event_id` 或 SSE `id:` 行）。  
- **回放**：`GET /events?limit=100`（limit 可配置）。响应可为 JSON 数组，或 `{ events }` / `{ data }` / `{ items }`；事件体可为 `{ type, data: { case_ids, ... } }` 扁平结构。

### 6.3 `window.AgentReconCasebaseConfig`

| 字段 | 含义 |
|------|------|
| `enabled` | `true` 时连接 SSE、加载图、绑定手动 RAG/回放；且 GLM 开启时启用 **深化内四维检索**（还须配置有效 `ragProxyUrl`） |
| `eventsApiBase` | 事件 API 根 URL；**默认 `http://127.0.0.1:3851`**（与同页 `ragProxyUrl` 一致，由代理转发到 8787） |
| `ragProxyUrl` | RAG 代理根，默认 `http://127.0.0.1:3851` |
| `agentIdPrefix` | 与画像下拉值拼成 `agent_id` |
| `ragK` | 手动 RAG 与缺省时的 `--k` 上界参考，默认 6 |
| `ragKPerDim` | **深化讨论**内每一维 `POST /v1/rag` 的 `k`；未设时用 `min(4, ragK)` |
| `replayLimit` | `GET /events?limit=` |

### 6.4 高亮规则与隔离

- 仅当 retrieval 的 **`agent_id` 等于当前会话 Agent**，或 **`trace_id` 等于最近一次手动 RAG 或深化讨论检索的 trace** 时，对 **`case_id`** 高亮。  
- 高亮 **TTL 30s**，过期自动恢复。  
- 图数据来自 `data/agent-case-library.json`；缺失的 `case_id` 仍占位显示以便对齐。  
- **SSE / 回放 / 解析失败** 不影响主地图与深化讨论主文本返回；错误仅体现在状态行或结果区。

---

## 7. 案例库静态 JSON 与讨论 Skill

- 数据：`data/agent-case-library.json`（四维 `concept` / `site_treatment` / `material_sensory` / `program`）。  
- 逻辑：`lib/agent-recon-caselib.js` 合并进 `queryKnowledgeCases` 并传入 GLM 讨论；外部 case-base **启用且配置了 `ragProxyUrl`** 时，GLM 增强实现**不再**在 `queryKnowledgeCases` 中追加虚构案例条目，避免与真实库检索重复。  
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

1. （可选，见 §6）若 case-base 启用：先 **规划四维 query** → **四次** `/v1/rag`（同一 `trace_id`）→ 将各维摘要与 `refs` 写入共享上下文。  
2. 五位画像 Agent **依次**调用同一文本模型，后一位可见前面摘要。  
3. 再调 **主持人** system prompt，输出共识、分歧、四维拼接、短中长期行动、核验清单，以及 **「合成新案例」** 段落。  
4. 任一步失败则回退规则引擎 `makeRuleDiscussion`。

---

*文档合并维护：原 `agent-recon-integration.md` + `agent-recon-casebase-integration.md` · 与仓库脚本保持同步*
