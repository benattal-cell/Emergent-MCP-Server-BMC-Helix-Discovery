import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";
import { buildServiceArchitectureHtml, type ServiceEdge, type ServiceNode } from "../svg/serviceArchitectureHtml.js";

export const serviceArchitectureSchema = z.object({
  serviceName: z.string().min(1),
  depth: z.number().int().min(0).default(2),
  title: z.string().min(1).optional(),
  kindFilter: z.array(z.string().min(1)).optional(),
  maxNodes: z.number().int().min(5).max(500).default(100)
}).strict();

function escapeDiscoveryDoubleQuoted(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

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

function rowString(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
}

async function resolveServiceRoots(client: DiscoveryClient, serviceName: string): Promise<Array<{ id: string; name: string }>> {
  const needle = escapeDiscoveryDoubleQuoted(serviceName);
  const queries = [
    `SEARCH BusinessService WHERE name HAS SUBWORD "${needle}" SHOW name, #id ORDER BY name`,
    `SEARCH BusinessApplicationInstance WHERE name HAS SUBWORD "${needle}" SHOW name, #id ORDER BY name`
  ];

  for (const query of queries) {
    const result = await client.searchData(query, { entityLabel: "services", appliedFilters: { serviceName } });
    const roots = result.rows.flatMap((row) => {
      const id = rowString(row, ["#id", "id", "key", "node_id"]);
      if (!id) return [];
      return [{ id, name: rowString(row, ["name", "Name"]) ?? id }];
    });
    if (roots.length > 0) return roots;
  }

  return [];
}

async function collectArchitectureGraph(
  client: DiscoveryClient,
  rootId: string,
  depth: number,
  kindFilter?: string[],
  maxNodes = 100
): Promise<{ nodes: ServiceNode[]; edges: ServiceEdge[]; levels: number }> {
  const nodes = new Map<string, ServiceNode>();
  const edges: ServiceEdge[] = [];
  const seenEdge = new Set<string>();
  const visited = new Set<string>();
  const allowedKinds = kindFilter && kindFilter.length > 0 ? new Set(kindFilter) : null;
  let frontier: string[] = [rootId];
  let levels = 0;

  for (let d = 0; d <= depth && frontier.length > 0 && nodes.size < maxNodes; d += 1) {
    const next: string[] = [];
    levels = Math.max(levels, d + 1);
    for (const id of frontier) {
      if (visited.has(id) || nodes.size >= maxNodes) continue;
      visited.add(id);
      const raw = await client.getNodeGraph(id);
      const graph = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const rawNodes = Array.isArray(graph.nodes) ? graph.nodes as Array<Record<string, unknown>> : [];
      const rawLinks = Array.isArray(graph.links) ? graph.links as Array<Record<string, unknown>> : (Array.isArray(graph.edges) ? graph.edges as Array<Record<string, unknown>> : []);

      for (const rawNode of rawNodes) {
        if (nodes.size >= maxNodes) break;
        const node = readNode(rawNode);
        if (!node) continue;
        if (allowedKinds && !allowedKinds.has(node.kind)) continue;
        if (!nodes.has(node.id)) nodes.set(node.id, node);
        if (d < depth && node.id !== id && !visited.has(node.id)) next.push(node.id);
      }

      for (const rawLink of rawLinks) {
        const edge = readEdge(rawLink);
        if (!edge || !nodes.has(edge.from) || !nodes.has(edge.to)) continue;
        const key = `${edge.from}>${edge.to}>${edge.kind}`;
        if (seenEdge.has(key)) continue;
        seenEdge.add(key);
        edges.push(edge);
      }
    }
    frontier = [...new Set(next)];
  }

  if (!nodes.has(rootId) && !allowedKinds) nodes.set(rootId, { id: rootId, kind: "Root", name: rootId });
  return { nodes: [...nodes.values()], edges, levels };
}

export function serviceArchitectureTools(client: DiscoveryClient) {
  return {
    discovery_service_architecture: {
      description: "Generate one or more self-contained D3 hierarchical architecture diagrams from a BusinessService or BusinessApplicationInstance name. Resolves node ids automatically via HAS SUBWORD lookup, generates one diagram per match. Use kindFilter to restrict node kinds and avoid graph explosion on large services (e.g. [\"BusinessService\",\"BusinessApplicationInstance\",\"Host\",\"SoftwareInstance\"]). Prefer discovery_dependency_map for mesh/topology/blast-radius graphs.",
      schema: serviceArchitectureSchema,
      handler: async (input: z.infer<typeof serviceArchitectureSchema>) => {
        const roots = await resolveServiceRoots(client, input.serviceName);
        if (roots.length === 0) {
          return { error: `Aucun BusinessService ou BusinessApplicationInstance trouvé pour le nom "${input.serviceName}".` };
        }

        return Promise.all(roots.map(async (root) => {
          const { nodes, edges, levels } = await collectArchitectureGraph(client, root.id, input.depth, input.kindFilter, input.maxNodes);
          const title = input.title ?? `Service architecture · ${root.name}`;
          const html = buildServiceArchitectureHtml(nodes, edges, root.id, title);
          return {
            summary: `${nodes.length} nœuds, ${levels} niveaux`,
            name: root.name,
            html
          };
        }));
      }
    }
  };
}
