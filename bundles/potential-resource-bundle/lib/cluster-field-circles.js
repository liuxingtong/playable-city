/**
 * 场域 / 廊道共用：双半径圆
 * - r_tight：触媒中点质心 + 覆盖最远中点 + 缓冲（米）
 * - r_budget：叙事面积 √(targetM2/π)
 * - r_inner = min(r_budget, r_tight)，r_outer = max(…) → 实线核心 / 虚线缓冲（偏大者为缓冲圈）
 */
const ClusterFieldCircles = (function () {
  const BUFFER_M = 75;
  const MIN_R_M = 90;
  const MAX_R_M = 1500;

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

  /**
   * @param {Array<{ lat: number, lon: number }>} members 触媒 DBSCAN 点（含中点坐标）
   * @param {number} targetM2 叙事分配面积 (m²)
   */
  function circlePairFromMembers(members, targetM2) {
    if (!members || members.length < 1) return null;
    let slat = 0;
    let slon = 0;
    for (let i = 0; i < members.length; i++) {
      slat += members[i].lat;
      slon += members[i].lon;
    }
    const clat = slat / members.length;
    const clon = slon / members.length;
    let maxD = 0;
    for (let i = 0; i < members.length; i++) {
      const d = haversineM(clat, clon, members[i].lat, members[i].lon);
      if (d > maxD) maxD = d;
    }
    const rTight = Math.min(MAX_R_M, Math.max(MIN_R_M, maxD + BUFFER_M));
    const rBudget = Math.sqrt(Math.max(targetM2, 1) / Math.PI);
    const radiusInnerM = Math.min(rBudget, rTight);
    const radiusOuterM = Math.max(rBudget, rTight);
    return {
      centerLat: clat,
      centerLon: clon,
      radiusInnerM,
      radiusOuterM
    };
  }

  /**
   * 每个 DBSCAN 簇：按全簇 Σpriority 分 10 ha 得 targetM2，再算内外圆。
   * 供廊道 medoid：使用 radiusOuterM（传入 compute 的 circle.radiusM）。
   * @returns {Map<number, { centerLat, centerLon, radiusM, radiusInnerM, radiusOuterM }>}
   */
  function dbscanCirclesForCorridor(db, maxTotalAreaM2) {
    const map = new Map();
    if (!db || !db.points || !db.labels || maxTotalAreaM2 == null) return map;
    const { points, labels, nClusters } = db;
    const nc = nClusters != null ? nClusters : 0;
    const clusterRows = [];
    for (let c = 0; c < nc; c++) {
      const mem = [];
      for (let i = 0; i < points.length; i++) {
        if (labels[i] === c) mem.push(points[i]);
      }
      if (mem.length < 2) continue;
      let sumP = 0;
      for (let i = 0; i < mem.length; i++) {
        sumP += mem[i].edge && Number.isFinite(mem[i].edge.priority) ? mem[i].edge.priority : 0;
      }
      clusterRows.push({ label: c, members: mem, sumP });
    }
    let totalP = 0;
    for (let i = 0; i < clusterRows.length; i++) totalP += clusterRows[i].sumP;
    if (totalP <= 1e-18) totalP = clusterRows.length || 1;

    for (let i = 0; i < clusterRows.length; i++) {
      const row = clusterRows[i];
      const targetM2 = maxTotalAreaM2 * (row.sumP / totalP);
      const pair = circlePairFromMembers(row.members, targetM2);
      if (!pair) continue;
      map.set(row.label, {
        centerLat: pair.centerLat,
        centerLon: pair.centerLon,
        radiusM: pair.radiusOuterM,
        radiusInnerM: pair.radiusInnerM,
        radiusOuterM: pair.radiusOuterM
      });
    }
    return map;
  }

  return {
    haversineM,
    circlePairFromMembers,
    dbscanCirclesForCorridor
  };
})();
