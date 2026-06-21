import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";
import { resolveTarget } from "../discovery/resolveTarget.js";
import { dependencyScopeTools } from "./dependencyScope.js";
import { dependencyMapTools } from "./dependencyMap.js";
import { serviceArchitectureTools } from "./serviceArchitecture.js";
import { graphTools } from "./graph.js";
import { CYTOSCAPE_VISUAL_DESCRIPTION } from "./visualInstructions.js";

const kindPattern = /^[A-Za-z][A-Za-z0-9_]*$/;

export const topologySchema = z.object({
  target: z.string().min(1).describe("Nom ou nodeId de la cible (Host, SoftwareInstance, NetworkDevice, SoftwareContainer, BusinessService, BusinessApplicationInstance…)"),
  targetKind: z.string().regex(kindPattern).optional().describe("Kind Discovery réel pour désambiguïser la résolution du nom (ex. Host, NetworkDevice, SoftwareContainer, StorageSystem, BusinessService)"),
  mode: z.enum(["scope", "summary", "map", "service"]).default("map"),
  depth: z.number().int().min(1).max(4).default(1).describe("Profondeur de traversée (mode map: max 3 ; mode service: max 4)"),
  maxNodes: z.number().int().min(5).max(500).default(60),
  layout: z.enum(["concentric", "hierarchical", "cose"]).default("concentric").describe("Layout du rendu interactif (mode map)"),
  kinds: z.array(z.string().regex(kindPattern)).optional().describe("Restreint les kinds AFFICHÉS dans le graphe (mode map) ; n'affecte pas la résolution de la cible")
}).strict();

const DESCRIPTION = [
  "Topologie / dépendances autour de N'IMPORTE QUEL objet Discovery (Host, SoftwareInstance, NetworkDevice, SoftwareContainer, BusinessService, BusinessApplicationInstance…). Un seul outil, quatre modes :",
  "- mode=scope : DIMENSIONNE le voisinage (compteurs par kind, fan-in/out) SANS dessiner. À lancer EN PREMIER sur un objet inconnu pour choisir depth/filtres.",
  "- mode=summary : synthèse type CMDB (nb de CI, top classes de CI, top types de relations). Pas de dessin.",
  "- mode=map (défaut) : DESSINE le graphe de dépendances interactif (multi-sauts via depth/maxNodes ; layout concentric|hierarchical|cose).",
  "- mode=service : arbre hiérarchique BusinessService → BusinessService (cibles BusinessService uniquement).",
  "Fournir target (nom ou nodeId) et éventuellement targetKind pour désambiguïser. scope/summary/map acceptent tout kind ; service est réservé aux BusinessService."
].join("\n");

export function topologyTools(client: DiscoveryClient) {
  const scope = dependencyScopeTools(client);
  const map = dependencyMapTools(client);
  const service = serviceArchitectureTools(client);
  const graph = graphTools(client);

  return {
    discovery_topology: {
      description: DESCRIPTION,
      schema: topologySchema,
      visualInstruction: CYTOSCAPE_VISUAL_DESCRIPTION,
      handler: async (input: z.infer<typeof topologySchema>) => {
        const targetKind = input.targetKind;
        switch (input.mode) {
          case "scope":
            return scope.discovery_dependency_scope.handler({ target: input.target, targetKind } as never);
          case "service":
            return service.discovery_service_architecture.handler({
              serviceName: input.target,
              targetKind,
              depth: Math.min(input.depth, 4),
              maxNodes: input.maxNodes
            } as never);
          case "map":
            return map.discovery_dependency_map.handler({
              target: input.target,
              targetKind,
              depth: Math.min(input.depth, 3),
              kinds: input.kinds,
              maxNodes: input.maxNodes,
              iterations: 200,
              linLog: false,
              gravity: 1,
              scalingRatio: 10,
              layout: input.layout
            } as never);
          case "summary":
          default: {
            const resolution = await resolveTarget(client, input.target, targetKind ? { targetKind } : {});
            if (resolution.status === "none") {
              return { content: [{ type: "text", text: `Rien trouvé pour ${input.target}.` }], structuredContent: { status: "none", target: input.target }, isError: true };
            }
            if (resolution.status === "ambiguous") {
              const candidatesText = resolution.candidates.map((c) => `${c.name} (${c.kind}) [id: ${c.id}]`).join(", ");
              return { content: [{ type: "text", text: `Cible ambiguë pour ${input.target}. Candidats: ${candidatesText}. Précise targetKind ou passe un nodeId exact.` }], structuredContent: { status: "ambiguous", candidates: resolution.candidates }, isError: true };
            }
            return graph.discovery_get_node_graph.handler({ nodeId: resolution.id, format: "summarize" } as never);
          }
        }
      },
      isVisual: true as const
    }
  };
}
