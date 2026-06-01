import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";
import { renderTopologyVisual } from "../svg/topologyVisual.js";
import { RESOLVABLE_TARGET_KINDS, resolveTarget, type ResolveTargetResult } from "../discovery/resolveTarget.js";
import { dependencyScopeOutputSchema } from "./outputSchemas.js";
import { SVG_VISUAL_DESCRIPTION } from "./visualInstructions.js";

export const dependencyScopeSchema = z.object({
  target: z.string().min(1),
  targetKind: z.enum(RESOLVABLE_TARGET_KINDS).optional()
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

function resolutionError(target: string, resolution: Extract<ResolveTargetResult, { status: "none" | "ambiguous" }>) {
  if (resolution.status === "none") {
    const text = `Rien trouvé pour ${target}.`;
    return { content: [{ type: "text", text }], structuredContent: { status: "none", target }, isError: true };
  }
  const candidatesText = resolution.candidates.map((candidate) => `${candidate.name} (${candidate.kind}) [id: ${candidate.id}]`).join(", ");
  const text = `Cible ambiguë pour ${target}. Candidats: ${candidatesText}. Pour choisir, rappelez l'outil avec targetKind=<kind> OU target=<id exact>.`;
  return { content: [{ type: "text", text }], structuredContent: { status: "ambiguous", target, candidates: resolution.candidates }, isError: true };
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

      description: "Lightweight probe. Given a NAME (BusinessService, BusinessApplicationInstance, Host or SoftwareInstance) OR a Discovery nodeId, returns ONLY the SIZE of the topology around it (node/relation counts by kind, in/out fan) WITHOUT drawing the graph. Use BEFORE discovery_dependency_map to estimate size and pick a depth. For the actual visual graph, use discovery_dependency_map. Returns a statistics summary card to render inline. Use targetKind to disambiguate NAME resolution, or pass target=<id exact>.",

      schema: dependencyScopeSchema,
      outputSchema: dependencyScopeOutputSchema,
      visualInstruction: SVG_VISUAL_DESCRIPTION,
      handler: async (input: z.infer<typeof dependencyScopeSchema>) => {
        const resolution = await resolveTarget(client, input.target, { targetKind: input.targetKind });
        if (resolution.status === "none" || resolution.status === "ambiguous") return resolutionError(input.target, resolution);
        const id = resolution.status === "node_id" ? resolution.id : resolution.id;
        const name = resolution.status === "node_id" ? undefined : resolution.name;
        const resolvedAs: "node_id" | "host_name" = resolution.status === "node_id" ? "node_id" : "host_name";

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
