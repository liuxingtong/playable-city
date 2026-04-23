/**
 * 触媒场域（玫红双圆）+ 资源场域（青双圆）+ 瓶颈/廊道折线。
 * 依赖：全局 L、map；appendCircleCornerPoints；classifyNodes 输出结构。
 */
(function () {
  'use strict';

  const FIELD_COLORS = ['#ff4dad', '#ff6b9d', '#e91e8c', '#ff8ec7', '#d81b87', '#f48fb1'];
  const RESOURCE_FIELD_COLORS = ['#00e5ff', '#26c6da', '#4dd0e1', '#18ffff', '#a7ffeb'];

  const PERF = {
    maxCatalystMarkersPerField: 18,
    maxCorridorMidMarkers: 0,
    maxBaseSegs: 140
  };

  function ensureFieldSystemMapPanes(map) {
    if (!map.getPane('fsPane')) {
      map.createPane('fsPane');
      map.getPane('fsPane').style.zIndex = 390;
      map.getPane('fsPane').style.pointerEvents = 'none';
    }
    if (!map.getPane('userPane')) {
      map.createPane('userPane');
      map.getPane('userPane').style.zIndex = 420;
    }
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function shortenResourceFieldLabel(lab) {
    const s = String(lab);
    if (s.startsWith('交通/慢行')) return s.replace(/^交通\/慢行/, '交');
    const m = { 医疗（旧）: '医', 医疗: '医', 科技: '科', 商业: '商', 体育: '体', 文化: '文' };
    return s.replace(/^(医疗（旧）|医疗|科技|商业|体育|文化)/, (x) => m[x] || x);
  }

  function compactCyanChipDivIcon(labelText, borderColor) {
    const c = borderColor || '#00e5ff';
    const esc = escapeHtml(shortenResourceFieldLabel(labelText));
    return L.divIcon({
      className: 'map-chip-leaflet-root',
      html: `<div class="map-chip-cyan" style="color:${c};border-color:${c}">${esc}</div>`,
      iconSize: [52, 18],
      iconAnchor: [26, 9]
    });
  }

  function fieldSystemLabel(i) {
    const letter = String.fromCharCode(65 + i);
    return `场域 ${letter} · 簇 ${i + 1}`;
  }

  function takeTopByPriority(edgeArr, maxN) {
    if (edgeArr.length <= maxN) return edgeArr;
    return [...edgeArr].sort((a, b) => b.priority - a.priority).slice(0, maxN);
  }

  function getEdgesToDrawAsBottleneck(classified, allEdges) {
    const strict = classified.bottleneck;
    if (strict.length > 0) return { list: strict, mode: 'strict' };
    const seam = classified.seamEdges || [];
    if (seam.length > 0) return { list: seam, mode: 'seam' };
    const med = classified.acPhysMedian;
    const low = [];
    for (let i = 0; i < allEdges.length; i++) {
      const e = allEdges[i];
      if (e.nodeType === 'act_elder' || e.nodeType === 'act_work' || e.nodeType === 'act_both') continue;
      if (e.csvi_AC_phys <= med) low.push(e);
    }
    return { list: low, mode: 'lowAc' };
  }

  function pathLatLngsFromEdges(edgeList) {
    if (!edgeList || !edgeList.length) return [];
    const out = [[edgeList[0].from.lat, edgeList[0].from.lon]];
    for (let i = 0; i < edgeList.length; i++) {
      out.push([edgeList[i].to.lat, edgeList[i].to.lon]);
    }
    return out;
  }

  /**
   * @param {L.Map} map
   * @param {object} edges
   * @param {object} classified classifyNodes 结果
   * @param {object} fields selectFieldSystems 结果
   * @param {object} resourceFields selectResourceFieldSystems 结果
   * @param {function} [onDone]
   */
  function renderFieldSystemMap(map, edges, classified, fields, resourceFields, onDone) {
    ensureFieldSystemMapPanes(map);
    const resFs = resourceFields && resourceFields.fieldSystems ? resourceFields.fieldSystems : [];
    const vectorRenderer = L.canvas({ padding: 0.5, pane: 'fsPane' });
    const bottleneckRenderer = L.canvas({ padding: 0.5 });
    let bottleneckDrawPack = { list: [], mode: 'none' };

    function phaseLines() {
      const plen = edges.length;
      const pp = new Float64Array(plen);
      for (let i = 0; i < plen; i++) pp[i] = edges[i].priority;
      pp.sort();
      const idx = plen ? Math.min(Math.floor(plen * 0.993), plen - 1) : 0;
      const pThresh = plen ? pp[idx] : 0;
      const cand = [];
      for (let i = 0; i < plen; i++) {
        const e = edges[i];
        if (e.priority >= pThresh) cand.push(e);
      }
      const baseShow =
        cand.length <= PERF.maxBaseSegs ? cand : takeTopByPriority(cand, PERF.maxBaseSegs);
      const netSegs = baseShow.map((e) => [
        [e.from.lat, e.from.lon],
        [e.to.lat, e.to.lon]
      ]);
      if (netSegs.length) {
        L.polyline(netSegs, {
          pane: 'fsPane',
          renderer: vectorRenderer,
          interactive: false,
          smoothFactor: 0,
          color: 'rgba(233,30,140,0.09)',
          weight: 1,
          opacity: 0.5
        }).addTo(map);
      }
    }

    function phasePolygonsAndLabels() {
      fields.fieldSystems.forEach((fs, i) => {
        const color = FIELD_COLORS[i] || '#fff';
        const rIn = fs.circleRadiusInnerM;
        const rOut = fs.circleRadiusOuterM;
        const dual = Math.abs(rOut - rIn) >= 0.75;
        if (dual) {
          L.circle([fs.circleCenterLat, fs.circleCenterLon], {
            pane: 'fsPane',
            radius: rOut,
            renderer: vectorRenderer,
            color: color,
            weight: 2,
            opacity: 0.65,
            fillColor: color,
            fillOpacity: 0.03,
            dashArray: '10,8',
            interactive: false
          }).addTo(map);
        }
        L.circle([fs.circleCenterLat, fs.circleCenterLon], {
          pane: 'fsPane',
          radius: dual ? rIn : rOut,
          renderer: vectorRenderer,
          color: color,
          weight: 2.5,
          opacity: 0.9,
          fillColor: color,
          fillOpacity: dual ? 0.09 : 0.08,
          interactive: false
        }).addTo(map);
        const cLat = fs.members.reduce((s, m) => s + m.lat, 0) / fs.members.length;
        const cLon = fs.members.reduce((s, m) => s + m.lon, 0) / fs.members.length;
        const labelIcon = L.divIcon({
          html: `<div style="
        color:${color};font-size:11px;font-weight:700;letter-spacing:1px;
        text-shadow:0 0 8px rgba(0,0,0,0.8);white-space:nowrap;
        font-family:'DM Sans','Noto Sans SC',sans-serif;
      ">${fieldSystemLabel(i)}<br>
      <span style="font-size:9px;font-weight:400;opacity:0.7">${fs.areaHa.toFixed(1)} ha · ${
            fs.catalystEdges.length
          } · r<sub>内</sub>${fs.circleRadiusInnerM.toFixed(0)}m${
            Math.abs(fs.circleRadiusOuterM - fs.circleRadiusInnerM) >= 0.75
              ? ` / 缓冲${fs.circleRadiusOuterM.toFixed(0)}m`
              : ''
          }</span>
      </div>`,
          className: '',
          iconSize: [160, 40],
          iconAnchor: [80, 20]
        });
        L.marker([cLat, cLon], { icon: labelIcon, interactive: false }).addTo(map);
      });

      resFs.forEach((fs, i) => {
        const color = RESOURCE_FIELD_COLORS[i % RESOURCE_FIELD_COLORS.length];
        const rIn = fs.circleRadiusInnerM;
        const rOut = fs.circleRadiusOuterM;
        const dual = Math.abs(rOut - rIn) >= 0.75;
        if (dual) {
          L.circle([fs.circleCenterLat, fs.circleCenterLon], {
            pane: 'fsPane',
            radius: rOut,
            renderer: vectorRenderer,
            color: color,
            weight: 2,
            opacity: 0.7,
            fillColor: color,
            fillOpacity: 0.04,
            dashArray: '10,8',
            interactive: false
          }).addTo(map);
        }
        L.circle([fs.circleCenterLat, fs.circleCenterLon], {
          pane: 'fsPane',
          radius: dual ? rIn : rOut,
          renderer: vectorRenderer,
          color: color,
          weight: 2.5,
          opacity: 0.95,
          fillColor: color,
          fillOpacity: dual ? 0.1 : 0.09,
          interactive: false
        }).addTo(map);
      });
    }

    function phaseCatalystDots() {
      fields.fieldSystems.forEach((fs, i) => {
        const color = FIELD_COLORS[i] || '#fff';
        const catSrc = fs.catalystEdges;
        const catShow =
          catSrc.length <= PERF.maxCatalystMarkersPerField
            ? catSrc
            : takeTopByPriority(catSrc, PERF.maxCatalystMarkersPerField);
        for (let j = 0; j < catShow.length; j++) {
          const e = catShow[j];
          L.circleMarker([e.midLat, e.midLon], {
            pane: 'fsPane',
            renderer: vectorRenderer,
            radius: 4.5,
            fillColor: '#ff4dad',
            color: color,
            weight: 1,
            fillOpacity: 0.45,
            opacity: 0.92,
            interactive: false
          }).addTo(map);
        }
      });
    }

    function phaseResourceDotsAndLabels() {
      resFs.forEach((fs, i) => {
        const color = RESOURCE_FIELD_COLORS[i % RESOURCE_FIELD_COLORS.length];
        const src = fs.resourceEdges || [];
        const show =
          src.length <= PERF.maxCatalystMarkersPerField
            ? src
            : [...src]
                .sort((a, b) => (Number(b.acPhysEff) || 0) - (Number(a.acPhysEff) || 0))
                .slice(0, PERF.maxCatalystMarkersPerField);
        for (let j = 0; j < show.length; j++) {
          const e = show[j];
          L.circleMarker([e.midLat, e.midLon], {
            pane: 'fsPane',
            renderer: vectorRenderer,
            radius: 4.2,
            fillColor: '#00e5ff',
            color: color,
            weight: 1.2,
            fillOpacity: 0.42,
            opacity: 0.95,
            interactive: false
          }).addTo(map);
        }
        const lab = fs.resourceClusterLabel
          ? String(fs.resourceClusterLabel)
          : fs.domainLabel
            ? String(fs.domainLabel)
            : '';
        if (lab) {
          L.marker([fs.circleCenterLat, fs.circleCenterLon], {
            pane: 'userPane',
            interactive: false,
            zIndexOffset: 280,
            icon: compactCyanChipDivIcon(lab, color)
          }).addTo(map);
        }
      });
    }

    function phaseBottleneckOverlay() {
      const paths = fields.corridorPaths || [];
      if (paths.length) {
        bottleneckDrawPack = { list: classified.bottleneck, mode: 'corridor' };
        for (let pi = 0; pi < paths.length; pi++) {
          const latlngs = pathLatLngsFromEdges(paths[pi].edges);
          if (latlngs.length < 2) continue;
          const layer = L.polyline(latlngs, {
            renderer: bottleneckRenderer,
            color: 'rgba(255,120,180,0.92)',
            weight: 2.6,
            opacity: 0.95,
            interactive: false,
            smoothFactor: 0,
            lineCap: 'round'
          }).addTo(map);
          if (typeof layer.bringToFront === 'function') layer.bringToFront();
        }
        return;
      }

      bottleneckDrawPack = getEdgesToDrawAsBottleneck(classified, edges);
      const bot = bottleneckDrawPack.list;
      const n = bot.length;
      const botSegs = new Array(n);
      for (let bi = 0; bi < n; bi++) {
        const be = bot[bi];
        botSegs[bi] = [
          [be.from.lat, be.from.lon],
          [be.to.lat, be.to.lon]
        ];
      }
      if (!botSegs.length) return;
      const thick = n > 4000 ? 1 : 1.35;
      const col =
        bottleneckDrawPack.mode === 'strict'
          ? 'rgba(255,120,180,0.92)'
          : bottleneckDrawPack.mode === 'seam'
            ? 'rgba(255,160,200,0.88)'
            : 'rgba(255,140,190,0.72)';
      const layer = L.polyline(botSegs, {
        renderer: bottleneckRenderer,
        interactive: false,
        smoothFactor: 0,
        color: col,
        weight: thick,
        opacity: 0.95
      }).addTo(map);
      if (typeof layer.bringToFront === 'function') layer.bringToFront();
    }

    function phaseStatsAndFit() {
      const allPts = [];
      fields.fieldSystems.forEach((fs) => {
        appendCircleCornerPoints(fs.circleCenterLat, fs.circleCenterLon, fs.circleRadiusOuterM, allPts);
      });
      resFs.forEach((fs) => {
        appendCircleCornerPoints(fs.circleCenterLat, fs.circleCenterLon, fs.circleRadiusOuterM, allPts);
      });
      const blist = bottleneckDrawPack.list;
      for (let bi = 0; bi < blist.length; bi++) {
        const be = blist[bi];
        allPts.push([be.from.lat, be.from.lon], [be.to.lat, be.to.lon]);
      }
      const cpaths = fields.corridorPaths || [];
      for (let pi = 0; pi < cpaths.length; pi++) {
        const es = cpaths[pi].edges;
        for (let ei = 0; ei < es.length; ei++) {
          const be = es[ei];
          allPts.push([be.from.lat, be.from.lon], [be.to.lat, be.to.lon]);
        }
      }
      if (allPts.length) {
        let minLat = allPts[0][0];
        let maxLat = allPts[0][0];
        let minLon = allPts[0][1];
        let maxLon = allPts[0][1];
        for (let k = 1; k < allPts.length; k++) {
          const p = allPts[k];
          if (p[0] < minLat) minLat = p[0];
          if (p[0] > maxLat) maxLat = p[0];
          if (p[1] < minLon) minLon = p[1];
          if (p[1] > maxLon) maxLon = p[1];
        }
        map.fitBounds(
          [
            [minLat - 0.003, minLon - 0.003],
            [maxLat + 0.003, maxLon + 0.003]
          ],
          { animate: false }
        );
      }
      if (typeof onDone === 'function') onDone();
    }

    requestAnimationFrame(() => {
      phaseLines();
      requestAnimationFrame(() => {
        phasePolygonsAndLabels();
        requestAnimationFrame(() => {
          phaseCatalystDots();
          phaseResourceDotsAndLabels();
          requestAnimationFrame(() => {
            phaseBottleneckOverlay();
            requestAnimationFrame(phaseStatsAndFit);
          });
        });
      });
    });
  }

  const g = typeof window !== 'undefined' ? window : globalThis;
  g.PRB_FieldSystemLeaflet = {
    renderFieldSystemMap,
    ensureFieldSystemMapPanes,
    FIELD_COLORS,
    RESOURCE_FIELD_COLORS
  };
})();
