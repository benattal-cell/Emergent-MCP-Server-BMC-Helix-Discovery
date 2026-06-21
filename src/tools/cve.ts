import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { DiscoveryClient } from "../discoveryClient.js";
import { structuredOutputSchema } from "./outputSchemas.js";

const languageSchema = z.enum(["fr", "en"]).optional();

const cveIdSchema = z.string().regex(/^CVE-\d{4}-\d{4,}$/i, "Invalid CVE format");
const CVE_SEARCH_MAX_ROWS = 20_000;
const CVE_SEARCH_PAGE_SIZE = 500;

function esc(value: string): string {
  return value.replace(/'/g, "\\'");
}

function splitCpe(cpe: string): string[] {
  const parts: string[] = [];
  let current = "";
  let escaped = false;
  for (const char of cpe) {
    if (escaped) {
      current += `\\${char}`;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === ":") {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (escaped) current += "\\";
  parts.push(current);
  return parts;
}

function regexEscapeLiteral(value: string): string {
  return value.replace(/\\([()])/g, "$1").replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
}

function cpeSegmentToRegex(segment: string): string {
  if (segment === "*") return ".*";
  return segment.split("*").map(regexEscapeLiteral).join(".*");
}

export function cpeToRegex(cpe: string): string {
  const parts = splitCpe(cpe);
  const regexParts: string[] = [];
  for (const part of parts) {
    if (part === "*") {
      regexParts.push(".*");
      break;
    }
    regexParts.push(cpeSegmentToRegex(part));
  }
  return regexParts.join(":");
}

function productTermsFromCpes(cpes: string[]): string[] {
  const terms = new Map<string, string>();
  for (const cpe of cpes) {
    const parts = splitCpe(cpe);
    const part = parts[2];
    const product = parts[4];
    const version = parts[5];
    if (part !== "a" || version !== "*" || !product || product === "*") continue;
    const term = product.replace(/[_-]+/g, " ").trim();
    if (!term) continue;
    terms.set(term.toLowerCase(), term);
  }
  return [...terms.values()];
}

export function buildDiscoveryDsl(cpes: string[]): string {
  const cpePredicates = cpes.map((cpe) => `(cpe_string_23 and cpe_string_23 matches '${esc(cpeToRegex(cpe))}')`);
  const typePredicates = productTermsFromCpes(cpes).map((term) => `(not cpe_string_23 and type has subword '${esc(term)}')`);
  const where = [...cpePredicates, ...typePredicates].join(" or ") || "false";
  return `search SoftwareInstance where ${where} show type, version, cpe_string_23, #:::Host.name, #:::BusinessService.name processwith show type as 'Type', version as 'Full Version', cpe_string_23 as 'CPE', #:::Host.name as 'Host Name', #:::BusinessService.name as 'Service Name', #RunningSoftware:HostedSoftware:Host:Host.#OwnedItem:Ownership:BusinessOwner:Person.name as 'Business Owner'`;
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

function rowString(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

function annotateMatchPrecision(rows: Array<Record<string, unknown>>, cpes: string[]): Array<Record<string, unknown>> {
  const cpeRegexes = cpes.map((cpe) => new RegExp(cpeToRegex(cpe), "i"));
  return rows.map((row) => {
    const cpe = rowString(row, ["CPE", "cpe_string_23", "cpe", "Cpe"]);
    const exact = cpe ? cpeRegexes.some((regex) => regex.test(cpe)) : false;
    return { ...row, matchPrecision: exact ? "exact" : "approximate" };
  });
}

async function rowsForExecutiveSummary(client: DiscoveryClient, dsl: string, inputRows: Array<Record<string, unknown>>, cpes: string[], cveId: string): Promise<{ rows: Array<Record<string, unknown>>; source: "provided_rows" | "executed_query" }> {
  if (inputRows.length > 0) return { rows: annotateMatchPrecision(inputRows, cpes), source: "provided_rows" };
  const result = await client.searchData(dsl, {
    entityLabel: "actifs impactés",
    appliedFilters: { cveId, cpeCount: cpes.length },
    maxRows: CVE_SEARCH_MAX_ROWS,
    pageSize: CVE_SEARCH_PAGE_SIZE
  });
  return { rows: annotateMatchPrecision(result.rows as Array<Record<string, unknown>>, cpes), source: "executed_query" };
}

export function cveTools(client: DiscoveryClient, config: Pick<AppConfig, "nvdApiKey" | "resultLimit">) {
  return {
    discovery_cve_executive_summary: {
      description: "Produce an EXECUTIVE-style summary for a CVE: number of impacted assets, top business services / hosts / versions, and a follow-up prompt. Use this FIRST when the user asks 'are we exposed to CVE-XXXX-YYYY?' or 'what's the impact of CVE-XXXX-YYYY?'. Requires the CVE ID. The tool fetches NVD CPEs, builds the Discovery impact query and executes it internally (or uses discoveryRows if provided). Set detail='full' to return the COMPLETE impacted inventory (every host, version, service, owner) up to `limit` rows instead of the summary.",
      schema: z.object({
        cveId: cveIdSchema,
        detail: z.enum(["summary", "full"]).default("summary"),
        topN: z.number().int().min(1).max(20).default(5),
        discoveryRows: z.array(z.record(z.unknown())).default([]),
        language: languageSchema,
        question: z.string().optional()
      }).strict(),
      outputSchema: structuredOutputSchema,
      handler: async (input: { cveId: string; detail: "summary" | "full"; topN: number; discoveryRows: Array<Record<string, unknown>>; language?: "fr" | "en"; question?: string }) => {
        const lang = resolveLanguage(input.language, input.question);
        const t = i18n(lang);
        const cveId = input.cveId.toUpperCase();
        const cpes = await fetchNvdCpes(cveId, config.nvdApiKey);
        const dsl = buildDiscoveryDsl(cpes);
        const { rows, source } = await rowsForExecutiveSummary(client, dsl, input.discoveryRows, cpes, cveId);

        if (input.detail === "full") {
          const cap = config.resultLimit ?? null;
          const limitedRows = cap === null ? rows : rows.slice(0, cap);
          return {
            cveHeader: { cveId, riskTitle: t.riskTitle },
            cveSummary: { cpeCount: cpes.length, impactedRowsCount: rows.length },
            execution: source,
            dslQuery: dsl,
            expectedColumns: t.expectedColumns,
            returnedRows: limitedRows.length,
            rows: limitedRows
          };
        }

        const topServices = aggregateTop(rows, ["Service Name", "Business Service", "business_service", "service"], input.topN);
        const topHosts = aggregateTop(rows, ["Host Name", "Host", "host"], input.topN);
        const topVersions = aggregateTop(rows, ["Full Version", "version", "product_version"], input.topN);
        const matchPrecision = aggregateTop(rows, ["matchPrecision"], 2);

        return {
          cveHeader: { cveId, riskTitle: t.riskTitle, note: t.summaryNote },
          cveSummary: { cpeCount: cpes.length, impactedRowsCount: rows.length, topServices, topHosts, topVersions, matchPrecision },
          discoverySearchPlan: { execution: source, dslQuery: dsl },
          followUpPrompt: t.followUpPrompt
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
