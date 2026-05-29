import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";
import { buildServiceArchitectureHtml, type ServiceEdge, type ServiceNode } from "../svg/serviceArchitectureHtml.js";

export const serviceArchitectureSchema = z.object({
  rootId: z.string().min(1),
  depth: z.number().int().min(0).default(4),
  title: z.string().min(1).optional()
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

async function collectArchitectureGraph(client: DiscoveryClient, rootId: string, depth: number): Promise<{ nodes: ServiceNode[]; edges: ServiceEdge[]; levels: number }> {
  const nodes = new Map<string, ServiceNode>();
  const edges: ServiceEdge[] = [];
  const seenEdge = new Set<string>();
  const visited = new Set<string>();
  let frontier: string[] = [rootId];
  let levels = 0;

  for (let d = 0; d <= depth && frontier.length > 0; d += 1) {
    const next: string[] = [];
    levels = Math.max(levels, d + 1);
    for (const id of frontier) {
      if (visited.has(id)) continue;
      visited.add(id);
      const raw = await client.getNodeGraph(id);
      const graph = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const rawNodes = Array.isArray(graph.nodes) ? graph.nodes as Array<Record<string, unknown>> : [];
      const rawLinks = Array.isArray(graph.links) ? graph.links as Array<Record<string, unknown>> : (Array.isArray(graph.edges) ? graph.edges as Array<Record<string, unknown>> : []);

      for (const rawNode of rawNodes) {
        const node = readNode(rawNode);
        if (!node) continue;
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

  if (!nodes.has(rootId)) nodes.set(rootId, { id: rootId, kind: "Root", name: rootId });
  return { nodes: [...nodes.values()], edges, levels };
}

export function serviceArchitectureTools(client: DiscoveryClient) {
  return {
    discovery_service_architecture: {
      description: "Generate a self-contained D3 hierarchical service architecture diagram from a root BusinessApplication or Host node id. Use this when the user asks for an architecture diagram or service schema; prefer discovery_dependency_map for dense mesh/topology/blast-radius graphs.",
      schema: serviceArchitectureSchema,
      handler: async (input: z.infer<typeof serviceArchitectureSchema>) => {
        const { nodes, edges, levels } = await collectArchitectureGraph(client, input.rootId, input.depth);
        const rootName = nodes.find((node) => node.id === input.rootId)?.name ?? input.rootId;
        const title = input.title ?? `Service architecture · ${rootName}`;
        const html = buildServiceArchitectureHtml(nodes, edges, input.rootId, title);
        return {
          summary: `${nodes.length} nœuds, ${levels} niveaux`,
          html
        };
      }
    }
  };
}
