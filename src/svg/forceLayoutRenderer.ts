import { svgEscape, svgTruncate } from "./renderer.js";
import { theme } from "./theme.js";

export interface PositionedNode { id: string; kind: string; name: string; x: number; y: number; degree: number }
export interface PositionedEdge { from: string; to: string; kind: string }

function color(kind: string): string {
  let hash = 0;
  for (let i = 0; i < kind.length; i++) hash = (hash * 33 + kind.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360} 62% 48%)`;
}

export function renderForceLayoutSvg(input: { nodes: PositionedNode[]; edges: PositionedEdge[]; width: number; height: number; title: string }): string {
  const { nodes, edges, width, height, title } = input;
  const index = new Map(nodes.map((n) => [n.id, n]));
  const topKinds = Object.entries(nodes.reduce<Record<string, number>>((acc, n) => {
    acc[n.kind] = (acc[n.kind] ?? 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 6);

  const edgeSvg = edges.map((e) => {
    const from = index.get(e.from);
    const to = index.get(e.to);
    if (!from || !to) return "";
    return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="#94a3b8" stroke-opacity="0.4" stroke-width="1.2"/>`;
  }).join("");

  const nodeSvg = nodes.map((n) => {
    const r = Math.min(18, Math.max(6, 6 + n.degree * 0.8));
    return `<g><circle cx="${n.x}" cy="${n.y}" r="${r}" fill="${color(n.kind)}" /><text x="${n.x + r + 4}" y="${n.y + 4}" font-size="11" fill="${theme.text}">${svgEscape(svgTruncate(n.name, 24))}</text></g>`;
  }).join("");

  const legend = topKinds.map((k, i) => `<text x="22" y="${72 + i * 14}" font-size="11" fill="${theme.textMuted}">■ <tspan fill="${theme.text}">${svgEscape(k[0])}</tspan> (${k[1]})</text>`).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="${theme.font}">
  <rect width="100%" height="100%" fill="${theme.bg}"/>
  <text x="20" y="32" font-size="${theme.fsTitle}" font-weight="700" fill="${theme.text}">${svgEscape(title)}</text>
  ${legend}
  ${edgeSvg}
  ${nodeSvg}
</svg>`;
}
