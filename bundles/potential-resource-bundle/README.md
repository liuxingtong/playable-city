# 潜力 / 资源分析 · 可迁移资源包（Potential–Resource Bundle）

本目录从 `playable-city` 主仓库拆出**两套**相关能力，便于整夹复制到新项目或静态站。

## 目录结构

| 路径 | 说明 |
|------|------|
| `lib/` | 与主站一致的独立脚本（边界、AC 聚合、DBSCAN 接缝、双圆几何、廊道路由）。 |
| `modules/` | 从页面内联脚本抽出的算法与 Leaflet 装配层。 |
| `examples/` | 两个最小可运行 HTML 示例（需本地 HTTP 打开以读 CSV）。 |

## 两套流水线

### A — 潜力 / 资源「节点」地图（原 `map_intervention_nodes`）

- **算法**：五维 `Wp_*` → 经验分位 → Jenks；潜力 = CPVI 高档且任一人群分位高档；资源 = 五主导列 `argmax` 分型后按类取 Top 比例。
- **模块**：`jenks-classification.js` → `map-intervention-data.js` → `map-intervention-leaflet.js`
- **示例**：`examples/map-intervention-nodes.html`
- **数据**：默认请求仓库根下 `data/cld_priority.csv`（CPVI / 新列名）。相对示例文件为 `../../data/cld_priority.csv`。
- **覆盖**：`window.PRB_MAP_CSV_URL = '你的路径.csv'` 可改数据源。

### B — 触媒场域 + 资源场域「面」+ 廊道（原 `xujiahui-site-selection` / `field_system_selection` 算法核）

- **算法**：`W_elder` / `W_work` 分位 + Jenks → 激活分型；`acPhysEff` Jenks 高档 → `resource`；`CatalystSeamClusters` + `CorridorBottleneck`；触媒与资源域各自 DBSCAN + 跨度分裂 + `ClusterFieldCircles` 双圆。
- **模块**：`jenks-classification.js` → `field-system-data.js` → `field-system-algorithms.js` → `field-system-leaflet-render.js`
- **示例**：`examples/field-system-map.html`
- **数据**：默认 `../../data/cld_priority.csv`（旧 `csvi_*` 列 + `N_YP`/`N08` 等，与主站场域页一致）。
- **覆盖**：`window.PRB_FIELD_CSV_URL`。

## 运行方式

在项目根目录起静态服务（需能访问上级 `data/`）：

```bash
npx --yes serve F:/Aworks/2026studio/xujiahui/playable-city
```

浏览器打开：

- `http://127.0.0.1:3000/bundles/potential-resource-bundle/examples/map-intervention-nodes.html`
- `http://127.0.0.1:3000/bundles/potential-resource-bundle/examples/field-system-map.html`

（端口以 `serve` 输出为准。）

## 全局 API 速查

- `PRB_MapInterventionData.loadEdgesMapIntervention()` / `computeMapInterventionLayers(edges)`
- `PRB_MapInterventionLeaflet.mountMapInterventionVisual(map, dataPack)`
- `PRB_FieldSystemData.loadEdges()` / `buildEdgesFromCsvRows` / `simulateEdges`
- `classifyNodes`, `selectFieldSystems`, `selectResourceFieldSystems`（由 `field-system-algorithms.js` 挂到 `window`）
- `PRB_FieldSystemLeaflet.renderFieldSystemMap(map, edges, classified, fields, resourceFields, onDone)`
- `PRB_FieldSystemAlgo`：算法与常量的命名空间备份

## 维护说明

- `lib/` 内文件为主仓库副本；若主站修正 bug，请同步复制或改为主项目 npm 包后再引用。
- `field-system-algorithms.js` 中 `RESOURCE_DOM_ORDER` 已与 `lib/ac-dom-aggregate.js` 的 `DOM_LABELS` 对齐（含「交通/慢行」「医疗（旧）」）。
