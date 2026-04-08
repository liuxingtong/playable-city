"""
Clip data/lan_use.shp to study bbox from data/daxujiahui-four-streets-union.geojson
→ data/lan_use_daxujiahui.geojson (for xujiahui-site-selection.html fetch).

Requires: pip install pyshp
"""
from __future__ import annotations

import json
import os
import sys

try:
    import shapefile
except ImportError:
    print("Install pyshp: pip install pyshp", file=sys.stderr)
    sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STUDY = os.path.join(ROOT, "data", "daxujiahui-four-streets-union.geojson")
SHP_BASE = os.path.join(ROOT, "data", "lan_use")
OUT = os.path.join(ROOT, "data", "lan_use_daxujiahui.geojson")


def study_bbox_from_geojson(path: str) -> tuple[float, float, float, float]:
    with open(path, "r", encoding="utf-8") as f:
        j = json.load(f)
    geom = j.get("geometry") or {}
    coords = geom.get("coordinates")
    if not coords:
        raise ValueError("no geometry")
    ring = coords[0]
    lon = [p[0] for p in ring]
    lat = [p[1] for p in ring]
    pad = 0.002
    return min(lon) - pad, min(lat) - pad, max(lon) + pad, max(lat) + pad


def bbox_intersects(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> bool:
    return not (a[2] < b[0] or a[0] > b[2] or a[3] < b[1] or a[1] > b[3])


def main() -> None:
    if not os.path.isfile(STUDY):
        print("Missing", STUDY, file=sys.stderr)
        sys.exit(1)
    study = study_bbox_from_geojson(STUDY)
    r = shapefile.Reader(SHP_BASE)
    feats = []
    n = len(r.shapes())

    def props_for_shape_index(idx: int) -> dict:
        """若无 .dbf 或读记录失败，退化为占位类型；有属性时写入 landuse_type / name。"""
        out: dict = {"landuse_type": "用地", "name": f"地块{idx}", "fid": idx}
        try:
            sr = r.shapeRecord(idx)
            flds = [f[0] for f in r.fields[1:]]
            row = list(sr.record)
            d: dict = {}
            for j, name in enumerate(flds):
                if j >= len(row):
                    break
                v = row[j]
                if isinstance(v, bytes):
                    v = v.decode("utf-8", errors="replace")
                d[name] = v
            for cand in (
                "landuse_type",
                "LANDUSE",
                "YDLX",
                "用地性质",
                "DLMC",
                "GXDLMC",
                "TYPE",
                "类型",
                "GHYT",
                "用地",
            ):
                if cand in d and d[cand] not in (None, ""):
                    out["landuse_type"] = str(d[cand]).strip()
                    break
            for ncand in ("NAME", "MC", "名称", "name"):
                if ncand in d and d[ncand] not in (None, ""):
                    out["name"] = str(d[ncand]).strip()
                    break
        except Exception:
            pass
        return out

    for i in range(n):
        shp = r.shape(i)
        bb = tuple(shp.bbox[:4])
        if not bbox_intersects(bb, study):
            continue
        try:
            gi = shp.__geo_interface__
        except Exception:
            continue
        feats.append(
            {
                "type": "Feature",
                "properties": props_for_shape_index(i),
                "geometry": gi,
            }
        )
    out = {"type": "FeatureCollection", "features": feats}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"Wrote {OUT} — {len(feats)} features (of {n} shapes)")


if __name__ == "__main__":
    main()
