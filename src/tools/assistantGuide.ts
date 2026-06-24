import { z } from "zod";
import { getCatalogDigest, lookupByName, lookupByType } from "../discovery/catalog.js";
import { structuredOutputSchema } from "./outputSchemas.js";

const guideSchema = z.object({
  request: z.string().min(1),
  maxUseCases: z.number().int().min(1).max(12).default(5),
  language: z.enum(["fr", "en"]).optional()
}).strict();

type GuideItem = {
  tool: string;
  purpose: string;
  useCase: string;
  purposeEn: string;
  useCaseEn: string;
};

type GuideSection = { id: string; title: string; titleEn: string; keywords: string[]; items: GuideItem[] };

const sections: GuideSection[] = [
  {
    id: "it_costs",
    title: "Coûts IT / Value Review",
    titleEn: "IT costs / Value Review",
    keywords: ["cost", "coût", "cout", "costs", "saving", "savings", "économie", "economies", "value review", "business case", "tco", "roi", "azure", "aws", "vmware", "licence", "license", "rightsizing"],
    items: [
      {
        tool: "discovery_cost",
        purpose: "Coûts IT / Value Review, en 4 modes (paramètre `mode`). categories : familles du catalogue. search : composants par texte/catégorie/sous-catégorie. estimate : min/médian/max pour un `component` × `quantity` sur un horizon (mensuel/annuel/5 ans). compare : alternatives annualisées + économie face à `current_solution`. En estimate/compare, `scope` (service/fleet) chiffre un parc RÉEL : résout les VMs depuis Discovery, les bucketise par taille (vCPU/RAM), dérive la quantité.",
        useCase: "Value Review : mode=categories pour cadrer, mode=search pour trouver 'VM 4 vCPU/16 Go', mode=estimate pour chiffrer une charge. Économies sur un service réel : mode=compare + scope={type:'service', name:'Apex'} → on-prem vs Azure/AWS/GCP automatiquement. mode=compare + scope={type:'fleet'} pour tout le parc virtuel.",
        purposeEn: "IT costs / Value Review, in 4 modes (`mode` param). categories: catalog families. search: components by text/category/subcategory. estimate: min/median/max for a `component` × `quantity`. compare: annualized alternatives + savings versus `current_solution`. In estimate/compare, `scope` (service/fleet) prices a REAL fleet: resolves the VMs from Discovery, buckets them by size (vCPU/RAM), derives the quantity.",
        useCaseEn: "Value Review: mode=categories to frame, mode=search to find '4 vCPU/16 GB VM', mode=estimate to price a workload. Savings on a real service: mode=compare + scope={type:'service', name:'Apex'} → on-prem vs Azure/AWS/GCP automatically. mode=compare + scope={type:'fleet'} for the whole virtual estate."
      },
      {
        tool: "discovery_windows_license_report",
        purpose: "Calculer les licences Windows Server par hôte physique, chiffrer Standard vs Datacenter et pré-calculer les optimisations.",
        useCase: "Pour un audit licensing Windows/Datacenter/Hyper-V/VMware, appeler ce tool puis narrer les optimizationOpportunities en priorité économie décroissante.",
        purposeEn: "Calculate Windows Server licensing by physical host, price Standard vs Datacenter, and precompute optimization opportunities.",
        useCaseEn: "For a Windows/Datacenter/Hyper-V/VMware licensing audit, call this tool then narrate optimizationOpportunities by descending savings."
      }
    ]
  },
  {
    id: "health",
    title: "Santé / connectivité API",
    titleEn: "Health / API connectivity",
    keywords: ["health", "status", "statut", "connexion", "connectivité", "reachable", "version", "api", "about", "diagnostic"],
    items: [
      {
        tool: "discovery_about",
        purpose: "Métadonnées de l'instance Discovery (version, capacités). Avec `check=true` : health-check (joignabilité + version d'API configurée supportée, warning si écart).",
        useCase: "check=true quand un outil échoue, après un déploiement Railway, ou avant une série d'analyses. Sans check : diagnostiquer la version et les capacités exposées par `/api/about`.",
        purposeEn: "Discovery instance metadata (version, capabilities). With `check=true`: health-check (reachability + configured API version supported, warning on mismatch).",
        useCaseEn: "check=true when a tool fails, after a Railway deployment, or before a batch of analyses. Without check: diagnose the version and capabilities exposed by `/api/about`."
      }
    ]
  },
  {
    id: "lifecycle",
    title: "Gestion des fins de support / lifecycle",
    titleEn: "End-of-support / lifecycle management",
    keywords: ["fin de support", "end of support", "eos", "eoss", "extended support", "eol", "lifecycle", "retirement", "obsolète", "obsolete", "outdated", "microsoft", "oracle", "adobe", "ibm", "support étendu", "patch"],
    items: [
      {
        tool: "discovery_lifecycle_report",
        purpose: "Exécuter directement un rapport lifecycle. scope='software' (défaut) : SoftwareInstance avec filtres publisherContains/productContains/hostNameContains/typeIn. scope='os' : obsolescence OS depuis les Host (dates EOS/EOSS/EOES/EOL SupportDetail OS, gestion failure_reason, filtre osContains).",
        useCase: "Pour 'logiciels Microsoft en fin de support', appeler avec publisherContains='Microsoft'. Pour 'Windows Server obsolètes' / 'OS à risque', appeler avec scope='os' (+ osContains si besoin, onlyAtRisk=true). PAS BESOIN de construire le DSL séparément.",
        purposeEn: "Run a lifecycle report directly. scope='software' (default): SoftwareInstance with publisherContains/productContains/hostNameContains/typeIn filters. scope='os': OS obsolescence from Host nodes (OS SupportDetail EOS/EOSS/EOES/EOL dates, failure_reason handling, osContains filter).",
        useCaseEn: "For 'Microsoft software end-of-life', call with publisherContains='Microsoft'. For 'obsolete Windows Server' / 'OS at risk', call with scope='os' (+ osContains as needed, onlyAtRisk=true). No need to build the DSL separately."
      }
    ]
  },
  {
    id: "compliance",
    title: "Conformité / patch management",
    titleEn: "Compliance / patch management",
    keywords: ["conformité", "conformite", "compliance", "patch", "kb", "correctif", "hotfix", "windows update", "missing kb", "non conforme", "non-compliant"],
    items: [
      {
        tool: "discovery_patch_compliance_report",
        purpose: "Vérifier directement la conformité patch KB de hôtes Windows (virtuels et baremetal), avec filtre optionnel sur OS et logiciels hébergés.",
        useCase: "Pour 'quels serveurs n'ont pas KB4018271/KB500...' appeler avec kbList et complianceMode='all' ou 'any'; utiliser hostsSoftwareMatching + hostingFilter pour cibler les hôtes qui hébergent un logiciel donné.",
        purposeEn: "Directly check Windows host KB patch compliance (virtual and bare-metal), with optional OS and hosted-software filters.",
        useCaseEn: "For 'which servers miss KB4018271/KB500...', call with kbList and complianceMode='all' or 'any'; use hostsSoftwareMatching + hostingFilter to target hosts running a given software."
      }
    ]
  },
  {
    id: "cve",
    title: "Vulnérabilités CVE/CPE",
    titleEn: "CVE/CPE vulnerabilities",
    keywords: ["cve", "cpe", "vuln", "vulnerability", "vulnérabilité", "nvd", "exposition", "exposure", "expose", "patch"],
    items: [
      {
        tool: "discovery_cve_executive_summary",
        purpose: "Produire une fiche CVE synthétique (style briefing) et demander si l'utilisateur veut le détail complet.",
        useCase: "Donner un résumé risque + top impacts business/hosts/versions avant drill-down.",
        purposeEn: "Produce a CVE executive summary and ask whether full details are needed.",
        useCaseEn: "Provide risk summary + top business/host/version impacts before drill-down."
      },
      {
        tool: "discovery_get_cve_cpes_from_nvd",
        purpose: "Récupérer les CPE associés à une CVE depuis NVD.",
        useCase: "Obtenir les cibles techniques d'une CVE sans saisie manuelle.",
        purposeEn: "Fetch CPEs associated with a CVE from NVD.",
        useCaseEn: "Get CVE technical targets without manual data entry."
      }
    ]
  },
  {
    id: "inventory",
    title: "Inventaire hôtes / logiciels",
    titleEn: "Host / software inventory",
    keywords: ["host", "hôte", "serveur", "server", "machine", "software", "logiciel", "soft", "application", "instance", "count", "combien", "inventaire", "inventory", "linux", "windows", "rhel"],
    items: [
      {
        tool: "discovery_find",
        purpose: "Recherche générique sur n'importe quel kind. `kind` (Host, SoftwareInstance, NetworkDevice, SoftwareContainer…) + `contains` (matche TOUS les attributs : nom, OS, owner, domaine…). Option `relatedToKind`+`relatedToName` pour scoper par relation.",
        useCase: "Combien de serveurs Linux ? → kind=Host, contains='Linux'. Toutes les instances Oracle → kind=SoftwareInstance, contains='Oracle'. Que tourne-t-il sur SAP-PROD-01 ? → kind=SoftwareInstance, relatedToKind=Host, relatedToName='SAP-PROD-01'. Logiciels du service Apex → relatedToKind=BusinessService.",
        purposeEn: "Generic search on any kind. `kind` (Host, SoftwareInstance, NetworkDevice, SoftwareContainer…) + `contains` (matches EVERY attribute: name, OS, owner, domain…). Optional `relatedToKind`+`relatedToName` to scope by relationship.",
        useCaseEn: "How many Linux servers? → kind=Host, contains='Linux'. All Oracle instances → kind=SoftwareInstance, contains='Oracle'. What runs on SAP-PROD-01? → kind=SoftwareInstance, relatedToKind=Host, relatedToName='SAP-PROD-01'. Software of the Apex service → relatedToKind=BusinessService."
      }
    ]
  },
  {
    id: "dependency",
    title: "Dépendances / Topologie",
    titleEn: "Dependencies / topology",
    keywords: ["dependency", "dépendance", "dependances", "topology", "topologie", "graph", "graphe", "map", "carte", "connected", "depends on", "impact", "blast radius", "node graph", "cmdb", "urbanisation", "service map"],
    items: [
      {
        tool: "discovery_topology",
        purpose: "Topologie/dépendances autour de n'importe quel objet, en 4 modes (paramètre `mode`). scope : dimensionne d'ABORD (compteurs, sans dessiner). summary : synthèse CMDB. map : graphe interactif (PNG+SVG+HTML, `depth`/`layout`). service : arbre BusinessService→BusinessService.",
        useCase: "Lance mode=scope en premier sur un objet inconnu pour estimer la taille, puis mode=map pour dessiner (layout=hierarchical pour l'architecture, concentric pour blast-radius). mode=summary pour une lecture CMDB sans visuel ; mode=service pour l'arbre des services métier. target = nom ou nodeId (Host, SoftwareInstance, NetworkDevice, SoftwareContainer, BusinessService, BusinessApplicationInstance) ; targetKind pour désambiguïser.",
        purposeEn: "Topology/dependencies around any object, in 4 modes (`mode` param). scope: SIZE first (counts, no draw). summary: CMDB rollup. map: interactive graph (PNG+SVG+HTML, `depth`/`layout`). service: BusinessService→BusinessService tree.",
        useCaseEn: "Run mode=scope first on an unknown object to size it, then mode=map to draw (layout=hierarchical for architecture, concentric for blast-radius). mode=summary for a CMDB read without a visual; mode=service for the business-service tree. target = name or nodeId; targetKind to disambiguate."
      }
    ]
  },
  {
    id: "governance",
    title: "Gouvernance / orphelins / rationalisation",
    titleEn: "Governance / orphans / rationalization",
    keywords: ["orphan", "orphelin", "rationalisation", "rationalization", "unused", "inutilisé", "isolé", "isolated", "no inbound", "sans client", "sans backend", "sans logiciel", "governance", "gouvernance", "audit"],
    items: [
      {
        tool: "discovery_find_orphans",
        purpose: "Identifier les nœuds d'un kind donné sans relation entrante significative, sans preset caché de bruit.",
        useCase: "Bases SQL sans client applicatif, hosts sans software hébergé, pools sans backend, ou audit complet selon les noise_filters fournis par l'appelant.",
        purposeEn: "Find nodes of a given kind with no significant inbound relationship, with no hidden noise presets.",
        useCaseEn: "SQL databases without application clients, hosts with no hosted software, pools with no backend, or full audit depending on caller-provided noise_filters."
      },
      {
        tool: "discovery_execute_dsl",
        purpose: "Exécuter une requête DSL ; valide syntaxe + taxonomy avant exécution.",
        useCase: "Toujours conserver generated_dsl_query dans le résultat pour expliquer et debugger une analyse de gouvernance.",
        purposeEn: "Execute a DSL query; validates syntax + taxonomy before execution.",
        useCaseEn: "Always keep generated_dsl_query in the result to explain and debug a governance analysis."
      }
    ]
  },
  {
    id: "raw_dsl",
    title: "Requêtes DSL brutes / aide à la rédaction",
    titleEn: "Raw DSL queries / authoring help",
    keywords: ["dsl", "query", "requête", "search data", "search_data", "traverse", "traversal", "nodecount", "nodes", "lookup", "syntax", "syntaxe", "example", "exemple", "validate", "validation"],
    items: [
      {
        tool: "discovery_build_query",
        purpose: "Composer une requête DSL à partir d'une intention structurée (le LLM n'écrit pas le DSL). Valide syntaxe + taxonomy, refuse les chemins de traversée inconnus, n'exécute pas.",
        useCase: "Tout besoin non couvert par un outil paramétré : ex. 'les ESX avec plus de 10 VM Windows' → searchKind=Host + condition NODECOUNT > 10 sur traversal VirtualMachine.",
        purposeEn: "Compose a DSL query from structured intent (the LLM does not write DSL). Validates syntax + taxonomy, refuses unknown traversal paths, does not execute.",
        useCaseEn: "Any need not covered by a parameterized tool: e.g. 'ESX hosts with more than 10 Windows VMs' → searchKind=Host + NODECOUNT > 10 condition over a VirtualMachine traversal."
      },
      {
        tool: "discovery_execute_dsl",
        purpose: "Exécuter une dslQuery validée — typiquement celle produite par discovery_build_query après accord utilisateur.",
        useCase: "Après présentation de la dslQuery à l'utilisateur, exécuter la requête validée et conserver generated_dsl_query dans le résultat.",
        purposeEn: "Execute a validated dslQuery — typically one produced by discovery_build_query after user approval.",
        useCaseEn: "After showing the dslQuery to the user, execute the validated query and keep generated_dsl_query in the result."
      }
    ]
  },
  {
    id: "taxonomy",
    title: "Exploration taxonomy Discovery",
    titleEn: "Discovery taxonomy exploration",
    keywords: ["taxonomy", "nodekind", "node kind", "fieldlist", "field", "relkind", "relationship", "model", "modèle", "schema", "schéma", "attribute", "attribut"],
    items: [
      {
        tool: "discovery_taxonomy",
        purpose: "Introspecter le modèle live (node kinds, champs, field lists, relations) via le paramètre `resource`.",
        useCase: "Fallback : kind/attribut/relation inconnu, quand le cookbook de discovery_execute_dsl n'a pas suffi à bâtir la requête.",
        purposeEn: "Introspect the live model (node kinds, fields, field lists, relationships) via the `resource` parameter.",
        useCaseEn: "Fallback: unknown kind/attribute/relationship when the discovery_execute_dsl cookbook was not enough to build the query."
      }
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
  if (/\b(bonjour|merci|que|quoi|comment|fin de support|vuln|requête|outil|combien|quels|quelles|chez nous|dépendance|orphelin|gouvernance)\b/.test(q)) return "fr";
  return "en";
}

const GLOBAL_RULES_FR = [
  "R-A1: AVANT tout appel d'outil, si l'intention ne correspond pas clairement à un outil de niveau 1 (vulnérabilités/CVE, dépendances/graphe, architecture, obsolescence), pose UNE question pour clarifier. Ne rien appeler.",
  "R-A2: Si le tool exige un OBJET et qu'aucun objet n'est nommé, demande lequel avant d'appeler l'outil.",
  "R-A3: Si l'objet nommé est absent À LA FOIS du registre nominatif (services/apps/hosts) ET des types SoftwareInstance connus, demande DE QUEL TYPE d'objet il s'agit plutôt que de deviner ou de lancer un execute_dsl.",
  "R-A4: Ne JAMAIS improviser une requête DSL brute pour contourner une ambiguïté.",
  "R-A5: Si aucun outil paramétré de niveau 1 ne couvre le besoin, NE rédige PAS de DSL toi-même. Appelle discovery_build_query en lui fournissant l'intention structurée (searchKind, conditions where avec opérateurs fermés, traversals depuis le référentiel, show). Il compose et valide la requête.",
  "R-A6: discovery_build_query renvoie une dslQuery SANS l'exécuter (il valide déjà la syntaxe). Présente-la à l'utilisateur (il peut la modifier), puis exécute-la via discovery_execute_dsl (qui revalide avant exécution). Le cookbook DSL complet est embarqué dans la description de discovery_execute_dsl (chargé à la connexion) et aussi exposé en resource MCP (mcp://discovery/dsl-cookbook).",
  "RÈGLE 1: N'invente JAMAIS du DSL Discovery (search/show) si un outil spécialisé couvre le besoin. Utilise d'abord les outils paramétrés ci-dessous.",
  "RÈGLE 2: Si l'utilisateur mentionne un éditeur (Microsoft, Oracle...) ou un produit (Windows Server, JBoss...), passe-le DIRECTEMENT en paramètre `publisherContains` / `productContains` à `discovery_lifecycle_report`. Pas d'enchaînement.",
  "RÈGLE 3: La réponse de chaque outil contient généralement un champ `summary` avec le chiffre clé. Cite-le textuellement avant tout détail.",
  "RÈGLE 4: Pour les outils retournant plusieurs représentations (ex: discovery_topology mode=map), choisis la représentation la plus riche que ton client supporte. Le HTML interactif est autoportant — propose-le en téléchargement si possible.",
  "RÈGLE 5: Pour du DSL brut, utilise `discovery_build_query` pour composer et valider l'intention structurée ; exécute ensuite seulement la dslQuery validée via `discovery_execute_dsl` après présentation à l'utilisateur.",
  "RÈGLE 6: Les chemins de traversal doivent venir du référentiel via `discovery_build_query`/`common_relationships`; ne retomber sur `discovery_taxonomy` que pour un chemin ABSENT du référentiel."
];

const GLOBAL_RULES_EN = [
  "R-A1: BEFORE any tool call, if the intent does not clearly map to a level-1 tool (vulnerabilities/CVE, dependencies/graph, architecture, obsolescence), ask ONE clarifying question. Do not call anything.",
  "R-A2: If the tool requires an OBJECT and no object is named, ask which one before calling the tool.",
  "R-A3: If the named object is absent from BOTH the nominal registry (services/apps/hosts) and known SoftwareInstance types, ask WHAT TYPE of object it is instead of guessing or launching execute_dsl.",
  "R-A4: NEVER improvise a raw DSL query to work around ambiguity.",
  "R-A5: If no level-1 parameterized tool covers the need, do NOT write DSL yourself. Call discovery_build_query with structured intent (searchKind, where conditions with closed operators, traversals from the referential, show). It composes and validates the query.",
  "R-A6: discovery_build_query returns a dslQuery WITHOUT executing it (it already validates syntax). Show it to the user (they can edit it), then execute it via discovery_execute_dsl (which re-validates before running). The full DSL cookbook is embedded in the discovery_execute_dsl description (loaded at connection time) and also exposed as an MCP resource (mcp://discovery/dsl-cookbook).",
  "RULE 1: NEVER invent Discovery DSL (search/show) when a specialized tool covers the need. Use the parameterized tools below first.",
  "RULE 2: If the user mentions a vendor (Microsoft, Oracle...) or a product (Windows Server, JBoss...), pass it DIRECTLY as `publisherContains` / `productContains` to `discovery_lifecycle_report`. No chaining.",
  "RULE 3: Tool responses usually include a `summary` field with the headline count. Quote it verbatim before any detail.",
  "RULE 4: For tools returning multiple representations (e.g. discovery_topology mode=map), choose the richest representation your client supports. The interactive HTML is self-contained — offer it as a downloadable artifact when possible.",
  "RULE 5: For raw DSL, use `discovery_build_query` to compose and validate structured intent; only then execute the validated dslQuery through `discovery_execute_dsl` after showing it to the user.",
  "RULE 6: Traversal paths must come from the referential through `discovery_build_query`/`common_relationships`; fall back to `discovery_taxonomy` only for a path ABSENT from the referential."
];

// Server instructions: delivered in the MCP `initialize` response (handshake),
// injected by compliant clients into the model context at connection time.
// Keep it SHORT — orchestration rules + pointers. The full DSL grammar stays in
// the `mcp://discovery/dsl-cookbook` resource and the discovery_execute_dsl
// description (loaded on demand), NOT here. Reuses GLOBAL_RULES_FR (single source).
export function buildServerInstructions(): string {
  return [
    "Serveur MCP BMC Helix Discovery (inventaire, CVE, obsolescence, conformité, licences, coûts/Value Review, dépendances/topologie, DSL).",
    "À LA CONNEXION : pour toute demande sur des données Discovery, appelle d'abord `discovery_tool_guide` avec la question brute de l'utilisateur — il renvoie les bons outils, le catalogue connu et les règles complètes (FR/EN).",
    "",
    "Classes de nœud RÉELLES : Host, SoftwareInstance, NetworkDevice, SoftwareContainer, BusinessService, BusinessApplicationInstance, Cluster, StorageSystem… Mappe les alias FR/EN vers la vraie classe avec `discovery_resolve_kind` ; ne devine jamais un kind.",
    "Limites : aucune limite artificielle pour l'instant — un appel ramène le maximum de lignes (l'API Discovery cape naturellement). N'invente aucun paramètre de limite.",
    "DSL : n'écris jamais de DSL à la main → `discovery_build_query` compose+valide, puis `discovery_execute_dsl` exécute. Le cookbook DSL complet (grammaire + exemples) est embarqué dans la description de `discovery_execute_dsl` (chargé à la connexion) ; il est aussi exposé en resource `mcp://discovery/dsl-cookbook`.",
    "Prompts MCP disponibles (workflows guidés) : cve_impact, value_review, eol_audit, dependency_analysis.",
    "",
    "Règles d'orchestration :",
    ...GLOBAL_RULES_FR.map((rule) => `- ${rule}`)
  ].join("\n");
}

function previewList(values: string[], max = 12): string {
  const visible = values.slice(0, max);
  const suffix = values.length > max ? ` (+${values.length - max})` : "";
  return visible.length > 0 ? `${visible.join(", ")}${suffix}` : "(vide)";
}

function catalogMatchesForRequest(request: string) {
  const terms = [...new Set(request.match(/[\p{L}0-9_.-]{3,}/gu) ?? [])].slice(0, 12);
  return terms.flatMap((term) => {
    const names = lookupByName(term).slice(0, 5);
    const types = lookupByType(term).slice(0, 5);
    if (names.length === 0 && types.length === 0) return [];
    return [{ term, names, types }];
  });
}

export function assistantGuideTools() {
  return {
    discovery_tool_guide: {
      description: "READ THIS FIRST, ALWAYS, before ANY action involving BMC Helix Discovery data (software inventory, hosts, CVE vulnerabilities, end-of-life, compliance, licensing, IT cost/value review, dependencies, topology, orphan/rationalization scans, raw DSL, or taxonomy). Pass the user's raw question as `request`. Returns: (a) relevant MCP tools to call next, (b) example use cases, (c) global rules to prevent wrong-tool selection and DSL improvisation. Skip this tool ONLY if the user explicitly names a specific MCP tool to use.",
      schema: guideSchema,
      outputSchema: structuredOutputSchema,
      handler: async (input: z.infer<typeof guideSchema>) => {
        const selected = pickSections(input.request);
        const language = resolveLanguage(input.language, input.request);
        const rules = language === "fr" ? GLOBAL_RULES_FR : GLOBAL_RULES_EN;
        const catalogDigest = getCatalogDigest({ nominalLimit: 100 });
        const catalogMatches = catalogMatchesForRequest(input.request);
        const lines: string[] = [];
        if (language === "fr") {
          lines.push(`Demande comprise: ${input.request}`);
          lines.push("");
          lines.push("## Règles globales");
          for (const rule of rules) lines.push(`- ${rule}`);
          lines.push("");
          lines.push("## Catalogue Discovery connu (cache)");
          lines.push(`- Services: ${previewList(catalogDigest.services.map((item) => item.name))}`);
          lines.push(`- Applications: ${previewList(catalogDigest.apps.map((item) => item.name))}`);
          lines.push(`- Hosts${catalogDigest.nominalTruncated ? " (liste partielle)" : ""}: ${previewList(catalogDigest.hosts.map((item) => item.name))}`);
          lines.push(`- Types SoftwareInstance${catalogDigest.truncated ? " (liste partielle)" : ""}: ${previewList(catalogDigest.softwareTypes.map((item) => item.type), catalogDigest.truncated ? 20 : catalogDigest.softwareTypes.length)}`);
          lines.push("");
          lines.push("## Outils pertinents pour cette demande");
        } else {
          lines.push(`Understood request: ${input.request}`);
          lines.push("");
          lines.push("## Global rules");
          for (const rule of rules) lines.push(`- ${rule}`);
          lines.push("");
          lines.push("## Known Discovery catalog (cache)");
          lines.push(`- Services: ${previewList(catalogDigest.services.map((item) => item.name))}`);
          lines.push(`- Applications: ${previewList(catalogDigest.apps.map((item) => item.name))}`);
          lines.push(`- Hosts${catalogDigest.nominalTruncated ? " (partial list)" : ""}: ${previewList(catalogDigest.hosts.map((item) => item.name))}`);
          lines.push(`- SoftwareInstance types${catalogDigest.truncated ? " (partial list)" : ""}: ${previewList(catalogDigest.softwareTypes.map((item) => item.type), catalogDigest.truncated ? 20 : catalogDigest.softwareTypes.length)}`);
          lines.push("");
          lines.push("## Relevant tools for this request");
        }
        for (const section of selected) {
          lines.push(`\n### ${language === "fr" ? section.title : section.titleEn}`);
          for (const item of section.items.slice(0, input.maxUseCases)) {
            lines.push(language === "fr"
              ? `- ${item.tool}: ${item.purpose} Exemple: ${item.useCase}`
              : `- ${item.tool}: ${item.purposeEn} Example: ${item.useCaseEn}`);
          }
        }
        return {
          request: input.request,
          language,
          matchedSections: selected.map((s) => s.id),
          globalRules: rules,
          catalogDigest,
          catalogMatches,
          guidance: lines.join("\n")
        };
      }
    }
  };
}
