/**
 * 瓶颈（边级）与廊道（簇间路径）共用：归一化边长 + 显式 b(e) 凸组合、
 * 簇接口 T_k = 几何 medoid 顶点；簇对 = 互为最近邻 + 不连通分量最小桥接（图距上限）；
 * 廊道 = w=α·l̂+β·(1−b) 的 Dijkstra，顺序求路并对已用边加占用惩罚。
 * 依赖：CatalystSeamClusters（同目录先加载）。
 */
const CorridorBottleneck = (function () {
  const ALPHA_LEN = 0.55;
  const BETA_BENEFIT = 0.45;
  const W_PRI = 0.45;
  const W_SEAM = 0.35;
  const W_AC = 0.2;
  const BOTTLENECK_B_MIN = 0.42;
  const CORRIDOR_OVERLAP_GAMMA = 0.35;
  /** 簇对桥接：超过该跳数视为不连（避免大图上次优桥过长） */
  const BRIDGE_MAX_HOPS = 260;

  function haversineM(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function edgeLengthM(ev) {
    return haversineM(ev.from.lat, ev.from.lon, ev.to.lat, ev.to.lon);
  }

  function buildAdjWithEdges(allEdges) {
    const adj = new Map();
    for (let i = 0; i < allEdges.length; i++) {
      const ev = allEdges[i];
      const u = ev.u;
      const v = ev.v;
      if (!adj.has(u)) adj.set(u, []);
      if (!adj.has(v)) adj.set(v, []);
      adj.get(u).push({ nb: v, edge: ev });
      adj.get(v).push({ nb: u, edge: ev });
    }
    return adj;
  }

  class MinHeap {
    constructor() {
      this.a = [];
    }
    push(key, dist) {
      this.a.push({ key, dist });
      this._up(this.a.length - 1);
    }
    pop() {
      const n = this.a.length;
      if (!n) return null;
      const top = this.a[0];
      if (n === 1) {
        this.a.pop();
        return top;
      }
      this.a[0] = this.a.pop();
      this._down(0);
      return top;
    }
    empty() {
      return this.a.length === 0;
    }
    _up(i) {
      const a = this.a;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (a[p].dist <= a[i].dist) break;
        const t = a[p];
        a[p] = a[i];
        a[i] = t;
        i = p;
      }
    }
    _down(i) {
      const a = this.a;
      const n = a.length;
      for (;;) {
        let m = i;
        const l = i * 2 + 1;
        const r = l + 1;
        if (l < n && a[l].dist < a[m].dist) m = l;
        if (r < n && a[r].dist < a[m].dist) m = r;
        if (m === i) break;
        const t = a[m];
        a[m] = a[i];
        a[i] = t;
        i = m;
      }
    }
  }

  /**
   * 单目标 Dijkstra（sources 通常 1 个）。边权须非负。
   */
  function dijkstraToTarget(adj, sources, target, edgeWeight) {
    const dist = new Map();
    const parent = new Map();
    const heap = new MinHeap();
    const sourceSet = new Set(sources);
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i];
      dist.set(s, 0);
      heap.push(s, 0);
    }
    while (!heap.empty()) {
      const { key: u, dist: du } = heap.pop();
      if (du !== dist.get(u)) continue;
      if (u === target) break;
      const outs = adj.get(u);
      if (!outs) continue;
      for (let k = 0; k < outs.length; k++) {
        const { nb, edge } = outs[k];
        const w = edgeWeight(edge);
        const nd = du + w;
        if (!dist.has(nb) || nd < dist.get(nb)) {
          dist.set(nb, nd);
          parent.set(nb, { prev: u, edge });
          heap.push(nb, nd);
        }
      }
    }
    if (!dist.has(target)) return null;
    const edges = [];
    let u = target;
    while (parent.has(u)) {
      const p = parent.get(u);
      edges.push(p.edge);
      u = p.prev;
    }
    edges.reverse();
    const dm = dist.get(target) || 0;
    return { edges, distM: sourceSet.has(target) ? 0 : dm };
  }

  /** 无权最短路跳数，用于簇间最近邻/桥接（快） */
  function shortestHopCount(adj, src, tgt) {
    if (src === tgt) return 0;
    const q = [src];
    const seen = new Map([[src, 0]]);
    for (let qi = 0; qi < q.length; qi++) {
      const u = q[qi];
      const d = seen.get(u);
      const outs = adj.get(u);
      if (!outs) continue;
      for (let k = 0; k < outs.length; k++) {
        const nb = outs[k].nb;
        if (seen.has(nb)) continue;
        if (nb === tgt) return d + 1;
        seen.set(nb, d + 1);
        q.push(nb);
      }
    }
    return Infinity;
  }

  function maxEdgeLenM(allEdges) {
    let m = 1e-9;
    for (let i = 0; i < allEdges.length; i++) {
      const L = edgeLengthM(allEdges[i]);
      if (L > m) m = L;
    }
    return m;
  }

  function normPriorityAll(edges) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < edges.length; i++) {
      const p = edges[i].priority;
      if (p < lo) lo = p;
      if (p > hi) hi = p;
    }
    const span = hi - lo || 1;
    return (e) => (e.priority - lo) / span;
  }

  /**
   * b(e) = W_PRI·nPri + W_SEAM·1_seam + W_AC·vulnAC
   * vulnAC：≤全域中位为 1，否则线性降至 0（至 95 分位 AC）
   */
  function buildBenefit01(edges, seamSet, acPhys50, nPriFn, acP95) {
    const map = new Map();
    const span = Math.max(acP95 - acPhys50, 1e-12);
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const nPri = nPriFn(e);
      const seam01 = seamSet.has(e) ? 1 : 0;
      let vuln = 1;
      if (e.csvi_AC_phys > acPhys50) {
        vuln = Math.max(0, 1 - (e.csvi_AC_phys - acPhys50) / span);
      }
      let b = W_PRI * nPri + W_SEAM * seam01 + W_AC * vuln;
      if (b > 1) b = 1;
      map.set(e, b);
    }
    return map;
  }

  function vertexPosFromCluster(clusterPoints, vid) {
    for (let i = 0; i < clusterPoints.length; i++) {
      const ev = clusterPoints[i].edge;
      if (ev.u === vid) return ev.from;
      if (ev.v === vid) return ev.to;
    }
    return null;
  }

  function clusterVertexSet(clusterPoints) {
    const s = new Set();
    for (let i = 0; i < clusterPoints.length; i++) {
      const ev = clusterPoints[i].edge;
      s.add(ev.u);
      s.add(ev.v);
    }
    return s;
  }

  /**
   * 几何 medoid：顶点到簇内各触媒边中点距离和最小。
   * @param {Array<{edge:*}>} clusterPoints
   * @param {{ centerLat: number, centerLon: number, radiusM: number }|null|undefined} circle 若给定则只考虑圆内路口（米制 haversine）
   */
  /**
   * 圆内无任一簇内路口时，逐步放大搜索半径（仍无则退回全顶点，避免断图）。
   */
  function geometricMedoidVertex(clusterPoints, circle) {
    let verts = [...clusterVertexSet(clusterPoints)];
    if (!verts.length) return null;
    if (
      circle &&
      circle.radiusM > 0 &&
      Number.isFinite(circle.centerLat) &&
      Number.isFinite(circle.centerLon)
    ) {
      let r = circle.radiusM;
      const rCap = Math.max(circle.radiusM * 6, 2800);
      let filtered = [];
      while (r <= rCap) {
        filtered = verts.filter((vid) => {
          const pos = vertexPosFromCluster(clusterPoints, vid);
          if (!pos) return false;
          return haversineM(pos.lat, pos.lon, circle.centerLat, circle.centerLon) <= r;
        });
        if (filtered.length) break;
        r *= 1.38;
      }
      if (filtered.length) verts = filtered;
    }
    let best = null;
    let bestSum = Infinity;
    for (let vi = 0; vi < verts.length; vi++) {
      const vid = verts[vi];
      const pos = vertexPosFromCluster(clusterPoints, vid);
      if (!pos) continue;
      let sum = 0;
      for (let j = 0; j < clusterPoints.length; j++) {
        const ev = clusterPoints[j].edge;
        sum += haversineM(pos.lat, pos.lon, ev.midLat, ev.midLon);
      }
      if (sum < bestSum) {
        bestSum = sum;
        best = vid;
      }
    }
    return best;
  }

  function extractClustersFromDb(db, clusterCirclesByClusterLabel) {
    const { points, labels } = db;
    const by = new Map();
    for (let i = 0; i < points.length; i++) {
      const lab = labels[i];
      if (lab < 0) continue;
      if (!by.has(lab)) by.set(lab, []);
      by.get(lab).push(points[i]);
    }
    const out = [];
    by.forEach((pts, lab) => {
      if (pts.length < 2) return;
      const circ =
        clusterCirclesByClusterLabel && clusterCirclesByClusterLabel.get
          ? clusterCirclesByClusterLabel.get(lab)
          : null;
      out.push({ id: lab, points: pts, medoid: geometricMedoidVertex(pts, circ || null) });
    });
    out.sort((a, b) => a.id - b.id);
    return out;
  }

  /** 簇间跳数矩阵（仅用于选对与桥接，不重跑加权 Dijkstra） */
  function clusterHopMatrix(adj, clusters) {
    const n = clusters.length;
    const H = Array.from({ length: n }, () => new Float64Array(n));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          H[i][j] = 0;
          continue;
        }
        const mi = clusters[i].medoid;
        const mj = clusters[j].medoid;
        if (mi == null || mj == null) {
          H[i][j] = Infinity;
          continue;
        }
        H[i][j] = shortestHopCount(adj, mi, mj);
      }
    }
    return H;
  }

  function mutualNearestPairs(n, H) {
    const pairs = [];
    const nn = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      let best = -1;
      let bd = Infinity;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const d = H[i][j];
        if (d < bd) {
          bd = d;
          best = j;
        }
      }
      nn[i] = best;
    }
    const seen = new Set();
    for (let i = 0; i < n; i++) {
      const j = nn[i];
      if (j < 0) continue;
      if (!Number.isFinite(H[i][j])) continue;
      if (nn[j] !== i) continue;
      const a = Math.min(i, j);
      const b = Math.max(i, j);
      const key = a + ':' + b;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([a, b]);
    }
    return pairs;
  }

  function unionFind(n) {
    const p = new Int32Array(n);
    for (let i = 0; i < n; i++) p[i] = i;
    function find(x) {
      while (p[x] !== x) x = p[x] = p[p[x]];
      return x;
    }
    function unite(a, b) {
      a = find(a);
      b = find(b);
      if (a === b) return false;
      p[a] = b;
      return true;
    }
    return { find, unite };
  }

  /** mutual 边先并入；若不连通则加跨分量最短「跳数」边，跳数 ≤ BRIDGE_MAX_HOPS */
  function expandPairsForConnectivity(n, H, basePairs) {
    const uf = unionFind(n);
    const out = [...basePairs];
    for (let k = 0; k < out.length; k++) {
      uf.unite(out[k][0], out[k][1]);
    }
    for (;;) {
      const roots = new Set();
      for (let i = 0; i < n; i++) roots.add(uf.find(i));
      if (roots.size <= 1) break;
      const rootArr = [...roots];
      let bestI = -1;
      let bestJ = -1;
      let bestH = Infinity;
      for (let a = 0; a < rootArr.length; a++) {
        for (let b = a + 1; b < rootArr.length; b++) {
          const ra = rootArr[a];
          const rb = rootArr[b];
          for (let i = 0; i < n; i++) {
            if (uf.find(i) !== ra) continue;
            for (let j = 0; j < n; j++) {
              if (uf.find(j) !== rb) continue;
              const h = H[i][j];
              if (!Number.isFinite(h) || h > BRIDGE_MAX_HOPS) continue;
              if (h < bestH) {
                bestH = h;
                bestI = i;
                bestJ = j;
              }
            }
          }
        }
      }
      if (bestI < 0) break;
      out.push([bestI, bestJ]);
      uf.unite(bestI, bestJ);
    }
    return out;
  }

  function edgePenaltyKey(ev) {
    return ev.u < ev.v ? ev.u + '\0' + ev.v : ev.v + '\0' + ev.u;
  }

  /**
   * bottleneckEdges：若廊道边集非空，取「廊道上的边」∩ AC≤中位 ∩ b≥τ；否则接缝∩同条件。
   * @returns {{ bottleneckEdges: Edge[], corridorPaths: Array<{i,j,edges:Edge[]}>, corridorEdgeSet: Set, benefit01: Map }}
   */
  function compute(opts) {
    const {
      edges,
      activatedEdges,
      criticalEdges,
      vertPos,
      connectorSeamSet,
      acPhys50,
      catalystDb,
      clusterCirclesByClusterLabel
    } = opts;

    const empty = {
      bottleneckEdges: [],
      corridorPaths: [],
      corridorEdgeSet: new Set(),
      benefit01: new Map()
    };

    if (!edges || !edges.length) return empty;

    const acSorted = edges.map((e) => e.csvi_AC_phys).sort((a, b) => a - b);
    const acP95 = acSorted[Math.min(acSorted.length - 1, Math.floor(acSorted.length * 0.95))] || acPhys50;

    const nPriFn = normPriorityAll(edges);
    const seamSet = connectorSeamSet || new Set();
    const benefit01 = buildBenefit01(edges, seamSet, acPhys50, nPriFn, acP95);

    const seamBasedBottleneck = [];
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      if (e.nodeType) continue;
      if (!seamSet.has(e)) continue;
      if (e.csvi_AC_phys > acPhys50) continue;
      const b = benefit01.get(e) || 0;
      if (b < BOTTLENECK_B_MIN) continue;
      seamBasedBottleneck.push(e);
    }

    const db =
      catalystDb ||
      CatalystSeamClusters.runCatalystDbscan(activatedEdges, criticalEdges);
    const clusters = extractClustersFromDb(db, clusterCirclesByClusterLabel || null);
    const corridorPaths = [];
    const corridorEdgeSet = new Set();

    if (clusters.length < 2) {
      return {
        bottleneckEdges: seamBasedBottleneck,
        corridorPaths,
        corridorEdgeSet,
        benefit01
      };
    }

    const adj = buildAdjWithEdges(edges);
    const maxLen = maxEdgeLenM(edges);
    const H = clusterHopMatrix(adj, clusters);
    const n = clusters.length;
    let pairs = mutualNearestPairs(n, H);
    pairs = expandPairsForConnectivity(n, H, pairs);

    pairs.sort((a, b) => {
      const ha = H[a[0]][a[1]];
      const hb = H[b[0]][b[1]];
      return ha - hb;
    });

    const penalty = new Map();
    const lHat = (e) => edgeLengthM(e) / maxLen;

    for (let pi = 0; pi < pairs.length; pi++) {
      const [ci, cj] = pairs[pi];
      const sa = clusters[ci].medoid;
      const sb = clusters[cj].medoid;
      if (sa == null || sb == null) continue;
      const hPair = H[ci][cj];
      if (!Number.isFinite(hPair) || hPair > BRIDGE_MAX_HOPS) continue;

      const weightFn = (e) => {
        const b = benefit01.get(e) || 0;
        const pen = penalty.get(edgePenaltyKey(e)) || 0;
        const mult = 1 + CORRIDOR_OVERLAP_GAMMA * pen;
        return (ALPHA_LEN * lHat(e) + BETA_BENEFIT * (1 - b)) * mult;
      };

      const res = dijkstraToTarget(adj, [sa], sb, weightFn);
      if (!res || !res.edges.length) continue;

      corridorPaths.push({
        i: clusters[ci].id,
        j: clusters[cj].id,
        medoidA: sa,
        medoidB: sb,
        edges: res.edges
      });
      for (let ei = 0; ei < res.edges.length; ei++) {
        const e = res.edges[ei];
        const k = edgePenaltyKey(e);
        penalty.set(k, (penalty.get(k) || 0) + 1);
        corridorEdgeSet.add(e);
      }
    }

    let bottleneckEdges = seamBasedBottleneck;
    if (corridorEdgeSet.size > 0) {
      const onCorridor = [];
      corridorEdgeSet.forEach((e) => {
        if (e.nodeType) return;
        if (e.csvi_AC_phys > acPhys50) return;
        const b = benefit01.get(e) || 0;
        if (b < BOTTLENECK_B_MIN) return;
        onCorridor.push(e);
      });
      if (onCorridor.length > 0) bottleneckEdges = onCorridor;
    }

    return { bottleneckEdges, corridorPaths, corridorEdgeSet, benefit01 };
  }

  return {
    compute,
    constants: {
      ALPHA_LEN,
      BETA_BENEFIT,
      W_PRI,
      W_SEAM,
      W_AC,
      BOTTLENECK_B_MIN,
      CORRIDOR_OVERLAP_GAMMA,
      BRIDGE_MAX_HOPS
    }
  };
})();
