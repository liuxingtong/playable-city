# 项目目录说明（cards）

静态叙事页、Leaflet 地图与 Node 脚本共用本仓库。以下路径以仓库根目录为准。页面需通过 **HTTP 根目录** 访问（如 `python -m http.server` 或 `npm run dev` 仅针对矩阵）。

## 顶层一览

| 路径 | 用途 |
|------|------|
| **`index.html`** | 可选入口：跳转到 `pages/1narrative-framework.html`。 |
| **`pages/`** | 主叙事框架、Leaflet 地图、模型与卡片等 **HTML 页面**（iframe 与相对路径均以此为锚）。 |
| **`lib/`** | 多页共用的浏览器端逻辑脚本（边界、聚合、DBSCAN、廊道、场域圆等）。 |
| **`src/matrix/`** | 停留意愿矩阵（Vite）：`stay_willingness_matrix.html`、`matrix_main.jsx`、`csvi_quadrant.jsx`。 |
| **`data/cld/`** | CLD/CSVI 边表：`cld_priority.csv`（主表）及 `cld_priority_beifan.csv` 等备份；`npm run sync:cld` 将主表复制到 `public/cld_priority.csv` 供矩阵 `fetch`。 |
| **`assets/images/`** | 叙事页插图等静态资源。 |
| **`package.json`** / **`vite.config.js`** | 依赖与 Vite 构建（`dist/`）。 |

## `pages/` 内主要 HTML

| 文件 | 说明 |
|------|------|
| **`1narrative-framework.html`** | 主叙事框架；内嵌 iframe 引用同目录及 `../profiles/`、`../dist/` 等，**改 `data-src` 或文件名须同步**。 |
| **`map_*.html`** | 单主题地图：`map_E_exposure.html`、`map_S_stressor.html`、`map_AC_buffer.html`、`map_intervention_nodes.html`。 |
| **`xujiahui-site-selection.html`** | 场域系统选址主页面（叙事 S9 iframe）。 |
| **`xujiahui-site-selection-osm-light.html`** | 浅色 OSM 栅格 + 浅色 UI；出图/截图（`?export`、`?zoom` 等）。 |
| **`field_system_selection.html`** | 同算法独立页，绘玫红廊道折线。 |
| **`cld_2d_interactive.html`** | CLD 二维交互。 |
| **`csvi-model.html`**、`dual-line-framework.html`、`prototype-cards.html`、`xujiahui-pole-cards.html`、`node-type-cards-v3.html` 等 | 模型与卡片页。 |

## `lib/` 共享脚本（由 `pages/*.html` 以 `../lib/…` 引用）

| 文件 | 用途 |
|------|------|
| **`xujiahui-osm-boundary.js`** | 大徐家汇四街道并集边界（数据 `../data/daxujiahui-four-streets-union.geojson`，相对**地图页**路径）。 |
| **`ac-dom-aggregate.js`** | 四资源主导列聚合；`map_intervention_nodes`、`map_AC_buffer` 等。 |
| **`catalyst-seam-clusters.js`** | 触媒 DBSCAN 与接缝。 |
| **`corridor-bottleneck-routing.js`** | b(e)、瓶颈、簇间廊道。 |
| **`cluster-field-circles.js`** | 双半径场域圆。 |
| **`field-parcels.js`** | 地块备用逻辑（当前主流程多不引用）。 |

## 子目录

| 路径 | 用途 |
|------|------|
| **`data/`** | 静态地理数据、选址草稿 JSON、POI GeoJSON；**`data/cld/`** 为边表 CSV。 |
| **`docs/`** | 手册与说明。 |
| **`profiles/`** | 人物画像 HTML。 |
| **`public/`** | 构建拷贝资源（如 `sync:cld` 后的 `cld_priority.csv`）。 |
| **`dist/`** | `npm run build` 输出（矩阵为 `dist/src/matrix/stay_willingness_matrix.html` 等）。 |
| **`scripts/`** | Node/Python 工具链（**全部保留在仓库中**；路径见 `package.json`）。 |
| **`output/`** | 部分导出脚本默认输出目录。 |

## 资源与 JSX

- **`src/matrix/csvi_quadrant.jsx` / `matrix_main.jsx`**：Vite 矩阵应用；`fetch` 使用 `import.meta.env.BASE_URL` + `cld_priority.csv`（运行时由 `public/` 提供，与 `sync:cld` 同步自 `data/cld/cld_priority.csv`）。
- 叙事插图：`<img src="../assets/images/1.jpg">` 等（相对 `pages/1narrative-framework.html`）。

## 常用命令

```bash
npm run dev              # Vite 开发（默认入口见 vite.config）
npm run build
npm run sync:cld         # data/cld/cld_priority.csv → public/cld_priority.csv
npm run filter:cld-xuhui
npm run filter:cld-daxujiahui
```

从仓库根目录起静态服务后，主叙事 URL 示例：`http://localhost:8080/pages/1narrative-framework.html` 或根路径 `http://localhost:8080/`（`index.html` 跳转）。
