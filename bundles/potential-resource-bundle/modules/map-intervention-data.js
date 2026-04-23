/**
 * 潜力/资源节点（五维 Wp 分轴 + Jenks），与 pages/map_intervention_nodes 一致。
 * 依赖：jenks-classification.js；d3（loadEdges）；window.ACDomAggregate；可选 xujiahui-osm-boundary。
 */
(function () {
  'use strict';

  const W_PERSONA_WEIGHTS_MAP = [
    [0.08, 0.18, 0.22, 0.05, 0.22, 0.05, 0.2],
    [0.32, 0.05, 0.1, 0.22, 0.08, 0.23, 0.0],
    [0.08, 0.2, 0.08, 0.32, 0.32, 0.0, 0.0],
    [0.12, 0.28, 0.25, 0.05, 0.3, 0.0, 0.0],
    [0.38, 0.05, 0.08, 0.08, 0.09, 0.32, 0.0]
  ];
  const WP_KEYS_MAP = ['Wp_elder', 'Wp_student', 'Wp_white', 'Wp_family', 'Wp_wander'];

  function gaussRand(mean, std) {
    let u = 0;
    let v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function rawFeatureTupleEdge(e) {
    const E = e.cpvi_E || 0;
    let S = e.cpvi_S;
    if (!Number.isFinite(S)) S = 0;
    S = Math.max(0, Math.min(1.5, S));
    const sInv = Math.max(0, Math.min(1, 1 - S / 1.2));
    const AC = Number.isFinite(e.acPhysEff) ? e.acPhysEff : e.cpvi_AC || 0;
    const N_UD = e.N_UD || 0;
    const N09 = e.N09 || 0;
    const N_CD = e.N_CD || 0;
    const N_OS = e.N_OS || 0;
    return [E, sInv, AC, N_UD, N09, N_CD, N_OS];
  }

  function extent7Edges(edges) {
    const lo = Array(7).fill(Infinity);
    const hi = Array(7).fill(-Infinity);
    edges.forEach((e) => {
      const t = rawFeatureTupleEdge(e);
      for (let j = 0; j < 7; j++) {
        const v = t[j];
        if (Number.isFinite(v)) {
          if (v < lo[j]) lo[j] = v;
          if (v > hi[j]) hi[j] = v;
        }
      }
    });
    for (let j = 0; j < 7; j++) {
      if (!Number.isFinite(lo[j]) || !Number.isFinite(hi[j])) {
        lo[j] = 0;
        hi[j] = 1;
      }
      if (hi[j] <= lo[j]) {
        lo[j] -= 1;
        hi[j] += 1;
      }
    }
    return { lo, hi };
  }

  function zFromTupleMap(t, lo, hi) {
    const z = [];
    for (let j = 0; j < 7; j++) {
      const v = t[j];
      const L = lo[j];
      const H = hi[j];
      if (!Number.isFinite(v) || H <= L) z[j] = 0.5;
      else z[j] = Math.max(0, Math.min(1, (v - L) / (H - L)));
    }
    return z;
  }

  function dot7Map(w, z) {
    let s = 0;
    for (let j = 0; j < 7; j++) s += w[j] * z[j];
    return s;
  }

  function addEmpiricalPercentileRanksMap(edges) {
    const n = edges.length;
    if (!n) return;
    const { lo, hi } = extent7Edges(edges);
    edges.forEach((e) => {
      const t = rawFeatureTupleEdge(e);
      const z = zFromTupleMap(t, lo, hi);
      for (let k = 0; k < 5; k++) e[WP_KEYS_MAP[k]] = dot7Map(W_PERSONA_WEIGHTS_MAP[k], z);
    });
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
    ranksFor((e) => e.Wp_elder, 'p_elder');
    ranksFor((e) => e.Wp_student, 'p_student');
    ranksFor((e) => e.Wp_white, 'p_white');
    ranksFor((e) => e.Wp_family, 'p_family');
    ranksFor((e) => e.Wp_wander, 'p_wander');
  }

  function estimateNodePositions(rawEdges) {
    const nodes = new Set();
    rawEdges.forEach((r) => {
      nodes.add(r.u);
      nodes.add(r.v);
    });
    const sum = {};
    const cnt = {};
    nodes.forEach((n) => {
      sum[n] = [0, 0];
      cnt[n] = 0;
    });
    rawEdges.forEach((r) => {
      const mx = r.lon;
      const my = r.lat;
      [r.u, r.v].forEach((id) => {
        sum[id][0] += mx;
        sum[id][1] += my;
        cnt[id]++;
      });
    });
    const pos = {};
    nodes.forEach((n) => {
      pos[n] = { lon: sum[n][0] / cnt[n], lat: sum[n][1] / cnt[n] };
    });
    const iters = rawEdges.length > 12000 ? 14 : 32;
    for (let iter = 0; iter < iters; iter++) {
      rawEdges.forEach((r) => {
        const mx = r.lon;
        const my = r.lat;
        pos[r.u].lon = 2 * mx - pos[r.v].lon;
        pos[r.u].lat = 2 * my - pos[r.v].lat;
      });
    }
    return pos;
  }

  function buildEdgesFromCsvRows(rows) {
    const raw = rows.map((r) => ({
      u: String(r.u),
      v: String(r.v),
      lon: +r.lon,
      lat: +r.lat,
      cpvi_E: +r.cpvi_E || +r.csvi_E || 0,
      cpvi_S: Number.isFinite(+r.cpvi_S)
        ? +r.cpvi_S
        : (+r.csvi_S_env || 0) + (+r.csvi_S_contact || 0),
      cpvi_AC: Number.isFinite(+r.cpvi_AC) ? +r.cpvi_AC : +r.csvi_AC_phys || 0,
      AC_traf_dom: r.AC_traf_dom,
      AC_tech_dom: r.AC_tech_dom,
      AC_mkt_dom: r.AC_mkt_dom,
      AC_sport_dom: r.AC_sport_dom,
      AC_soc_cul_dom: r.AC_soc_cul_dom,
      AC_med_dom: r.AC_med_dom,
      N_UD: +r.N_UD || +r.pop_total || 0,
      N09: +r.N09 || +r.N08 || 0,
      N_CD: +r.N_CD || 0,
      N_OS: +r.N_OS || 0,
      priority: +r.priority
    }));
    const pos = estimateNodePositions(raw);
    const agg = window.ACDomAggregate;
    return raw.map((r) => {
      const from = pos[r.u];
      const to = pos[r.v];
      const midLon = (from.lon + to.lon) / 2;
      const midLat = (from.lat + to.lat) / 2;
      const acPhysEff = agg.effectiveAcPhys(r);
      const resourceDom = agg.resourceDomType(r);
      const W_urban = r.cpvi_E * (acPhysEff + 1);
      const W_work = Math.max(0, r.N_UD * r.N09);
      return {
        u: r.u,
        v: r.v,
        from,
        to,
        midLon,
        midLat,
        cpvi_E: r.cpvi_E,
        cpvi_S: r.cpvi_S,
        cpvi_AC: r.cpvi_AC,
        csvi_AC_phys: r.cpvi_AC,
        AC_traf_dom: r.AC_traf_dom,
        AC_med_dom: r.AC_med_dom,
        AC_tech_dom: r.AC_tech_dom,
        AC_mkt_dom: r.AC_mkt_dom,
        AC_sport_dom: r.AC_sport_dom,
        AC_soc_cul_dom: r.AC_soc_cul_dom,
        acPhysEff,
        resourceDom,
        N_UD: r.N_UD,
        N09: r.N09,
        N_CD: r.N_CD,
        N_OS: r.N_OS,
        priority: r.priority,
        W_elder: W_urban,
        W_work: W_work
      };
    });
  }

  function simulateEdges() {
    const centerLon = 121.438;
    const centerLat = 31.195;
    const spread = 0.018;
    const gridSize = 28;
    const nodes = {};
    let nid = 0;
    for (let i = 0; i < gridSize; i++) {
      for (let j = 0; j < gridSize; j++) {
        nodes[nid] = {
          lon: centerLon - spread + (i / gridSize) * spread * 2 + gaussRand(0, 0.0003),
          lat: centerLat - spread + (j / gridSize) * spread * 2 + gaussRand(0, 0.00025),
          id: nid
        };
        nid++;
      }
    }
    const edges = [];
    for (let i = 0; i < gridSize; i++) {
      for (let j = 0; j < gridSize; j++) {
        const id = i * gridSize + j;
        if (j < gridSize - 1 && Math.random() > 0.06) edges.push({ u: id, v: i * gridSize + j + 1 });
        if (i < gridSize - 1 && Math.random() > 0.06) edges.push({ u: id, v: (i + 1) * gridSize + j });
      }
    }
    edges.forEach((e) => {
      const n1 = nodes[e.u];
      const n2 = nodes[e.v];
      e.midLon = (n1.lon + n2.lon) / 2;
      e.midLat = (n1.lat + n2.lat) / 2;
      e.from = n1;
      e.to = n2;
      const dx = e.midLon - centerLon;
      const dy = e.midLat - centerLat;
      const distC = Math.sqrt(dx * dx + dy * dy) / spread;
      const dSW = Math.sqrt(
        Math.pow(e.midLon - (centerLon - 0.008), 2) + Math.pow(e.midLat - (centerLat - 0.006), 2)
      );
      const proxSW = Math.max(0, 1 - dSW / 0.008);
      const dSE = Math.sqrt(
        Math.pow(e.midLon - (centerLon + 0.007), 2) + Math.pow(e.midLat - (centerLat - 0.004), 2)
      );
      const proxSE = Math.max(0, 1 - dSE / 0.007);
      const proxCenter = Math.max(0, 1 - distC * 1.5);
      e.cpvi_E = Math.max(0.05, Math.min(0.95, gaussRand(0.35 + proxSW * 0.3 + proxCenter * 0.2, 0.1)));
      e.cpvi_S = Math.max(0, Math.min(0.5, gaussRand(0.18 + proxSE * 0.15, 0.06)));
      e.N_UD = Math.max(0.1, Math.min(0.9, gaussRand(0.45 + proxSE * 0.25 + proxCenter * 0.1, 0.08)));
      e.N09 = Math.max(0, Math.min(1, gaussRand(0.48, 0.14)));
      e.N_CD = Math.max(0, Math.min(1, gaussRand(0.22 + proxSW * 0.2, 0.1)));
      e.N_OS = Math.max(0, Math.min(1, gaussRand(0.32 + proxCenter * 0.1, 0.12)));
      const dPark1 = Math.sqrt(
        Math.pow(e.midLon - (centerLon - 0.005), 2) + Math.pow(e.midLat - (centerLat + 0.006), 2)
      );
      const parkProx = Math.max(0, 1 - dPark1 / 0.006);
      const corridorDist = Math.abs(e.midLat - (centerLat - 0.005));
      const inCorridor =
        corridorDist < 0.003 && e.midLon > centerLon - 0.01 && e.midLon < centerLon + 0.01;
      e.cpvi_AC = Math.max(
        0.001,
        Math.min(0.3, gaussRand(0.04 + parkProx * 0.15 - (inCorridor ? 0.03 : 0), 0.025))
      );
      e.csvi_AC_phys = e.cpvi_AC;
      const b = e.cpvi_AC;
      e.AC_traf_dom = Math.max(0.001, Math.min(0.35, b * gaussRand(1, 0.12)));
      e.AC_tech_dom = Math.max(0.001, Math.min(0.35, b * gaussRand(1, 0.12)));
      e.AC_mkt_dom = Math.max(0.001, Math.min(0.35, b * gaussRand(1, 0.12)));
      e.AC_sport_dom = Math.max(0.001, Math.min(0.35, b * gaussRand(1, 0.12)));
      e.AC_soc_cul_dom = Math.max(0.001, Math.min(0.35, b * gaussRand(1, 0.12)));
      e.priority = Math.max(0, Math.min(1, (e.cpvi_E * e.cpvi_S) / Math.max(0.001, e.cpvi_AC + 0.01)));
      e.priority = Math.min(1, e.priority / 10);
      e.acPhysEff = window.ACDomAggregate.effectiveAcPhys(e);
      e.resourceDom = window.ACDomAggregate.resourceDomType(e);
      e.W_elder = e.cpvi_E * (e.acPhysEff + 1);
      e.W_work = Math.max(0, e.N_UD * e.N09);
    });
    return edges;
  }

  function getMapCsvUrl() {
    const g = typeof window !== 'undefined' ? window : globalThis;
    if (g.PRB_MAP_CSV_URL) return String(g.PRB_MAP_CSV_URL);
    return '../../data/cld_priority.csv';
  }

  async function loadEdgesMapIntervention() {
    const CSV_FILENAME = getMapCsvUrl();
    try {
      const rows = await d3.csv(CSV_FILENAME, { cache: 'no-store' }, d3.autoType);
      if (!rows || !rows.length) throw new Error('CSV 为空');
      const hasPriority = rows[0].priority !== undefined;
      const hasE = rows[0].cpvi_E !== undefined || rows[0].csvi_E !== undefined;
      if (!hasPriority || !hasE) {
        throw new Error('CSV 列不匹配（需要 priority、cpvi_E/csvi_E、N_UD/N09；建议含 N_CD、N_OS）');
      }
      return buildEdgesFromCsvRows(rows);
    } catch (err) {
      const why = err && err.message ? err.message : String(err);
      console.warn('未加载 ' + CSV_FILENAME + '，使用内置模拟数据。原因: ' + why);
      return simulateEdges();
    }
  }

  function takeTopFractionByMetric(arr, metricFn, frac) {
    const n = arr.length;
    if (!n) return [];
    const k = Math.max(1, Math.ceil(n * frac));
    return [...arr].sort((a, b) => metricFn(b) - metricFn(a)).slice(0, k);
  }

  function takeTopFractionPerResourceDom(arr, frac) {
    const base =
      (window.ACDomAggregate && window.ACDomAggregate.DOM_KEYS) || [
        'AC_traf_dom',
        'AC_tech_dom',
        'AC_mkt_dom',
        'AC_sport_dom',
        'AC_soc_cul_dom'
      ];
    const keys = Array.from(new Set([...base, 'AC_med_dom']));
    const out = [];
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const sub = arr.filter((e) => e.resourceDom && e.resourceDom.key === key);
      const top = takeTopFractionByMetric(sub, (e) => e.resourceDom.max, frac);
      for (let j = 0; j < top.length; j++) out.push(top[j]);
    }
    return out;
  }

  function anyPersonaJenksHigh(e) {
    return (
      e.perClass_elder === 2 ||
      e.perClass_student === 2 ||
      e.perClass_white === 2 ||
      e.perClass_family === 2 ||
      e.perClass_wander === 2
    );
  }

  const NODE_MARKER_POTENTIAL_TOP_FRAC = 0.5;
  const NODE_MARKER_RESOURCE_TOP_FRAC = 0.1;

  /**
   * @param {object[]} edges
   * @returns {Promise<object>}
   */
  async function computeMapInterventionLayers(edges) {
    addEmpiricalPercentileRanksMap(edges);
    const priorityValues = edges.map((e) => e.priority);
    const csviBreaks = getClassificationBreaks(priorityValues, 3);
    const breaksElder = getClassificationBreaks(
      edges.map((e) => e.p_elder),
      3
    );
    const breaksStudent = getClassificationBreaks(
      edges.map((e) => e.p_student),
      3
    );
    const breaksWhite = getClassificationBreaks(
      edges.map((e) => e.p_white),
      3
    );
    const breaksFamily = getClassificationBreaks(
      edges.map((e) => e.p_family),
      3
    );
    const breaksWander = getClassificationBreaks(
      edges.map((e) => e.p_wander),
      3
    );

    edges.forEach((e) => {
      e.csviClass = classifyJenks(e.priority, csviBreaks);
      e.perClass_elder = classifyJenks(e.p_elder, breaksElder);
      e.perClass_student = classifyJenks(e.p_student, breaksStudent);
      e.perClass_white = classifyJenks(e.p_white, breaksWhite);
      e.perClass_family = classifyJenks(e.p_family, breaksFamily);
      e.perClass_wander = classifyJenks(e.p_wander, breaksWander);
    });

    const activatedEdges = [];
    edges.forEach((e) => {
      if (e.csviClass === 2 && anyPersonaJenksHigh(e)) {
        e.nodeType = 'act_potential';
        activatedEdges.push(e);
        return;
      }
      e.nodeType = null;
    });

    const studyGeom =
      typeof getDaxujiahuiBoundaryGeometry === 'function'
        ? await getDaxujiahuiBoundaryGeometry()
        : null;
    const edgeMidInStudy = (e) =>
      typeof pointInDaxujiahuiGeometry === 'function'
        ? pointInDaxujiahuiGeometry(e.midLon, e.midLat, studyGeom)
        : true;
    const activatedInStudy = activatedEdges.filter(edgeMidInStudy);
    const resourceCandidatesInStudy = edges.filter(
      (e) => e.nodeType == null && e.resourceDom && edgeMidInStudy(e)
    );

    const activatedDrawList = takeTopFractionByMetric(
      activatedInStudy,
      (e) => e.priority,
      NODE_MARKER_POTENTIAL_TOP_FRAC
    );
    const resourceDrawList = takeTopFractionPerResourceDom(
      resourceCandidatesInStudy,
      NODE_MARKER_RESOURCE_TOP_FRAC
    );
    resourceDrawList.forEach((e) => {
      e.nodeType = 'resource';
    });

    const networkEdgesInStudy = [];
    for (let i = 0; i < edges.length; i++) {
      if (edgeMidInStudy(edges[i])) networkEdgesInStudy.push(edges[i]);
    }

    return {
      edges,
      activatedDrawList,
      resourceDrawList,
      activatedInStudy,
      resourceCandidatesInStudy,
      networkEdgesInStudy,
      edgeMidInStudy
    };
  }

  const g = typeof window !== 'undefined' ? window : globalThis;
  g.PRB_MapInterventionData = {
    buildEdgesFromCsvRows,
    simulateEdges,
    loadEdgesMapIntervention,
    computeMapInterventionLayers,
    NODE_MARKER_POTENTIAL_TOP_FRAC,
    NODE_MARKER_RESOURCE_TOP_FRAC
  };
})();
