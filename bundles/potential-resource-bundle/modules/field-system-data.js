/**
 * 场域选址页用边表：CSV（旧 csvsi_* 列）或模拟网格。
 * 依赖：d3（loadEdges）、window.ACDomAggregate（simulate / CSV 行上的 acPhysEff、resourceDom）。
 */
(function () {
  'use strict';

  function gaussRand(mean, std) {
    let u = 0;
    let v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
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
    const iters = rawEdges.length > 12000 ? 8 : 24;
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
      csvi_E: +r.csvi_E,
      csvi_S_env: +r.csvi_S_env,
      csvi_S_contact: +r.csvi_S_contact,
      csvi_AC_phys: +r.csvi_AC_phys,
      csvi_AC_social: +r.csvi_AC_social,
      N_YP: +r.N_YP,
      N08: +r.N08,
      priority: +r.priority,
      AC_med_dom: r.AC_med_dom,
      AC_tech_dom: r.AC_tech_dom,
      AC_mkt_dom: r.AC_mkt_dom,
      AC_sport_dom: r.AC_sport_dom,
      AC_soc_cul_dom: r.AC_soc_cul_dom
    }));
    const pos = estimateNodePositions(raw);
    return raw.map((r) => {
      const from = pos[r.u];
      const to = pos[r.v];
      const midLon = (from.lon + to.lon) / 2;
      const midLat = (from.lat + to.lat) / 2;
      const sTotal = r.csvi_S_env + r.csvi_S_contact;
      const rowForAc = {
        csvi_AC_phys: r.csvi_AC_phys,
        AC_med_dom: r.AC_med_dom,
        AC_tech_dom: r.AC_tech_dom,
        AC_mkt_dom: r.AC_mkt_dom,
        AC_sport_dom: r.AC_sport_dom,
        AC_soc_cul_dom: r.AC_soc_cul_dom
      };
      let acPhysEff = r.csvi_AC_phys;
      let resourceDom = null;
      if (typeof window !== 'undefined' && window.ACDomAggregate) {
        acPhysEff = window.ACDomAggregate.effectiveAcPhys(rowForAc);
        resourceDom = window.ACDomAggregate.resourceDomType(rowForAc);
      }
      return {
        u: r.u,
        v: r.v,
        from,
        to,
        midLon,
        midLat,
        csvi_E: r.csvi_E,
        csvi_S_env: r.csvi_S_env,
        csvi_S_contact: r.csvi_S_contact,
        csvi_AC_phys: r.csvi_AC_phys,
        csvi_AC_social: r.csvi_AC_social,
        N_YP: r.N_YP,
        N08: r.N08,
        priority: r.priority,
        AC_med_dom: r.AC_med_dom,
        AC_tech_dom: r.AC_tech_dom,
        AC_mkt_dom: r.AC_mkt_dom,
        AC_sport_dom: r.AC_sport_dom,
        AC_soc_cul_dom: r.AC_soc_cul_dom,
        acPhysEff,
        resourceDom,
        W_elder: r.csvi_E * (acPhysEff + 1),
        W_work: Math.max(0, (+r.N_YP || 0) * (+r.N08 || 0)),
        S_contact_ratio: sTotal > 0 ? r.csvi_S_contact / sTotal : 0
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

      e.csvi_E = Math.max(0.05, Math.min(0.95, gaussRand(0.35 + proxSW * 0.3 + proxCenter * 0.2, 0.1)));
      e.csvi_S_env = Math.max(0, Math.min(0.4, gaussRand(0.08, 0.03)));
      e.csvi_S_contact = Math.max(0, Math.min(0.8, gaussRand(0.35 + proxSE * 0.2, 0.08)));
      e.N_YP = Math.max(0.1, Math.min(0.9, gaussRand(0.45 + proxSE * 0.25 + proxCenter * 0.1, 0.08)));
      e.N08 = Math.max(0, Math.min(1, gaussRand(0.48, 0.14)));

      const dPark1 = Math.sqrt(
        Math.pow(e.midLon - (centerLon - 0.005), 2) + Math.pow(e.midLat - (centerLat + 0.006), 2)
      );
      const parkProx = Math.max(0, 1 - dPark1 / 0.006);
      const corridorDist = Math.abs(e.midLat - (centerLat - 0.005));
      const inCorridor =
        corridorDist < 0.003 && e.midLon > centerLon - 0.01 && e.midLon < centerLon + 0.01;
      e.csvi_AC_phys = Math.max(
        0.001,
        Math.min(0.3, gaussRand(0.04 + parkProx * 0.15 - (inCorridor ? 0.03 : 0), 0.025))
      );
      e.csvi_AC_social = Math.max(0, Math.min(0.4, gaussRand(0.06 + proxCenter * 0.15, 0.04)));

      e.priority = Math.max(
        0,
        Math.min(
          1,
          (e.csvi_E * (e.csvi_S_env + e.csvi_S_contact)) /
            Math.max(0.001, e.csvi_AC_phys * e.csvi_AC_social + 0.01)
        )
      );
      e.priority = Math.min(1, e.priority / 30);
      const b = e.csvi_AC_phys;
      e.AC_med_dom = Math.max(0.001, Math.min(0.35, b * gaussRand(1, 0.12)));
      e.AC_tech_dom = Math.max(0.001, Math.min(0.35, b * gaussRand(1, 0.12)));
      e.AC_mkt_dom = Math.max(0.001, Math.min(0.35, b * gaussRand(1, 0.12)));
      e.AC_sport_dom = Math.max(0.001, Math.min(0.35, b * gaussRand(1, 0.12)));
      e.AC_soc_cul_dom = Math.max(0.001, Math.min(0.35, b * gaussRand(1, 0.12)));
      if (typeof window !== 'undefined' && window.ACDomAggregate) {
        e.acPhysEff = window.ACDomAggregate.effectiveAcPhys(e);
        e.resourceDom = window.ACDomAggregate.resourceDomType(e);
      } else {
        e.acPhysEff = e.csvi_AC_phys;
        e.resourceDom = null;
      }
      e.W_elder = e.csvi_E * (e.acPhysEff + 1);
      e.W_work = Math.max(0, e.N_YP * e.N08);
      const sTotal = e.csvi_S_env + e.csvi_S_contact;
      e.S_contact_ratio = sTotal > 0 ? e.csvi_S_contact / sTotal : 0;
    });
    return edges;
  }

  function getFieldCsvUrl() {
    const g = typeof window !== 'undefined' ? window : globalThis;
    if (g.PRB_FIELD_CSV_URL) return String(g.PRB_FIELD_CSV_URL);
    return '../../data/cld_priority.csv';
  }

  async function loadEdges() {
    const CSV_FILENAME = getFieldCsvUrl();
    try {
      const rows = await d3.csv(CSV_FILENAME, { cache: 'no-store' }, d3.autoType);
      if (!rows || !rows.length) throw new Error('empty');
      if (rows[0].priority === undefined || rows[0].N08 === undefined) {
        throw new Error('需要 priority、N08 等列（W_work=N_YP×N08）');
      }
      return buildEdgesFromCsvRows(rows);
    } catch (err) {
      console.warn('未加载 ' + CSV_FILENAME + '，使用模拟路网。', err);
      return simulateEdges();
    }
  }

  const g = typeof window !== 'undefined' ? window : globalThis;
  g.PRB_FieldSystemData = {
    gaussRand,
    estimateNodePositions,
    buildEdgesFromCsvRows,
    simulateEdges,
    loadEdges,
    getFieldCsvUrl
  };
})();
