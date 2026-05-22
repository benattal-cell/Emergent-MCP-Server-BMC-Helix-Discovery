import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";

const nodeIdSchema = z.object({
  nodeId: z.string().min(1)
}).strict();

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function summarizeGraph(raw: unknown): unknown {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const nodes = toArray(obj.nodes);
  const rawEdges = Array.isArray(obj.edges) ? obj.edges : obj.relationships;
  const edges = toArray(rawEdges);

  const nodeKinds: Record<string, number> = {};
  for (const n of nodes) {
    const kind = n && typeof n === "object" && typeof (n as { kind?: unknown }).kind === "string"
      ? (n as { kind: string }).kind
      : "Unknown";
    nodeKinds[kind] = (nodeKinds[kind] ?? 0) + 1;
  }

  const relationKinds: Record<string, number> = {};
  for (const e of edges) {
    const kind = e && typeof e === "object" && typeof (e as { kind?: unknown; type?: unknown }).kind === "string"
      ? (e as { kind: string }).kind
      : (e && typeof e === "object" && typeof (e as { type?: unknown }).type === "string"
        ? (e as { type: string }).type
        : "Unknown");
    relationKinds[kind] = (relationKinds[kind] ?? 0) + 1;
  }

  return {
    counts: {
      nodes: nodes.length,
      relations: edges.length
    },
    nodeKinds,
    relationKinds,
    cmdbView: {
      ciCount: nodes.length,
      relationCount: edges.length,
      topCiClasses: Object.entries(nodeKinds).sort((a, b) => b[1] - a[1]).slice(0, 10),
      topRelationTypes: Object.entries(relationKinds).sort((a, b) => b[1] - a[1]).slice(0, 10)
    }
  };
}

export function graphTools(client: DiscoveryClient) {
  return {
    discovery_get_node_graph: {
      schema: nodeIdSchema,
      handler: async (input: z.infer<typeof nodeIdSchema>) => client.getNodeGraph(input.nodeId)
    },
    discovery_summarize_node_graph_cmdb: {
      schema: z.object({ graph: z.unknown() }).strict(),
      handler: async (input: { graph: unknown }) => summarizeGraph(input.graph)
    }
  };
}
