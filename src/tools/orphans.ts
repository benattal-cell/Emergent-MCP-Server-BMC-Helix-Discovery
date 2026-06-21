import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";
import { kpiDashboard, type BarDatum } from "../svg/kpi.js";
import { renderVisual } from "../svg/renderer.js";
import { appendRowsMarkdownSummary } from "./shared/markdownTable.js";
import { orphanOutputSchema } from "./outputSchemas.js";

type GroupBy = "host" | "publisher" | "product" | "type";
type OrphanCategory = "NO_INBOUND" | "HAS_INBOUND" | "ONLY_FILTERED_INBOUND" | "HAS_SIGNIFICANT_INBOUND";

const targetFilterSchema = z.object({
  type_matches: z.string().min(1).optional(),
  type_in: z.array(z.string().min(1)).min(1).optional(),
  name_contains: z.string().min(1).optional(),
  publisher_in: z.array(z.string().min(1)).min(1).optional(),
  product_in: z.array(z.string().min(1)).min(1).optional(),
  custom_where: z.string().min(1).optional()
}).strict();

const inboundRelationSchema = z.object({
  kind: z.string().min(1),
  source_kind: z.string().min(1),
  direction: z.enum(["in", "out"]).default("in")
}).strict();

const noiseFiltersSchema = z.object({
  exclude_source_type_patterns: z.array(z.string().min(1)).default([]),
  exclude_source_name_patterns: z.array(z.string().min(1)).default([]),
  exclude_self_kind: z.boolean().default(false),
  exclude_same_host: z.boolean().default(false)
}).strict();

export const findOrphansSchema = z.object({
  target_kind: z.string().min(1),
  target_filter: targetFilterSchema.default({}),
  inbound_relation: inboundRelationSchema,
  noise_filters: noiseFiltersSchema.default({}),
  include_active: z.boolean().default(false),
  include_inbound_detail: z.boolean().default(false),
  group_by: z.enum(["host", "publisher", "product", "type"]).nullable().default(null),
  offset: z.number().int().min(0).default(0)
}).strict();

export type FindOrphansInput = z.infer<typeof findOrphansSchema>;

function esc(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function combineRegex(patterns: string[]): string {
  if (patterns.length === 1) return patterns[0];
  return `(?i)(${patterns.map((p) => p.replace(/^\(\?i\)/i, "")).join("|")})`;
}

function buildTargetWhere(input: FindOrphansInput): string {
  const filter = input.target_filter ?? {};
  const parts: string[] = [];
  if (filter.type_matches) parts.push(`type MATCHES "${esc(filter.type_matches)}"`);
  if (filter.type_in?.length) parts.push(`(${filter.type_in.map((v) => `type = "${esc(v)}"`).join(" or ")})`);
  if (filter.name_contains) parts.push(`name has subword "${esc(filter.name_contains)}"`);
  if (filter.publisher_in?.length) parts.push(`(${filter.publisher_in.map((v) => `publisher = "${esc(v)}"`).join(" or ")})`);
  if (filter.product_in?.length) parts.push(`(${filter.product_in.map((v) => `product = "${esc(v)}"`).join(" or ")})`);
  if (filter.custom_where) parts.push(`(${filter.custom_where})`);
  return parts.length ? `\nWHERE ${parts.join(" AND ")}` : "";
}

function buildTraverse(input: FindOrphansInput): string {
  return `TRAVERSE :${input.inbound_relation.kind}::${input.inbound_relation.source_kind}`;
}

function buildNoiseWhere(input: FindOrphansInput): string {
  const noise = input.noise_filters ?? {};
  const parts: string[] = [];
  if (noise.exclude_source_type_patterns.length) {
    parts.push(`type NOT MATCHES "${esc(combineRegex(noise.exclude_source_type_patterns))}"`);
  }
  for (const pattern of noise.exclude_source_name_patterns) {
    parts.push(`name NOT MATCHES "${esc(pattern)}"`);
  }
  if (noise.exclude_self_kind) parts.push(`type != "${esc(input.target_kind)}"`);
  return parts.length ? ` WHERE ${parts.join(" AND ")}` : "";
}

function hasDslNoiseFilters(input: FindOrphansInput): boolean {
  const noise = input.noise_filters ?? {};
  return noise.exclude_source_type_patterns.length > 0 || noise.exclude_source_name_patterns.length > 0 || noise.exclude_self_kind;
}

export function buildFindOrphansQuery(input: FindOrphansInput): string {
  const traverse = buildTraverse(input);
  const where = buildTargetWhere(input);
  const noiseWhere = buildNoiseWhere(input);
  const showFields = "name AS name, type AS type, host_name AS host";
  if (hasDslNoiseFilters(input)) {
    return `SEARCH ${input.target_kind}${where}\nSHOW ${showFields}, NODECOUNT(${traverse}${noiseWhere}) AS significant_inbound, NODECOUNT(${traverse}) AS total_inbound`;
  }
  return `SEARCH ${input.target_kind}${where}\nSHOW ${showFields}, NODECOUNT(${traverse}) AS inbound_count`;
}

function collectNames(payload: unknown): string[] {
  if (Array.isArray(payload)) return payload.flatMap(collectNames);
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const direct = [record.name, record.kind, record.relkind, record.nodekind].filter((v): v is string => typeof v === "string");
    if (direct.length) return direct;
    const containers = [record.items, record.results, record.nodekinds, record.relkinds, record.kinds, record.names].filter(Boolean);
    const nested = containers.flatMap(collectNames);
    if (nested.length) return nested;
    return Object.keys(record);
  }
  return typeof payload === "string" ? [payload] : [];
}

