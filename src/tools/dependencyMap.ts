import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";
import { renderForceLayoutSvg, type PositionedEdge, type PositionedNode } from "../svg/forceLayoutRenderer.js";
import { renderVisual } from "../svg/renderer.js";
import { buildInteractiveHtml } from "../svg/interactiveGraph.js";

export const dependencyMapSchema = z.object({
  target: z.string().min(1),
  depth: z.number().int().min(1).max(3).default(1),
  kinds: z.array(z.string().min(1)).optional(),
  maxNodes: z.number().int().min(5).max(200).default(60),
  iterations: z.number().int().min(50).max(600).default(200),
  linLog: z.boolean().default(false),
  gravity: z.number().min(0).max(10).default(1),
  scalingRatio: z.number().min(1).max(100).default(10),
  /**
   * Layout for the INTERACTIVE HTML view only (the PNG/SVG always use ForceAtlas2).
   * - "concentric"   → focus at center, ringed by BFS distance. Default. Best for
   *                    topology, dependency graph, blast-radius, impact analysis, modeling.
   * - "hierarchical" → top-down layered view (Cytoscape breadthfirst). Best for
   *                    architecture, n-tier, service model, application stack.
   * - "cose"         → generic force layout (same vibe as the PNG/SVG ForceAtlas2).
   */
  layout: z.enum(["concentric", "hierarchical", "cose"]).default("concentric")
}).strict();

const structuredContentSchema = z.object({
  focus: z.object({ id: z.string(), name: z.string() }),
  layout: z.object({ algorithm: z.literal("forceatlas2"), iterations: z.number(), settings: z.record(z.unknown()) }),
  interactiveLayout: z.enum(["concentric", "hierarchical", "cose"]),
  nodes: z.array(z.object({ id: z.string(), kind: z.string(), name: z.string(), x: z.number(), y: z.number(), degree: z.number(), type: z.string().optional(), port: z.string().optional(), publisher: z.string().optional() })),
  edges: z.array(z.object({ from: z.string(), to: z.string(), kind: z.string() })),
  truncated: z.boolean(),
  counts: z.object({ nodes: z.number(), edges: z.number(), kinds: z.record(z.number()) })
});

interface GraphNode { id: string; kind: string; name: string; type?: string; port?: string; publisher?: string }
interface GraphEdge { from: string; to: string; kind: string }
const looksLikeNodeId = (v: string) => v.length >= 16 && !/\s/.test(v) && /^[A-Za-z0-9+/=_\-]+$/.test(v);

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

async function walkGraph(client: DiscoveryClient, focusId: string, depth: number, maxNodes: number, kindFilter?: string[]) {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const visited = new Set<string>();
  const seenEdge = new Set<string>();
  let frontier: string[] = [focusId];
  for (let d = 0; d <= depth; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      if (visited.has(id)) continue;
      visited.add(id);
      const raw = await client.getNodeGraph(id);
      const g = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};
      const rawNodes = Array.isArray(g.nodes) ? g.nodes as Array<Record<string, unknown>> : [];
      const rawLinks = Array.isArray(g.links) ? g.links as Array<Record<string, unknown>> : [];
      for (const n of rawNodes) {
        const nid = typeof n.id === "string" ? n.id : undefined;
        if (!nid) continue;
        const kind = typeof n.kind === "string" ? n.kind : "Unknown";
        if (kindFilter && kindFilter.length > 0 && nid !== focusId && !kindFilter.includes(kind)) continue;
        if (!nodes.has(nid) && nodes.size < maxNodes) {
          const name = typeof n.name === "string" ? n.name : (typeof n.short_name === "string" ? n.short_name : nid);
          const type = formatOptionalAttribute(n.type);
          const port = formatOptionalAttribute(n.port) ?? formatOptionalAttribute(n.listening_ports);
          const publisher = formatOptionalAttribute(n.publisher) ?? formatOptionalAttribute(n.vendor);
          nodes.set(nid, { id: nid, kind, name, ...(type ? { type } : {}), ...(port ? { port } : {}), ...(publisher ? { publisher } : {}) });
          if (d < depth && nid !== id) next.push(nid);
        }
      }
      for (const l of rawLinks) {
        const src = typeof l.src_id === "string" ? l.src_id : undefined;
        const tgt = typeof l.tgt_id === "string" ? l.tgt_id : undefined;
        if (!src || !tgt || !nodes.has(src) || !nodes.has(tgt)) continue;
        const kind = typeof l.kind === "string" ? l.kind : "rel";
        const eid = `${src}>${tgt}>${kind}`;
        if (seenEdge.has(eid)) continue;
        seenEdge.add(eid);
        edges.push({ from: src, to: tgt, kind });
      }
    }
    frontier = next;
    if (nodes.size >= maxNodes) break;
  }
  return { nodes, edges };
}

