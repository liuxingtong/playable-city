# 徐家汇中期 · 叙事与地图（cards）

人机共生空间与认知恢复方向的**静态叙事页 + Leaflet 地图 + CSVI 街段数据可视化**。主入口为 `**pages/1narrative-framework.html`**（根目录 `index.html` 会跳转过去）；叙事内含 iframe 嵌入模型页、矩阵、多维地图、三类节点与场域选址等。

## 本地运行

```bash
npm install
```

### 环境变量（推荐 `.env`）

- 当前仓库已支持在项目根目录放置 `.env`，启动脚本会自动读取；不用每次手动 `$env:...`。
- 可先复制模板：`copy .env.example .env`（Windows）后填写真实值（尤其 `GLM_API_KEY`）。
- 命令行里显式设置的同名变量优先级更高，会覆盖 `.env`。
- **矩阵等 Vite 页面**：`npm run dev`（默认打开 `src/matrix/stay_willingness_matrix.html`；会先执行 `sync:cld`：自 `data/cld_priority.csv` 按大徐家汇四街道并集裁剪后写入 `public/cld_priority.csv`，无边界 GeoJSON 时整表复制）。
- **多数 HTML（含叙事框架、地图）**：需通过 **HTTP 以仓库根为站点根** 访问（否则 `fetch` CSV / GeoJSON 会失败）。例如：
  - 在项目根目录：`npm run serve:static` 或 `python scripts/serve-static-robust.py 8080`（**推荐**，Windows 上可避免浏览器断开连接时的 `WinError 10053` 刷屏）；亦可 `python -m http.server 8080`；
  - 浏览器打开 `http://localhost:8080/` 或 `http://localhost:8080/pages/1narrative-framework.html`；
  - `npx serve .` 或 VS Code Live Server，根目录指向本仓库；
  - 静态托管时同样保持 `pages/`、`lib/`、`data/`、`dist/` 等相对关系。

生产构建（当前 Vite 入口为停留意愿矩阵）：

```bash
npm run build
```

## 核心页面（`pages/`）


| 文件                                                                         | 说明                                                                                       |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `pages/1narrative-framework.html`                                          | 主叙事框架；**勿单独改被 iframe 引用的文件名/相对路径**除非同步修改此处                                               |
| `pages/agent-recon-mvp.html`                                               | Agent 踏勘 MVP：勘探范围默认 **天平路街道**（`data/tianping-road-street.geojson`）；五类画像、地图、Top3 候选（规则引擎） |
| `pages/map_E_exposure.html` / `map_S_stressor.html` / `map_AC_buffer.html` | CSVI 三维度地图                                                                               |
| `pages/map_intervention_nodes.html`                                        | 潜力 · 资源节点街段地图；`lib/ac-dom-aggregate.js` 与矩阵、AC 地图共用聚合规则                                  |
| `pages/xujiahui-site-selection.html`                                       | **场域系统选址主页面**（叙事 S9 iframe）；底图 Carto Dark                                                |
| `pages/xujiahui-site-selection-osm-light.html`                             | 同上逻辑的浅色 OSM 副本；`?export`、`?bw`、`?zoom`、`?scaleHint` 等                                    |
| `pages/field_system_selection.html`                                        | 同算法独立页，**绘制**玫红簇间廊道折线                                                                    |
| `csvi-model.html` 等                                                        | 见 `docs/PROJECT_LAYOUT.md`                                                               |
| `src/matrix/stay_willingness_matrix.html`                                  | 停留意愿 **五维雷达** Vite 入口（`csvi_quadrant.jsx` + `personaFive.js`）；构建产出在 `dist/src/matrix/`   |


共享浏览器脚本在 `**lib/`**（地图页以 `../lib/*.js` 引用），其中 `lib/agent-recon-mvp.js` 对应 Agent 踏勘 MVP 的评分与交互逻辑。

## 脚本与数据（简要）


