/**
 * 触媒簇 ↔ 瓶颈接缝 与场域选址对齐。
 * runCatalystDbscan 与场域选址页（pages/xujiahui-site-selection.html / pages/field_system_selection.html）内 selectFieldSystems 共用同一套
 * 候选边、DBSCAN 参数与 ε 步进；接缝在多簇时为「各触媒簇路网扩张交界」。
 * 若激活顶点侧无法形成 ≥2 种簇标签，回退 k-means(k=2) / 经度对半（与旧版兼容）。
 */
const CatalystSeamClusters = (function () {
  const MAX_DBSCAN_POINTS = 200;

  function attachPlanarMetersXY(points) {
    const n = points.length;
    if (n === 0) return;
    let slat = 0, slon = 0;
    for (let i = 0; i < n; i++) {
      slat += points[i].lat;
      slon += points[i].lon;
    }
    const clat = slat / n;
    const clon = slon / n;
    const mLat = 111320;
    const mLon = 111320 * Math.cos(clat * Math.PI / 180);
    for (let i = 0; i < n; i++) {
      const p = points[i];
      p._mx = (p.lon - clon) * mLon;
      p._my = (p.lat - clat) * mLat;
    }
  }

  function dbscan(points, eps, minPts) {
    const n = points.length;
    attachPlanarMetersXY(points);
    const eps2 = eps * eps;
    const labels = new Int32Array(n).fill(-1);
    let clusterId = 0;

    function regionQuery(pIdx) {
      const neighbors = [];
      const p = points[pIdx];
      const px = p._mx, py = p._my;
      for (let i = 0; i < n; i++) {
        const q = points[i];
        const dx = px - q._mx, dy = py - q._my;
        if (dx * dx + dy * dy <= eps2) neighbors.push(i);
      }
      return neighbors;
    }

    for (let i = 0; i < n; i++) {
      if (labels[i] !== -1) continue;
      const neighbors = regionQuery(i);
      if (neighbors.length < minPts) { labels[i] = -2; continue; }
      labels[i] = clusterId;
      const seeds = [...neighbors];
      let si = 0;
      while (si < seeds.length) {
        const q = seeds[si++];
        if (labels[q] !== -1 && labels[q] !== -2 && labels[q] !== clusterId) continue;
        if (labels[q] === -1 || labels[q] === -2) labels[q] = clusterId;
        const qNeighbors = regionQuery(q);
        if (qNeighbors.length >= minPts) {
          for (const nn of qNeighbors) {
            if (labels[nn] === -1 || labels[nn] === -2) seeds.push(nn);
          }
        }
      }
      clusterId++;
    }
    return { labels, nClusters: clusterId };
  }

  function runCatalystDbscan(activatedEdges, criticalEdges) {
    const catalystEdges = [...activatedEdges, ...criticalEdges];
    catalystEdges.sort((a, b) => b.priority - a.priority);
    const topN = Math.min(catalystEdges.length, Math.ceil(catalystEdges.length * 0.25));
    const candidates = catalystEdges.slice(
      0,
      Math.min(catalystEdges.length, Math.max(topN, 20), MAX_DBSCAN_POINTS)
    );
    const points = candidates.map((e, i) => ({ lat: e.midLat, lon: e.midLon, idx: i, edge: e }));
    let eps = 180, minPts = 3;
    let result;
    for (let attempt = 0; attempt < 5; attempt++) {
      result = dbscan(points, eps, minPts);
      if (result.nClusters >= 2) break;
      eps += 60;
      if (minPts > 2) minPts--;
    }
    return {
      candidates,
      points,
      labels: result.labels,
      nClusters: result.nClusters,
      eps,
      minPts
    };
  }

  function planarDist2(lat1, lon1, lat2, lon2) {
    const clat = ((lat1 + lat2) / 2) * Math.PI / 180;
    const mLat = 111320;
    const mLon = 111320 * Math.cos(clat);
    const dy = (lat2 - lat1) * mLat;
    const dx = (lon2 - lon1) * mLon;
    return dx * dx + dy * dy;
  }

  function vertexSeedsFromCatalystDbscan(activatedEdges, vertPos, db) {
    const seedLabel = new Map();
    const { points, labels } = db;
    const edgeToIdx = new Map();
    for (let i = 0; i < points.length; i++) edgeToIdx.set(points[i].edge, i);

    const incidents = new Map();
    for (let i = 0; i < activatedEdges.length; i++) {
      const ev = activatedEdges[i];
      if (!incidents.has(ev.u)) incidents.set(ev.u, []);
      if (!incidents.has(ev.v)) incidents.set(ev.v, []);
      incidents.get(ev.u).push(ev);
      incidents.get(ev.v).push(ev);
    }

    const clusteredPts = [];
    for (let i = 0; i < points.length; i++) {
      if (labels[i] >= 0) {
        clusteredPts.push({ lat: points[i].lat, lon: points[i].lon, c: labels[i] });
      }
    }

    function nearestCluster(lat, lon) {
      if (!clusteredPts.length) return 0;
      let best = clusteredPts[0].c;
      let bestD = Infinity;
      for (let j = 0; j < clusteredPts.length; j++) {
        const p = clusteredPts[j];
        const d = planarDist2(lat, lon, p.lat, p.lon);
        if (d < bestD) {
          bestD = d;
          best = p.c;
        }
      }
      return best;
    }

    const vertSet = new Set();
    for (let i = 0; i < activatedEdges.length; i++) {
      vertSet.add(activatedEdges[i].u);
      vertSet.add(activatedEdges[i].v);
    }

    vertSet.forEach(vid => {
      const pos = vertPos.get(vid);
      if (!pos) return;
      let bestLab = -1;
      let bestPrio = -1;
      const inc = incidents.get(vid);
      if (inc) {
        for (let k = 0; k < inc.length; k++) {
          const ev = inc[k];
          const idx = edgeToIdx.get(ev);
          if (idx === undefined) continue;
          const lab = labels[idx];
          if (lab >= 0 && ev.priority > bestPrio) {
            bestPrio = ev.priority;
            bestLab = lab;
          }
        }
      }
      const lab = bestLab >= 0 ? bestLab : nearestCluster(pos.lat, pos.lon);
      seedLabel.set(vid, lab);
    });

    return seedLabel;
  }

  function vertToPlanarXY(lon, lat) {
    const kLon = Math.cos(lat * Math.PI / 180);
    return [lon * kLon, lat];
  }

  function dist2xy(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
  }

  function kMeans2LabelsFromVerts(verts, vertPos) {
    const n = verts.length;
    if (n < 2) return null;
    const xy = new Array(n);
    for (let i = 0; i < n; i++) {
      const p = vertPos.get(verts[i]);
      const lon = p && Number.isFinite(p.lon) ? p.lon : 0;
      const lat = p && Number.isFinite(p.lat) ? p.lat : 0;
      xy[i] = vertToPlanarXY(lon, lat);
    }
    let bestI = 0, bestJ = 1, bestD = -1;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = dist2xy(xy[i][0], xy[i][1], xy[j][0], xy[j][1]);
        if (d > bestD) {
          bestD = d;
          bestI = i;
          bestJ = j;
        }
      }
    }
    if (bestD < 1e-20) return null;
    let c0x = xy[bestI][0], c0y = xy[bestI][1];
    let c1x = xy[bestJ][0], c1y = xy[bestJ][1];
    const labels = new Uint8Array(n);
    for (let iter = 0; iter < 40; iter++) {
      for (let i = 0; i < n; i++) {
        const d0 = dist2xy(xy[i][0], xy[i][1], c0x, c0y);
        const d1 = dist2xy(xy[i][0], xy[i][1], c1x, c1y);
        labels[i] = d0 <= d1 ? 0 : 1;
      }
      let s0x = 0, s0y = 0, n0 = 0;
      let s1x = 0, s1y = 0, n1 = 0;
      for (let i = 0; i < n; i++) {
        if (labels[i] === 0) {
          s0x += xy[i][0];
          s0y += xy[i][1];
          n0++;
        } else {
          s1x += xy[i][0];
          s1y += xy[i][1];
          n1++;
        }
      }
      if (n0 === 0 || n1 === 0) return null;
      const nc0x = s0x / n0, nc0y = s0y / n0;
      const nc1x = s1x / n1, nc1y = s1y / n1;
      if (
        Math.abs(nc0x - c0x) < 1e-9 &&
        Math.abs(nc0y - c0y) < 1e-9 &&
        Math.abs(nc1x - c1x) < 1e-9 &&
        Math.abs(nc1y - c1y) < 1e-9
      )
        break;
      c0x = nc0x;
      c0y = nc0y;
      c1x = nc1x;
      c1y = nc1y;
    }
    return labels;
  }

  function seedLabelsLongitudeFallback(verts, vertPos) {
    const sorted = [...verts];
    sorted.sort((a, b) => {
      const pa = vertPos.get(a), pb = vertPos.get(b);
      return (pa ? pa.lon : 0) - (pb ? pb.lon : 0);
    });
    const half = Math.floor(sorted.length / 2);
    const seedLabel = new Map();
    if (half < 1 || half >= sorted.length) return seedLabel;
    for (let i = 0; i < half; i++) seedLabel.set(sorted[i], 0);
    for (let i = half; i < sorted.length; i++) seedLabel.set(sorted[i], 1);
    return seedLabel;
  }

  function buildKMeansSeedMap(activatedEdges, vertPos) {
    const vertSet = new Set();
    for (let i = 0; i < activatedEdges.length; i++) {
      vertSet.add(activatedEdges[i].u);
      vertSet.add(activatedEdges[i].v);
    }
    const verts = [...vertSet];
    const seam = new Map();
    if (verts.length < 2) return seam;
    let seedLabel = new Map();
    const km = kMeans2LabelsFromVerts(verts, vertPos);
    if (km) {
      for (let i = 0; i < verts.length; i++) seedLabel.set(verts[i], km[i]);
    } else {
      seedLabel = seedLabelsLongitudeFallback(verts, vertPos);
    }
    return seedLabel;
  }

  function buildAdjacencyUndirected(allEdges) {
    const adj = new Map();
    for (let i = 0; i < allEdges.length; i++) {
      const ev = allEdges[i];
      const u = ev.u, v = ev.v;
      if (!adj.has(u)) adj.set(u, []);
      if (!adj.has(v)) adj.set(v, []);
      adj.get(u).push(v);
      adj.get(v).push(u);
    }
    return adj;
  }

  function collectVoronoiSeamEdges(allEdges, seedLabel) {
    const seam = new Set();
    if (!seedLabel.size || !allEdges.length) return seam;

    const adj = buildAdjacencyUndirected(allEdges);
    const owner = new Map(seedLabel);
    const q = [...seedLabel.keys()];
    let qi = 0;
    while (qi < q.length) {
      const u = q[qi++];
      const lu = owner.get(u);
      const outs = adj.get(u);
      if (!outs) continue;
      for (let i = 0; i < outs.length; i++) {
        const nb = outs[i];
        if (!owner.has(nb)) {
          owner.set(nb, lu);
          q.push(nb);
        }
      }
    }

    for (let i = 0; i < allEdges.length; i++) {
      const ev = allEdges[i];
      const a = owner.get(ev.u);
      const b = owner.get(ev.v);
      if (a !== undefined && b !== undefined && a !== b) seam.add(ev);
    }
    return seam;
  }

  function distinctLabelCount(seedLabel) {
    const s = new Set();
    seedLabel.forEach(v => s.add(v));
    return s.size;
  }

  function collectAlignedSeamEdgesWithDb(allEdges, activatedEdges, criticalEdges, vertPos) {
    const empty = new Set();
    const emptyOut = { seam: empty, db: null };
    if (!activatedEdges.length || !allEdges.length) return emptyOut;

    const db = runCatalystDbscan(activatedEdges, criticalEdges);
    let seedLabel = vertexSeedsFromCatalystDbscan(activatedEdges, vertPos, db);

    if (distinctLabelCount(seedLabel) < 2) {
      seedLabel = buildKMeansSeedMap(activatedEdges, vertPos);
    }
    if (distinctLabelCount(seedLabel) < 2) return { seam: empty, db };

    return { seam: collectVoronoiSeamEdges(allEdges, seedLabel), db };
  }

  function collectAlignedSeamEdges(allEdges, activatedEdges, criticalEdges, vertPos) {
    return collectAlignedSeamEdgesWithDb(allEdges, activatedEdges, criticalEdges, vertPos).seam;
  }

  return {
    collectAlignedSeamEdges,
    collectAlignedSeamEdgesWithDb,
    runCatalystDbscan
  };
})();
