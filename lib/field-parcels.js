/**
 * 地块 Polygon 解析（备用）：主页面已改用圆形场域；本脚本默认不再被 HTML 引用。
 * 数据路径 ../data/field-parcels.geojson（相对地图页 pages/）。
 */
const FieldParcels = (function () {
  const PAD_LAT = 0.0005;
  const NEAR_MEMBER_M = 85;

  function ringBBox(ringLatLon) {
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    for (let i = 0; i < ringLatLon.length; i++) {
      const lat = ringLatLon[i][0];
      const lon = ringLatLon[i][1];
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
    return { minLat, maxLat, minLon, maxLon };
  }

  function bboxesOverlap(a, b) {
    return !(
      a.maxLon < b.minLon ||
      a.minLon > b.maxLon ||
      a.maxLat < b.minLat ||
      a.minLat > b.maxLat
    );
  }

  function padBbox(bb, padLat, padLon) {
    return {
      minLat: bb.minLat - padLat,
      maxLat: bb.maxLat + padLat,
      minLon: bb.minLon - padLon,
      maxLon: bb.maxLon + padLon
    };
  }

  function padLonForLat(latDeg) {
    return PAD_LAT / Math.cos((latDeg * Math.PI) / 180);
  }

  /** ring: [lat,lon][] */
  function pointInRing(lat, lon, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const yi = ring[i][0];
      const xi = ring[i][1];
      const yj = ring[j][0];
      const xj = ring[j][1];
      const denom = xj - xi + 1e-30;
      const inter =
        (xi > lon) !== (xj > lon) && lat < ((yj - yi) * (lon - xi)) / denom + yi;
      if (inter) inside = !inside;
    }
    return inside;
  }

  function pointInAnyRing(lat, lon, rings) {
    for (let r = 0; r < rings.length; r++) {
      if (pointInRing(lat, lon, rings[r])) return true;
    }
    return false;
  }

  function membersBBox(members) {
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    for (let i = 0; i < members.length; i++) {
      const lat = members[i].lat;
      const lon = members[i].lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
    return { minLat, maxLat, minLon, maxLon };
  }

  function nearAnyMember(parcel, members, maxM) {
    const max2 = maxM * maxM;
    const verts = parcel.outerLatLon;
    const clat = (parcel.bbox.minLat + parcel.bbox.maxLat) / 2;
    const mLat = 111320;
    const mLon = 111320 * Math.cos((clat * Math.PI) / 180);
    for (let vi = 0; vi < verts.length; vi++) {
      const vl = verts[vi][0];
      const vo = verts[vi][1];
      for (let mi = 0; mi < members.length; mi++) {
        const m = members[mi];
        const dy = (m.lat - vl) * mLat;
        const dx = (m.lon - vo) * mLon;
        if (dx * dx + dy * dy <= max2) return true;
      }
    }
    return false;
  }

  function closeRingLatLon(ring) {
    if (!ring || ring.length < 3) return ring ? ring.map((p) => [p[0], p[1]]) : [];
    const out = ring.map((p) => [p[0], p[1]]);
    const a = out[0];
    const b = out[out.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) out.push([a[0], a[1]]);
    return out;
  }

  function addPolygonCoords(coords, out) {
    if (!coords || !coords[0] || coords[0].length < 3) return;
    const outerLonLat = coords[0];
    const outerLatLon = outerLonLat.map((c) => [c[1], c[0]]);
    const bbox = ringBBox(outerLatLon);
    out.push({ outerLatLon, bbox });
  }

  /**
   * @returns {Array<{ outerLatLon: [number,number][], bbox }>}
   */
  function parseGeoJSON(gj) {
    if (!gj) return [];
    const out = [];
    const feats = gj.type === 'FeatureCollection' ? gj.features : [gj];
    for (let fi = 0; fi < feats.length; fi++) {
      const f = feats[fi];
      const g = f && f.geometry;
      if (!g) continue;
      if (g.type === 'Polygon') {
        addPolygonCoords(g.coordinates, out);
      } else if (g.type === 'MultiPolygon') {
        for (let pi = 0; pi < g.coordinates.length; pi++) {
          addPolygonCoords(g.coordinates[pi], out);
        }
      }
    }
    return out;
  }

  function pickParcels(members, parcelList) {
    if (!parcelList || !parcelList.length || !members || !members.length) return [];
    const bbRaw = membersBBox(members);
    const padLon = padLonForLat((bbRaw.minLat + bbRaw.maxLat) / 2);
    const bb = padBbox(bbRaw, PAD_LAT, padLon);
    const cLat = (bb.minLat + bb.maxLat) / 2;
    const cLon = (bb.minLon + bb.maxLon) / 2;
    const chosen = [];
    for (let pi = 0; pi < parcelList.length; pi++) {
      const parcel = parcelList[pi];
      if (!bboxesOverlap(bb, parcel.bbox)) continue;
      let take = false;
      for (let mi = 0; mi < members.length; mi++) {
        const m = members[mi];
        if (pointInRing(m.lat, m.lon, parcel.outerLatLon)) {
          take = true;
          break;
        }
      }
      if (!take) take = pointInRing(cLat, cLon, parcel.outerLatLon);
      if (!take) take = nearAnyMember(parcel, members, NEAR_MEMBER_M);
      if (take) chosen.push(parcel);
    }
    return chosen;
  }

  /** @param members {{lat,lon}[]} 触媒中点等 */
  function collectRingsForMembers(members, parcelList) {
    return pickParcels(members, parcelList).map((p) => closeRingLatLon(p.outerLatLon));
  }

  function ringsByDbscanLabel(db, parcelList) {
    const map = new Map();
    if (!db || !parcelList || !parcelList.length) return map;
    const { points, labels, nClusters } = db;
    for (let c = 0; c < nClusters; c++) {
      const mem = [];
      for (let i = 0; i < points.length; i++) {
        if (labels[i] === c) mem.push({ lat: points[i].lat, lon: points[i].lon });
      }
      if (mem.length < 2) continue;
      const rings = collectRingsForMembers(mem, parcelList);
      if (rings.length) map.set(c, rings);
    }
    return map;
  }

  return {
    parseGeoJSON,
    collectRingsForMembers,
    ringsByDbscanLabel,
    pointInAnyRing
  };
})();
