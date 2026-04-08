# 地块 GeoJSON（已不再接入主页面）

**当前主流程**：场域边界为 **质心圆**（见 `cluster-field-circles.js` + `xujiahui-site-selection.html` / `field_system_selection.html`），页面 **不再** `fetch` 本文件。

以下为历史/备用说明：若你自行 fork 再接地块，可参考 `field-parcels.js` 与下列数据约定。

- **空 `FeatureCollection`**（默认）：行为与从前一致——场域边界 = 触媒中点凸包 + 按 10 ha 比例做缓冲/缩放；簇 medoid 不额外约束。
- **含 Polygon / MultiPolygon**：对每个触媒簇，按触媒中点与簇包络框挑选 **与之相交的地块**（点落在面内、或簇中心落在面内、或地块顶点距任一中点 ≤ 约 85 m），**多块取并集**绘制；面积 = 选中地块面积之和（**不再**做 10 ha 凸包缩放）。  
  **廊道 medoid** 仅在「该簇有选中地块」时，改为在 **落在任一地块闭合环内的路口** 上取几何 medoid（否则回退为原逻辑）。

## 数据格式

- WGS84，`FeatureCollection`，要素几何为 `Polygon` 或 `MultiPolygon` 即可（属性随意）。
- 地块宜为 **独立闭合面**（街廓 / OSM landuse / 自有宗地等），数量过大时请注意浏览器性能。

## 如何准备数据

1. **OSM**：可用 Overpass 在研究区 bbox 内导出 `landuse` 等并转 GeoJSON（注意 ODbL 许可）。仓库脚本：  
   `npm run fetch:field-parcels`（默认**很小** bbox + 有限 landuse 类型，减轻 **504**）。扩大范围可设：  
   `OVERPASS_BBOX=南,西,北,东`（越大越容易超时；可多次小块导出再合并 FeatureCollection）。脚本会依次尝试 `overpass.kumi.systems` 与 `overpass-api.de` 并带重试。
2. **自有矢量**：在 QGIS 等工具中裁剪到大徐家汇范围后，导出为 GeoJSON 覆盖本文件。

## 局限说明

- **簇间廊道** 仍走全路网最短路；仅 **各簇 medoid** 优先落在地块内，**路径中段** inevitably 经过道路与地块外空间。
- 触媒中点若在路心、与地块面不相交，依赖「簇中心」或 **85 m 邻近** 规则关联地块，可能多选或少选，需凭数据调参（`field-parcels.js` 内 `NEAR_MEMBER_M`、`PAD_LAT`）。
