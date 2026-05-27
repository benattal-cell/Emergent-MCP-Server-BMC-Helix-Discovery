import { z } from "zod";

const guideSchema = z.object({
  request: z.string().min(1),
  maxUseCases: z.number().int().min(1).max(12).default(5),
  language: z.enum(["fr", "en"]).optional()
}).strict();

type GuideItem = { tool: string; purpose: string; useCase: string };

type GuideSection = { id: string; title: string; keywords: string[]; items: GuideItem[] };

const sections: GuideSection[] = [
  {
    id: "lifecycle",
    title: "Gestion des fins de support / lifecycle",
    keywords: ["fin de support", "end of support", "eos", "eoss", "extended support", "eol", "lifecycle", "retirement", "obsolète", "obsolete", "outdated"],
    items: [
      { tool: "discovery_lifecycle_report", purpose: "Exécuter un rapport lifecycle standardisé.", useCase: "Lister les logiciels proches ou au-delà de EOS/EOSS/EOES/EOL." },
      { tool: "discovery_build_lifecycle_query", purpose: "Générer une requête lifecycle flexible filtrable.", useCase: "Filtrer par publisher/produit/hôte et adapter la fenêtre de risque." },
      { tool: "discovery_find_software_instances", purpose: "Trouver rapidement des instances logicielles.", useCase: "Pré-cibler un type/version avant analyse lifecycle." }
    ]
  },
  {
    id: "cve",
    title: "Vulnérabilités CVE/CPE",
    keywords: ["cve", "cpe", "vuln", "vulnerability", "vulnérabilité", "nvd", "exposition", "exposure", "patch"],
    items: [
      { tool: "discovery_cve_executive_summary", purpose: "Produire une fiche CVE synthétique (style briefing) et demander si l'utilisateur veut le détail complet.", useCase: "Donner un résumé risque + top impacts business/hosts/versions avant drill-down." },
      { tool: "discovery_get_cve_cpes_from_nvd", purpose: "Récupérer les CPE associés à une CVE depuis NVD.", useCase: "Obtenir les cibles techniques d'une CVE sans saisie manuelle." },
      { tool: "discovery_build_cve_software_query", purpose: "Construire la requête Discovery à partir de CPE.", useCase: "Générer une recherche prête à l'emploi pour identifier les logiciels impactés." },
      { tool: "discovery_cve_full_inventory_prompt", purpose: "Préparer l'appel qui retourne l'inventaire complet impacté.", useCase: "Si l'utilisateur veut en savoir plus, lancer l'extraction détaillée (table complète)." }
    ]
  },
  {
    id: "inventory",
    title: "Inventaire hôtes / logiciels",
    keywords: ["host", "hôte", "serveur", "server", "machine", "software", "logiciel", "soft", "application", "instance", "count", "combien", "inventaire", "inventory"],
    items: [
      { tool: "discovery_find_hosts", purpose: "Lister/filtrer des hôtes par nom ou OS.", useCase: "Combien de serveurs Linux ? Quels hôtes contiennent 'PROD' dans leur nom ?" },
      { tool: "discovery_find_software_instances", purpose: "Lister/filtrer des instances logicielles.", useCase: "Toutes les instances Oracle, ou tous les Apache." },
      { tool: "discovery_find_host_software", purpose: "Lister les logiciels installés sur un hôte donné.", useCase: "Que tourne-t-il sur SAP-PROD-01 ?" }
    ]
  },
  {
    id: "taxonomy",
    title: "Exploration taxonomy Discovery",
    keywords: ["taxonomy", "nodekind", "fieldlist", "relkind", "model", "modèle", "schema"],
    items: [
      { tool: "discovery_taxonomy_node_kinds", purpose: "Lister les types de nœuds disponibles.", useCase: "Savoir quels kinds sont exploitables dans les requêtes." },
      { tool: "discovery_taxonomy_node_fields", purpose: "Lister les champs d'un kind.", useCase: "Identifier le nom exact d'un attribut avant une query." },
      { tool: "discovery_taxonomy_relkind_details", purpose: "Détailler un type de relation.", useCase: "Valider les relations à utiliser entre Host et Software." }
    ]
  }
];

function pickSections(request: string): GuideSection[] {
  const q = request.toLowerCase();
  const matched = sections.filter((s) => s.keywords.some((k) => q.includes(k)));
  return matched.length > 0 ? matched : sections;
}

function resolveLanguage(language: "fr" | "en" | undefined, request: string): "fr" | "en" {
  if (language) return language;
  const q = request.toLowerCase();
  if (/\b(bonjour|merci|que|quoi|comment|fin de support|vuln|requête|outil|combien|quels|quelles)\b/.test(q)) return "fr";
  return "en";
}

