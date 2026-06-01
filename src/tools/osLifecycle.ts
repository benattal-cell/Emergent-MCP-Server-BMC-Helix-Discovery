import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";
import { kpiGrid } from "../svg/kpi.js";
import { renderVisual } from "../svg/renderer.js";
import { flatRowsOutputSchema } from "./outputSchemas.js";

const riskWindowDaysDefault = 182;
const DAY_IN_NANOS = 864000000000;

const osLifecycleSchema = z.object({
  osContains: z.string().min(1).optional(),
  onlyAtRisk: z.boolean().default(false),
  riskWindowDays: z.number().int().min(1).max(3650).default(riskWindowDaysDefault),
  limit: z.number().int().min(1).max(1000).default(100)
}).strict();

type OsLifecycleInput = z.infer<typeof osLifecycleSchema>;

function escDouble(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function osSupportPrefix(attribute: string): string {
  return `#ElementWithDetail:SupportDetail:OSDetail:SupportDetail.${attribute}`;
}

function supportValue(attribute: string): string {
  return `value(${osSupportPrefix(attribute)})`;
}

function supportDateAlias(attribute: string): string {
  return `@${attribute}`;
}

function osDetailFilter(): string {
  return `${supportDateAlias("support_type")} = "OS Support Detail"`;
}

function nonPertinentFailureReason(): string {
  return `(${supportDateAlias("failure_reason")} and ${supportDateAlias("failure_reason")} MATCHES "(?i).*not pertinent.*")`;
}

function riskExpr(riskWindowDays: number): { order: string; display: string; inWindow: string } {
  const windowNanos = riskWindowDays * DAY_IN_NANOS;
  return {
    order: `(
    @end_support_date and (@end_support_date < currentTime() and '01 - EOS Exceeded')
    or @end_support_date and (@end_support_date < currentTime() + ${windowNanos} and '02 - EOS less than ${riskWindowDays} days away')
    or @end_security_support_date and (@end_security_support_date < currentTime() and '03 - EOSS Exceeded')
    or @end_ext_support_date and (@end_ext_support_date < currentTime() and '04 - EOES Exceeded')
    or @retirement_date and (@retirement_date < currentTime() and '05 - EOL Exceeded')
    or '99 - No immediate EOS risk'
  )`,
    display: `(
    @end_support_date and (@end_support_date < currentTime() and 'EOS Exceeded')
    or @end_support_date and (@end_support_date < currentTime() + ${windowNanos} and 'EOS less than ${riskWindowDays} days away')
    or @end_security_support_date and (@end_security_support_date < currentTime() and 'EOSS Exceeded')
    or @end_ext_support_date and (@end_ext_support_date < currentTime() and 'EOES Exceeded')
    or @retirement_date and (@retirement_date < currentTime() and 'EOL Exceeded')
    or 'No immediate EOS risk'
  )`,
    inWindow: `(@end_support_date and @end_support_date >= currentTime() and @end_support_date < currentTime() + ${windowNanos})`
  };
}

function dataQualityExpr(): string {
  return `(
    (@end_support_date or @end_security_support_date or @end_ext_support_date or @retirement_date or @default_retirement_date) and 'Dates present'
    or (${nonPertinentFailureReason()} and 'Not pertinent')
    or @failure_reason and 'Failure reason supplied'
    or 'Missing lifecycle dates'
  )`;
}

function buildWhereClause(input: OsLifecycleInput, mode: "base" | "atRisk" | "window" = "base"): string {
  const filters = [osDetailFilter()];
  if (input.osContains) filters.push(`os MATCHES "${escDouble(input.osContains)}"`);
  if (input.onlyAtRisk || mode === "atRisk") filters.push("(@end_support_date and @end_support_date < currentTime())");
  if (mode === "window") filters.push(riskExpr(input.riskWindowDays).inWindow);
  return filters.join(" and ");
}

export function buildOsLifecycleQuery(input: OsLifecycleInput, mode: "base" | "atRisk" | "window" = "base"): string {
  const risk = riskExpr(input.riskWindowDays);
  const withClause = [
    `${supportValue("end_support_date")} as end_support_date`,
    `${supportValue("end_security_support_date")} as end_security_support_date`,
    `${supportValue("end_ext_support_date")} as end_ext_support_date`,
    `${supportValue("retirement_date")} as retirement_date`,
    `${supportValue("default_retirement_date")} as default_retirement_date`,
    `${supportValue("name")} as support_name`,
    `${supportValue("product")} as product`,
    `${supportValue("publisher")} as publisher`,
    `${supportValue("failure_reason")} as failure_reason`,
    `${supportValue("type")} as support_type`
  ].join(", ");

  return `SEARCH Host WITH ${withClause} WHERE ${buildWhereClause(input, mode)} ORDER BY ${risk.order} SHOW name AS 'Host', os AS 'OS', vendor AS 'Vendor', virtual AS 'Virtual', @support_name AS 'Support Detail', @product AS 'Product', @publisher AS 'Publisher', (@end_support_date and formatTime(@end_support_date, '%Y-%m-%d')) AS 'EOS', (@end_security_support_date and formatTime(@end_security_support_date, '%Y-%m-%d')) AS 'EOSS', (@end_ext_support_date and formatTime(@end_ext_support_date, '%Y-%m-%d')) AS 'EOES', (@retirement_date and formatTime(@retirement_date, '%Y-%m-%d')) AS 'EOL', (@default_retirement_date and formatTime(@default_retirement_date, '%Y-%m-%d')) AS 'Default EOL', @failure_reason AS 'Failure Reason', ${dataQualityExpr()} AS 'Date Data Quality', ${risk.display} AS 'OS Lifecycle Risk'`;
}

function appliedFiltersFor(input: OsLifecycleInput): Record<string, unknown> {
  const applied: Record<string, unknown> = {
    onlyAtRisk: input.onlyAtRisk,
    riskWindowDays: input.riskWindowDays
  };
  if (input.osContains) applied.osContains = input.osContains;
  return applied;
}

export function osLifecycleTools(client: DiscoveryClient) {
  return {
    discovery_os_lifecycle_report: {
      description: "Run an operating-system lifecycle report directly in Discovery. Starts from Host nodes, traverses OS SupportDetail only, returns host OS/vendor/virtual plus EOS/EOSS/EOES/EOL/default dates and failure_reason. A missing date with failure_reason containing 'not pertinent' is classified as not pertinent, not as missing data. USE THIS DIRECTLY; do not delegate to discovery_search_data.",
      schema: osLifecycleSchema,
      outputSchema: flatRowsOutputSchema,
      handler: async (input: OsLifecycleInput) => {
        const appliedFilters = appliedFiltersFor(input);
        const [hosts, atRisk, inWindow] = await Promise.all([
          client.queryJson(buildOsLifecycleQuery(input), input.limit, { entityLabel: "hôtes avec lifecycle OS", appliedFilters }),
          client.queryJson(buildOsLifecycleQuery({ ...input, onlyAtRisk: false }, "atRisk"), 0, { entityLabel: "hôtes OS à risque", appliedFilters }),
          client.queryJson(buildOsLifecycleQuery({ ...input, onlyAtRisk: false }, "window"), 0, { entityLabel: "hôtes OS dans la fenêtre de risque", appliedFilters })
        ]);
        const rows = Array.isArray(hosts.rows) ? hosts.rows : [];
        const result = {
          summary: `${atRisk.totalCount ?? 0} hôte(s) OS à risque sur ${hosts.totalCount ?? rows.length} hôte(s) ciblé(s).`,
          totalCount: hosts.totalCount,
          returnedCount: rows.length,
          rows,
          risk: {
            hosts: hosts.totalCount ?? rows.length,
            atRisk: atRisk.totalCount ?? 0,
            window: inWindow.totalCount ?? 0,
            riskWindowDays: input.riskWindowDays
          },
          generated_dsl_query: buildOsLifecycleQuery(input),
          appliedFilters
        };
        const svg = kpiGrid("OS lifecycle", [
          { label: "Hôtes", value: String(result.risk.hosts), hint: input.osContains },
          { label: "À risque", value: String(result.risk.atRisk), hint: "EOS dépassée", alert: result.risk.atRisk > 0 },
          { label: "Fenêtre", value: String(result.risk.window), hint: `${input.riskWindowDays} j`, alert: result.risk.window > 0 }
        ], { columns: 3 });
        return renderVisual(svg, { name: "os_lifecycle_report", textSummary: result.summary, structuredContent: result });
      },
      isVisual: true as const
    }
  };
}
