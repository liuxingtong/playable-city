# 「大徐家汇」边界 — OpenStreetMap / Nominatim 检索说明

检索日期：2026-03-21（Nominatim + Overpass，与本地脚本无关）。

## 结论（简要）

| 问题 | 结论 |
|------|------|
| OSM 里有没有名叫 **「大徐家汇」** 的独立多边形？ | **没有**。Nominatim 对 `大徐家汇, 上海`、`大徐家汇商圈` 等查询**未返回**与徐汇规划概念匹配的行政/规划边界（多为无关 POI 或日本便利店）。 |
| 「大徐家汇」是什么？ | 多为 **上海市/徐汇区的规划或品牌范围**，**不是**民政部街道名录里的单一法定区划名；与 OSM 的 `boundary=administrative` **不一定一一对应**。 |
| 在 OSM 上较接近、可机读的是什么？ | **街道级边界**（`admin_level=8`）：如 **徐家汇街道**、以及常与「徐家汇城市副中心」连片讨论的相邻街道（田林、枫林、斜土、虹梅等），见下表。 |

## Nominatim 检索摘要

- **`大徐家汇, 上海`**（`polygon_geojson=1`）：无可用行政面；命中与「大徐家汇」无关的点位/小面。
- **`徐家汇商圈, 上海`**：空结果。
- **`徐家汇街道, 上海市` + 上海城区 `viewbox`**：得到 **relation 13469990**，`boundary=administrative`，`name:zh=徐家汇街道`，带 **Polygon** 几何（可作为**最小**可用代理边界）。

## 建议用作「大徐家汇」近似的 OSM Relation（徐汇核心片）

以下均在上海市域 viewbox 内检索到 **Polygon / MultiPolygon**，可直接用 Nominatim `polygon_geojson=1` 或 Overpass `relation(ID); out geom;` 取几何。

| OSM relation | 名称（示例） | 说明 |
|---------------|--------------|------|
| [13469990](https://www.openstreetmap.org/relation/13469990) | 徐家汇街道 / Xujiahui | **核心内核**，与「徐家汇」地名最对齐；**面积小于**常见口头「大徐家汇」。 |
| [13470052](https://www.openstreetmap.org/relation/13470052) | 枫林路街道 / Fenglinlu | 与徐家汇街道相邻，常划入副中心辐射讨论。 |
| [13470053](https://www.openstreetmap.org/relation/13470053) | 斜土路街道 / Xietulu | 同上。 |
| [13470318](https://www.openstreetmap.org/relation/13470318) | 田林街道 | 北侧/西侧连片。 |
| [13470463](https://www.openstreetmap.org/relation/13470463) | 虹梅路街道 / Hongmeilu | **偏西**（含漕开发一带），是否算「大徐家汇」取决于你的规划口径。 |

若你需要 **一个**「更大徐家汇」多边形，常见做法（OSM 无现成单体时）：

1. 用 **QGIS / Turf.js** 对上述 relation 几何做 **union**，再按需 **buffer** 或 **手工修形**；或  
2. 使用 **规划局/测绘院** 公布的 CAZ、副中心范围 **Shapefile/GeoJSON**（若有公开数据），与 OSM 底图对齐。

## 可复用的请求示例（遵守 Nominatim 使用政策：限流 + 明确 User-Agent）

**Nominatim（徐家汇街道，限定上海城区）**

```http
GET https://nominatim.openstreetmap.org/search?q=徐家汇街道,上海市&format=jsonv2&polygon_geojson=1&limit=5&viewbox=121.20,31.35,121.60,31.05&bounded=1
```

**Overpass（relation 13469990 几何）**

```text
[out:json][timeout:25];
relation(13469990);
out geom;
```

## 与仓库内「徐汇区」数据的关系

- `data/xuhui-district-R1278188.geojson`：**整个徐汇区**（OSM relation 1278188）。  
- **大徐家汇**：应 **远小于** 徐汇区；若用 OSM，至少应改用 **13469990** 或上表多街道 **合并**，而不是沿用全区面。

---

## 四街道并集（仓库内成品）

按你指定的 **徐家汇街道、天平路街道、湖南路街道、枫林路街道**，已从 OSM 取下列 relation 做 **几何并集**（`@turf/union`），生成单一轮廓：

| 街道 | OSM relation |
|------|----------------|
| 徐家汇街道 | [13469990](https://www.openstreetmap.org/relation/13469990) |
| 天平路街道 | [13469980](https://www.openstreetmap.org/relation/13469980) |
| 湖南路街道 | [13469979](https://www.openstreetmap.org/relation/13469979) |
| 枫林路街道 | [13470052](https://www.openstreetmap.org/relation/13470052) |

- **输出文件**：`data/daxujiahui-four-streets-union.geojson`（单个 `Feature`，`geometry` 为合并后的 `Polygon` 或 `MultiPolygon`）  
- **更新数据**：`npm run fetch:daxujiahui-4`（请求 Overpass，需网络）

---

*本文件仅记录检索结论与数据源 ID；未在任意地图上默认绘制「大徐家汇」边界。*
