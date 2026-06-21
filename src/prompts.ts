import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// MCP Prompts: user-triggered workflows that pre-wire the correct tool sequence,
// so the LLM follows the right path (and the documented rules) instead of improvising.

function userMessage(text: string) {
  return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
}

export function registerDiscoveryPrompts(server: McpServer): void {
  server.registerPrompt(
    "cve_impact",
    {
      title: "Briefing impact CVE",
      description: "Évalue l'exposition du parc BMC Discovery à un CVE : résumé exécutif, puis inventaire complet sur demande.",
      argsSchema: { cve_id: z.string().describe("Identifiant CVE, ex. CVE-2026-12345") }
    },
    ({ cve_id }) => userMessage([
      `Évalue l'impact du CVE ${cve_id} sur le parc BMC Helix Discovery.`,
      "",
      "Procédure :",
      `1. Appelle discovery_cve_executive_summary avec cveId="${cve_id}" et detail="summary".`,
      "2. Cite en titre le nombre d'actifs impactés, puis les top services / hôtes / versions.",
      "3. Propose ensuite l'inventaire complet ; si l'utilisateur accepte, rappelle discovery_cve_executive_summary avec detail=\"full\".",
      "",
      "Règles : ne devine PAS les CPE (le tool les récupère via le NVD) ; n'écris pas de DSL à la main."
    ].join("\n"))
  );

  server.registerPrompt(
    "value_review",
    {
      title: "Value Review (coûts IT)",
      description: "Analyse de coûts / Value Review : chiffrage et alternatives à partir de la base de coûts de référence.",
      argsSchema: {
        workload: z.string().optional().describe("Charge à chiffrer, ex. 'VM 4 vCPU 16 Go', 'Oracle EE'"),
        current_solution: z.string().optional().describe("Solution actuelle pour comparer, ex. 'VMware vSphere'")
      }
    },
    ({ workload, current_solution }) => userMessage([
      "Réalise une Value Review à partir de la base de coûts de référence.",
      "",
      "Procédure :",
      "1. discovery_cost_categories pour cadrer les familles disponibles.",
      `2. discovery_cost_search puis discovery_cost_estimate pour chiffrer ${workload ? `"${workload}"` : "la charge demandée"}.`,
      `3. discovery_cost_compare${current_solution ? ` (current_solution="${current_solution}")` : ""} pour les alternatives annualisées et l'économie médiane.`,
      "4. Pour les licences Windows Server, utilise discovery_windows_license_report.",
      "",
      "Croise avec l'inventaire réel via discovery_find si une quantité est nécessaire. Présente min / médian / max et l'économie médiane."
    ].join("\n"))
  );

  server.registerPrompt(
    "eol_audit",
    {
      title: "Audit fin de support (EOL/EOS)",
      description: "Audit d'obsolescence logiciel ou OS, avec filtre éditeur/produit et focus sur les éléments à risque.",
      argsSchema: {
        scope: z.string().optional().describe("software (défaut) ou os"),
        vendor: z.string().optional().describe("Éditeur, ex. Microsoft, Oracle"),
        product: z.string().optional().describe("Produit, ex. Windows Server, SQL Server")
      }
    },
    ({ scope, vendor, product }) => userMessage([
      "Réalise un audit de fin de support / obsolescence.",
      "",
      "Procédure : appelle discovery_lifecycle_report DIRECTEMENT (ne chaîne pas plusieurs requêtes) avec :",
      `- scope="${scope === "os" ? "os" : "software"}"`,
      vendor ? `- publisherContains="${vendor}"` : "- publisherContains=<éditeur> si l'utilisateur en cite un",
      product ? `- productContains="${product}"` : "- productContains=<produit> si l'utilisateur en cite un",
      "- onlyAtRisk=true pour ne montrer que ce qui est déjà hors support.",
      "",
      "Cite le champ summary en titre, puis détaille les éléments à risque (dates EOS/EOL)."
    ].join("\n"))
  );

  server.registerPrompt(
    "dependency_analysis",
    {
      title: "Analyse de dépendances",
      description: "Cartographie les dépendances d'un objet (service, application, hôte, logiciel), en estimant d'abord la taille.",
      argsSchema: {
        target: z.string().describe("Nom ou nodeId de l'objet, ex. 'PROD-WEB-01' ou un service"),
        target_kind: z.string().optional().describe("Kind pour désambiguïser, ex. Host, BusinessService")
      }
    },
    ({ target, target_kind }) => userMessage([
      `Analyse les dépendances de "${target}".`,
      "",
      "Procédure :",
      `1. discovery_dependency_scope (target="${target}"${target_kind ? `, targetKind="${target_kind}"` : ""}) pour estimer la TAILLE de la topologie avant de dessiner.`,
      "2. discovery_dependency_map pour le graphe : layout=\"hierarchical\" pour une question d'architecture, layout=\"concentric\" pour blast-radius / impact.",
      "3. Pour une vue service→service pure (BusinessService), utilise discovery_service_architecture.",
      target_kind ? "" : "",
      "Si le nom est ambigu, précise targetKind avant de continuer."
    ].filter((line) => line !== null).join("\n"))
  );
}
