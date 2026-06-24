import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";
import { buildServiceArchitectureHtml, buildServiceArchitectureSvg, type ServiceEdge, type ServiceNode } from "../svg/serviceArchitectureHtml.js";
import { renderVisual, type VisualContentBlock } from "../svg/renderer.js";
import { RESOLVABLE_TARGET_KINDS, resolveTarget, type ResolveTargetResult } from "../discovery/resolveTarget.js";
import { serviceArchitectureOutputSchema } from "./outputSchemas.js";

export const serviceArchitectureSchema = z.object({
  serviceName: z.string().min(1),
  targetKind: z.enum(RESOLVABLE_TARGET_KINDS).optional(),
  depth: z.number().int().min(1).max(4).default(3),
  title: z.string().min(1).optional(),
  kindFilter: z.array(z.string().min(1)).optional().describe("Ignored in service-only mode; discovery_service_architecture always renders BusinessService dependency trees only."),
  maxNodes: z.number().int().min(5).max(500).default(100)
}).strict();

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

function normalizeDependsOn(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((item) => (typeof item === "string" || typeof item === "number" || typeof item === "boolean" ? String(item).trim() : ""))
    .filter((item) => item.length > 0);
}

function rowString(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return undefined;
}

function escapeDiscoveryDoubleQuoted(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function computeDistances(edges: ServiceEdge[], rootId: string): Map<string, number> {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);

  const distances = new Map<string, number>([[rootId, 0]]);
  const queue = [rootId];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const next of outgoing.get(current) ?? []) {
      if (distances.has(next)) continue;
      distances.set(next, (distances.get(current) ?? 0) + 1);
      queue.push(next);
    }
  }
  return distances;
}

function selectTreeEdges(
  edges: ServiceEdge[],
  distances: Map<string, number>,
  retainedNodeIds: Set<string>
): { treeEdges: ServiceEdge[]; crossLinks: ServiceEdge[] } {
  const incoming = new Map<string, ServiceEdge[]>();
  for (const edge of edges) {
    if (!retainedNodeIds.has(edge.from) || !retainedNodeIds.has(edge.to)) continue;
    if (!distances.has(edge.from) || !distances.has(edge.to)) continue;
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
  }

  const treeEdges: ServiceEdge[] = [];
  const crossLinks: ServiceEdge[] = [];
  for (const child of [...incoming.keys()].sort((a, b) => (distances.get(a) ?? 0) - (distances.get(b) ?? 0))) {
    const parents = incoming.get(child) ?? [];
    parents.sort((a, b) => (distances.get(a.from) ?? Number.MAX_SAFE_INTEGER) - (distances.get(b.from) ?? Number.MAX_SAFE_INTEGER));
    const [winner, ...extras] = parents;
    if (winner) treeEdges.push(winner);
    crossLinks.push(...extras);
  }
  return { treeEdges, crossLinks };
}

