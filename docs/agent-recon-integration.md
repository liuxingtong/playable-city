# Agent 踏勘系统集成接口

页面：`pages/agent-recon-mvp.html`  
核心脚本：`lib/agent-recon-mvp.js`

## 勘探范围

- 默认仅使用 **上海市徐汇区天平路街道** 多边形裁剪边段与街景索引。
- 边界文件：`data/tianping-road-street.geojson`（缺失时退回全表并控制台告警）。
- 更新边界：`npm run fetch:tianping-street`

## 智谱 GLM（glm-5.1 + 多 Agent 协作）

实现文件：`lib/agent-recon-glm.js`（由 `lib/agent-recon-mvp.js` 在加载时 `buildGlmEnhancedAdapters` 合并）。

### 配置 `window.AgentReconGlmConfig`

| 字段 | 说明 |
|------|------|
| `enabled` | 是否尝试启用 GLM（为 `true` 且具备 Key 或代理时才真正走模型） |
| `apiKey` | 智谱 API Key；可保留占位 `YOUR_GLM_API_KEY_PLACEHOLDER`，此时须配 `proxyUrl` |
| `model` | 文本模型，默认 `glm-5.1`（与智谱开放文档一致时可改为平台当前提供的 glm-5 系名称） |
| `visionModel` | 街景图辅助分，默认 `glm-5v-turbo` |
| `baseUrl` | 直连完整 URL，默认 `https://open.bigmodel.cn/api/paas/v4/chat/completions` |
| `proxyUrl` | 本地代理地址，例如 `http://127.0.0.1:3847/v1/chat/completions`（推荐，避免 CORS 与密钥进前端） |

### 本地代理

```bash
set GLM_API_KEY=你的密钥
npm run glm:proxy
```

页面里设置 `proxyUrl: "http://127.0.0.1:3847/v1/chat/completions"` 即可；浏览器端 `apiKey` 可继续占位。

文生图（CogView）走同端口：`proxyImageUrl: "http://127.0.0.1:3847/v1/images/generations"`，环境变量可选 `GLM_IMAGE_API_BASE` 覆盖上游（默认智谱 `images/generations`）。

### 案例库 Skill + 拼接方案

- 技能全文：`docs/skills/agent-recon-case-library.md`（讨论时由 `lib/agent-recon-skill-prompt.js` 注入精简版）。
- 数据：`data/agent-case-library.json`（四维 `concept` / `site_treatment` / `material_sensory` / `program`）。
- 逻辑：`lib/agent-recon-caselib.js` 按场地指标为每维预选 1 条，合并进 `queryKnowledgeCases` 列表并传入 GLM 讨论。
- 示意图：`lib/agent-recon-scheme-canvas.js` 生成本地四象限 PNG；可选 `generateCogViewImage`（`lib/agent-recon-glm.js`）调用 CogView。

### 多 Agent 讨论流程

1. 五位画像 Agent **依次**调用同一文本模型，后一位可见前面专家发言摘要。  
2. 再调用一次 **主持人** system prompt，输出共识、分歧、建议与现场核验清单。  
3. 任一步失败则回退到规则引擎 `makeRuleDiscussion`。

## 目标

为以下能力预留统一入口：

- 外接 LLM（结合街景图像理解给分、留言）
- MCP 工具链（知识库检索/案例提取）
- 外部数据库（项目库、地块库、历史评估库）
- 深化选址讨论编排（案例 + 数据 + 多 Agent 留言）

## 前端注入方式

页面加载前，在全局注入 `window.AgentReconAdapters`。脚本会自动 merge 默认实现（规则引擎）与外接实现。

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

## 适配器函数契约

### `scoreWithVisionLLM(payload)`

- 输入：`{ agent, row, streetview, features }`
- 输出：`null` 或 `{ score: number, reason: string }`
- 用途：将图像理解分数并入 Agent 评分（可选）

### `getAgentComment(payload)`

- 输入：`{ agent, row, streetview, llmScore }`
- 输出：`{ text: string, source?: string }` 或字符串
- 用途：每个 Agent 留言区展示

### `queryKnowledgeCases(payload)`

- 输入：`{ selectedRow, zoneRows, nearestStreetview, personas, currentPersona }`
- 输出：`Array<{ id, title, focus, relevance }>`
- 用途：深化讨论中的案例候选

### `runDeepDiscussion(payload)`

- 输入：`{ selectedRow, cases, mcpExtra, dbExtra, currentPersona, nearestStreetview, personas }`（`personas` 为五类 Agent 元数据数组，供 GLM 多轮协作）
- 输出：`string`
- 用途：形成深化选址讨论文本

### `queryExternalDatabase(payload)`

- 输入：`{ selectedRow, nearestStreetview }`
- 输出：任意 JSON（供讨论阶段拼装）

### `queryMcpKnowledge(payload)`

- 输入：`{ selectedRow, nearestStreetview }`
- 输出：任意 JSON（供讨论阶段拼装）

## 街景数据目录约定

目录：`data/streetview_geo/`

- `index.geojson`（推荐）或 `index.csv`
- 可先空文件，后续补数据无需改代码

## 建议的后端代理

静态页面不直接处理密钥，建议接一层后端：

- `POST /api/agent/vision-score`
- `POST /api/agent/comment`
- `POST /api/kb/cases`
- `POST /api/discussion/generate`
- `POST /api/db/query`
- `POST /api/mcp/query`

前端适配器里仅调用上述代理接口，避免 API Key 暴露。
