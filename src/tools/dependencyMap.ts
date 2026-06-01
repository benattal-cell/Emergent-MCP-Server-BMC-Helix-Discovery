import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";
import { renderForceLayoutSvg, type PositionedEdge, type PositionedNode } from "../svg/forceLayoutRenderer.js";
import { renderVisual } from "../svg/renderer.js";
import { buildInteractiveHtml } from "../svg/interactiveGraph.js";
import { RESOLVABLE_TARGET_KINDS, resolveTarget, type ResolveTargetResult } from "../discovery/resolveTarget.js";
import { dependencyMapOutputSchema } from "./outputSchemas.js";
import { CYTOSCAPE_VISUAL_DESCRIPTION } from "./visualInstructions.js";

export const dependencyMapSchema = z.object({
  target: z.string().min(1),
  targetKind: z.enum(RESOLVABLE_TARGET_KINDS).optional(),
  depth: z.number().int().min(1).max(3).default(1),
  kinds: z.array(z.string().min(1)).optional().describe("Restricts which CI KINDS are DISPLAYED in the resulting graph (to reduce clutter). It does NOT affect how the target name is resolved — use targetKind for that. Leave empty to show all kinds."),
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

function graphLinkContainers(graph: Record<string, unknown>): Array<Record<string, unknown>> {
  return [graph.links, graph.edges, graph.relationships].flatMap((container) =>
    Array.isArray(container) ? container as Array<Record<string, unknown>> : []
  );
}

function readGraphEdge(raw: Record<string, unknown>): GraphEdge | null {
  const from = typeof raw.src_id === "string" ? raw.src_id : (typeof raw.from === "string" ? raw.from : undefined);
  const to = typeof raw.tgt_id === "string" ? raw.tgt_id : (typeof raw.to === "string" ? raw.to : undefined);
  if (!from || !to) return null;
  const kind = typeof raw.kind === "string" ? raw.kind : "rel";
  return { from, to, kind };
}

async function walkGraph(client: DiscoveryClient, focusId: string, depth: number, maxNodes: number, kindFilter?: string[]) {
  const nodes = new Map<string, GraphNode>();
  const rawEdges: GraphEdge[] = [];
  const visited = new Set<string>();
  const seenRawEdge = new Set<string>();
  let frontier: string[] = [focusId];
  for (let d = 0; d <= depth; d++) {
    const next = new Set<string>();
    for (const id of frontier) {
      if (visited.has(id)) continue;
      visited.add(id);
      const raw = await client.getNodeGraph(id);
      const g = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};
      const rawNodes = Array.isArray(g.nodes) ? g.nodes as Array<Record<string, unknown>> : [];
      const rawLinks = graphLinkContainers(g);
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
        }
      }
      for (const l of rawLinks) {
        const edge = readGraphEdge(l);
        if (!edge) continue;
        const eid = `${edge.from}>${edge.to}>${edge.kind}`;
        if (!seenRawEdge.has(eid)) {
          seenRawEdge.add(eid);
          rawEdges.push(edge);
        }

        if (d >= depth) continue;
        const neighbor = edge.from === id ? edge.to : (edge.to === id ? edge.from : undefined);
        if (!neighbor || visited.has(neighbor) || !nodes.has(neighbor)) continue;
        next.add(neighbor);
      }
    }
    frontier = [...next];
    if (nodes.size >= maxNodes) break;
  }
  const edges = rawEdges.filter((edge) => nodes.has(edge.from) && nodes.has(edge.to));
  return { nodes, edges };
}

function resolutionError(target: string, resolution: Extract<ResolveTargetResult, { status: "none" | "ambiguous" }>) {
  if (resolution.status === "none") {
    const text = `Rien trouvé pour ${target}.`;
    return { content: [{ type: "text", text }], structuredContent: { status: "none", target }, isError: true };
  }
  const candidatesText = resolution.candidates.map((candidate) => `${candidate.name} (${candidate.kind}) [id: ${candidate.id}]`).join(", ");
  const text = `Cible ambiguë pour ${target}. Candidats: ${candidatesText}. Pour choisir, rappelez l'outil avec targetKind=<kind> OU target=<id exact>.`;
  return { content: [{ type: "text", text }], structuredContent: { status: "ambiguous", target, candidates: resolution.candidates }, isError: true };
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
      description: "DRAWS the actual dependency graph around a Discovery node. targetKind optionally disambiguates NAME resolution (BusinessService, BusinessApplicationInstance, Host or SoftwareInstance); alternatively pass target=<id exact>. kinds restricts which CI KINDS are DISPLAYED in the resulting graph (to reduce clutter) and does NOT affect target resolution — leave empty to show all kinds. Returns multiple representations in the same response: a PNG image (base64), an SVG resource, and a self-contained interactive HTML resource (Cytoscape embedded inline, no external CDN). The interactive HTML includes CI-style icons per kind, mini-map, search, dark-mode toggle, hover tooltip and click-to-spotlight-neighbors. CHOOSING THE LAYOUT (`layout` param, applies ONLY to the interactive HTML — PNG/SVG always use ForceAtlas2): pass `layout='hierarchical'` when the user's question is about ARCHITECTURE, n-tier, application stack, or service model (top-down layered view). Pass `layout='concentric'` (default) when the question is about TOPOLOGY, MODELING, graph view, dependency map, blast-radius or impact analysis (focus at center, others on rings by distance). Pass `layout='cose'` only if explicitly asked for a generic force-directed look. If your client supports inline image rendering, render the PNG. If your client supports file artifacts or downloadable resources, present the HTML resource as a downloadable file the user can open in a browser. Do NOT attempt to summarize the raw HTML — it is meant for rendering, not reading.",
      schema: dependencyMapSchema,
      outputSchema: dependencyMapOutputSchema,
      visualInstruction: CYTOSCAPE_VISUAL_DESCRIPTION,
      handler: async (input: z.infer<typeof dependencyMapSchema>) => {
        const resolution = await resolveTarget(client, input.target, { targetKind: input.targetKind });
        if (resolution.status === "none" || resolution.status === "ambiguous") return resolutionError(input.target, resolution);
        const focusId = resolution.status === "node_id" ? resolution.id : resolution.id;
        const focusName = resolution.status === "node_id" ? input.target : resolution.name;
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