async function collectArchitectureGraph(
  client: DiscoveryClient,
  rootId: string,
  depth: number
): Promise<{ nodes: ServiceNode[]; edges: ServiceEdge[]; levels: number; crossLinks: ServiceEdge[]; truncated: boolean }> {
  const cappedDepth = Math.min(4, Math.max(1, depth));
  const query = `SEARCH BusinessService WHERE #id = "${escapeDiscoveryDoubleQuoted(rootId)}"
  EXPAND Dependant:Dependency:DependedUpon:BusinessService
  SHOW name, #id AS id,
       #Dependant:Dependency:DependedUpon:BusinessService.name AS depends_on`;
  const result = await client.searchData(query, {
    entityLabel: "service_arch:closure",
    appliedFilters: { rootId }
  });

  const nodes = new Map<string, ServiceNode>();
  const nameToId = new Map<string, string>();
  const rows = result.rows as Array<Record<string, unknown>>;
  for (const row of rows) {
    const id = rowString(row, ["id", "#id", "key", "node_id"]);
    const name = rowString(row, ["name", "Name"]);
    if (!id || !name) continue;
    if (!nodes.has(id)) nodes.set(id, { id, name, kind: "BusinessService" });
    if (!nameToId.has(name)) {
      nameToId.set(name, id);
    } else if (nameToId.get(name) !== id) {
      process.stderr.write(`${JSON.stringify({ level: "warning", message: "BusinessService name collision in service architecture closure", name, keptId: nameToId.get(name), ignoredId: id })}\n`);
    }
  }

  const rawEdges: ServiceEdge[] = [];
  const seenEdges = new Set<string>();
  for (const row of rows) {
    const parentName = rowString(row, ["name", "Name"]);
    if (!parentName) continue;
    const parentId = nameToId.get(parentName);
    if (!parentId) continue;
    for (const childName of normalizeDependsOn(row.depends_on)) {
      const childId = nameToId.get(childName);
      if (!childId) continue;
      const edge: ServiceEdge = { from: parentId, to: childId, kind: "Dependency" };
      const key = `${edge.from}>${edge.to}>${edge.kind}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      rawEdges.push(edge);
    }
  }

  const orientedEdges = orientEdgesFromRoot(rawEdges, rootId);
  const distances = computeDistances(orientedEdges, rootId);
  const retainedNodeIds = new Set([...nodes.keys()].filter((id) => {
    const distance = distances.get(id);
    return distance !== undefined && distance <= cappedDepth;
  }));
  const truncated = [...nodes.keys()].some((id) => {
    const distance = distances.get(id);
    return distance !== undefined && distance > cappedDepth;
  });
  const { treeEdges, crossLinks } = selectTreeEdges(orientedEdges, distances, retainedNodeIds);
  const retainedNodes = [...nodes.values()].filter((node) => retainedNodeIds.has(node.id));
  const levels = Math.max(1, ...retainedNodes.map((node) => (distances.get(node.id) ?? 0) + 1));

  return { nodes: retainedNodes, edges: treeEdges, levels, crossLinks, truncated };
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
      description: "Generate a service-only hierarchical dependency tree between BusinessService nodes. This tool renders only BusinessService → BusinessService dependencies; for Host, SoftwareInstance, BusinessApplicationInstance, mesh, topology, or blast-radius architecture views, use discovery_dependency_map with layout=\"hierarchical\". depth defaults to 3 and is capped at 4. kindFilter is ignored because this mode is always BusinessService-only.",
      schema: serviceArchitectureSchema,
      outputSchema: serviceArchitectureOutputSchema,
      handler: async (input: z.infer<typeof serviceArchitectureSchema>) => {
        const resolution = await resolveTarget(client, input.serviceName, { targetKind: input.targetKind });
        if (resolution.status === "none" || resolution.status === "ambiguous") return resolutionError(input.serviceName, resolution);
        if (resolution.status === "unique" && resolution.kind !== "BusinessService") {
          const text = `La vue architecture hiérarchique discovery_service_architecture est réservée aux BusinessService. Pour afficher l'architecture de ${resolution.name} (${resolution.kind}), utilisez discovery_dependency_map avec layout="hierarchical".`;
          return {
            content: [{ type: "text", text }],
            structuredContent: { status: "redirect", target: input.serviceName, resolved: resolution, recommendedTool: "discovery_dependency_map", layout: "hierarchical" },
            isError: false
          };
        }
        const root = resolution.status === "node_id"
          ? { id: resolution.id, name: input.serviceName }
          : { id: resolution.id, name: resolution.name };

        const rendered = await Promise.all([root].map(async (root) => {
          const { nodes, edges, levels, crossLinks, truncated } = await collectArchitectureGraph(client, root.id, input.depth);
          const title = input.title ?? `Service architecture · ${root.name}`;
          const summary = `${root.name}: ${nodes.length} nœuds, ${levels} niveaux${truncated ? " (truncated)" : ""}`;
          const structuredContent = {
            root: { id: root.id, name: root.name },
            summary,
            nodes,
            edges,
            levels,
            crossLinks,
            truncated
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
