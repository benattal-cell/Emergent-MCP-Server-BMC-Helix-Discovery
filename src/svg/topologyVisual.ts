import { buildInteractiveHtml } from "./interactiveGraph.js";
import { renderForceLayoutSvg, type PositionedEdge, type PositionedNode } from "./forceLayoutRenderer.js";
import { renderVisual } from "./renderer.js";

export interface TopologyNode { id: string; kind: string; name: string; type?: string; port?: string; publisher?: string }
export interface TopologyEdge { from: string; to: string; kind: string }

function formatOptionalAttribute(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() === "" ? undefined : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const items = value
      .map((item) => (typeof item === "string" || typeof item === "number" || typeof item === "boolean" ? String(item) : undefined))
      .filter((item): item is string => item !== undefined && item.trim() !== "");
    return items.length > 0 ? items.join(", ") : undefined;
  }
  return undefined;
}

export function normalizeGraph(raw: unknown): { nodes: TopologyNode[]; edges: TopologyEdge[] } {
  const graph = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const rawNodes = Array.isArray(graph.nodes) ? graph.nodes as Array<Record<string, unknown>> : [];
  const rawEdges = Array.isArray(graph.links)
    ? graph.links as Array<Record<string, unknown>>
    : (Array.isArray(graph.edges) ? graph.edges as Array<Record<string, unknown>> : []);

  const nodes = rawNodes.flatMap((node) => {
    const id = typeof node.id === "string" ? node.id : undefined;
    if (!id) return [];
    const kind = typeof node.kind === "string" ? node.kind : "Unknown";
    const name = typeof node.name === "string" ? node.name : (typeof node.short_name === "string" ? node.short_name : id);
    const type = formatOptionalAttribute(node.type);
    const port = formatOptionalAttribute(node.port) ?? formatOptionalAttribute(node.listening_ports);
    const publisher = formatOptionalAttribute(node.publisher) ?? formatOptionalAttribute(node.vendor);
    return [{ id, kind, name, ...(type ? { type } : {}), ...(port ? { port } : {}), ...(publisher ? { publisher } : {}) }];
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const seen = new Set<string>();
  const edges = rawEdges.flatMap((edge) => {
    const from = typeof edge.src_id === "string" ? edge.src_id : (typeof edge.from === "string" ? edge.from : undefined);
    const to = typeof edge.tgt_id === "string" ? edge.tgt_id : (typeof edge.to === "string" ? edge.to : undefined);
    if (!from || !to || !nodeIds.has(from) || !nodeIds.has(to)) return [];
    const kind = typeof edge.kind === "string" ? edge.kind : "rel";
    const key = `${from}>${to}>${kind}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ from, to, kind }];
  });
  return { nodes, edges };
}

export function circularLayout(nodes: TopologyNode[], edges: TopologyEdge[], width = 1200, height = 760): PositionedNode[] {
  const degree = new Map<string, number>();
  for (const node of nodes) degree.set(node.id, 0);
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.max(80, Math.min(width, height) * 0.36);
  return nodes.map((node, index) => {
    const angle = (index / Math.max(1, nodes.length)) * Math.PI * 2 - Math.PI / 2;
    return {
      ...node,
      x: nodes.length === 1 ? cx : cx + Math.cos(angle) * radius,
      y: nodes.length === 1 ? cy : cy + Math.sin(angle) * radius,
      degree: degree.get(node.id) ?? 0
    };
  });
}

export function renderTopologyVisual(raw: unknown, options: { name: string; title: string; textSummary: string; focusId?: string; structuredContent?: unknown }) {
  const graph = normalizeGraph(raw);
  const positionedNodes = circularLayout(graph.nodes, graph.edges);
  const svg = renderForceLayoutSvg({ nodes: positionedNodes, edges: graph.edges as PositionedEdge[], width: 1200, height: 760, title: options.title });
  const html = buildInteractiveHtml(graph.nodes, graph.edges, { title: options.title, focusId: options.focusId, layout: "concentric" });
  return renderVisual(svg, {
    name: options.name,
    textSummary: options.textSummary,
    pngWidth: 1200,
    structuredContent: options.structuredContent ?? raw,
    ...(html ? { interactiveHtml: { html, resourceName: `${options.name}.cytoscape` } } : {})
  });
}
