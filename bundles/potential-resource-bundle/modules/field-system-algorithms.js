/**
 * 触媒分类、DBSCAN 场域、资源域场域（与 pages/xujiahui-site-selection 算法块对齐）。
 * 依赖：jenks-classification.js → classifyJenks 等；
 *       lib/catalyst-seam-clusters.js、cluster-field-circles.js、corridor-bottleneck-routing.js
 */
(function () {
  'use strict';

  const MAX_TOTAL_FIELD_AREA_M2 = 100000;
  const MAX_FIELD_SYSTEMS = 6;
  const SPLIT_MAX_CLUSTER_DIAMETER_M = 520;
  const SPLIT_MIN_MEMBERS_FOR_SPLIT = 5;
  const SPLIT_INNER_EPS_FACTOR = 0.48;
  const SPLIT_REFINEMENT_PASSES = 3;
  const SPLIT_INNER_EPS_MIN_M = 40;

  const MAX_TOTAL_RESOURCE_FIELD_AREA_M2 = 100000;
  /** 与 lib/ac-dom-aggregate.js DOM_LABELS 的 label 字符串一致（含 v6 交通/慢行、旧版医疗） */
  const RESOURCE_DOM_ORDER = ['交通/慢行', '体育', '科技', '商业', '文化', '医疗（旧）'];
  const MAX_RESOURCE_CLUSTERS_PER_DOMAIN = 3;
  const MAX_DBSCAN_POINTS_RESOURCE = 200;

  function addEmpiricalPercentileRanks(edges) {
    const n = edges.length;
    if (!n) return;
    function ranksFor(getter, setter) {
      if (n === 1) {
        edges[0][setter] = 0.5;
        return;
      }
      const idx = edges.map((_, i) => i);
      idx.sort((ia, ib) => {
        const va = getter(edges[ia]);
        const vb = getter(edges[ib]);
        const a = Number.isFinite(va) ? va : 0;
        const b = Number.isFinite(vb) ? vb : 0;
        return a - b;
      });
      const pr = new Array(n);
      let j = 0;
      while (j < n) {
        let k = j;
        const vj = getter(edges[idx[j]]);
        const base = Number.isFinite(vj) ? vj : 0;
        while (k + 1 < n) {
          const vk = getter(edges[idx[k + 1]]);
          const vb = Number.isFinite(vk) ? vk : 0;
          if (vb !== base) break;
          k++;
        }
        const mid = (j + k) / 2;
        const p = mid / (n - 1);
        for (let t = j; t <= k; t++) pr[idx[t]] = p;
        j = k + 1;
      }
      for (let i = 0; i < n; i++) edges[i][setter] = pr[i];
    }
    ranksFor((e) => e.W_elder, 'p_elder');
    ranksFor((e) => e.W_work, 'p_work');
  }

  function vertPosFromActivatedEdges(activatedEdgeList) {
    const m = new Map();
    for (let i = 0; i < activatedEdgeList.length; i++) {
      const ev = activatedEdgeList[i];
      m.set(ev.u, ev.from);
      m.set(ev.v, ev.to);
    }
    return m;
  }

  function attachPlanarMetersXY(points) {
    const n = points.length;
    if (n === 0) return;
    let slat = 0;
    let slon = 0;
    for (let i = 0; i < n; i++) {
      slat += points[i].lat;
      slon += points[i].lon;
    }
    const clat = slat / n;
    const clon = slon / n;
    const mLat = 111320;
    const mLon = 111320 * Math.cos((clat * Math.PI) / 180);
    for (let i = 0; i < n; i++) {
      const p = points[i];
      p._mx = (p.lon - clon) * mLon;
      p._my = (p.lat - clat) * mLat;
    }
  }

  function appendCircleCornerPoints(lat, lon, radiusM, allPts) {
    const dLat = radiusM / 111320;
    const dLon = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
    allPts.push(
      [lat - dLat, lon - dLon],
      [lat - dLat, lon + dLon],
      [lat + dLat, lon - dLon],
      [lat + dLat, lon + dLon]
    );
  }

  function classifyNodes(edges) {
    addEmpiricalPercentileRanks(edges);
    const len = edges.length;
    const pri = new Array(len);
    const pElderArr = new Array(len);
    const pWorkArr = new Array(len);
    const acPhysArr = new Array(len);
    for (let i = 0; i < len; i++) {
      const e = edges[i];
      pri[i] = e.priority;
      pElderArr[i] = e.p_elder;
      pWorkArr[i] = e.p_work;
      acPhysArr[i] = e.csvi_AC_phys;
    }
    const csviBreaks = getClassificationBreaks(pri, 3);
    const wElderBreaks = getClassificationBreaks(pElderArr, 3);
    const wWorkBreaks = getClassificationBreaks(pWorkArr, 3);
    acPhysArr.sort((a, b) => a - b);
    const nAc = acPhysArr.length;
    const acPhys50 = nAc ? acPhysArr[Math.floor((nAc - 1) / 2)] : 0;

    edges.forEach((e) => {
      e.csviClass = classifyJenks(e.priority, csviBreaks);
      e.wElderClass = classifyJenks(e.p_elder, wElderBreaks);
      e.wWorkClass = classifyJenks(e.p_work, wWorkBreaks);
    });

    const acPhysEffVals = edges.map((e) => Number(e.acPhysEff) || 0);
    const acPhysEffBreaks = getClassificationBreaks(acPhysEffVals, 3);
    edges.forEach((e) => {
      e.acPhysClass = classifyJenks(Number(e.acPhysEff) || 0, acPhysEffBreaks);
    });

    const activated = [];
    const bottleneck = [];
    const critical = [];

    edges.forEach((e) => {
      if (e.csviClass === 2 && (e.wElderClass === 2 || e.wWorkClass === 2)) {
        if (e.wElderClass === 2 && e.wWorkClass <= 1) e.nodeType = 'act_elder';
        else if (e.wWorkClass === 2 && e.wElderClass <= 1) e.nodeType = 'act_work';
        else e.nodeType = 'act_both';
        activated.push(e);
        return;
      }
      e.nodeType = null;
    });

    edges.forEach((e) => {
      if (e.nodeType != null) return;
      if (e.acPhysClass === 2) e.nodeType = 'resource';
    });

    const vertPosAct = vertPosFromActivatedEdges(activated);
    const aligned = CatalystSeamClusters.collectAlignedSeamEdgesWithDb(
      edges,
      activated,
      critical,
      vertPosAct
    );
    const connectorSeamSet = aligned.seam;
    const seamEdges = Array.from(connectorSeamSet);

    const clusterCirclesByClusterLabel =
      typeof ClusterFieldCircles !== 'undefined'
        ? ClusterFieldCircles.dbscanCirclesForCorridor(aligned.db, MAX_TOTAL_FIELD_AREA_M2)
        : null;

    const routePack = CorridorBottleneck.compute({
      edges,
      activatedEdges: activated,
      criticalEdges: critical,
      vertPos: vertPosAct,
      connectorSeamSet,
      acPhys50,
      catalystDb: aligned.db,
      clusterCirclesByClusterLabel
    });
    for (let bi = 0; bi < routePack.bottleneckEdges.length; bi++) {
      const e = routePack.bottleneckEdges[bi];
      e.nodeType = 'bottleneck';
      bottleneck.push(e);
    }

    return {
      activated,
      bottleneck,
      critical,
      seamEdges,
      acPhysMedian: acPhys50,
      corridorPaths: routePack.corridorPaths,
      corridorEdgeSet: routePack.corridorEdgeSet,
      catalystDb: aligned.db
    };
  }

  function clusterMaxPairwiseDistanceM(members) {
    const n = members.length;
    if (n < 2) return 0;
    attachPlanarMetersXY(members);
    let maxD = 0;
    for (let i = 0; i < n; i++) {
      const pi = members[i];
      for (let j = i + 1; j < n; j++) {
        const pj = members[j];
        const dx = pi._mx - pj._mx;
        const dy = pi._my - pj._my;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > maxD) maxD = d;
      }
    }
    return maxD;
  }

  function refineClustersByDiameterSplit(clusters, dbscanEps, minPts) {
    let cur = clusters;
    for (let pass = 0; pass < SPLIT_REFINEMENT_PASSES; pass++) {
      const next = [];
      let anySplit = false;
      for (let ci = 0; ci < cur.length; ci++) {
        const cl = cur[ci];
        if (cl.members.length < SPLIT_MIN_MEMBERS_FOR_SPLIT) {
          next.push(cl);
          continue;
        }
        const diam = clusterMaxPairwiseDistanceM(cl.members);
        if (diam <= SPLIT_MAX_CLUSTER_DIAMETER_M) {
          next.push(cl);
          continue;
        }
        const subEps = Math.max(SPLIT_INNER_EPS_MIN_M, dbscanEps * SPLIT_INNER_EPS_FACTOR);
        const subMinPts = Math.min(minPts, Math.max(2, Math.min(3, Math.floor(cl.members.length / 4))));
        const subResult = dbscan(cl.members, subEps, subMinPts);
        const subClusters = [];
        for (let c = 0; c < subResult.nClusters; c++) {
          const mem = [];
          for (let i = 0; i < cl.members.length; i++) {
            if (subResult.labels[i] === c) mem.push(cl.members[i]);
          }
          if (mem.length >= 2) {
            subClusters.push({
              members: mem,
              sumPriority: mem.reduce((s, m) => s + m.edge.priority, 0)
            });
          }
        }
        if (subClusters.length >= 2) {
          for (let si = 0; si < subClusters.length; si++) next.push(subClusters[si]);
          anySplit = true;
        } else {
          next.push(cl);
        }
      }
      cur = next;
      if (!anySplit) break;
    }
    return cur;
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
      const px = p._mx;
      const py = p._my;
      for (let i = 0; i < n; i++) {
        const q = points[i];
        const dx = px - q._mx;
        const dy = py - q._my;
        if (dx * dx + dy * dy <= eps2) neighbors.push(i);
      }
      return neighbors;
    }

    for (let i = 0; i < n; i++) {
      if (labels[i] !== -1) continue;
      const neighbors = regionQuery(i);
      if (neighbors.length < minPts) {
        labels[i] = -2;
        continue;
      }
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

  function selectFieldSystems(edges, classified) {
    const db =
      classified.catalystDb ||
      CatalystSeamClusters.runCatalystDbscan(classified.activated, classified.critical);
    const { points, labels, nClusters, eps, minPts } = db;
    const result = { labels, nClusters };

    const clusters = [];
    for (let c = 0; c < result.nClusters; c++) {
      const members = [];
      for (let i = 0; i < points.length; i++) {
        if (result.labels[i] === c) members.push(points[i]);
      }
      if (members.length < 2) continue;
      const sumPriority = members.reduce((s, m) => s + m.edge.priority, 0);
      clusters.push({ id: c, members, sumPriority });
    }

    clusters.sort((a, b) => b.sumPriority - a.sumPriority);
    const expanded = refineClustersByDiameterSplit(clusters, eps, minPts);
    expanded.sort((a, b) => b.sumPriority - a.sumPriority);
    const topClusters = expanded.slice(0, MAX_FIELD_SYSTEMS);

    let totalPriority = 0;
    for (let ti = 0; ti < topClusters.length; ti++) totalPriority += topClusters[ti].sumPriority;
    if (totalPriority <= 1e-18) totalPriority = topClusters.length || 1;

    const fieldSystems = topClusters.map((cl, fi) => {
      const targetM2 = MAX_TOTAL_FIELD_AREA_M2 * (cl.sumPriority / totalPriority);
      const pair =
        typeof ClusterFieldCircles !== 'undefined'
          ? ClusterFieldCircles.circlePairFromMembers(cl.members, targetM2)
          : null;
      const cLat = pair
        ? pair.centerLat
        : cl.members.reduce((s, m) => s + m.lat, 0) / cl.members.length;
      const cLon = pair
        ? pair.centerLon
        : cl.members.reduce((s, m) => s + m.lon, 0) / cl.members.length;
      const rIn = pair ? pair.radiusInnerM : Math.sqrt(Math.max(targetM2, 1) / Math.PI);
      const rOut = pair ? pair.radiusOuterM : rIn;

      return {
        id: fi,
        members: cl.members,
        circleCenterLat: cLat,
        circleCenterLon: cLon,
        circleRadiusInnerM: rIn,
        circleRadiusOuterM: rOut,
        boundarySource: 'circle',
        areaM2: targetM2,
        areaHa: targetM2 / 10000,
        sumPriority: cl.sumPriority,
        targetM2,
        catalystEdges: cl.members.map((m) => m.edge)
      };
    });

    const corridorEdges = classified.corridorEdgeSet ? [...classified.corridorEdgeSet] : [];

    return {
      fieldSystems,
      corridorEdges,
      corridorPaths: classified.corridorPaths || [],
      eps,
      areaPlan: 'priority10ha',
      splitParams: {
        maxDiameterM: SPLIT_MAX_CLUSTER_DIAMETER_M,
        minMembers: SPLIT_MIN_MEMBERS_FOR_SPLIT,
        maxFields: MAX_FIELD_SYSTEMS
      }
    };
  }

  function runResourceDomainDbscan(domainEdges) {
    const sorted = [...domainEdges].sort(
      (a, b) => (Number(b.acPhysEff) || 0) - (Number(a.acPhysEff) || 0)
    );
    const topN = Math.min(sorted.length, Math.ceil(sorted.length * 0.25));
    const candidates = sorted.slice(
      0,
      Math.min(sorted.length, Math.max(topN, 20), MAX_DBSCAN_POINTS_RESOURCE)
    );
    const points = candidates.map((e, i) => ({ lat: e.midLat, lon: e.midLon, idx: i, edge: e }));
    let eps = 180;
    let minPts = 3;
    let result;
    for (let attempt = 0; attempt < 5; attempt++) {
      result = dbscan(points, eps, minPts);
      if (result.nClusters >= 2) break;
      eps += 60;
      if (minPts > 2) minPts--;
    }
    return {
      points,
      labels: result.labels,
      nClusters: result.nClusters,
      eps,
      minPts
    };
  }

  function membersFromDbscanLabels(db) {
    const clusters = [];
    for (let c = 0; c < db.nClusters; c++) {
      const members = [];
      for (let i = 0; i < db.points.length; i++) {
        if (db.labels[i] === c) members.push(db.points[i]);
      }
      if (members.length >= 2) {
        const sumPriority = members.reduce((s, m) => s + (Number(m.edge.acPhysEff) || 0), 0);
        clusters.push({ id: c, members, sumPriority });
      }
    }
    return clusters;
  }

  function fallbackResourceClusterFromEdges(domainEdges) {
    const cap = Math.min(domainEdges.length, MAX_DBSCAN_POINTS_RESOURCE);
    const sorted = [...domainEdges].sort(
      (a, b) => (Number(b.acPhysEff) || 0) - (Number(a.acPhysEff) || 0)
    );
    const members = sorted.slice(0, cap).map((e) => ({ lat: e.midLat, lon: e.midLon, edge: e }));
    if (members.length < 2) return null;
    const sumPriority = members.reduce((s, m) => s + (Number(m.edge.acPhysEff) || 0), 0);
    return { id: 0, members, sumPriority };
  }

  function selectResourceFieldSystems(edges) {
    const resourceEdges = edges.filter((e) => e.nodeType === 'resource');
    const flat = [];
    for (let di = 0; di < RESOURCE_DOM_ORDER.length; di++) {
      const domLabel = RESOURCE_DOM_ORDER[di];
      const domainEdges = resourceEdges.filter(
        (e) => e.resourceDom && e.resourceDom.label === domLabel
      );
      if (domainEdges.length < 2) continue;
      const db = runResourceDomainDbscan(domainEdges);
      let clusters = membersFromDbscanLabels(db);
      if (!clusters.length) {
        const fb = fallbackResourceClusterFromEdges(domainEdges);
        if (fb) clusters = [fb];
      }
      if (!clusters.length) continue;
      clusters.sort((a, b) => b.sumPriority - a.sumPriority);
      const expanded = refineClustersByDiameterSplit(clusters, db.eps, db.minPts);
      expanded.sort((a, b) => b.sumPriority - a.sumPriority);
      const picked = expanded
        .filter((c) => c.members && c.members.length >= 2)
        .slice(0, MAX_RESOURCE_CLUSTERS_PER_DOMAIN);
      const nPick = picked.length;
      for (let pi = 0; pi < nPick; pi++) {
        const cl = picked[pi];
        flat.push({
          domainLabel: domLabel,
          resourceClusterLabel: nPick > 1 ? `${domLabel}·${pi + 1}` : domLabel,
          members: cl.members,
          sumPriority: cl.sumPriority
        });
      }
    }
    let totalP = 0;
    for (let i = 0; i < flat.length; i++) totalP += flat[i].sumPriority;
    if (totalP <= 1e-18) totalP = flat.length || 1;
    const fieldSystems = flat.map((pd, fi) => {
      const targetM2 = MAX_TOTAL_RESOURCE_FIELD_AREA_M2 * (pd.sumPriority / totalP);
      const pair =
        typeof ClusterFieldCircles !== 'undefined'
          ? ClusterFieldCircles.circlePairFromMembers(pd.members, targetM2)
          : null;
      const cLat = pair
        ? pair.centerLat
        : pd.members.reduce((s, m) => s + m.lat, 0) / pd.members.length;
      const cLon = pair
        ? pair.centerLon
        : pd.members.reduce((s, m) => s + m.lon, 0) / pd.members.length;
      const rIn = pair ? pair.radiusInnerM : Math.sqrt(Math.max(targetM2, 1) / Math.PI);
      const rOut = pair ? pair.radiusOuterM : rIn;
      return {
        id: fi,
        domainLabel: pd.domainLabel,
        resourceClusterLabel: pd.resourceClusterLabel,
        members: pd.members,
        circleCenterLat: cLat,
        circleCenterLon: cLon,
        circleRadiusInnerM: rIn,
        circleRadiusOuterM: rOut,
        boundarySource: 'circle',
        areaM2: targetM2,
        areaHa: targetM2 / 10000,
        sumPriority: pd.sumPriority,
        targetM2,
        resourceEdges: pd.members.map((m) => m.edge)
      };
    });
    return { fieldSystems, areaPlan: 'resourceDom10ha' };
  }

  const g = typeof window !== 'undefined' ? window : globalThis;
  g.PRB_FieldSystemAlgo = {
    MAX_TOTAL_FIELD_AREA_M2,
    addEmpiricalPercentileRanks,
    vertPosFromActivatedEdges,
    classifyNodes,
    attachPlanarMetersXY,
    appendCircleCornerPoints,
    dbscan,
    refineClustersByDiameterSplit,
    selectFieldSystems,
    selectResourceFieldSystems,
    RESOURCE_DOM_ORDER
  };
  g.classifyNodes = classifyNodes;
  g.selectFieldSystems = selectFieldSystems;
  g.selectResourceFieldSystems = selectResourceFieldSystems;
  g.appendCircleCornerPoints = appendCircleCornerPoints;
})();
