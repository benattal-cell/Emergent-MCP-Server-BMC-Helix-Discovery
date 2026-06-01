import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";
import { buildServiceArchitectureHtml, buildServiceArchitectureSvg, type ServiceEdge, type ServiceNode } from "../svg/serviceArchitectureHtml.js";
import { renderVisual, type VisualContentBlock } from "../svg/renderer.js";
import { RESOLVABLE_TARGET_KINDS, resolveTarget, type ResolveTargetResult } from "../discovery/resolveTarget.js";
import { serviceArchitectureOutputSchema } from "./outputSchemas.js";

export const serviceArchitectureSchema = z.object({
  serviceName: z.string().min(1),
  targetKind: z.enum(RESOLVABLE_TARGET_KINDS).optional(),
  depth: z.number().int().min(0).default(2),
  title: z.string().min(1).optional(),
  kindFilter: z.array(z.string().min(1)).optional().describe("Restricts which CI kinds are displayed in the architecture graph (to reduce clutter). It does NOT affect how serviceName is resolved — use targetKind for that."),
  maxNodes: z.number().int().min(5).max(500).default(100)
}).strict();

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

function readNode(raw: Record<string, unknown>): ServiceNode | null {
  const id = typeof raw.id === "string" ? raw.id : undefined;
  if (!id) return null;
  const kind = typeof raw.kind === "string" ? raw.kind : "Unknown";
  const name = typeof raw.name === "string" ? raw.name : (typeof raw.short_name === "string" ? raw.short_name : id);
  const type = formatOptionalAttribute(raw.type);
  const port = formatOptionalAttribute(raw.port) ?? formatOptionalAttribute(raw.listening_ports);
  const publisher = formatOptionalAttribute(raw.publisher) ?? formatOptionalAttribute(raw.vendor);
  return { id, kind, name, ...(type ? { type } : {}), ...(port ? { port } : {}), ...(publisher ? { publisher } : {}) };
}

function readEdge(raw: Record<string, unknown>): ServiceEdge | null {
  const from = typeof raw.src_id === "string" ? raw.src_id : (typeof raw.from === "string" ? raw.from : undefined);
  const to = typeof raw.tgt_id === "string" ? raw.tgt_id : (typeof raw.to === "string" ? raw.to : undefined);
  if (!from || !to) return null;
  const kind = typeof raw.kind === "string" ? raw.kind : "rel";
  return { from, to, kind };
}

function graphLinkContainers(graph: Record<string, unknown>): Array<Record<string, unknown>> {
  return [graph.links, graph.edges, graph.relationships].flatMap((container) =>
    Array.isArray(container) ? container as Array<Record<string, unknown>> : []
  );
}

function orientEdgesFromRoot(edges: ServiceEdge[], rootId: string): ServiceEdge[] {
  const adjacency = new Map<string, ServiceEdge[]>();
  for (const edge of edges) {
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge]);
    adjacency.set(edge.to, [...(adjacency.get(edge.to) ?? []), edge]);
  }

  const distance = new Map<string, number>([[rootId, 0]]);
  const queue = [rootId];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const edge of adjacency.get(current) ?? []) {
      const next = edge.from === current ? edge.to : edge.from;
      if (distance.has(next)) continue;
      distance.set(next, (distance.get(current) ?? 0) + 1);
      queue.push(next);
    }
  }

  return edges.map((edge) => {
    const fromDistance = distance.get(edge.from);
    const toDistance = distance.get(edge.to);
    if (fromDistance !== undefined && toDistance !== undefined && fromDistance > toDistance) {
      return { from: edge.to, to: edge.from, kind: edge.kind };
    }
    return edge;
  });
}

