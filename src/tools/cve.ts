import { z } from "zod";
import type { AppConfig } from "../config.js";
import { structuredOutputSchema } from "./outputSchemas.js";

const languageSchema = z.enum(["fr", "en"]).optional();

const cpeSchema = z.string().min(1).refine((v) => v.startsWith("cpe:2.3:"), {
  message: "CPE must start with cpe:2.3:"
});

const cveIdSchema = z.string().regex(/^CVE-\d{4}-\d{4,}$/i, "Invalid CVE format");

function esc(value: string): string {
  return value.replace(/'/g, "\\'");
}

function buildDiscoveryDsl(cpes: string[]): string {
  const where = cpes.map((cpe) => `cpe_string_23 matches '${esc(cpe)}'`).join(" or ");
  return `search SoftwareInstance where ${where} show type, version, #:::Host.name, #:::BusinessService.name processwith show type as 'Type', version as 'Full Version', #:::Host.name as 'Host Name', #:::BusinessService.name as 'Service Name', #RunningSoftware:HostedSoftware:Host:Host.#OwnedItem:Ownership:BusinessOwner:Person.name as 'Business Owner'`;
}

async function fetchNvdCpes(cveId: string, nvdApiKey?: string): Promise<string[]> {
  const headers: Record<string, string> = {};
  if (nvdApiKey) {
    headers.apiKey = nvdApiKey;
  }
  const res = await fetch(`https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${encodeURIComponent(cveId)}`, {
    headers
  });
  if (!res.ok) {
    throw new Error(`NVD request failed: HTTP ${res.status}`);
  }
  const data = await res.json() as { vulnerabilities?: Array<{ cve?: { configurations?: unknown[] } }> };
  const out = new Set<string>();

  function walk(node: unknown): void {
    if (!node || typeof node !== "object") return;
    const anyNode = node as { criteria?: unknown; nodes?: unknown[]; cpeMatch?: unknown[]; cpe_match?: unknown[] };
    if (typeof anyNode.criteria === "string" && anyNode.criteria.startsWith("cpe:2.3:")) out.add(anyNode.criteria);
    const matches = Array.isArray(anyNode.cpeMatch) ? anyNode.cpeMatch : Array.isArray(anyNode.cpe_match) ? anyNode.cpe_match : [];
    for (const m of matches) {
      if (m && typeof m === "object" && typeof (m as { criteria?: unknown }).criteria === "string") {
        const c = (m as { criteria: string }).criteria;
        if (c.startsWith("cpe:2.3:")) out.add(c);
      }
    }
    if (Array.isArray(anyNode.nodes)) {
      for (const child of anyNode.nodes) walk(child);
    }
  }

  for (const v of data.vulnerabilities ?? []) {
    for (const conf of v.cve?.configurations ?? []) walk(conf);
  }
  return Array.from(out);
}

export function cveTools(config: Pick<AppConfig, "nvdApiKey">) {
  return {
    discovery_cve_executive_summary: {
      description: "Produce an EXECUTIVE-style summary for a CVE: number of impacted assets, top business services / hosts / versions, and a follow-up prompt asking if the user wants the full impacted inventory. Use this FIRST when the user asks 'are we exposed to CVE-XXXX-YYYY?' or 'what's the impact of CVE-XXXX-YYYY?'. Requires the CVE ID. Optionally pass already-fetched Discovery rows to compute aggregates; otherwise pass discoveryRows=[].",
      schema: z.object({
        cveId: cveIdSchema,
        topN: z.number().int().min(1).max(20).default(5),
        discoveryRows: z.array(z.record(z.unknown())).default([]),
        language: languageSchema,
        question: z.string().optional()
      }).strict(),
      outputSchema: structuredOutputSchema,
      handler: async (input: { cveId: string; topN: number; discoveryRows: Array<Record<string, unknown>>; language?: "fr" | "en"; question?: string }) => {
        const lang = resolveLanguage(input.language, input.question);
        const t = i18n(lang);
        const cveId = input.cveId.toUpperCase();
        const cpes = await fetchNvdCpes(cveId, config.nvdApiKey);
        const dsl = buildDiscoveryDsl(cpes);
        const rows = input.discoveryRows;

        const topServices = aggregateTop(rows, ["Service Name", "Business Service", "business_service", "service"], input.topN);
        const topHosts = aggregateTop(rows, ["Host Name", "Host", "host"], input.topN);
        const topVersions = aggregateTop(rows, ["Full Version", "version", "product_version"], input.topN);

        return {
          cveHeader: { cveId, riskTitle: t.riskTitle, note: t.summaryNote },
          cveSummary: { cpeCount: cpes.length, impactedRowsCount: rows.length, topServices, topHosts, topVersions },
          discoverySearchPlan: { primaryTool: "discovery_build_cve_software_query", nextExecutionTool: "discovery_search_data", dslQuery: dsl },
          followUpPrompt: t.followUpPrompt
        };
      }
    },
    discovery_build_cve_software_query: {
      description: "Build the Discovery DSL query that finds software instances matching a list of CPEs. Use this AFTER getting CPEs from discovery_get_cve_cpes_from_nvd, to construct the query that will be passed to discovery_search_data. Returns the ready-to-run DSL string.",
      schema: z.object({ cpeStrings: z.array(cpeSchema).min(1), includeUrlEncoded: z.boolean().default(false) }).strict(),
      outputSchema: structuredOutputSchema,
      handler: async (input: { cpeStrings: string[]; includeUrlEncoded: boolean }) => {
        const dsl = buildDiscoveryDsl(input.cpeStrings);
        return {
          cpeCount: input.cpeStrings.length,
          dslQuery: dsl,
          ...(input.includeUrlEncoded ? { urlEncodedQuery: encodeURIComponent(dsl) } : {})
        };
      }
    },
    discovery_get_cve_cpes_from_nvd: {
      description: "Fetch the official CPE (Common Platform Enumeration) strings associated with a CVE from the NIST NVD database. Use this when you need to know precisely which products and versions are affected by a CVE. The CPEs returned are the technical fingerprints that match against Discovery's cpe_string_23 attribute.",
      schema: z.object({ cveId: cveIdSchema }).strict(),
      outputSchema: structuredOutputSchema,
      handler: async (input: { cveId: string }) => {
        const cpes = await fetchNvdCpes(input.cveId.toUpperCase(), config.nvdApiKey);
        return { cveId: input.cveId.toUpperCase(), cpeCount: cpes.length, cpeStrings: cpes };
      }
    },
    discovery_cve_full_inventory_prompt: {
      description: "Prepare the full impacted-inventory call. Use this AFTER discovery_cve_executive_summary if the user said yes to seeing the full impacted inventory (every host, version, service, owner). Returns a recommendedInput ready to pass to discovery_search_data.",
      schema: z.object({ cveId: cveIdSchema, cpeStrings: z.array(cpeSchema).min(1), limit: z.number().int().min(1).max(500).default(200), language: languageSchema, question: z.string().optional() }).strict(),
      outputSchema: structuredOutputSchema,
      handler: async (input: { cveId: string; cpeStrings: string[]; limit: number; language?: "fr" | "en"; question?: string }) => {
        const lang = resolveLanguage(input.language, input.question);
        const t = i18n(lang);
        const dsl = buildDiscoveryDsl(input.cpeStrings);
        return {
          cveId: input.cveId.toUpperCase(),
          objective: t.fullInventoryObjective,
          runWithTool: "discovery_search_data",
          recommendedInput: { query: dsl, limit: input.limit },
          expectedColumns: t.expectedColumns
        };
      }
    }
  };
}

function resolveLanguage(language?: "fr" | "en", question?: string): "fr" | "en" {
  if (language) return language;
  const q = (question ?? "").toLowerCase();
  if (/\b(bonjour|merci|risque|service|version|vulnérabilit|voulez-vous|inventaire)\b/.test(q)) return "fr";
  return "en";
}

function i18n(language: "fr" | "en") {
  if (language === "fr") {
    return {
      riskTitle: "Risques associés",
      summaryNote: "Template aligné pour un briefing CVE exécutif (résumé d'abord, détails sur demande).",
      followUpPrompt: "Voulez-vous maintenant le tableau complet des actifs impactés (service, hôte, version, owner, exposition) ?",
      fullInventoryObjective: "Retourner l'inventaire complet impacté pour une analyse détaillée.",
      expectedColumns: ["Type", "Version complète", "Nom hôte", "Nom service", "Business Owner"]
    };
  }
  return {
    riskTitle: "Risks Associated",
    summaryNote: "Template aligned for executive CVE briefing (summary first, details on demand).",
    followUpPrompt: "Do you want the full impacted inventory table (service, host, version, owner, exposure) now?",
    fullInventoryObjective: "Return the full impacted inventory dataset for analyst drill-down.",
    expectedColumns: ["Type", "Full Version", "Host Name", "Service Name", "Business Owner"]
  };
}

function aggregateTop(rows: Array<Record<string, unknown>>, candidateKeys: string[], topN: number): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = candidateKeys.find((k) => typeof row[k] === "string" && String(row[k]).trim() !== "");
    if (!key) continue;
    const value = String(row[key]).trim();
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([value, count]) => ({ value, count }));
}