function asCount(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function categorize(row: Record<string, unknown>, hasNoise: boolean): OrphanCategory {
  if (!hasNoise) return asCount(row.inbound_count) === 0 ? "NO_INBOUND" : "HAS_INBOUND";
  const significant = asCount(row.significant_inbound);
  const total = asCount(row.total_inbound);
  if (significant === 0 && total === 0) return "NO_INBOUND";
  if (significant === 0 && total > 0) return "ONLY_FILTERED_INBOUND";
  return "HAS_SIGNIFICANT_INBOUND";
}

function shouldInclude(category: OrphanCategory, includeActive: boolean): boolean {
  if (includeActive) return true;
  return category === "NO_INBOUND" || category === "ONLY_FILTERED_INBOUND";
}

function grouped(rows: Array<Record<string, unknown>>, groupBy: GroupBy | null): Record<string, number> | undefined {
  if (!groupBy) return undefined;
  return rows.reduce<Record<string, number>>((acc, row) => {
    const key = typeof row[groupBy] === "string" && row[groupBy] !== "" ? row[groupBy] as string : "(empty)";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

async function validateTaxonomy(client: DiscoveryClient, input: FindOrphansInput): Promise<void> {
  const [nodeKindsPayload, relKindsPayload] = await Promise.all([
    client.getTaxonomyNodeKinds(false),
    client.getTaxonomyRelationshipKinds(false)
  ]);
  const nodeKinds = Array.from(new Set(collectNames(nodeKindsPayload))).sort();
  const relKinds = Array.from(new Set(collectNames(relKindsPayload))).sort();
  const invalid: string[] = [];
  if (!nodeKinds.includes(input.target_kind)) invalid.push(`Invalid target_kind '${input.target_kind}'. Valid node kinds include: ${nodeKinds.slice(0, 50).join(", ")}`);
  if (!nodeKinds.includes(input.inbound_relation.source_kind)) invalid.push(`Invalid inbound_relation.source_kind '${input.inbound_relation.source_kind}'. Valid node kinds include: ${nodeKinds.slice(0, 50).join(", ")}`);
  if (!relKinds.includes(input.inbound_relation.kind)) invalid.push(`Invalid inbound_relation.kind '${input.inbound_relation.kind}'. Valid relationship kinds include: ${relKinds.slice(0, 50).join(", ")}`);
  if (invalid.length) throw new Error(invalid.join("\n"));
}

export function orphansTools(client: DiscoveryClient) {
  return {
    discovery_find_orphans: {
      description: `Neutral orphan finder for BMC Helix Discovery. This tool does NOT decide what is 'noise' on your behalf. The patterns you provide in noise_filters are applied verbatim. An empty exclude list means every inbound relationship is counted. The recipes below are starting points, not safe defaults — review the exclude patterns for your environment before drawing conclusions.

RECIPES:
1. Rationalization scan — databases with no application client: target_kind=SoftwareInstance, target_filter.type_matches="(?i)Database Server$", inbound_relation.kind=ObservedCommunication, source_kind=SoftwareInstance, and explicitly exclude only management/backup/cluster patterns your team agrees are non-application clients.
2. Audit scan — show ALL inbound including agents and backups: leave noise_filters empty and set include_active=true so every inbound relationship is counted and visible.
3. Hosts hosting no software (orphan hardware): target_kind=Host, inbound_relation.kind=HostedSoftware, source_kind=SoftwareInstance, direction=out, no noise filters.
4. LoadBalancerPool with no backend: target_kind=LoadBalancerPool and choose the backend relationship/source_kind from taxonomy; do not exclude health checks unless that is explicitly part of your audit scope.

Use discovery_execute_dsl if you want to inspect or run raw Discovery DSL. Limitations: exclude_same_host is documented as a first-version limitation and cannot be removed from total_inbound because total_inbound is computed by Discovery DSL before post-processing. ObservedCommunication direction can be asymmetric depending on model/storage; the :Rel::Kind traversal avoids role assumptions and is the default form.`,
      schema: findOrphansSchema,
      outputSchema: orphanOutputSchema,
      handler: async (input: FindOrphansInput) => {
        await validateTaxonomy(client, input);
        const generated_dsl_query = buildFindOrphansQuery(input);
        const result = await client.queryJson(generated_dsl_query, undefined, {
          entityLabel: input.target_kind,
          appliedFilters: input as unknown as Record<string, unknown>,
          offset: input.offset
        });
        const hasNoise = hasDslNoiseFilters(input);
        const allRows = result.rows.map((row) => {
          const category = categorize(row, hasNoise);
          return { ...row, category };
        });
        const rows = allRows.filter((row) => shouldInclude(row.category as OrphanCategory, input.include_active));
        const by_category = allRows.reduce<Record<string, number>>((acc, row) => {
          const category = String(row.category);
          acc[category] = (acc[category] ?? 0) + 1;
          return acc;
        }, {});
        const warnings: string[] = [];
        if (input.noise_filters.exclude_same_host) warnings.push("exclude_same_host is not implemented in DSL in this version; total_inbound still includes same-host relationships.");
        if (input.include_inbound_detail) warnings.push("include_inbound_detail requested, but this version returns count-based categorization only; use generated_dsl_query with discovery_execute_dsl for raw DSL debugging.");
        if (result.returnedCount < result.totalCount) warnings.push("Result set is truncated by the server result limit (MCP_RESULT_LIMIT); refine target_filter or raise MCP_RESULT_LIMIT.");
        const payload = {
          summary: {
            total_candidates: allRows.length,
            total_matching_in_discovery: result.totalCount,
            returned_candidates: result.returnedCount,
            by_category,
            grouped_by: grouped(allRows, input.group_by),
            filters_applied: input,
            generated_dsl_query,
            warnings
          },
          rows,
          generated_dsl_query
        };
        const byType = rows.reduce<Record<string, number>>((acc, row) => {
          const value = (row as Record<string, unknown>).type;
          const t = typeof value === "string" && value.trim() !== "" ? value : "(type inconnu)";
          acc[t] = (acc[t] ?? 0) + 1;
          return acc;
        }, {});
        const bars: BarDatum[] = Object.entries(byType).map(([label, value]) => ({ label, value }));
        const svg = kpiDashboard(
          "Orphelins",
          [
            { label: "Éléments orphelins", value: String(rows.length), hint: `${allRows.length} candidats analysés`, alert: rows.length > 0 },
            { label: "Kind", value: input.target_kind, hint: input.inbound_relation.kind }
          ],
          bars,
          { barTitle: "Répartition par type", maxBars: 12 }
        );
        return renderVisual(svg, {
          name: `orphans_${input.target_kind.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase()}`,
          textSummary: appendRowsMarkdownSummary(`${rows.length} orphan candidates retained from ${allRows.length} analyzed ${input.target_kind} rows.`, rows),
          structuredContent: payload
        });
      },
      isVisual: true as const
    }
  };
}
