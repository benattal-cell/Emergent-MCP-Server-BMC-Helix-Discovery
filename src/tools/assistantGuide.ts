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
    keywords: ["fin de support", "end of support", "eos", "eoss", "extended support", "eol", "lifecycle", "retirement", "obsolète", "obsolete", "outdated", "microsoft", "oracle", "adobe", "ibm", "support étendu", "patch"],
    items: [
      { tool: "discovery_lifecycle_report", purpose: "Exécuter directement un rapport lifecycle avec filtres intégrés (publisherContains, productContains, hostNameContains, typeIn).", useCase: "Pour 'logiciels Microsoft en fin de support', appeler avec publisherContains='Microsoft'. PAS BESOIN d'enchaîner build_lifecycle_query + search_data." },
      { tool: "discovery_build_lifecycle_query", purpose: "AVANCÉ. Construire le DSL sans l'exécuter, uniquement pour inspection.", useCase: "Rare : seulement si on doit modifier la requête avant exécution." },
      { tool: "discovery_find_software_instances", purpose: "Trouver rapidement des instances logicielles.", useCase: "Pré-cibler un type/version sans dimension lifecycle." }
    ]
  },
  {
    id: "cve",
    title: "Vulnérabilités CVE/CPE",
    keywords: ["cve", "cpe", "vuln", "vulnerability", "vulnérabilité", "nvd", "exposition", "exposure", "expose", "patch"],
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
    keywords: ["host", "hôte", "serveur", "server", "machine", "software", "logiciel", "soft", "application", "instance", "count", "combien", "inventaire", "inventory", "linux", "windows", "rhel"],
    items: [
      { tool: "discovery_find_hosts", purpose: "Lister/filtrer des hôtes par nom ou OS.", useCase: "Combien de serveurs Linux ? Quels hôtes contiennent 'PROD' dans leur nom ?" },
      { tool: "discovery_find_software_instances", purpose: "Lister/filtrer des instances logicielles.", useCase: "Toutes les instances Oracle, ou tous les Apache." },
      { tool: "discovery_find_host_software", purpose: "Lister les logiciels installés sur un hôte donné.", useCase: "Que tourne-t-il sur SAP-PROD-01 ?" }
    ]
  },
  {
    id: "dependency",
    title: "Dépendances / Topologie",
    keywords: ["dependency", "dépendance", "dependances", "topology", "topologie", "graph", "graphe", "map", "carte", "connected", "depends on", "impact", "blast radius"],
    items: [
      { tool: "discovery_dependency_scope", purpose: "Probe léger à appeler EN PREMIER pour estimer la taille du graphe avant rendu.", useCase: "Avant le rendu, évaluer nodes/relations pour choisir depth et éviter une carte trop dense." },
      { tool: "discovery_dependency_map", purpose: "Rendre une carte multi-représentation (PNG + SVG + HTML interactif autoportant). Si le client supporte les fichiers téléchargeables, il DOIT proposer le HTML interactif via le mécanisme natif (ex: present_files).", useCase: "Pour une analyse d'impact ou blast radius, afficher le PNG/SVG inline et proposer systématiquement le HTML interactif en téléchargement si possible." }
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
  if (/\b(bonjour|merci|que|quoi|comment|fin de support|vuln|requête|outil|combien|quels|quelles|chez nous)\b/.test(q)) return "fr";
  return "en";
}

const GLOBAL_RULES_FR = [
  "RÈGLE 1: N'invente JAMAIS du DSL Discovery (search/show). Utilise les outils paramétrés ci-dessous.",
  "RÈGLE 2: Si l'utilisateur mentionne un éditeur (Microsoft, Oracle...) ou un produit (Windows Server, JBoss...), passe-le DIRECTEMENT en paramètre `publisherContains` / `productContains` à `discovery_lifecycle_report`. Pas d'enchaînement.",
  "RÈGLE 3: La réponse de chaque outil contient un champ `summary` avec le chiffre clé. Cite-le textuellement avant tout détail.",
  "RÈGLE 4: Pour les outils retournant plusieurs représentations (ex: discovery_dependency_map), choisis la représentation la plus riche que ton client supporte. Le HTML interactif est autoportant — propose-le en téléchargement si possible."
];

const GLOBAL_RULES_EN = [
  "RULE 1: NEVER invent Discovery DSL (search/show). Use the parameterized tools listed below.",
  "RULE 2: If the user mentions a vendor (Microsoft, Oracle...) or a product (Windows Server, JBoss...), pass it DIRECTLY as `publisherContains` / `productContains` to `discovery_lifecycle_report`. No chaining.",
  "RULE 3: Every tool response includes a `summary` field with the headline count. Quote it verbatim before any detail.",
  "RULE 4: For tools returning multiple representations (e.g. discovery_dependency_map), choose the richest representation your client supports. The interactive HTML is self-contained — offer it as a downloadable artifact when possible."
];

export function assistantGuideTools() {
  return {
    discovery_tool_guide: {
      description: "READ THIS FIRST, ALWAYS, before ANY action involving BMC Helix Discovery data (software inventory, hosts, CVE vulnerabilities, end-of-life, compliance, licensing, dependencies, scans). Pass the user's raw question as `request`. Returns: (a) the list of relevant MCP tools to call next, (b) example use cases, (c) global rules to prevent common mistakes (such as inventing DSL). Skip this tool ONLY if the user explicitly names a specific MCP tool to use. Calling this first prevents wrong-tool selection and DSL improvisation.",
      schema: guideSchema,
      handler: async (input: z.infer<typeof guideSchema>) => {
        const selected = pickSections(input.request);
        const language = resolveLanguage(input.language, input.request);
        const rules = language === "fr" ? GLOBAL_RULES_FR : GLOBAL_RULES_EN;
        const lines: string[] = [];
        if (language === "fr") {
          lines.push(`Demande comprise: ${input.request}`);
          lines.push("");
          lines.push("## Règles globales");
          for (const rule of rules) lines.push(`- ${rule}`);
          lines.push("");
          lines.push("## Outils pertinents pour cette demande");
        } else {
          lines.push(`Understood request: ${input.request}`);
          lines.push("");
          lines.push("## Global rules");
          for (const rule of rules) lines.push(`- ${rule}`);
          lines.push("");
          lines.push("## Relevant tools for this request");
        }
        for (const section of selected) {
          lines.push(`\n### ${section.title}`);
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
          globalRules: rules,
          guidance: lines.join("\n")
        };
      }
    }
  };
}

function translatePurpose(text: string): string {
  const map: Record<string, string> = {
    "Exécuter directement un rapport lifecycle avec filtres intégrés (publisherContains, productContains, hostNameContains, typeIn).": "Run a lifecycle report directly with built-in filters (publisherContains, productContains, hostNameContains, typeIn).",
    "AVANCÉ. Construire le DSL sans l'exécuter, uniquement pour inspection.": "ADVANCED. Build the DSL string without executing it, only for inspection.",
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
    "Détailler un type de relation.": "Show details for a relationship kind.",
    "Probe léger à appeler EN PREMIER pour estimer la taille du graphe avant rendu.": "Lightweight probe to call FIRST to estimate graph size before rendering.",
    "Rendre une carte multi-représentation (PNG + SVG + HTML interactif autoportant). Si le client supporte les fichiers téléchargeables, il DOIT proposer le HTML interactif via le mécanisme natif (ex: present_files).": "Render a multi-representation map (PNG + SVG + self-contained interactive HTML). If the client supports downloadable files, it MUST offer the interactive HTML through the native mechanism (e.g. present_files).",
  };
  return map[text] ?? text;
}

function translateUseCase(text: string): string {
  const map: Record<string, string> = {
    "Pour 'logiciels Microsoft en fin de support', appeler avec publisherContains='Microsoft'. PAS BESOIN d'enchaîner build_lifecycle_query + search_data.": "For 'Microsoft software end-of-life', call with publisherContains='Microsoft'. NO NEED to chain build_lifecycle_query + search_data.",
    "Rare : seulement si on doit modifier la requête avant exécution.": "Rare: only when the query must be modified before execution.",
    "Pré-cibler un type/version sans dimension lifecycle.": "Pre-target a type/version with no lifecycle dimension.",
    "Donner un résumé risque + top impacts business/hosts/versions avant drill-down.": "Provide risk summary + top business/host/version impacts before drill-down.",
    "Obtenir les cibles techniques d'une CVE sans saisie manuelle.": "Get CVE technical targets without manual data entry.",
    "Générer une recherche prête à l'emploi pour identifier les logiciels impactés.": "Generate a ready-to-run search to identify impacted software.",
    "Si l'utilisateur veut en savoir plus, lancer l'extraction détaillée (table complète).": "If the user wants more details, run the detailed extraction (full table).",
    "Combien de serveurs Linux ? Quels hôtes contiennent 'PROD' dans leur nom ?": "How many Linux servers? Which hosts contain 'PROD' in their name?",
    "Toutes les instances Oracle, ou tous les Apache.": "All Oracle instances, or all Apache instances.",
    "Que tourne-t-il sur SAP-PROD-01 ?": "What's running on SAP-PROD-01?",
    "Savoir quels kinds sont exploitables dans les requêtes.": "Determine which kinds can be used in queries.",
    "Identifier le nom exact d'un attribut avant une query.": "Identify exact attribute names before running a query.",
    "Valider les relations à utiliser entre Host et Software.": "Validate relationships to use between Host and Software.",
    "Avant le rendu, évaluer nodes/relations pour choisir depth et éviter une carte trop dense.": "Before rendering, evaluate nodes/relationships to choose depth and avoid an overly dense map.",
    "Pour une analyse d'impact ou blast radius, afficher le PNG/SVG inline et proposer systématiquement le HTML interactif en téléchargement si possible.": "For impact/blast-radius analysis, render PNG/SVG inline and always offer the interactive HTML as a downloadable artifact when possible.",
  };
  return map[text] ?? text;
}
