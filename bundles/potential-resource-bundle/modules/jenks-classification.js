/**
 * Fisher–Jenks 自然断点 + 大样本三分位回退（与主站 pages 内联逻辑一致）。
 * 依赖：无。暴露全局 jenks / getClassificationBreaks / classifyJenks。
 */
(function () {
  'use strict';

  function jenks(data, nClasses) {
    const sorted = [...data].sort((a, b) => a - b);
    const n = sorted.length;
    if (n <= nClasses) return sorted;
    const lc = Array.from({ length: n + 1 }, () => new Float64Array(nClasses + 1).fill(Infinity));
    const variance = Array.from({ length: n + 1 }, () => new Float64Array(nClasses + 1).fill(Infinity));
    for (let i = 1; i <= nClasses; i++) {
      lc[1][i] = 1;
      variance[1][i] = 0;
    }
    for (let l = 2; l <= n; l++) {
      let sum = 0;
      let sumSq = 0;
      for (let m = 1; m <= l; m++) {
        const val = sorted[l - m];
        sum += val;
        sumSq += val * val;
        const w = m;
        const v = sumSq - (sum * sum) / w;
        const i4 = l - m;
        if (i4 !== 0) {
          for (let j = 2; j <= nClasses; j++) {
            if (variance[l][j] >= v + variance[i4][j - 1]) {
              lc[l][j] = i4 + 1;
              variance[l][j] = v + variance[i4][j - 1];
            }
          }
        }
      }
      lc[l][1] = 1;
      variance[l][1] = sumSq - (sum * sum) / l;
    }
    const breaks = [];
    let k = n;
    for (let j = nClasses; j >= 2; j--) {
      const idx = lc[k][j] - 2;
      breaks.unshift(sorted[idx]);
      k = lc[k][j] - 1;
    }
    return breaks;
  }

  const JENKS_MAX_N = 4096;

  function getClassificationBreaks(values, nClasses) {
    const n = values.length;
    if (n === 0) return [0, 1];
    if (n <= JENKS_MAX_N) return jenks(values, nClasses);
    const sorted = [...values].sort((a, b) => a - b);
    const i1 = Math.floor(n / 3);
    const i2 = Math.floor((2 * n) / 3);
    let b0 = sorted[Math.min(i1, n - 1)];
    let b1 = sorted[Math.min(Math.max(i2, i1 + 1), n - 1)];
    if (b1 <= b0 && n > 2) b1 = sorted[n - 1] + 1e-12;
    return [b0, b1];
  }

  function classifyJenks(value, breaks) {
    if (value < breaks[0]) return 0;
    if (value < breaks[1]) return 1;
    return 2;
  }

  const g = typeof window !== 'undefined' ? window : globalThis;
  g.jenks = jenks;
  g.getClassificationBreaks = getClassificationBreaks;
  g.classifyJenks = classifyJenks;
  g.JENKS_MAX_N = JENKS_MAX_N;
})();