export function assistantGuideTools() {
  return {
    discovery_tool_guide: {
      description: "READ THIS FIRST. Use this tool BEFORE answering any user question about BMC Helix Discovery data, software inventory, hosts, CVE vulnerabilities, end-of-life software, compliance, or licensing. Pass the user's raw question as 'request'. Returns the list of relevant MCP tools to call next AND example use cases. Calling this first prevents picking the wrong tool. Skip it ONLY if the user explicitly names a specific MCP tool to use.",
      schema: guideSchema,
      handler: async (input: z.infer<typeof guideSchema>) => {
        const selected = pickSections(input.request);
        const language = resolveLanguage(input.language, input.request);
        const lines: string[] = [];
        if (language === "fr") {
          lines.push(`Demande comprise: ${input.request}`);
          lines.push("Je me limite aux capacités MCP pertinentes pour cette demande.");
        } else {
          lines.push(`Understood request: ${input.request}`);
          lines.push("I am limiting guidance to the MCP capabilities relevant to this request.");
        }
        for (const section of selected) {
          lines.push(`\n## ${section.title}`);
          for (const item of section.items.slice(0, input.maxUseCases)) {
            lines.push(language === "fr"
              ? `- ${item.tool}: ${item.purpose} Exemple: ${item.useCase}`
              : `- ${item.tool}: ${translatePurpose(item.purpose)} Example: ${translateUseCase(item.useCase)}`);
          }
        }
        return {
          request: input.request,
          language,
          matchedSections: selected.map((s) => s.id),
          guidance: lines.join("\n")
        };
      }
    }
  };
}

function translatePurpose(text: string): string {
  const map: Record<string, string> = {
    "Exécuter un rapport lifecycle standardisé.": "Run a standardized lifecycle report.",
    "Générer une requête lifecycle flexible filtrable.": "Build a flexible, filterable lifecycle query.",
    "Trouver rapidement des instances logicielles.": "Quickly find software instances.",
    "Produire une fiche CVE synthétique (style briefing) et demander si l'utilisateur veut le détail complet.": "Produce a CVE executive summary and ask whether full details are needed.",
    "Récupérer les CPE associés à une CVE depuis NVD.": "Fetch CPEs associated with a CVE from NVD.",
    "Construire la requête Discovery à partir de CPE.": "Build the Discovery query from CPE strings.",
    "Préparer l'appel qui retourne l'inventaire complet impacté.": "Prepare the call that returns the full impacted inventory.",
    "Lister/filtrer des hôtes par nom ou OS.": "List/filter hosts by name or OS.",
    "Lister/filtrer des instances logicielles.": "List/filter software instances.",
    "Lister les logiciels installés sur un hôte donné.": "List software installed on a given host.",
    "Lister les types de nœuds disponibles.": "List available node kinds.",
    "Lister les champs d'un kind.": "List fields for a node kind.",
    "Détailler un type de relation.": "Show details for a relationship kind."
  };
  return map[text] ?? text;
}

function translateUseCase(text: string): string {
  const map: Record<string, string> = {
    "Lister les logiciels proches ou au-delà de EOS/EOSS/EOES/EOL.": "List software close to, or beyond, EOS/EOSS/EOES/EOL.",
    "Filtrer par publisher/produit/hôte et adapter la fenêtre de risque.": "Filter by publisher/product/host and tune the risk window.",
    "Pré-cibler un type/version avant analyse lifecycle.": "Pre-target a type/version before lifecycle analysis.",
    "Donner un résumé risque + top impacts business/hosts/versions avant drill-down.": "Provide risk summary + top business/host/version impacts before drill-down.",
    "Obtenir les cibles techniques d'une CVE sans saisie manuelle.": "Get CVE technical targets without manual data entry.",
    "Générer une recherche prête à l'emploi pour identifier les logiciels impactés.": "Generate a ready-to-run search to identify impacted software.",
    "Si l'utilisateur veut en savoir plus, lancer l'extraction détaillée (table complète).": "If the user wants more details, run the detailed extraction (full table).",
    "Combien de serveurs Linux ? Quels hôtes contiennent 'PROD' dans leur nom ?": "How many Linux servers? Which hosts contain 'PROD' in their name?",
    "Toutes les instances Oracle, ou tous les Apache.": "All Oracle instances, or all Apache instances.",
    "Que tourne-t-il sur SAP-PROD-01 ?": "What's running on SAP-PROD-01?",
    "Savoir quels kinds sont exploitables dans les requêtes.": "Determine which kinds can be used in queries.",
    "Identifier le nom exact d'un attribut avant une query.": "Identify exact attribute names before running a query.",
    "Valider les relations à utiliser entre Host et Software.": "Validate relationships to use between Host and Software."
  };
  return map[text] ?? text;
}
