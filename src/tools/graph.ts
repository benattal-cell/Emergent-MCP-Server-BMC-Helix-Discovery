import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";
import { renderTopologyVisual } from "../svg/topologyVisual.js";
import { graphOutputSchema, graphSummaryOutputSchema } from "./outputSchemas.js";
import { CYTOSCAPE_VISUAL_DESCRIPTION } from "./visualInstructions.js";

const nodeIdSchema = z.object({
  nodeId: z.string().min(1)
}).strict();

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function summarizeGraph(raw: unknown): unknown {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const nodes = toArray(obj.nodes);
  const rawEdges = Array.isArray(obj.edges) ? obj.edges : (Array.isArray(obj.links) ? obj.links : obj.relationships);
  const edges = toArray(rawEdges);

  const nodeKinds: Record<string, number> = {};
  for (const n of nodes) {
    const kind = n && typeof n === "object" && typeof (n as { kind?: unknown; type?: unknown }).kind === "string"
      ? (n as { kind: string }).kind
      : (n && typeof n === "object" && typeof (n as { type?: unknown }).type === "string"
        ? (n as { type: string }).type
        : "Unknown");
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
    counts: { nodes: nodes.length, relations: edges.length },
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
      description: "Get the dependency graph around a specific node (by nodeId): all directly-connected nodes and the relationships between them. Use this when the user asks 'what depends on X?', 'what's connected to X?', 'show the topology around X'. The nodeId must come from a previous search (e.g. discovery_find_hosts returns a 'key' field that's the nodeId).",
      schema: nodeIdSchema,
      outputSchema: graphOutputSchema,
      visualInstruction: CYTOSCAPE_VISUAL_DESCRIPTION,
      handler: async (input: z.infer<typeof nodeIdSchema>) => {
        const raw = await client.getNodeGraph(input.nodeId);
        const summary = summarizeGraph(raw) as { counts?: { nodes?: number; relations?: number } };
        return renderTopologyVisual(raw, {
          name: `node_graph_${input.nodeId.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase()}`,
          title: `Node graph · ${input.nodeId}`,
          focusId: input.nodeId,
          textSummary: `Node graph for ${input.nodeId}: ${summary.counts?.nodes ?? 0} nodes, ${summary.counts?.relations ?? 0} relations.`,
          structuredContent: raw
        });
      },
      isVisual: true as const
    },
    discovery_summarize_node_graph_cmdb: {
      description: "Take the raw graph output of discovery_get_node_graph and summarize it CMDB-style: total CI count, top CI classes, top relationship types. Use this right after discovery_get_node_graph when the raw graph is too verbose for the user.",
      schema: z.object({ graph: z.unknown() }).strict(),
      outputSchema: graphSummaryOutputSchema,
      handler: async (input: { graph: unknown }) => summarizeGraph(input.graph)
    }
  };
}
