import { z } from "zod";
import { Graphviz } from "@hpcc-js/wasm-graphviz";
import { DiscoveryClient } from "../discoveryClient.js";
import { renderVisual } from "../svg/renderer.js";

export const dependencyMapSchema = z.object({
  target: z.string().min(1),
  depth: z.number().int().min(1).max(3).default(1),
  kinds: z.array(z.string().min(1)).optional(),
  maxNodes: z.number().int().min(5).max(200).default(60),
  engine: z.enum(["dot", "neato", "fdp", "sfdp", "twopi", "circo"]).default("dot")
}).strict();

interface GraphNode { id: string; kind: string; name: string; }
interface GraphEdge { from: string; to: string; kind: string; }

function looksLikeNodeId(value: string): boolean {
  return value.length >= 16 && !/\s/.test(value) && /^[A-Za-z0-9+/=_\-]+$/.test(value);
}

let graphvizInstance: Awaited<ReturnType<typeof Graphviz.load>> | null = null;
async function getGraphviz() {
  if (!graphvizInstance) graphvizInstance = await Graphviz.load();
  return graphvizInstance;
}

async function walkGraph(client: DiscoveryClient, focusId: string, depth: number, maxNodes: number) {
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
      const g = raw as Record<string, unknown>;
      const rawNodes = Array.isArray(g.nodes) ? g.nodes as Array<Record<string, unknown>> : [];
      const rawLinks = Array.isArray(g.links) ? g.links as Array<Record<string, unknown>> : [];

      for (const n of rawNodes) {
        const nid = typeof n.id === "string" ? n.id : undefined;
        if (!nid) continue;
        if (!nodes.has(nid) && nodes.size < maxNodes) {
          nodes.set(nid, { id: nid, kind: typeof n.kind === "string" ? n.kind : "Unknown", name: typeof n.name === "string" ? n.name : (typeof n.short_name === "string" ? n.short_name : nid) });
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

export function dependencyMapTools(client: DiscoveryClient) {
  return {
    discovery_dependency_map: {
      description: "Render a dependency map (SVG + PNG) around a Discovery node.",
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

        const { nodes, edges } = await walkGraph(client, focusId, input.depth, input.maxNodes);
        const truncated = nodes.size >= input.maxNodes;
        const dot = `digraph G {\n${Array.from(nodes.values()).map((n) => `  "${n.id}" [label="${n.name}"];`).join("\n")}\n${edges.map((e) => `  "${e.from}" -> "${e.to}" [label="${e.kind}"];`).join("\n")}\n}`;
        const graphviz = await getGraphviz();
        const svg = graphviz.dot(dot, "svg", { engine: input.engine });
        return renderVisual(svg, {
          name: `depmap_${focusName.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase()}_d${input.depth}`,
          textSummary: `Dependency map for '${focusName}': ${nodes.size} nodes, ${edges.length} edges${truncated ? " (truncated)" : ""}. Engine=${input.engine}, depth=${input.depth}.`,
          pngWidth: 1600
        });
      },
      isVisual: true as const
    }
  };
}
