# 徐家汇中期 · 叙事与地图（cards）

人机共生空间与认知恢复方向的**静态叙事页 + Leaflet 地图 + CSVI 街段数据可视化**。主入口为 **`pages/1narrative-framework.html`**（根目录 `index.html` 会跳转过去）；叙事内含 iframe 嵌入模型页、矩阵、多维地图、三类节点与场域选址等。

## 本地运行

```bash
npm install
```

- **矩阵等 Vite 页面**：`npm run dev`（默认打开 `src/matrix/stay_willingness_matrix.html`；会先执行 `sync:cld` 将 `data/cld/cld_priority.csv` 同步到 `public/cld_priority.csv`）。
- **多数 HTML（含叙事框架、地图）**：需通过 **HTTP 以仓库根为站点根** 访问（否则 `fetch` CSV / GeoJSON 会失败）。例如：
  - 在项目根目录：`python -m http.server 8080`，浏览器打开 `http://localhost:8080/` 或 `http://localhost:8080/pages/1narrative-framework.html`；
  - `npx serve .` 或 VS Code Live Server，根目录指向本仓库；
  - 静态托管时同样保持 `pages/`、`lib/`、`data/`、`dist/` 等相对关系。

生产构建（当前 Vite 入口为停留意愿矩阵）：

```bash
npm run build
```

## 核心页面（`pages/`）

| 文件 | 说明 |
|------|------|
| `pages/1narrative-framework.html` | 主叙事框架；**勿单独改被 iframe 引用的文件名/相对路径**除非同步修改此处 |
| `pages/map_E_exposure.html` / `map_S_stressor.html` / `map_AC_buffer.html` | CSVI 三维度地图 |
| `pages/map_intervention_nodes.html` | 潜力 · 资源节点街段地图；`lib/ac-dom-aggregate.js` 与矩阵、AC 地图共用聚合规则 |
| `pages/xujiahui-site-selection.html` | **场域系统选址主页面**（叙事 S9 iframe）；底图 Carto Dark |
| `pages/xujiahui-site-selection-osm-light.html` | 同上逻辑的浅色 OSM 副本；`?export`、`?bw`、`?zoom`、`?scaleHint` 等 |
| `pages/field_system_selection.html` | 同算法独立页，**绘制**玫红簇间廊道折线 |
| `csvi-model.html` 等 | 见 `docs/PROJECT_LAYOUT.md` |
| `src/matrix/stay_willingness_matrix.html` | 停留意愿矩阵 Vite 入口（同目录 `matrix_main.jsx`、`csvi_quadrant.jsx`）；构建产出在 `dist/src/matrix/` |

共享浏览器脚本在 **`lib/`**（地图页以 `../lib/*.js` 引用）。

## 脚本与数据（简要）

| 命令 | 作用 |
|------|------|
| `npm run sync:cld` | `data/cld/cld_priority.csv` → `public/cld_priority.csv` |
| `data/cld/cld_priority.csv` 可选列 | `AC_med_dom`、`AC_tech_dom`、`AC_mkt_dom`、`AC_sport_dom`：**四列同行为非空**时，`map_AC_buffer` 与停留意愿矩阵用**算术平均**作为 AC_phys；`map_intervention_nodes` 另用 **argmax** 标资源主导类型 |
| `npm run filter:cld-daxujiahui` | 按大徐家汇四街道并集筛选 CSV |
| `npm run fetch:daxujiahui-4` | 拉取四街道边界 GeoJSON → `data/` |
| `npm run clip:lan-use` | 需已安装 Python `pyshp`：裁剪用地 → `data/lan_use_daxujiahui.geojson`（供选址页用地统计） |
| `npm run fetch:field-parcels` | （可选）Overpass 示例地块 |
| `npm run render:site-osm` / `render:site-osm:vector` | Node 叠加边界与选址 JSON 出图 |
| `npm run render:site-osm:carto` / `render:site-osm:de` | 瓦片源变体 |
| `npm run screenshot:site` / `screenshot:site:light` | Playwright 打开 `pages/` 下选址导出页截图 |

示例：`http://localhost:8080/pages/xujiahui-site-selection-osm-light.html?export=clean&bw=1&zoom=14`

### 印刷比例尺与导出

- **查推荐 zoom**：`npm run map:scale`（可选 `--lat`、`--dpi`、`--scale`）。
- **Node 出图**：`node scripts/render-xujiahui-site-osm.mjs --tiles carto-light --scale 5000 --dpi 300`
- **浏览器**：`pages/xujiahui-site-selection-osm-light.html?zoom=**&scaleHint=1`
- 共享逻辑脚本位于 **`lib/`**（`catalyst-seam-clusters.js`、`corridor-bottleneck-routing.js`、`cluster-field-circles.js`、`xujiahui-osm-boundary.js` 等）。

## 文档

- **`docs/PROJECT_LAYOUT.md`** — 目录与文件说明（更全）
- **`docs/徐家汇数据分析完整手册.md`** — 指标、节点判定、廊道/瓶颈与实现对照
- **`docs/PPT框架_人机共生空间与认知恢复.md`** — 汇报页结构参考

## 许可与数据

地图边界与部分脚本数据来自 **OpenStreetMap**，适用 **ODbL**。使用 `fetch:*` 脚本时请遵守各服务的使用政策。
