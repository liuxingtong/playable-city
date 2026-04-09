/**
 * 可玩资源主导列（AC_traf_dom / AC_tech_dom / AC_mkt_dom / AC_sport_dom / AC_soc_cul_dom）：
 * - 五列齐全时用五列算术平均作为聚合 cpvi_AC（新框架 v6+）。
 * - 旧版五列（AC_med_dom 替代 AC_traf_dom）兼容：若 AC_traf_dom 缺失但 AC_med_dom + 其余四列齐全，
 *   按旧版五列处理，med 标签显示为"医疗（旧）"。
 * - 仅旧版四列（无文化列）齐全时退回四列均值与四类 argmax。
 * - 资源节点主导类型：参与聚合的列中取最大者 → 交通/慢行 / 科技 / 商业 / 体育 / 文化。
 */
(function (g) {
  'use strict';

  /* v6 新五列（交通/慢行替代医疗） */
  var DOM_KEYS = ['AC_traf_dom', 'AC_tech_dom', 'AC_mkt_dom', 'AC_sport_dom', 'AC_soc_cul_dom'];
  /* v5.x 旧版五列（医疗+文化）兼容 */
  var LEGACY5_DOM_KEYS = ['AC_med_dom', 'AC_tech_dom', 'AC_mkt_dom', 'AC_sport_dom', 'AC_soc_cul_dom'];
  /* v5 旧版四列（无文化列）兼容 */
  var LEGACY_DOM_KEYS = ['AC_med_dom', 'AC_tech_dom', 'AC_mkt_dom', 'AC_sport_dom'];

  var DOM_LABELS = {
    AC_traf_dom:    '交通/慢行',
    AC_tech_dom:    '科技',
    AC_mkt_dom:     '商业',
    AC_sport_dom:   '体育',
    AC_soc_cul_dom: '文化',
    AC_med_dom:     '医疗（旧）'
  };

  function cellNum(row, k) {
    if (!row || row[k] === '' || row[k] == null) return NaN;
    var n = Number(row[k]);
    return Number.isFinite(n) ? n : NaN;
  }

  /** @returns {{ keys: string[], vals: number[] } | null} */
  function domSplitForRow(row) {
    if (!row) return null;
    /* 优先：v6 新五列 */
    var vals5 = DOM_KEYS.map(function (k) { return cellNum(row, k); });
    if (vals5.every(function (v) { return Number.isFinite(v); }))
      return { keys: DOM_KEYS, vals: vals5 };
    /* 兼容：v5.x 旧版五列（含医疗列） */
    var vals5leg = LEGACY5_DOM_KEYS.map(function (k) { return cellNum(row, k); });
    if (vals5leg.every(function (v) { return Number.isFinite(v); }))
      return { keys: LEGACY5_DOM_KEYS, vals: vals5leg };
    /* 兼容：v5 旧版四列（无文化列） */
    var vals4 = LEGACY_DOM_KEYS.map(function (k) { return cellNum(row, k); });
    if (vals4.every(function (v) { return Number.isFinite(v); }))
      return { keys: LEGACY_DOM_KEYS, vals: vals4 };
    return null;
  }

  function effectiveAcPhys(row) {
    var sp = domSplitForRow(row);
    if (sp) {
      var s = 0;
      for (var i = 0; i < sp.vals.length; i++) s += sp.vals[i];
      return s / sp.vals.length;
    }
    /* 优先读新列 cpvi_AC，回退旧列 csvi_AC_phys */
    var p = Number(row.cpvi_AC);
    if (Number.isFinite(p)) return p;
    p = Number(row.csvi_AC_phys);
    return Number.isFinite(p) ? p : 0;
  }

  /** @returns {{ key: string, label: string, max: number } | null} */
  function resourceDomType(row) {
    var sp = domSplitForRow(row);
    if (!sp) return null;
    var vals = sp.vals;
    var bi = 0;
    for (var i = 1; i < vals.length; i++) {
      if (vals[i] > vals[bi]) bi = i;
    }
    var key = sp.keys[bi];
    return { key: key, label: DOM_LABELS[key] || key, max: vals[bi] };
  }

  g.ACDomAggregate = {
    DOM_KEYS:        DOM_KEYS,
    LEGACY_DOM_KEYS: LEGACY_DOM_KEYS,
    DOM_LABELS:      DOM_LABELS,
    effectiveAcPhys: effectiveAcPhys,
    resourceDomType: resourceDomType
  };
})(typeof window !== 'undefined' ? window : globalThis);
