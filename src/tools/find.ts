import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";
import { kpiGrid, type Kpi } from "../svg/kpi.js";
import { renderVisual } from "../svg/renderer.js";
import { deriveHostRole } from "./hostRole.js";
import { flatRowsOutputSchema } from "./outputSchemas.js";
import { appendRowsMarkdownSummary } from "./shared/markdownTable.js";
import { getKnownKinds } from "./executeDsl.js";

const kindPattern = /^[A-Za-z][A-Za-z0-9_]*$/;

export const findSchema = z.object({
  kind: z.string().regex(kindPattern, "kind must be a Discovery node kind, e.g. Host, SoftwareInstance"),
  contains: z.string().min(1).optional(),
  relatedToKind: z.string().regex(kindPattern).optional(),
  relatedToName: z.string().min(1).optional(),
  fields: z.array(z.string().regex(/^[A-Za-z0-9_]+$/)).min(1).optional(),
  limit: z.number().int().min(1).max(200).default(50)
}).strict();

function esc(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function slug(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase() || "find";
}

function softwareType(row: Record<string, unknown>): string | undefined {
  return typeof row.type === "string" ? row.type : (typeof row.Type === "string" ? row.Type : undefined);
}

export function buildFindQuery(input: z.infer<typeof findSchema>): string {
  const conditions: string[] = [];
  if (input.contains) conditions.push(`* has subword "${esc(input.contains)}"`);
  if (input.relatedToKind && input.relatedToName) {
    const n = esc(input.relatedToName);
    conditions.push(
      input.relatedToKind === "Host"
        ? `(#:::Host.name has subword "${n}" or #:::Host.hostname has subword "${n}" or #:::Host.dns_name has subword "${n}")`
        : `#:::${input.relatedToKind}.name has subword "${n}"`
    );
  }
  const where = conditions.length > 0 ? ` where ${conditions.join(" and ")}` : "";
  const show = input.fields && input.fields.length > 0 ? ` show ${input.fields.join(", ")}` : "";
  return `search ${input.kind}${where}${show}`;
}

export function findTools(client: DiscoveryClient) {
  return {
    discovery_find: {
      description: "Generic search for ANY BMC Helix Discovery node kind. Provide `kind` (Host, SoftwareInstance, NetworkDevice, Database, Container, BusinessApplicationInstance, BusinessService, ...) and an optional `contains` term matched across ALL attributes (name, os, owner, domain, fqdn, ...). Optionally scope by relationship with `relatedToKind` + `relatedToName` — e.g. kind=SoftwareInstance, relatedToKind=Host, relatedToName='PROD-01' → software on that host; relatedToKind=BusinessService → software of that service. `fields` overrides the displayed columns (default: the kind's standard attributes). For multi-condition or traversal queries, use discovery_build_query / discovery_execute_dsl. Replaces the former find_hosts / find_software_instances / find_host_software tools.",
      schema: findSchema,
      outputSchema: flatRowsOutputSchema,
      handler: async (input: z.infer<typeof findSchema>) => {
        if (input.relatedToName && !input.relatedToKind) {
          return { error: "relatedToName requires relatedToKind." };
        }

        const known = await getKnownKinds(client);
        if (known) {
          for (const kind of [input.kind, input.relatedToKind].filter((value): value is string => Boolean(value))) {
            if (!known.has(kind)) {
              const lower = kind.toLowerCase();
              const suggestions = [...known].filter((k) => k.toLowerCase().includes(lower) || lower.includes(k.toLowerCase())).slice(0, 8);
              return {
                unknownKind: kind,
                suggestions,
                knownKindsSample: [...known].slice(0, 30),
                message: `Kind "${kind}" not found in the live taxonomy. Pick a valid kind (see suggestions) or call discovery_taxonomy(resource="node_kinds").`
              };
            }
          }
        }

        const appliedFilters: Record<string, unknown> = { kind: input.kind };
        if (input.contains) appliedFilters.contains = input.contains;
        if (input.relatedToKind) appliedFilters.relatedToKind = input.relatedToKind;
        if (input.relatedToName) appliedFilters.relatedToName = input.relatedToName;

        const query = buildFindQuery(input);
        const result = await client.queryJson(query, input.limit, { entityLabel: input.kind, appliedFilters });
        const rows = Array.isArray(result.rows) ? result.rows as Array<Record<string, unknown>> : [];

        const kpis: Kpi[] = [
          { label: input.kind, value: String(result.totalCount ?? rows.length), hint: `${result.returnedCount ?? rows.length} retournés` }
        ];
        const structuredContent: Record<string, unknown> = { ...result, generated_dsl_query: query };

        // Host-role enrichment only when listing the software of a host (the former find_host_software case).
        if (input.kind === "SoftwareInstance" && input.relatedToKind === "Host") {
          const role = deriveHostRole(rows.map(softwareType).filter((type): type is string => Boolean(type)));
          structuredContent.hostRole = role;
          kpis.push({ label: "Rôle hôte", value: role.role, hint: role.matched.join(", ") || "Aucun mapping" });
        }

        const svg = kpiGrid(`Recherche · ${input.kind}`, kpis, { columns: 2 });
        return renderVisual(svg, {
          name: `find_${slug(input.kind)}_${slug(input.contains ?? input.relatedToName ?? "all")}`,
          textSummary: appendRowsMarkdownSummary(result.summary, rows),
          structuredContent
        });
      },
      isVisual: true as const
    }
  };
}
