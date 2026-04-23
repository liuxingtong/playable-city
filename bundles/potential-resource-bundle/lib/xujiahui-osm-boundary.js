/**
 * 研究区边界图层（Leaflet）：仅显示大徐家汇四街道并集。
 * 数据：../data/daxujiahui-four-streets-union.geojson（相对地图页 pages/；npm run fetch:daxujiahui-4）
 * 样式沿用原徐汇区边界的玫红虚线填充。依赖全局 L。
 */
(function (global) {
  'use strict';

  const LOCAL_DAXUJIAHUI_GEOJSON = '../data/daxujiahui-four-streets-union.geojson';

  function pickGeometryAndLabel(j) {
    let geom = null;
    if (j.type === 'Feature' && j.geometry) geom = j.geometry;
    else if (j.type === 'FeatureCollection' && j.features?.[0]?.geometry) geom = j.features[0].geometry;
    else if (j.type === 'Polygon' || j.type === 'MultiPolygon') geom = j;
    if (!geom || !['Polygon', 'MultiPolygon'].includes(geom.type)) return null;
    const label =
      (j.properties && (j.properties.display_name || j.properties.name)) ||
      '大徐家汇（四街道并集）';
    return { geojson: geom, label };
  }

  let daxujiahuiGeoLoadPromise = null;

  /** 与地图图层共用同一次 fetch，避免重复请求 */
  async function loadDaxujiahuiFourStreetsGeoJSON() {
    if (!daxujiahuiGeoLoadPromise) {
      daxujiahuiGeoLoadPromise = (async () => {
        try {
          const r = await fetch(LOCAL_DAXUJIAHUI_GEOJSON, { cache: 'no-store' });
          if (!r.ok) return null;
          const j = await r.json();
          return pickGeometryAndLabel(j);
        } catch (e) {
          console.warn('大徐家汇边界不可用:', LOCAL_DAXUJIAHUI_GEOJSON, e);
          return null;
        }
      })();
    }
    return daxujiahuiGeoLoadPromise;
  }

  /** GeoJSON 坐标为 [lon, lat] */
  function pointInRing(lon, lat, ring) {
    let inside = false;
    const n = ring.length;
    if (n < 3) return false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];
      if ((yi > lat) !== (yj > lat)) {
        const xinters = (xj - xi) * (lat - yi) / (yj - yi) + xi;
        if (lon < xinters) inside = !inside;
      }
    }
    return inside;
  }

  /** polygonCoords: [外环, 洞1, …] */
  function pointInPolygonCoords(lon, lat, polygonCoords) {
    const outer = polygonCoords[0];
    if (!pointInRing(lon, lat, outer)) return false;
    for (let h = 1; h < polygonCoords.length; h++) {
      if (pointInRing(lon, lat, polygonCoords[h])) return false;
    }
    return true;
  }

  /**
   * 点是否落在几何内。geometry 为 null/undefined 时视为 true（未加载边界则不裁剪）。
   * @param {number} lon
   * @param {number} lat
   * @param {{type:'Polygon'|'MultiPolygon',coordinates:any}|null|undefined} geometry
   */
  function pointInDaxujiahuiGeometry(lon, lat, geometry) {
    if (geometry == null) return true;
    if (geometry.type === 'Polygon') {
      return pointInPolygonCoords(lon, lat, geometry.coordinates);
    }
    if (geometry.type === 'MultiPolygon') {
      const polys = geometry.coordinates;
      for (let p = 0; p < polys.length; p++) {
        if (pointInPolygonCoords(lon, lat, polys[p])) return true;
      }
      return false;
    }
    return false;
  }

  async function getDaxujiahuiBoundaryGeometry() {
    const d = await loadDaxujiahuiFourStreetsGeoJSON();
    return d ? d.geojson : null;
  }

  /**
   * 仅保留边段中点落在研究区内的记录（需含 midLon、midLat，与 CSV 管线一致）。
   * 边界未加载或界内为空时退回原数组。
   * @param {Array<{midLon?:number,midLat?:number}>|null|undefined} edges
   */
  async function filterEdgeRecordsToDaxujiahuiStudy(edges) {
    if (!edges || !edges.length) return edges;
    const geom = await getDaxujiahuiBoundaryGeometry();
    if (!geom) return edges;
    const out = [];
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const lon = e.midLon;
      const lat = e.midLat;
      if (lon == null || lat == null || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      if (pointInDaxujiahuiGeometry(lon, lat, geom)) out.push(e);
    }
    if (!out.length) {
      console.warn('[大徐家汇] 边界内无边段，场域/分类退回全表');
      return edges;
    }
    return out;
  }

  /**
   * 与历史 API 兼容：仅加载大徐家汇一层，样式同原徐汇边界。
   * @param {L.LayerGroup} layerGroup
   * @param {(layer: L.GeoJSON|null) => void} [onReady] 图层加入后回调（便于 bringToFront）
   */
  function addXuhuiBoundaryToGroup(layerGroup, onReady) {
    if (!global.L || !layerGroup) return;
    loadDaxujiahuiFourStreetsGeoJSON().then((daxj) => {
      if (!daxj) {
        console.warn('未获取到大徐家汇边界（请确认存在 ' + LOCAL_DAXUJIAHUI_GEOJSON + '）');
        if (typeof onReady === 'function') onReady(null);
        return;
      }
      const layer = global.L.geoJSON(daxj.geojson, {
        interactive: true,
        style: {
          color: '#ff4dad',
          weight: 2,
          opacity: 0.9,
          fillColor: '#e91e8c',
          fillOpacity: 0.06,
          dashArray: '10 7'
        },
        onEachFeature(_feature, fLayer) {
          fLayer.bindTooltip(daxj.label, {
            sticky: true,
            direction: 'center',
            className: 'boundary-tt'
          });
        }
      });
      layerGroup.addLayer(layer);
      if (typeof onReady === 'function') onReady(layer);
    });
  }

  global.addXuhuiBoundaryToGroup = addXuhuiBoundaryToGroup;
  global.addXujiahuiBoundaryToGroup = addXuhuiBoundaryToGroup;
  global.getDaxujiahuiBoundaryGeometry = getDaxujiahuiBoundaryGeometry;
  global.pointInDaxujiahuiGeometry = pointInDaxujiahuiGeometry;
  global.filterEdgeRecordsToDaxujiahuiStudy = filterEdgeRecordsToDaxujiahuiStudy;
})(typeof window !== 'undefined' ? window : globalThis);