function layout(nodes: GraphNode[], edges: GraphEdge[], options: z.infer<typeof dependencyMapSchema>): PositionedNode[] {
  const g = new Graph();
  nodes.forEach((n, i) => {
    const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2;
    g.addNode(n.id, { ...n, x: Math.cos(angle), y: Math.sin(angle) });
  });
  edges.forEach((e, i) => {
    if (g.hasNode(e.from) && g.hasNode(e.to) && !g.hasEdge(e.from, e.to)) g.addEdge(e.from, e.to, { id: `e${i}` });
  });
  forceAtlas2.assign(g, {
    iterations: options.iterations,
    settings: {
      gravity: options.gravity,
      scalingRatio: options.scalingRatio,
      strongGravityMode: false,
      barnesHutOptimize: nodes.length > 50,
      slowDown: 1,
      linLogMode: options.linLog
    }
  });
  const coords = g.mapNodes((id, attrs) => ({
    id,
    kind: String(attrs.kind),
    name: String(attrs.name),
    x: Number(attrs.x),
    y: Number(attrs.y),
    degree: g.degree(id),
    ...(typeof attrs.type === "string" ? { type: attrs.type } : {}),
    ...(typeof attrs.port === "string" ? { port: attrs.port } : {}),
    ...(typeof attrs.publisher === "string" ? { publisher: attrs.publisher } : {})
  }));
  const xs = coords.map((n) => n.x), ys = coords.map((n) => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = 1600, h = 900, margin = 40;
  return coords.map((n) => ({ ...n, x: margin + ((n.x - minX) / Math.max(1e-6, maxX - minX)) * (w - margin * 2), y: margin + ((n.y - minY) / Math.max(1e-6, maxY - minY)) * (h - margin * 2) }));
}

export function dependencyMapTools(client: DiscoveryClient) {
  return {
    discovery_dependency_map: {
      description: "Render a dependency map around a Discovery node. Returns multiple representations in the same response: a PNG image (base64), an SVG resource, and a self-contained interactive HTML resource (Cytoscape embedded inline, no external CDN). The interactive HTML includes CI-style icons per kind, mini-map, search, dark-mode toggle, hover tooltip and click-to-spotlight-neighbors. CHOOSING THE LAYOUT (`layout` param, applies ONLY to the interactive HTML — PNG/SVG always use ForceAtlas2): pass `layout='hierarchical'` when the user's question is about ARCHITECTURE, n-tier, application stack, or service model (top-down layered view). Pass `layout='concentric'` (default) when the question is about TOPOLOGY, MODELING, graph view, dependency map, blast-radius or impact analysis (focus at center, others on rings by distance). Pass `layout='cose'` only if explicitly asked for a generic force-directed look. If your client supports inline image rendering, render the PNG. If your client supports file artifacts or downloadable resources, present the HTML resource as a downloadable file the user can open in a browser. Do NOT attempt to summarize the raw HTML — it is meant for rendering, not reading.",
      schema: dependencyMapSchema,
      handler: async (input: z.infer<typeof dependencyMapSchema>) => {
        let focusId = input.target;
        let focusName = input.target;
        if (!looksLikeNodeId(input.target)) {
          const found = await client.findHosts({ nameContains: input.target, limit: 1 });
          const first = found.rows[0] as { id?: unknown; name?: unknown } | undefined;
          if (!first || typeof first.id !== "string") throw new Error(`No host found matching '${input.target}' and value does not look like a node id`);
          focusId = first.id;
          if (typeof first.name === "string") focusName = first.name;
        }
        const { nodes, edges } = await walkGraph(client, focusId, input.depth, input.maxNodes, input.kinds);
        if (!nodes.has(focusId)) nodes.set(focusId, { id: focusId, kind: "Focus", name: focusName });
        const positionedNodes = layout(Array.from(nodes.values()), edges, input);
        const positionedEdges: PositionedEdge[] = edges;
        const kinds = positionedNodes.reduce<Record<string, number>>((acc, n) => { acc[n.kind] = (acc[n.kind] ?? 0) + 1; return acc; }, {});
        const structuredContent = structuredContentSchema.parse({
          focus: { id: focusId, name: focusName },
          layout: { algorithm: "forceatlas2", iterations: input.iterations, settings: { gravity: input.gravity, scalingRatio: input.scalingRatio, strongGravityMode: false, barnesHutOptimize: positionedNodes.length > 50, slowDown: 1, linLogMode: input.linLog } },
          interactiveLayout: input.layout,
          nodes: positionedNodes,
          edges,
          truncated: positionedNodes.length >= input.maxNodes,
          counts: { nodes: positionedNodes.length, edges: edges.length, kinds }
        });
        const svg = renderForceLayoutSvg({ nodes: positionedNodes, edges: positionedEdges, width: 1600, height: 900, title: `Dependency map · ${focusName}` });
        const html = buildInteractiveHtml(positionedNodes, edges, { title: `Dependency map · ${focusName}`, focusId, layout: input.layout });
        return renderVisual(svg, {
          name: `depmap_${focusName.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase()}_d${input.depth}`,
          textSummary: `Dependency map for '${focusName}': ${positionedNodes.length} nodes, ${edges.length} edges${positionedNodes.length >= input.maxNodes ? " (truncated)" : ""}. Static layout=ForceAtlas2 (${input.iterations} iter). Interactive layout=${input.layout}.`,
          pngWidth: 1600,
          structuredContent,
          ...(html ? {
            interactiveHtml: {
              html,
              resourceName: `depmap_${focusName.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase()}_d${input.depth}.cytoscape`
            }
          } : {})
        });
      },
      isVisual: true as const
    }
  };
}
