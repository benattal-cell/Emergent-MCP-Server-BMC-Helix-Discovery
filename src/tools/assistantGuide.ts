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
        tool: "list_categories",
        purpose: "Lister les catégories et sous-catégories de la base de coûts IT avant une recherche.",
        useCase: "Démarrer un Value Review en découvrant les familles disponibles (cloud, infra virtualisée, licences, stockage...).",
        purposeEn: "List categories and subcategories from the IT cost knowledge base before searching.",
        useCaseEn: "Start a Value Review by discovering available families (cloud, virtualized infra, licenses, storage...)."
      },
      {
        tool: "search_it_costs",
        purpose: "Rechercher des composants de coût par texte, catégorie et sous-catégorie.",
        useCase: "Trouver les lignes de référence pour VM 4 vCPU/16 Go, Oracle, Microsoft 365 ou stockage.",
        purposeEn: "Search cost components by text, category, and subcategory.",
        useCaseEn: "Find reference rows for 4 vCPU/16 GB VMs, Oracle, Microsoft 365, or storage."
      },
      {
        tool: "estimate_cost",
        purpose: "Estimer min/médian/max pour un composant et une quantité sur un horizon mensuel, annuel ou 5 ans.",
        useCase: "Après inventaire, estimer le coût annuel de 200 VMs VMware ou de 50 cores Oracle.",
        purposeEn: "Estimate min/median/max for a component and quantity over monthly, annual, or 5-year horizons.",
        useCaseEn: "After inventory, estimate the annual cost of 200 VMware VMs or 50 Oracle cores."
      },
      {
        tool: "compare_alternatives",
        purpose: "Comparer les alternatives annualisées et calculer les économies potentielles face à une solution actuelle.",
        useCase: "Comparer VMware vs Azure/AWS/GCP pour 100 VMs 4 vCPU/16 Go et classer les économies médianes.",
        purposeEn: "Compare annualized alternatives and calculate potential savings versus a current solution.",
        useCaseEn: "Compare VMware vs Azure/AWS/GCP for 100 4 vCPU/16 GB VMs and rank median savings."
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
        tool: "discovery_get_api_status",
        purpose: "Vérifier que Discovery est joignable et que la version API configurée est supportée.",
        useCase: "À appeler quand un outil échoue, après un déploiement Railway, ou avant une série d'analyses.",
        purposeEn: "Check whether Discovery is reachable and whether the configured API version is supported.",
        useCaseEn: "Call this when a tool fails, after a Railway deployment, or before a batch of analyses."
      },
      {
        tool: "discovery_about",
        purpose: "Lire les métadonnées brutes de l'instance Discovery.",
        useCase: "Diagnostiquer la version et les capacités exposées par `/api/about`.",
        purposeEn: "Read raw metadata from the Discovery instance.",
        useCaseEn: "Diagnose the version and capabilities exposed by `/api/about`."
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
        purpose: "Exécuter directement un rapport lifecycle avec filtres intégrés (publisherContains, productContains, hostNameContains, typeIn).",
        useCase: "Pour 'logiciels Microsoft en fin de support', appeler avec publisherContains='Microsoft'. PAS BESOIN d'enchaîner build_lifecycle_query + search_data.",
        purposeEn: "Run a lifecycle report directly with built-in filters (publisherContains, productContains, hostNameContains, typeIn).",
        useCaseEn: "For 'Microsoft software end-of-life', call with publisherContains='Microsoft'. NO NEED to chain build_lifecycle_query + search_data."
      },
      {
        tool: "discovery_os_lifecycle_report",
        purpose: "Exécuter directement un rapport d'obsolescence OS depuis les Host avec dates EOS/EOSS/EOES/EOL SupportDetail OS et gestion de failure_reason.",
        useCase: "Pour 'Windows Server obsolètes' ou 'OS à risque', appeler ce tool avec osContains si besoin et onlyAtRisk=true pour EOS dépassée. PAS BESOIN d'enchaîner search_data.",
        purposeEn: "Run an OS obsolescence report directly from Host nodes with OS SupportDetail EOS/EOSS/EOES/EOL dates and failure_reason handling.",
        useCaseEn: "For 'obsolete Windows Server' or 'OS at risk', call this tool with osContains as needed and onlyAtRisk=true for exceeded EOS. NO NEED to chain search_data."
      },
      {
        tool: "discovery_build_lifecycle_query",
        purpose: "AVANCÉ. Construire le DSL sans l'exécuter, uniquement pour inspection.",
        useCase: "Rare : seulement si on doit modifier la requête avant exécution.",
        purposeEn: "ADVANCED. Build the DSL string without executing it, only for inspection.",
        useCaseEn: "Rare: only when the query must be modified before execution."
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
      },
      {
        tool: "discovery_build_cve_software_query",
        purpose: "Construire la requête Discovery à partir de CPE.",
        useCase: "Générer une recherche prête à l'emploi pour identifier les logiciels impactés.",
        purposeEn: "Build the Discovery query from CPE strings.",
        useCaseEn: "Generate a ready-to-run search to identify impacted software."
      },
      {
        tool: "discovery_cve_full_inventory_prompt",
        purpose: "Préparer l'appel qui retourne l'inventaire complet impacté.",
        useCase: "Si l'utilisateur veut en savoir plus, lancer l'extraction détaillée (table complète).",
        purposeEn: "Prepare the call that returns the full impacted inventory.",
        useCaseEn: "If the user wants more details, run the detailed extraction (full table)."
      }
    ]
  },
  {
    id: "inventory",
    title: "Inventaire hôtes / logiciels",
    titleEn: "Host / software inventory",
    keywords: ["host", "hôte", "serveur", "server", "machine", "software", "logiciel", "soft", "application", "instance", "count", "combien", "inventaire", "inventory", "linux", "windows", "rhel", "carte hôte", "host card"],
    items: [
      {
        tool: "discovery_find_hosts",
        purpose: "Lister/filtrer des hôtes par nom ou OS.",
        useCase: "Combien de serveurs Linux ? Quels hôtes contiennent 'PROD' dans leur nom ?",
        purposeEn: "List/filter hosts by name or OS.",
        useCaseEn: "How many Linux servers? Which hosts contain 'PROD' in their name?"
      },
      {
        tool: "discovery_find_software_instances",
        purpose: "Lister/filtrer des instances logicielles.",
        useCase: "Toutes les instances Oracle, ou tous les Apache.",
        purposeEn: "List/filter software instances.",
        useCaseEn: "All Oracle instances, or all Apache instances."
      },
      {
        tool: "discovery_find_host_software",
        purpose: "Lister les logiciels installés sur un hôte donné.",
        useCase: "Que tourne-t-il sur SAP-PROD-01 ?",
        purposeEn: "List software installed on a given host.",
        useCaseEn: "What's running on SAP-PROD-01?"
      },
      {
        tool: "discovery_host_card",
        purpose: "Rendre une carte visuelle synthétique d'un hôte.",
        useCase: "Quand l'utilisateur veut une fiche lisible/visuelle pour un serveur précis.",
        purposeEn: "Render a concise visual card for a host.",
        useCaseEn: "When the user wants a readable visual profile for a specific server."
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
        tool: "discovery_dependency_scope",
        purpose: "Probe léger à appeler EN PREMIER pour estimer la taille du graphe avant rendu.",
        useCase: "Avant le rendu, évaluer nodes/relations pour choisir depth et éviter une carte trop dense.",
        purposeEn: "Lightweight probe to call FIRST to estimate graph size before rendering.",
        useCaseEn: "Before rendering, evaluate nodes/relationships to choose depth and avoid an overly dense map."
      },
      {
        tool: "discovery_dependency_map",
        purpose: "Rendre une carte multi-représentation (PNG + SVG + HTML interactif autoportant). Si le client supporte les fichiers téléchargeables, il DOIT proposer le HTML interactif via le mécanisme natif (ex: present_files).",
        useCase: "Pour une analyse d'impact ou blast radius, afficher le PNG/SVG inline et proposer systématiquement le HTML interactif en téléchargement si possible.",
        purposeEn: "Render a multi-representation map (PNG + SVG + self-contained interactive HTML). If the client supports downloadable files, it MUST offer the interactive HTML through the native mechanism (e.g. present_files).",
        useCaseEn: "For impact/blast-radius analysis, render PNG/SVG inline and always offer the interactive HTML as a downloadable artifact when possible."
      },
      {
        tool: "discovery_service_architecture",
        purpose: "Générer un schéma d'architecture hiérarchical style dossier (D3 tree, rectangles, Bézier) depuis un nœud racine BusinessApplication ou Host. Plus lisible que dependency_map pour les services avec une structure arborescente claire.",
        useCase: `Passer serviceName="Jira" — le tool résout automatiquement tous les nœuds correspondants et génère un schéma par résultat. Pour éviter l'explosion du graphe sur les gros services, passer kindFilter=["BusinessService","BusinessApplicationInstance","Host","SoftwareInstance"]. Toujours commencer par depth=2 ; augmenter si le résultat est trop pauvre.`,
        purposeEn: "Generate a hierarchical folder-style architecture diagram (D3 tree, rectangles, Bézier links) from a root BusinessApplication or Host node. More readable than dependency_map for services with a clear tree structure.",
        useCaseEn: "When the user asks 'show me the architecture of [service]' or 'service X diagram', prefer this tool over dependency_map. If the graph has many cross-links (multi-parent), tell the user some nodes were duplicated."
      },
      {
        tool: "discovery_get_node_graph",
        purpose: "Récupérer le graphe brut autour d'un nodeId Discovery.",
        useCase: "Quand on a déjà un nodeId et qu'on veut inspecter les relations sans rendu visuel.",
        purposeEn: "Retrieve the raw graph around a Discovery nodeId.",
        useCaseEn: "When a nodeId is already known and relationships should be inspected without visual rendering."
      },
      {
        tool: "discovery_summarize_node_graph_cmdb",
        purpose: "Résumer un graphe brut en vue CMDB/urbanisation (classes CI, relations, volumes).",
        useCase: "Après discovery_get_node_graph, produire une synthèse compréhensible pour CMDB/IT architecture.",
        purposeEn: "Summarize a raw graph into a CMDB/IT-architecture view (CI classes, relationships, volumes).",
        useCaseEn: "After discovery_get_node_graph, produce a summary understandable for CMDB/IT architecture."
      },
      {
        tool: "discovery_topology_services",
        purpose: "Appeler l'endpoint Discovery /topology/services avec un payload connu.",
        useCase: "Seulement si l'utilisateur demande explicitement des données de service/topologie et fournit ou connaît le payload attendu.",
        purposeEn: "Call the Discovery /topology/services endpoint with a known payload.",
        useCaseEn: "Only when the user explicitly asks for service/topology data and provides or knows the expected payload."
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
        tool: "discovery_search_data",
        purpose: "Exécuter le DSL généré ou inspecter une requête brute seulement si aucun outil spécialisé ne couvre le besoin.",
        useCase: "Toujours conserver generated_dsl_query dans le résultat pour expliquer et debugger une analyse de gouvernance.",
        purposeEn: "Execute generated DSL or inspect a raw query only when no specialized tool covers the need.",
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
        tool: "discovery_dsl_examples",
        purpose: "Fournir des exemples DSL statiques par thème avant d'écrire une requête brute.",
        useCase: "Demander topic='traversal', 'counting', 'lookup', 'database', etc. pour éviter les erreurs de syntaxe.",
        purposeEn: "Return static DSL examples by topic before drafting a raw query.",
        useCaseEn: "Ask for topic='traversal', 'counting', 'lookup', 'database', etc. to avoid syntax mistakes."
      },
      {
        tool: "discovery_validate_query",
        purpose: "Valider localement les pièges courants sans exécuter la requête Discovery.",
        useCase: "À appeler avant discovery_search_data si la requête contient TRAVERSE, LOOKUP, ORDER BY ou NODECOUNT.",
        purposeEn: "Locally validate common traps without executing the Discovery query.",
        useCaseEn: "Call before discovery_search_data if the query contains TRAVERSE, LOOKUP, ORDER BY, or NODECOUNT."
      },
      {
        tool: "discovery_search_data",
        purpose: "Exécuter une requête DSL brute et retourner des résultats aplatis avec erreurs DSL enrichies.",
        useCase: "Fallback avancé : utiliser seulement si les outils spécialisés ne répondent pas à la question.",
        purposeEn: "Execute a raw DSL query and return flattened results with enriched DSL errors.",
        useCaseEn: "Advanced fallback: use only if specialized tools do not answer the question."
      },
      {
        tool: "discovery_search_tree_data",
        purpose: "Exécuter une requête DSL brute au format hiérarchique/tree.",
        useCase: "Rare : seulement si le client a besoin d'une structure imbriquée plutôt qu'un tableau aplati.",
        purposeEn: "Execute a raw DSL query in hierarchical/tree format.",
        useCaseEn: "Rare: only if the client needs nested structure rather than a flattened table."
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
        tool: "discovery_taxonomy_node_kinds",
        purpose: "Lister les types de nœuds disponibles.",
        useCase: "Savoir quels kinds sont exploitables dans les requêtes.",
        purposeEn: "List available node kinds.",
        useCaseEn: "Determine which kinds can be used in queries."
      },
      {
        tool: "discovery_taxonomy_node_kind_details",
        purpose: "Afficher les métadonnées complètes d'un node kind.",
        useCase: "Comprendre les attributs et relations d'un kind précis avant une query.",
        purposeEn: "Show full metadata for a node kind.",
        useCaseEn: "Understand attributes and relationships for a specific kind before a query."
      },
      {
        tool: "discovery_taxonomy_node_kind_field_lists",
        purpose: "Lister les field lists disponibles pour un node kind.",
        useCase: "Identifier quelle liste de champs demander ensuite.",
        purposeEn: "List field lists available for a node kind.",
        useCaseEn: "Identify which field list to request next."
      },
      {
        tool: "discovery_taxonomy_node_fields",
        purpose: "Lister les champs d'un kind pour une field list.",
        useCase: "Identifier le nom exact d'un attribut avant une query.",
        purposeEn: "List fields for a node kind and field list.",
        useCaseEn: "Identify exact attribute names before running a query."
      },
      {
        tool: "discovery_taxonomy_relationship_kinds",
        purpose: "Lister les types de relations disponibles.",
        useCase: "Découvrir les relkinds avant d'écrire un TRAVERSE ou NODECOUNT.",
        purposeEn: "List available relationship kinds.",
        useCaseEn: "Discover relkinds before writing TRAVERSE or NODECOUNT."
      },
      {
        tool: "discovery_taxonomy_relkind_details",
        purpose: "Détailler un type de relation.",
        useCase: "Valider les relations à utiliser entre Host et Software.",
        purposeEn: "Show details for a relationship kind.",
        useCaseEn: "Validate relationships to use between Host and Software."
      },
      {
        tool: "discovery_taxonomy_sections",
        purpose: "Lister les sections du modèle taxonomy.",
        useCase: "Exploration metadata rare, utile pour comprendre le modèle global.",
        purposeEn: "List taxonomy model sections.",
        useCaseEn: "Rare metadata exploration, useful to understand the overall model."
      },
      {
        tool: "discovery_taxonomy_locales",
        purpose: "Lister les locales taxonomy disponibles.",
        useCase: "Rare : vérifier les langues/locales disponibles pour les libellés taxonomy.",
        purposeEn: "List available taxonomy locales.",
        useCaseEn: "Rare: check available languages/locales for taxonomy labels."
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
  "R-A3: Si l'objet nommé est absent À LA FOIS du registre nominatif (services/apps/hosts) ET des types SoftwareInstance connus, demande DE QUEL TYPE d'objet il s'agit plutôt que de deviner ou de lancer un data_search.",
  "R-A4: Ne JAMAIS improviser une requête discovery_search_data pour contourner une ambiguïté.",
  "RÈGLE 1: N'invente JAMAIS du DSL Discovery (search/show) si un outil spécialisé couvre le besoin. Utilise d'abord les outils paramétrés ci-dessous.",
  "RÈGLE 2: Si l'utilisateur mentionne un éditeur (Microsoft, Oracle...) ou un produit (Windows Server, JBoss...), passe-le DIRECTEMENT en paramètre `publisherContains` / `productContains` à `discovery_lifecycle_report`. Pas d'enchaînement.",
  "RÈGLE 3: La réponse de chaque outil contient généralement un champ `summary` avec le chiffre clé. Cite-le textuellement avant tout détail.",
  "RÈGLE 4: Pour les outils retournant plusieurs représentations (ex: discovery_dependency_map), choisis la représentation la plus riche que ton client supporte. Le HTML interactif est autoportant — propose-le en téléchargement si possible.",
  "RÈGLE 5: Pour du DSL brut, appelle d'abord `discovery_dsl_examples` ou `discovery_validate_query`; puis seulement `discovery_search_data` si aucun outil spécialisé ne suffit."
];

const GLOBAL_RULES_EN = [
  "R-A1: BEFORE any tool call, if the intent does not clearly map to a level-1 tool (vulnerabilities/CVE, dependencies/graph, architecture, obsolescence), ask ONE clarifying question. Do not call anything.",
  "R-A2: If the tool requires an OBJECT and no object is named, ask which one before calling the tool.",
  "R-A3: If the named object is absent from BOTH the nominal registry (services/apps/hosts) and known SoftwareInstance types, ask WHAT TYPE of object it is instead of guessing or launching data_search.",
  "R-A4: NEVER improvise a discovery_search_data query to work around ambiguity.",
  "RULE 1: NEVER invent Discovery DSL (search/show) when a specialized tool covers the need. Use the parameterized tools below first.",
  "RULE 2: If the user mentions a vendor (Microsoft, Oracle...) or a product (Windows Server, JBoss...), pass it DIRECTLY as `publisherContains` / `productContains` to `discovery_lifecycle_report`. No chaining.",
  "RULE 3: Tool responses usually include a `summary` field with the headline count. Quote it verbatim before any detail.",
  "RULE 4: For tools returning multiple representations (e.g. discovery_dependency_map), choose the richest representation your client supports. The interactive HTML is self-contained — offer it as a downloadable artifact when possible.",
  "RULE 5: For raw DSL, call `discovery_dsl_examples` or `discovery_validate_query` first; then call `discovery_search_data` only if no specialized tool is enough."
];

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
