/**
 * 简易 Case 节点图（自定义 SVG，可对照 Neo4j Case 节点 id）
 */

const DIM_COLORS = {
  site_perception: "#22c55e",
  concept: "#7dd3fc",
  form: "#f472b6",
  space: "#60a5fa",
  function: "#f59e0b",
  technology: "#34d399",
  site_treatment: "#a78bfa",
  material_sensory: "#4ade80",
  program: "#fb923c",
  _default: "#94a3b8",
};

function colorForDimension(dim) {
  if (DIM_COLORS[dim]) return DIM_COLORS[dim];
  const src = String(dim || "_default");
  let hash = 0;
  for (let i = 0; i < src.length; i++) hash = (hash * 33 + src.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue} 70% 62%)`;
}

/**
 * @param {SVGElement} svg
 * @param {Array<{ id: string, title?: string, primary_dimension?: string }>} cases
 * @param {string[]} highlightedIds
 */
export function renderCaseGraph(svg, cases, highlightedIds) {
  if (!svg) return;
  const set = new Set(highlightedIds || []);
  const W = 260;
  const H = 220;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = "";

  const n = Math.max(1, cases.length);
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const pad = 16;
  const cw = (W - pad * 2) / cols;
  const ch = (H - pad * 2) / rows;

  cases.forEach((c, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = pad + col * cw + cw / 2;
    const cy = pad + row * ch + ch / 2;
    const r = Math.min(cw, ch) * 0.28;
    const dim = c.primary_dimension || "_default";
    const stroke = colorForDimension(dim);
    const hot = set.has(c.id);

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", hot ? "case-node case-node--hot" : "case-node");

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", String(cx));
    circle.setAttribute("cy", String(cy));
    circle.setAttribute("r", String(r));
    circle.setAttribute("fill", hot ? "rgba(255,180,80,0.35)" : "rgba(30,42,58,0.9)");
    circle.setAttribute("stroke", hot ? "#ffb347" : stroke);
    circle.setAttribute("stroke-width", hot ? "3" : "1.5");
    g.appendChild(circle);

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", String(cx));
    text.setAttribute("y", String(cy + 4));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", "#e2e8f0");
    text.setAttribute("font-size", "9");
    text.textContent = (c.title || c.id).slice(0, 8);
    g.appendChild(text);

    const idText = document.createElementNS("http://www.w3.org/2000/svg", "text");
    idText.setAttribute("x", String(cx));
    idText.setAttribute("y", String(cy + r + 12));
    idText.setAttribute("text-anchor", "middle");
    idText.setAttribute("fill", "#8899aa");
    idText.setAttribute("font-size", "7");
    idText.textContent = String(c.id).slice(0, 14);
    g.appendChild(idText);

    svg.appendChild(g);
  });
}
