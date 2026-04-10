# Streetview Geo Assets

该目录用于维护带地理坐标的街景素材索引，供 `pages/agent-recon-mvp.html` 读取并与边段点位关联。

支持两种入口文件（二选一即可）：

- `index.geojson`
- `index.csv`

## GeoJSON 格式

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [121.43, 31.20] },
      "properties": {
        "id": "sv_001",
        "image": "images/sv_001.jpg",
        "thumb": "thumbs/sv_001.jpg",
        "heading": 180,
        "ts": "2026-04-09T10:00:00+08:00"
      }
    }
  ]
}
```

## CSV 格式

`id,lon,lat,image,thumb,heading,ts`

## 约定

- `image` 与 `thumb` 为相对路径时，建议以本目录为基准组织文件。
- 当前可先保持空索引，后续补图即可自动生效。