| 命令                                                     | 作用                                                                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run sync:cld`                                     | `data/cld_priority.csv` →（按 `data/daxujiahui-four-streets-union.geojson` 裁剪）→ `public/cld_priority.csv`                                                       |
| `data/streetview_geo/index.geojson` / `index.csv`      | Agent 踏勘街景坐标索引（可先空，后续补图像与经纬度）                                                                                                                                 |
| `data/cld_priority.csv` 可选列                            | `AC_med_dom`、`AC_tech_dom`、`AC_mkt_dom`、`AC_sport_dom`：**四列同行为非空**时，`map_AC_buffer` 与停留意愿矩阵用**算术平均**作为 AC_phys；`map_intervention_nodes` 另用 **argmax** 标资源主导类型 |
| `npm run filter:cld-daxujiahui`                        | 按大徐家汇四街道并集筛选 CSV                                                                                                                                              |
| `npm run fetch:daxujiahui-4`                           | 拉取四街道边界 GeoJSON → `data/`                                                                                                                                     |
| `npm run fetch:tianping-street`                        | 拉取 **天平路街道** 行政边界 → `data/tianping-road-street.geojson`（Agent 踏勘页裁剪用）                                                                                         |
| `npm run build:block-od`                               | 由轨迹 xlsx 生成 `data/block-od-activity.csv`（地块 OD 网：介数/调和/PageRank 合成 **N_OD**，供踏勘规则分）                                                                       |
| `npm run glm:proxy`                                    | 本地转发智谱 `chat/completions` 与 `images/generations`（`GLM_API_KEY`；页面分别配置 `proxyUrl` / `proxyImageUrl`）                                                           |
| `npm run casebase:rag-proxy`                           | 案例库本地代理（默认 **3851**）：案例库 `POST /v1/rag` + 事件转发 + `POST /v1/poi-around` + 街景语义日志等                                                                                       |
| `npm run web:rag-proxy`                                | 网页检索代理（默认 **3852**）：`POST /v1/rag`（不经案例库，公开检索摘要）                                                                                       |
| `npm run start:agent-recon`                            | **一键启动**踏勘栈：见下文 **「Agent 踏勘一键启动（含 case-base）」** 与 `**docs/agent-recon-contracts.md`**                                                                         |
| `npm run serve:static`                                 | 仅静态站（默认 **8080**）：`python scripts/serve-static-robust.py`                                                                                                     |
| `npm run clip:lan-use`                                 | 需已安装 Python `pyshp`：裁剪用地 → `data/lan_use_daxujiahui.geojson`（供选址页用地统计）                                                                                        |
| `npm run fetch:field-parcels`                          | （可选）Overpass 示例地块                                                                                                                                             |
| `npm run render:site-osm` / `render:site-osm:vector`   | Node 叠加边界与选址 JSON 出图                                                                                                                                          |
| `npm run render:site-osm:carto` / `render:site-osm:de` | 瓦片源变体                                                                                                                                                         |
| `npm run screenshot:site` / `screenshot:site:light`    | Playwright 打开 `pages/` 下选址导出页截图                                                                                                                               |


示例：`http://localhost:8080/pages/xujiahui-site-selection-osm-light.html?export=clean&bw=1&zoom=14`

### Agent 踏勘一键启动（含 case-base SSE）

在 **playable-city 仓库根** 执行 `npm run start:agent-recon`，会按顺序启动（细节与变量表见 `**docs/agent-recon-contracts.md`** §2）：

- **静态站**：`python scripts/serve-static-robust.py <端口>`（默认 **8080**，可用环境变量 `**AGENT_RECON_HTTP_PORT`** 覆盖）。该脚本在客户端提前断开时抑制 Windows 上常见的 `**ConnectionAbortedError` / WinError 10053** 噪声；浏览器打开 `http://127.0.0.1:8080/pages/agent-recon-mvp.html`（端口以实际为准）。
- **网页 RAG 代理（深化默认）**：`POST http://127.0.0.1:3852/v1/rag`（`WEB_RAG_PORT`；踏勘页默认 `ragProxyUrl` 指向此端口）
- **案例库等服务代理**：`POST http://127.0.0.1:3851/v1/rag`（在 `CASE_BASE_ROOT` 下执行 `rag_answer_glm.py`；将 `ragProxyUrl` 改回 3851 即用案例库检索）
- **街景语义日志**：`POST http://127.0.0.1:3851/v1/streetview-semantic/log`（与 **3851** 同源；网页 RAG 模式下由 `eventsApiBase` 承担，不必经 3852）

