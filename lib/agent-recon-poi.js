/**
 * 周边 OSM POI：经 casebase RAG 代理 POST /v1/poi-around（避免浏览器直连 Overpass 的 CORS）。
 * 配置：window.AgentReconPoiConfig（可与 AgentReconCasebaseConfig.ragProxyUrl 同根）
 */

const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

export function getPoiRuntimeConfig() {
  if (typeof window === "undefined") {
    return { enabled: false, proxyBase: "", radiusM: 280, maxItems: 48 };
  }
  const poi = window.AgentReconPoiConfig || {};
  const fromCase = String(window.AgentReconCasebaseConfig?.ragProxyUrl || "").replace(/\/$/, "");
  const proxyBase = String(poi.proxyBase || fromCase).replace(/\/$/, "");
  return {
    enabled: poi.enabled !== false && Boolean(proxyBase),
    proxyBase,
    radiusM: Number(poi.radiusM) > 0 ? Number(poi.radiusM) : 280,
    maxItems: Math.min(80, Math.max(8, Number(poi.maxItems) > 0 ? Number(poi.maxItems) : 48)),
  };
}

/**
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<string>} 多行文本，供 siteContext 拼接；失败时返回空串
 */
export async function fetchNearbyPoiContext(lat, lon) {
  const cfg = getPoiRuntimeConfig();
  if (!cfg.enabled || !Number.isFinite(lat) || !Number.isFinite(lon)) return "";
  const key = `${cfg.radiusM}:${lat.toFixed(5)}:${lon.toFixed(5)}:${cfg.maxItems}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_TTL_MS) return hit.text;

  let text = "";
  try {
    const res = await fetch(`${cfg.proxyBase}/v1/poi-around`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lat,
        lon,
        radius_m: cfg.radiusM,
        max_items: cfg.maxItems,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(data.lines) && data.lines.length) {
      text = `【周边 OSM 兴趣点（约 ${cfg.radiusM}m，OpenStreetMap，仅供参考）】\n${data.lines.join("\n")}`;
    }
  } catch {
    text = "";
  }

  if (text) cache.set(key, { t: Date.now(), text });
  return text;
}
