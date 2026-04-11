/**
 * 外部案例库事件：SSE retrieval + 回放 + 30s 高亮状态。
 * 配置见 window.AgentReconCasebaseConfig
 */
import { DEFAULT_CASE_DIMENSIONS } from "./agent-recon-dimensions.js";

const HIGHLIGHT_TTL_MS = 30_000;
const MIN_STABLE_STREAM_MS = 5_000;

export function generateTraceId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `tr_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * @typedef {{ case_ids?: string[], trace_id?: string, agent_id?: string, event_id?: number }} RetrievalPayload
 */

export class CaseRetrievalHighlighter {
  /**
   * @param {{
   *   getSessionAgentId: () => string,
   *   getActiveTraceId: () => string | null,
   *   eventsApiBase: string,
   *   onHighlightChange?: (caseIds: string[]) => void,
   *   onStatus?: (msg: string) => void,
   * }} opts
   */
  constructor(opts) {
    this.getSessionAgentId = opts.getSessionAgentId;
    this.getActiveTraceId = opts.getActiveTraceId;
    this.eventsApiBase = opts.eventsApiBase.replace(/\/$/, "");
    this.onHighlightChange = opts.onHighlightChange || (() => {});
    this.onStatus = opts.onStatus || (() => {});
    /** @type {Map<string, { until: number, agent_id?: string, trace_id?: string }>} */
    this.highlights = new Map();
    this.sinceEventId = null;
    this._stopped = false;
    this._readerLoop = null;
    this._ttlTimer = null;
    this._reconnectDelayMs = 1200;
    this._maxReconnectDelayMs = 30_000;
  }

  start() {
    this._stopped = false;
    this._tickTtl();
    this._connectLoop();
  }

  stop() {
    this._stopped = true;
    if (this._readerLoop) {
      try {
        this._readerLoop.abort();
      } catch {
        /* ignore */
      }
      this._readerLoop = null;
    }
    if (this._ttlTimer) {
      clearInterval(this._ttlTimer);
      this._ttlTimer = null;
    }
  }

  _tickTtl() {
    if (this._ttlTimer) clearInterval(this._ttlTimer);
    this._ttlTimer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [id, meta] of this.highlights) {
        if (meta.until <= now) {
          this.highlights.delete(id);
          changed = true;
        }
      }
      if (changed) this.onHighlightChange(this.getHighlightedCaseIds());
    }, 500);
  }

  getHighlightedCaseIds() {
    const now = Date.now();
    const sessionAgent = this.getSessionAgentId();
    const activeTrace = this.getActiveTraceId();
    const out = [];
    for (const [caseId, meta] of this.highlights) {
      if (meta.until <= now) continue;
      const okAgent = meta.agent_id != null && meta.agent_id === sessionAgent;
      const okTrace = activeTrace != null && meta.trace_id != null && meta.trace_id === activeTrace;
      if (okAgent || okTrace) out.push(caseId);
    }
    return out;
  }

  /**
   * @param {RetrievalPayload} data
   */
  applyRetrievalEvent(data) {
    const ids = Array.isArray(data.case_ids) ? data.case_ids.map(String) : [];
    const agent_id = data.agent_id != null ? String(data.agent_id) : "";
    const trace_id = data.trace_id != null ? String(data.trace_id) : "";
    const until = Date.now() + HIGHLIGHT_TTL_MS;
    for (const id of ids) {
      this.highlights.set(id, { until, agent_id, trace_id });
    }
    if (Number.isFinite(Number(data.event_id))) {
      const eid = Number(data.event_id);
      this.sinceEventId = this.sinceEventId == null ? eid : Math.max(this.sinceEventId, eid);
    }
    this.onHighlightChange(this.getHighlightedCaseIds());
  }

  async fetchReplay(limit = 100) {
    const url = `${this.eventsApiBase}/events?limit=${encodeURIComponent(String(limit))}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET /events ${res.status}`);
    const j = await res.json();
    const list = Array.isArray(j) ? j : j.events || j.data || j.items || [];
    let maxId = this.sinceEventId;
    for (const ev of list) {
      const type = ev?.type || ev?.event || ev?.name;
      let payload = ev;
      if (ev?.data != null && typeof ev.data === "object" && !Array.isArray(ev.data)) {
        payload = { ...ev.data, event_id: ev.data.event_id ?? ev.event_id };
      }
      if (type === "retrieval" || (Array.isArray(payload?.case_ids) && payload.case_ids.length)) {
        this.applyRetrievalEvent({
          case_ids: payload.case_ids,
          trace_id: payload.trace_id,
          agent_id: payload.agent_id,
          event_id: payload.event_id ?? ev.event_id,
        });
      }
      if (Number.isFinite(Number(ev?.event_id))) {
        maxId = maxId == null ? Number(ev.event_id) : Math.max(maxId, Number(ev.event_id));
      }
      if (Number.isFinite(Number(payload?.event_id))) {
        maxId = maxId == null ? Number(payload.event_id) : Math.max(maxId, Number(payload.event_id));
      }
    }
    if (maxId != null) this.sinceEventId = maxId;
    return list;
  }

  async _connectLoop() {
    while (!this._stopped) {
      try {
        const aliveMs = await this._readStreamOnce();
        if (this._stopped) break;
        if (aliveMs < MIN_STABLE_STREAM_MS) {
          throw new Error(`stream closed too soon (${aliveMs}ms)`);
        }
        // 仅在连接稳定存活后恢复短退避，避免抖动时 1-2 秒风暴重连。
        this._reconnectDelayMs = 1200;
        this.onStatus("SSE 连接结束，准备重连…");
        await sleep(800);
      } catch (e) {
        if (this._stopped) break;
        this.onStatus(`SSE 断开，${Math.round(this._reconnectDelayMs / 1000)}s 后重连…`);
        await sleep(this._reconnectDelayMs);
        this._reconnectDelayMs = Math.min(this._maxReconnectDelayMs, Math.floor(this._reconnectDelayMs * 1.5));
      }
    }
  }

  async _readStreamOnce() {
    const url = new URL(`${this.eventsApiBase}/events/stream`);
    const sinceNum = Number(this.sinceEventId);
    if (Number.isFinite(sinceNum)) {
      url.searchParams.set("since_event_id", String(sinceNum));
    }
    const ac = new AbortController();
    this._readerLoop = ac;
    const startedAt = Date.now();
    const res = await fetch(url.toString(), { signal: ac.signal });
    if (!res.ok) throw new Error(`stream ${res.status}`);
    this.onStatus("SSE 已连接");
    const reader = res.body?.getReader();
    if (!reader) throw new Error("无 body");
    const dec = new TextDecoder();
    let buf = "";
    while (!this._stopped) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split(/\r\n\r\n|\n\n/);
      buf = parts.pop() || "";
      for (const block of parts) {
        this._parseSseBlock(block);
      }
    }
    return Date.now() - startedAt;
  }

  _parseSseBlock(block) {
    const lines = block.split(/\r\n|\n/).filter(Boolean);
    let eventName = "message";
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      else if (line.startsWith("id:")) {
        const idNum = Number(line.slice(3).trim());
        if (Number.isFinite(idNum)) {
          this.sinceEventId = this.sinceEventId == null ? idNum : Math.max(this.sinceEventId, idNum);
        }
      }
    }
    const dataStr = dataLines.join("\n");
    if (!dataStr) return;
    if (eventName !== "retrieval") return;
    try {
      const data = JSON.parse(dataStr);
      this.applyRetrievalEvent(data);
    } catch {
      /* 非 JSON 时忽略，不影响主链路 */
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * POST 本地 RAG 代理（playable-city/scripts/casebase-rag-proxy.mjs）
 * @param {{ ragProxyUrl: string, query: string, agentId: string, traceId: string, k?: number }} p
 */
export async function callCasebaseRagProxy(p) {
  const url = p.ragProxyUrl.replace(/\/$/, "") + "/v1/rag";
  const init = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: p.query,
      agent_id: p.agentId,
      trace_id: p.traceId,
      k: p.k ?? 6,
    }),
  };
  let res;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await fetch(url, init);
      break;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await sleep(350 * (attempt + 1));
    }
  }
  if (!res) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* stdout 可能混有日志 */
    const m = text.match(/\{[\s\S]*\}\s*$/);
    if (m) json = JSON.parse(m[0]);
  }
  if (!res.ok) {
    throw new Error(json?.error || text.slice(0, 300) || `HTTP ${res.status}`);
  }
  return json;
}

/** 与案例库默认主键一致（可被 dimensions 覆盖） */
export const CASEBASE_DIMENSION_KEYS = [...DEFAULT_CASE_DIMENSIONS];

/**
 * 按维度各发一条 query 调 RAG（同一 trace_id / agent_id，便于 SSE 与追溯对齐）。
 * @param {{
 *   ragProxyUrl: string,
 *   agentId: string,
 *   traceId: string,
 *   queriesByDimension: Record<string, string>,
 *   k?: number,
 *   dimensions?: string[],
 * }} opts
 */
export async function retrieveCasesByDimensionQueries(opts) {
  const dims = Array.isArray(opts.dimensions) && opts.dimensions.length ? opts.dimensions : CASEBASE_DIMENSION_KEYS;
  const k = Number(opts.k) > 0 ? Number(opts.k) : 4;
  const byDimension = {};
  const errors = [];
  const jobs = dims.map(async (dim) => {
    const q = String(opts.queriesByDimension?.[dim] ?? "").trim();
    if (!q) {
      byDimension[dim] = null;
      return;
    }
    try {
      const j = await callCasebaseRagProxy({
        ragProxyUrl: opts.ragProxyUrl,
        query: q,
        agentId: opts.agentId,
        traceId: opts.traceId,
        k,
      });
      byDimension[dim] = j;
    } catch (e) {
      errors.push({ dimension: dim, message: String(e?.message || e) });
      byDimension[dim] = null;
    }
  });
  await Promise.all(jobs);
  return { byDimension, errors };
}

/**
 * 将单次 RAG JSON 压成讨论用短文本（避免把整个 JSON 塞进模型）。
 * @param {string} dimension
 * @param {Record<string, unknown>|null} json
 */
export function formatRagDimensionBlock(dimension, json) {
  if (!json || typeof json !== "object") return `【${dimension}】（该维检索无结果）`;
  const ans = json.answer ?? json.response ?? "";
  const refs = json.refs;
  const refStr =
    Array.isArray(refs) || (refs && typeof refs === "object")
      ? JSON.stringify(refs).slice(0, 2000)
      : "";
  const tail = refStr ? `\nrefs: ${refStr}` : "";
  const a = String(ans || "").trim().slice(0, 1400);
  return `【${dimension}】\n${a || "（正文为空，仅见 refs）"}${tail}`;
}