async function collectArchitectureGraph(
  client: DiscoveryClient,
  rootId: string,
  depth: number,
  kindFilter?: string[],
  maxNodes = 100
): Promise<{ nodes: ServiceNode[]; edges: ServiceEdge[]; levels: number }> {
  const nodes = new Map<string, ServiceNode>();
  const rawEdges: ServiceEdge[] = [];
  const seenRawEdge = new Set<string>();
  const visited = new Set<string>();
  const distances = new Map<string, number>([[rootId, 0]]);
  const allowedKinds = kindFilter && kindFilter.length > 0 ? new Set(kindFilter) : null;
  let frontier: string[] = [rootId];

  for (let d = 0; d <= depth && frontier.length > 0 && nodes.size < maxNodes; d += 1) {
    const next = new Set<string>();
    for (const id of frontier) {
      if (visited.has(id) || nodes.size >= maxNodes) continue;
      visited.add(id);
      const raw = await client.getNodeGraph(id);
      const graph = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const rawNodes = Array.isArray(graph.nodes) ? graph.nodes as Array<Record<string, unknown>> : [];
      const rawLinks = graphLinkContainers(graph);

      for (const rawNode of rawNodes) {
        if (nodes.size >= maxNodes) break;
        const node = readNode(rawNode);
        if (!node) continue;
        if (allowedKinds && !allowedKinds.has(node.kind)) continue;
        if (!nodes.has(node.id)) nodes.set(node.id, node);
      }

      for (const rawLink of rawLinks) {
        const edge = readEdge(rawLink);
        if (!edge) continue;
        const key = `${edge.from}>${edge.to}>${edge.kind}`;
        if (!seenRawEdge.has(key)) {
          seenRawEdge.add(key);
          rawEdges.push(edge);
        }

        if (d >= depth) continue;
        const neighbor = edge.from === id ? edge.to : (edge.to === id ? edge.from : undefined);
        if (!neighbor || visited.has(neighbor) || !nodes.has(neighbor)) continue;
        if (!distances.has(neighbor)) distances.set(neighbor, d + 1);
        next.add(neighbor);
      }
    }
    frontier = [...next];
  }

  if (!nodes.has(rootId) && !allowedKinds) nodes.set(rootId, { id: rootId, kind: "Root", name: rootId });
  const collectedEdges = rawEdges.filter((edge) => nodes.has(edge.from) && nodes.has(edge.to));
  const edges = orientEdgesFromRoot(collectedEdges, rootId);
  const levels = Math.max(1, ...[...nodes.keys()].map((id) => (distances.get(id) ?? 0) + 1));
  return { nodes: [...nodes.values()], edges, levels };
}

function resourceSlug(value: string): string {
  const slug = value.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase();
  return slug || "service";
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

export function serviceArchitectureTools(client: DiscoveryClient) {
  return {
    discovery_service_architecture: {
      description: "Generate one or more self-contained D3 hierarchical architecture diagrams from a BusinessService, BusinessApplicationInstance, Host or SoftwareInstance name, or from an exact Discovery nodeId. Use targetKind to disambiguate NAME resolution, or pass serviceName=<id exact>. Returns native MCP visual content: PNG image, SVG resource, and self-contained D3 HTML resource. kindFilter restricts which CI kinds are DISPLAYED in the architecture graph (to reduce clutter). It does NOT affect how serviceName is resolved — use targetKind for that. Prefer discovery_dependency_map for mesh/topology/blast-radius graphs.",
      schema: serviceArchitectureSchema,
      outputSchema: serviceArchitectureOutputSchema,
      handler: async (input: z.infer<typeof serviceArchitectureSchema>) => {
        const resolution = await resolveTarget(client, input.serviceName, { targetKind: input.targetKind });
        if (resolution.status === "none" || resolution.status === "ambiguous") return resolutionError(input.serviceName, resolution);
        const root = resolution.status === "node_id"
          ? { id: resolution.id, name: input.serviceName }
          : { id: resolution.id, name: resolution.name };

        const rendered = await Promise.all([root].map(async (root) => {
          const { nodes, edges, levels } = await collectArchitectureGraph(client, root.id, input.depth, input.kindFilter, input.maxNodes);
          const title = input.title ?? `Service architecture · ${root.name}`;
          const summary = `${root.name}: ${nodes.length} nœuds, ${levels} niveaux${nodes.length >= input.maxNodes ? " (truncated)" : ""}`;
          const structuredContent = {
            root: { id: root.id, name: root.name },
            summary,
            nodes,
            edges,
            levels,
            truncated: nodes.length >= input.maxNodes
          };
          const svg = buildServiceArchitectureSvg(nodes, edges, root.id, title);
          const html = buildServiceArchitectureHtml(nodes, edges, root.id, title);
          const name = `svcarch_${resourceSlug(root.name)}_d${input.depth}`;

          return renderVisual(svg, {
            name,
            textSummary: summary,
            pngWidth: 1600,
            structuredContent,
            interactiveHtml: {
              html,
              resourceName: `${name}.d3`
            }
          });
        }));

        const diagrams = rendered.map((visual) => visual.structuredContent);
        const summary = `${rendered.length} service(s) résolu(s) pour "${input.serviceName}".`;
        return {
          content: rendered.flatMap((visual) => visual.content) as VisualContentBlock[],
          structuredContent: { summary, diagrams, count: diagrams.length }
        };
      },
      isVisual: true as const
    }
  };
}
