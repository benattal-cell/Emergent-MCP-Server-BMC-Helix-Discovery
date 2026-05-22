import { z } from "zod";

const guideSchema = z.object({
  request: z.string().min(1),
  maxUseCases: z.number().int().min(1).max(12).default(5)
}).strict();

type GuideItem = { tool: string; purpose: string; useCase: string };

type GuideSection = { id: string; title: string; keywords: string[]; items: GuideItem[] };

const sections: GuideSection[] = [
  {
    id: "lifecycle",
    title: "Gestion des fins de support / lifecycle",
    keywords: ["fin de support", "end of support", "eos", "eoss", "extended support", "eol", "lifecycle", "retirement"],
    items: [
      { tool: "discovery_lifecycle_report", purpose: "Exécuter un rapport lifecycle standardisé.", useCase: "Lister les logiciels proches ou au-delà de EOS/EOSS/EOES/EOL." },
      { tool: "discovery_build_lifecycle_query", purpose: "Générer une requête lifecycle flexible filtrable.", useCase: "Filtrer par publisher/produit/hôte et adapter la fenêtre de risque." },
      { tool: "discovery_find_software_instances", purpose: "Trouver rapidement des instances logicielles.", useCase: "Pré-cibler un type/version avant analyse lifecycle." }
    ]
  },
  {
    id: "cve",
    title: "Vulnérabilités CVE/CPE",
    keywords: ["cve", "cpe", "vuln", "vulnerability", "nvd"],
    items: [
      { tool: "discovery_get_cve_cpes_from_nvd", purpose: "Récupérer les CPE associés à une CVE depuis NVD.", useCase: "Obtenir les cibles techniques d'une CVE sans saisie manuelle." },
      { tool: "discovery_build_cve_software_query", purpose: "Construire la requête Discovery à partir de CPE.", useCase: "Générer une recherche prête à l’emploi pour identifier les logiciels impactés." }
    ]
  },
  {
    id: "taxonomy",
    title: "Exploration taxonomy Discovery",
    keywords: ["taxonomy", "nodekind", "fieldlist", "relkind", "model"],
    items: [
      { tool: "discovery_taxonomy_node_kinds", purpose: "Lister les types de nœuds disponibles.", useCase: "Savoir quels kinds sont exploitables dans les requêtes." },
      { tool: "discovery_taxonomy_node_fields", purpose: "Lister les champs d’un kind.", useCase: "Identifier le nom exact d’un attribut avant une query." },
      { tool: "discovery_taxonomy_relkind_details", purpose: "Détailler un type de relation.", useCase: "Valider les relations à utiliser entre Host et Software." }
    ]
  }
];

function pickSections(request: string): GuideSection[] {
  const q = request.toLowerCase();
  const matched = sections.filter((s) => s.keywords.some((k) => q.includes(k)));
  return matched.length > 0 ? matched : sections;
}

export function assistantGuideTools() {
  return {
    discovery_tool_guide: {
      schema: guideSchema,
      handler: async (input: z.infer<typeof guideSchema>) => {
        const selected = pickSections(input.request);
        const lines: string[] = [];
        lines.push(`Demande comprise: ${input.request}`);
        lines.push("Je me limite aux capacités MCP pertinentes pour cette demande.");
        for (const section of selected) {
          lines.push(`\n## ${section.title}`);
          for (const item of section.items.slice(0, input.maxUseCases)) {
            lines.push(`- ${item.tool}: ${item.purpose} Exemple: ${item.useCase}`);
          }
        }
        return {
          request: input.request,
          matchedSections: selected.map((s) => s.id),
          guidance: lines.join("\n")
        };
      }
    }
  };
}
