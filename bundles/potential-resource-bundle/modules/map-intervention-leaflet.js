/**
 * 潜力/资源节点地图图层（Leaflet）。
 * 依赖：L、d3.extent；PRB_MapInterventionData.computeMapInterventionLayers 的输出。
 */
(function () {
  'use strict';

  const NETWORK_BUCKETS = 22;
  const MAG_NODE = '#e91e8c';
  const RES_NODE = '#5ce1e6';

  function csviColorFromT(t) {
    t = Math.max(0, Math.min(1, t));
    const r = Math.round(88 + t * 147);
    const g = Math.round(18 + t * 48);
    const b = Math.round(52 + t * 108);
    return `rgba(${r},${g},${b},${0.15 + t * 0.28})`;
  }

  function priorityTo01(edgeList) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < edgeList.length; i++) {
      const p = edgeList[i].priority;
      if (p < lo) lo = p;
      if (p > hi) hi = p;
    }
    const span = hi - lo || 1;
    return (p) => (p - lo) / span;
  }

  function starIcon(color, size) {
    size = size || 24;
    const c = size / 2;
    const svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <polygon points="${c},1 ${c * 1.22},${c * 0.65} ${size - 1},${c * 0.65} ${c * 1.35},${c * 1.05} ${c * 1.5},${size - 1} ${c},${c * 1.3} ${c * 0.5},${size - 1} ${c * 0.65},${c * 1.05} 1,${c * 0.65} ${c * 0.78},${c * 0.65}"
      fill="${color}" fill-opacity="0.65" stroke="${color}" stroke-width="1.5" />
  </svg>`;
    return L.divIcon({
      html: svg,
      className: '',
      iconSize: [size, size],
      iconAnchor: [c, c]
    });
  }

  function hexNodeIcon(color, size) {
    size = size || 20;
    const c = size / 2;
    const r = c - 2;
    const pts = [];
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 6 + (k * Math.PI) / 3 - Math.PI / 2;
      pts.push(`${c + r * Math.cos(a)},${c + r * Math.sin(a)}`);
    }
    const d = pts.join(' ');
    const svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <polygon points="${d}" fill="${color}" fill-opacity="0.22" stroke="${color}" stroke-width="2" />
  </svg>`;
    return L.divIcon({
      html: svg,
      className: '',
      iconSize: [size, size],
      iconAnchor: [c, c]
    });
  }

  const NODE_ICONS = {
    act_potential: starIcon(MAG_NODE, 24),
    resource: hexNodeIcon(RES_NODE, 22)
  };

  const nodeStyles = {
    act_potential: {
      typeCN: '潜力 · 激活',
      typeEN: 'Potential · activated',
      typeClass: 't-act',
      note: 'CPVI 高三档且五类关切分位至少一类高三档'
    },
    resource: {
      typeCN: '资源节点',
      typeEN: 'Resource',
      typeClass: 't-res',
      note: '五主导列 argmax 分型；界内各类前 10%'
    }
  };

  function makeTooltip(e) {
    const s = nodeStyles[e.nodeType];
    if (!s) return '';
    const dom = e.resourceDom;
    if (e.nodeType === 'resource') {
      const domVal = dom && Number.isFinite(dom.max) ? dom.max : 0;
      const domLab = dom ? dom.label : '—';
      return `
    <div class="tt-type ${s.typeClass}">${s.typeEN}</div>
    <div class="tt-name">${s.typeCN}${dom ? ' · ' + dom.label : ''}</div>
    <div class="tt-r"><span>主导列（argmax）</span><b>${domLab}</b></div>
    <div class="tt-r"><span>该列值</span><b>${domVal.toFixed(4)}</b></div>
    <div class="tt-r"><span>CPVI</span><b>${e.priority.toFixed(4)}</b></div>`;
    }
    return `
    <div class="tt-type ${s.typeClass}">${s.typeEN}</div>
    <div class="tt-name">${s.typeCN}</div>
    <div class="tt-r"><span>CPVI</span><b>${e.priority.toFixed(4)}</b></div>
    <div class="tt-r"><span>W_urban = E×(AC+1)</span><b>${e.W_elder.toFixed(4)}</b></div>
    <div class="tt-r"><span>W_work = N_UD×N09</span><b>${e.W_work.toFixed(4)}</b></div>`;
  }

  function placeNodeMarker(map, layerGroups, e, layerName) {
    const s = nodeStyles[e.nodeType];
    if (!s || !NODE_ICONS[e.nodeType]) return;
    const marker = L.marker([e.midLat, e.midLon], { icon: NODE_ICONS[e.nodeType] }).bindTooltip(
      makeTooltip(e),
      {
        className: 'node-tooltip',
        direction: 'top',
        offset: [0, -14],
        sticky: false
      }
    );
    marker.addTo(layerGroups[layerName]);
  }

  /**
   * @returns {{ layerGroups: object, layerVisible: object, toggleLayer: function }}
   */
  function mountMapInterventionVisual(map, dataPack) {
    const vectorRenderer = L.canvas({ padding: 0.5 });
    const layerGroups = {
      network: L.layerGroup().addTo(map),
      activated: L.layerGroup().addTo(map),
      resource: L.layerGroup().addTo(map),
      boundary: L.layerGroup().addTo(map)
    };
    if (typeof addXujiahuiBoundaryToGroup === 'function') {
      addXujiahuiBoundaryToGroup(layerGroups.boundary);
    }

    const {
      edges,
      activatedDrawList,
      resourceDrawList,
      networkEdgesInStudy,
      activatedInStudy,
      resourceCandidatesInStudy
    } = dataPack;

    const colorBasis = networkEdgesInStudy.length ? networkEdgesInStudy : edges;
    const p01 = priorityTo01(colorBasis);
    const bucketSegs = Array.from({ length: NETWORK_BUCKETS }, () => []);
    for (let i = 0; i < networkEdgesInStudy.length; i++) {
      const e = networkEdgesInStudy[i];
      const t = Math.max(0, Math.min(1, p01(e.priority)));
      const bi = Math.min(NETWORK_BUCKETS - 1, Math.floor(t * NETWORK_BUCKETS));
      bucketSegs[bi].push([
        [e.from.lat, e.from.lon],
        [e.to.lat, e.to.lon]
      ]);
    }
    for (let bi = 0; bi < NETWORK_BUCKETS; bi++) {
      const segs = bucketSegs[bi];
      if (!segs.length) continue;
      const t = (bi + 0.5) / NETWORK_BUCKETS;
      L.polyline(segs, {
        renderer: vectorRenderer,
        interactive: false,
        smoothFactor: 0,
        color: csviColorFromT(t),
        weight: 1.5,
        opacity: 0.5,
        lineCap: 'round'
      }).addTo(layerGroups.network);
    }

    activatedDrawList.forEach((e) => placeNodeMarker(map, layerGroups, e, 'activated'));
    resourceDrawList.forEach((e) => placeNodeMarker(map, layerGroups, e, 'resource'));

    const extentMarker = [...activatedDrawList, ...resourceDrawList];
    const nNetInStudy = networkEdgesInStudy.length;
    const extentSrc = extentMarker.length ? extentMarker : nNetInStudy ? networkEdgesInStudy : edges;
    const latExtent = d3.extent(extentSrc, (e) => e.midLat);
    const lonExtent = d3.extent(extentSrc, (e) => e.midLon);
    const pad = 0.003;
    if (latExtent[0] != null && lonExtent[0] != null) {
      const b = [
        [latExtent[0] - pad, lonExtent[0] - pad],
        [latExtent[1] + pad, lonExtent[1] + pad]
      ];
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          map.fitBounds(b, { animate: false });
        });
      });
    }

    const layerVisible = { activated: true, resource: true, network: true, boundary: true };

    function toggleLayer(name) {
      layerVisible[name] = !layerVisible[name];
      const chk = document.getElementById(`chk-${name}`);
      if (layerVisible[name]) {
        if (chk) chk.classList.add('on');
        map.addLayer(layerGroups[name]);
      } else {
        if (chk) chk.classList.remove('on');
        map.removeLayer(layerGroups[name]);
      }
    }

    const g = typeof window !== 'undefined' ? window : globalThis;
    g.__prbMapIntervention = { toggleLayer };

    return {
      layerGroups,
      layerVisible,
      toggleLayer,
      stats: {
        nNetInStudy,
        nActAll: activatedInStudy.length,
        nResAll: resourceCandidatesInStudy.length,
        nAct: activatedDrawList.length,
        nRes: resourceDrawList.length,
        nEdgesTotal: edges.length
      }
    };
  }

  const g = typeof window !== 'undefined' ? window : globalThis;
  g.PRB_MapInterventionLeaflet = { mountMapInterventionVisual };
  g.toggleLayer = function (name) {
    if (g.__prbMapIntervention && g.__prbMapIntervention.toggleLayer) {
      g.__prbMapIntervention.toggleLayer(name);
    }
  };
})();
