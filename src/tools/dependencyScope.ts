import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";
import { renderTopologyVisual } from "../svg/topologyVisual.js";
import { dependencyScopeOutputSchema } from "./outputSchemas.js";

export const dependencyScopeSchema = z.object({
  target: z.string().min(1)
}).strict();

interface ScopeResult {
  resolved: { type: "node_id" | "host_name"; id?: string; name?: string };
  counts: {
    nodes: number;
    relations: number;
    inbound: number;
    outbound: number;
  };
  nodeKinds: Record<string, number>;
  relationKinds: Record<string, number>;
  suggestion: string;
}

function looksLikeNodeId(value: string): boolean {
  return value.length >= 16 && !/\s/.test(value) && /^[A-Za-z0-9+/=_\-]+$/.test(value);
}

function inferDirection(link: Record<string, unknown>, focusId: string): "in" | "out" | "unknown" {
  const src = typeof link.src_id === "string" ? link.src_id : undefined;
  const tgt = typeof link.tgt_id === "string" ? link.tgt_id : undefined;
  if (src === focusId) return "out";
  if (tgt === focusId) return "in";
  return "unknown";
}

export function dependencyScopeTools(client: DiscoveryClient) {
  return {
    discovery_dependency_scope: {
      description: "Lightweight probe: given a host name OR a Discovery nodeId, returns the topology size around it (node counts by kind, relation counts by kind, in/out fan). Use this BEFORE discovery_dependency_map to estimate how big the graph will be and pick a sensible depth.",
      schema: dependencyScopeSchema,
      outputSchema: dependencyScopeOutputSchema,
      handler: async (input: z.infer<typeof dependencyScopeSchema>) => {
        let id: string | undefined;
        let name: string | undefined;
        let resolvedAs: "node_id" | "host_name";

        if (looksLikeNodeId(input.target)) {
          id = input.target;
          resolvedAs = "node_id";
        } else {
          const found = await client.findHosts({ nameContains: input.target, limit: 1 });
          const first = found.rows[0] as { id?: unknown; name?: unknown } | undefined;
          if (!first || typeof first.id !== "string") {
            throw new Error(`No host found matching '${input.target}' and value does not look like a node id`);
          }
          id = first.id;
          name = typeof first.name === "string" ? first.name : undefined;
          resolvedAs = "host_name";
        }

        const graphRaw = await client.getNodeGraph(id);
        const graph = (graphRaw && typeof graphRaw === "object") ? graphRaw as Record<string, unknown> : {};
        const nodes = Array.isArray(graph.nodes) ? graph.nodes as Array<Record<string, unknown>> : [];
        const links = Array.isArray(graph.links) ? graph.links as Array<Record<string, unknown>> : [];

        const nodeKinds: Record<string, number> = {};
        for (const n of nodes) {
          const k = typeof n.kind === "string" ? n.kind : "Unknown";
          nodeKinds[k] = (nodeKinds[k] ?? 0) + 1;
        }

        const relationKinds: Record<string, number> = {};
        let inbound = 0;
        let outbound = 0;
        for (const link of links) {
          const k = typeof link.kind === "string" ? link.kind : "Unknown";
          relationKinds[k] = (relationKinds[k] ?? 0) + 1;
          const dir = inferDirection(link, id);
          if (dir === "in") inbound++;
          else if (dir === "out") outbound++;
        }

        let suggestion: string;
        if (nodes.length === 0) suggestion = "No neighbors found. Check the target identifier.";
        else if (nodes.length > 80) suggestion = "Dense neighborhood — call discovery_dependency_map with depth=1 and filter kinds.";
        else if (nodes.length > 25) suggestion = "Medium neighborhood — discovery_dependency_map with depth=1 should render cleanly.";
        else suggestion = "Small neighborhood — safe to call discovery_dependency_map with depth=2.";

        const result: ScopeResult = {
          resolved: { type: resolvedAs, id, name },
          counts: { nodes: nodes.length, relations: links.length, inbound, outbound },
          nodeKinds,
          relationKinds,
          suggestion
        };

        return renderTopologyVisual(graphRaw, {
          name: `dependency_scope_${id.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase()}`,
          title: `Dependency scope · ${name ?? id}`,
          focusId: id,
          textSummary: `${nodes.length} nodes, ${links.length} relations. ${suggestion}`,
          structuredContent: { ...result, rawGraph: graphRaw }
        });
      },
      isVisual: true as const
    }
  };
}