若设置 `**CASEBASE_EVENTS_CMD`**，脚本会 **先请求 `http://127.0.0.1:8787/health`（可配）**：若已 **HTTP 200** 则 **不再清端口、不再起子进程**（避免多实例抢 8787）；否则 **释放 8787 上旧监听** 后启动事件服务，并轮询直至 200 再启动 RAG 与静态站；失败则 **退出且不会启动后续服务**（日志含 cwd、脱敏命令、健康 URL、spawn/超时/子进程退出码等）。

**Windows（PowerShell）推荐（两选一）**：

1. **推荐：`.env` 一次配置，后续直接启动**

```powershell
cd F:\Aworks\2026studio\xujiahui\playable-city
copy .env.example .env
# 编辑 .env，填入真实 GLM_API_KEY；CASEBASE_EVENTS_* 可按本机路径调整
npm run start:agent-recon
```

2. 临时会话变量（路径按本机修改；`CASEBASE_EVENTS_CMD` 使用 case-base 的 `start_casebase_events.ps1` 可一键起 postgres+neo4j+SSE）：

```powershell
cd F:\Aworks\2026studio\xujiahui\playable-city
$env:CASEBASE_EVENTS_CWD="F:\Aworks\2026studio\xujiahui\case-base"
$env:CASEBASE_EVENTS_CMD="powershell -ExecutionPolicy Bypass -File scripts/start_casebase_events.ps1 -BindHost 127.0.0.1 -Port 8787"
npm run start:agent-recon
```

- `**CASEBASE_EVENTS_CWD**`：必须指向 **case-base 仓库根**（保证 `scripts/...` 相对路径正确）。
- `**CASEBASE_EVENTS_CMD`**：case-base 侧启动命令；可在命令中加 **`-SkipDb`** 仅起 SSE（数据库已由 docker 拉起时）。

**外部系统（case-base，默认 127.0.0.1:8787）常用地址**：


| 用途             | URL                                      |
| -------------- | ---------------------------------------- |
| 健康检查（一键启动脚本使用） | `http://127.0.0.1:8787/health`           |
| Demo 页         | `http://127.0.0.1:8787/demo`             |
| SSE 事件流        | `http://127.0.0.1:8787/events/stream`    |
| 历史事件           | `http://127.0.0.1:8787/events?limit=100` |


可选：`START_WITH_GLM_PROXY=1` 同时起智谱代理；`CASEBASE_SKIP_KILL_PORT=1` 跳过清 8787；超时与健康 URL 见 `**docs/agent-recon-contracts.md`** §2。
语义日志路径可用环境变量覆盖：`AGENT_RECON_SEMANTIC_LOG_DIR`、`AGENT_RECON_SEMANTIC_LOG_FILE`。

### 印刷比例尺与导出

- **查推荐 zoom**：`npm run map:scale`（可选 `--lat`、`--dpi`、`--scale`）。
- **Node 出图**：`node scripts/render-xujiahui-site-osm.mjs --tiles carto-light --scale 5000 --dpi 300`
- **浏览器**：`pages/xujiahui-site-selection-osm-light.html?zoom=**&scaleHint=1`
- 共享逻辑脚本位于 `**lib/`**（`catalyst-seam-clusters.js`、`corridor-bottleneck-routing.js`、`cluster-field-circles.js`、`xujiahui-osm-boundary.js` 等）。

## 文档

- `**docs/PROJECT_LAYOUT.md**` — 目录与文件说明（更全）
- `**docs/徐家汇数据分析完整手册.md**` — 指标、节点判定、廊道/瓶颈与实现对照
- `**docs/agent-recon-contracts.md**` — Agent 踏勘 **统一契约**（GLM、适配器、case-base RAG/SSE、`npm run start:agent-recon`）
- `**docs/agent-recon-integration.md`** / `**docs/agent-recon-casebase-integration.md**` — 索引，正文见 `agent-recon-contracts.md`
- `**docs/PPT框架_人机共生空间与认知恢复.md**` — 汇报页结构参考

## 许可与数据

地图边界与部分脚本数据来自 **OpenStreetMap**，适用 **ODbL**。使用 `fetch:`* 脚本时请遵守各服务的使用政策。