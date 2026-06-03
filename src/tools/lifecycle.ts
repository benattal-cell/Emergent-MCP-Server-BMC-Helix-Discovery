import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";
import { kpiGrid } from "../svg/kpi.js";
import { renderVisual } from "../svg/renderer.js";
import { dslQueryOutputSchema, flatRowsOutputSchema } from "./outputSchemas.js";
import { appendRowsMarkdownSummary } from "./shared/markdownTable.js";
import { DAY_IN_NANOS } from "./shared/time.js";

const riskWindowDaysDefault = 182;

const softwareTypeEnum = z.enum(["software", "OS", "hardware"]);

const lifecycleSchema = z.object({
  riskWindowDays: z.number().int().min(1).max(3650).default(riskWindowDaysDefault),
  includeUrlEncoded: z.boolean().default(false),
  hostNameContains: z.string().min(1).optional(),
  publisherContains: z.string().min(1).optional(),
  productContains: z.string().min(1).optional(),
  typeIn: z.array(softwareTypeEnum).min(1).optional(),
  onlyAtRisk: z.boolean().default(false)
}).strict();

const lifecycleReportSchema = z.object({
  limit: z.number().int().min(1).max(500).default(100),
  riskWindowDays: z.number().int().min(1).max(3650).default(riskWindowDaysDefault),
  onlyAtRisk: z.boolean().default(false),
  hostNameContains: z.string().min(1).optional(),
  publisherContains: z.string().min(1).optional(),
  productContains: z.string().min(1).optional(),
  typeIn: z.array(softwareTypeEnum).min(1).optional()
}).strict();

function esc(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildWhereClause(input: z.infer<typeof lifecycleSchema>): string {
  const hasDates = "(@retirement_date or @end_support_date or @end_security_support_date or @end_ext_support_date)";
  const filters: string[] = [hasDates];

  if (input.hostNameContains) {
    const needle = esc(input.hostNameContains);
    filters.push(`nodecount(traverse RunningSoftware:HostedSoftware:Host:Host where name has subword "${needle}" or hostname has subword "${needle}" or dns_name has subword "${needle}") > 0`);
  }
  if (input.publisherContains) {
    const needle = esc(input.publisherContains);
    filters.push(`(publisher has subword "${needle}" or type has subword "${needle}" or @support_publisher has subword "${needle}")`);
  }
  if (input.productContains) filters.push(`product has subword "${esc(input.productContains)}"`);
  if (input.typeIn && input.typeIn.length > 0) {
    filters.push(`(${input.typeIn.map((v) => `type = '${v}'`).join(" or ")})`);
  }

  if (input.onlyAtRisk) {
    filters.push("((@end_ext_support_date and @end_ext_support_date < currentTime()) or (@end_security_support_date and @end_security_support_date < currentTime()) or (@end_support_date and @end_support_date < currentTime()) or (@retirement_date and @retirement_date < currentTime()))");
  }

  return filters.join(" and ");
}

export function buildLifecycleQuery(input: z.infer<typeof lifecycleSchema>): string {
  const windowNanos = input.riskWindowDays * DAY_IN_NANOS;
  const orderRiskExpr = `(
    @end_ext_support_date and (@end_ext_support_date < currentTime() and '01 - EOES Exceeded')
    or @end_security_support_date and (@end_security_support_date < currentTime() and '02 - EOSS Exceeded')
    or @end_support_date and (@end_support_date < currentTime() and '03 - EOS Exceeded')
    or @retirement_date and (@retirement_date < currentTime() and '04 - EOL Exceeded')
    or (
      @end_ext_support_date and (@end_ext_support_date < currentTime() + ${windowNanos} and '05 - EOES less than ${input.riskWindowDays} days away')
      or @end_security_support_date and (@end_security_support_date < currentTime() + ${windowNanos} and '06 - EOSS less than ${input.riskWindowDays} days away')
      or @end_support_date and (@end_support_date < currentTime() + ${windowNanos} and '07 - EOS less than ${input.riskWindowDays} days away')
      or @retirement_date and (@retirement_date < currentTime() + ${windowNanos} and '08 - EOL less than ${input.riskWindowDays} days away')
    )
    or (
      @end_ext_support_date and '09 - EOES more than ${input.riskWindowDays} days away'
      or @end_security_support_date and '10 - EOSS more than ${input.riskWindowDays} days away'
      or @end_support_date and '11 - EOS more than ${input.riskWindowDays} days away'
      or @retirement_date and '12 - EOL more than ${input.riskWindowDays} days away'
    )
  )`;

  const displayRiskExpr = `(
    @end_ext_support_date and (@end_ext_support_date < currentTime() and 'EOES Exceeded')
    or @end_security_support_date and (@end_security_support_date < currentTime() and 'EOSS Exceeded')
    or @end_support_date and (@end_support_date < currentTime() and 'EOS Exceeded')
    or @retirement_date and (@retirement_date < currentTime() and 'EOL Exceeded')
    or (
      @end_ext_support_date and (@end_ext_support_date < currentTime() + ${windowNanos} and 'EOES less than ${input.riskWindowDays} days away')
      or @end_security_support_date and (@end_security_support_date < currentTime() + ${windowNanos} and 'EOSS less than ${input.riskWindowDays} days away')
      or @end_support_date and (@end_support_date < currentTime() + ${windowNanos} and 'EOS less than ${input.riskWindowDays} days away')
      or @retirement_date and (@retirement_date < currentTime() + ${windowNanos} and 'EOL less than ${input.riskWindowDays} days away')
    )
    or (
      @end_ext_support_date and 'EOES more than ${input.riskWindowDays} days away'
      or @end_security_support_date and 'EOSS more than ${input.riskWindowDays} days away'
      or @end_support_date and 'EOS more than ${input.riskWindowDays} days away'
      or @retirement_date and 'EOL more than ${input.riskWindowDays} days away'
    )
  )`;

  return `search SoftwareInstance with value(#ElementWithDetail:SupportDetail:SoftwareDetail:SupportDetail.retirement_date) as retirement_date, value(#ElementWithDetail:SupportDetail:SoftwareDetail:SupportDetail.end_support_date) as end_support_date, value(#ElementWithDetail:SupportDetail:SoftwareDetail:SupportDetail.end_security_support_date) as end_security_support_date, value(#ElementWithDetail:SupportDetail:SoftwareDetail:SupportDetail.end_ext_support_date) as end_ext_support_date, value(#ElementWithDetail:SupportDetail:SoftwareDetail:SupportDetail.publisher) as support_publisher where ${buildWhereClause(input)} order by ${orderRiskExpr} show name as 'Software Instance', type as 'Type', publisher as 'SI Publisher', product as 'Product', edition as 'Edition', product_version as 'Product Version', full_version as 'Full Version', @support_publisher as 'Support Detail Publisher', (@retirement_date and formatTime(@retirement_date, '%Y-%m-%d')) as 'End of Life', (@end_support_date and formatTime(@end_support_date, '%Y-%m-%d')) as 'End of Support', (@end_security_support_date and formatTime(@end_security_support_date, '%Y-%m-%d')) as 'End of Security Support', (@end_ext_support_date and formatTime(@end_ext_support_date, '%Y-%m-%d')) as 'End of Ext Support', ${displayRiskExpr} as 'Lifecycle Risk', #RunningSoftware:HostedSoftware:Host:Host.name as 'Host', #ClusteredSoftware:HostedSoftware:Host:Host.name as 'Cluster Hosts', #AggregateSoftware:HostedSoftware:Host:Host.name as 'Aggregate Hosts'`;
}

function appliedFiltersFor(input: z.infer<typeof lifecycleReportSchema>): Record<string, unknown> {
  const applied: Record<string, unknown> = {
    riskWindowDays: input.riskWindowDays,
    onlyAtRisk: input.onlyAtRisk
  };
  if (input.hostNameContains) applied.hostNameContains = input.hostNameContains;
  if (input.publisherContains) applied.publisherContains = input.publisherContains;
  if (input.productContains) applied.productContains = input.productContains;
  if (input.typeIn) applied.typeIn = input.typeIn;
  return applied;
}

export function lifecycleTools(client: DiscoveryClient) {
  return {
    discovery_lifecycle_report: {
      description: "Run the end-of-life/end-of-support report. Returns software/OS with their EOL, EOS, EOSS, EOES dates AND a 'Lifecycle Risk' label (e.g. 'EOS Exceeded', 'EOL less than 182 days away'). USE THIS DIRECTLY (do not chain build_lifecycle_query + search_data) when the user asks 'what software is end-of-life?', 'what is going out of support soon?', 'show obsolete software'. ALWAYS pass `publisherContains` when the user mentions a vendor (Microsoft, Oracle, Adobe, IBM, ...). ALWAYS pass `productContains` when the user mentions a specific product (Windows Server, SQL Server, JBoss, ...). Set `onlyAtRisk=true` to filter to items already past a support date. Response includes a `summary` field with the headline count, then `rows` with the data.",
      schema: lifecycleReportSchema,
      outputSchema: flatRowsOutputSchema,
      handler: async (input: z.infer<typeof lifecycleReportSchema>) => {
        const query = buildLifecycleQuery({
          riskWindowDays: input.riskWindowDays,
          includeUrlEncoded: false,
          onlyAtRisk: input.onlyAtRisk,
          hostNameContains: input.hostNameContains,
          publisherContains: input.publisherContains,
          productContains: input.productContains,
          typeIn: input.typeIn
        });
        const result = await client.queryJson(query, input.limit, {
          entityLabel: "logiciels avec dates de cycle de vie",
          appliedFilters: appliedFiltersFor(input)
        });
        const rows = Array.isArray(result.rows) ? result.rows : [];
        const svg = kpiGrid("Lifecycle", [
          { label: input.onlyAtRisk ? "Fin de support" : "Éléments", value: String(result.totalCount ?? rows.length), hint: `${result.returnedCount ?? rows.length} retournés`, alert: input.onlyAtRisk || rows.length > 0 },
          { label: "Fenêtre risque", value: `${input.riskWindowDays} j`, hint: input.publisherContains ?? input.productContains ?? undefined }
        ], { columns: 2 });
        return renderVisual(svg, {
          name: "lifecycle_report",
          textSummary: appendRowsMarkdownSummary(result.summary, rows),
          structuredContent: result
        });
      },
      isVisual: true as const
    },
    discovery_build_lifecycle_query: {
      description: "Construit le DSL lifecycle sans l'exécuter. Pour l'exécuter, passer le dslQuery retourné à discovery_data_search avec provenance='curated' (pas de userConfirmed requis). Pour le cas standard, préférer discovery_lifecycle_report qui exécute en un appel.",
      schema: lifecycleSchema,
      outputSchema: dslQueryOutputSchema,
      handler: async (input: z.infer<typeof lifecycleSchema>) => {
        const dslQuery = buildLifecycleQuery(input);
        return {
          dslQuery,
          provenance: "curated",
          riskWindowDays: input.riskWindowDays,
          ...(input.includeUrlEncoded ? { urlEncodedQuery: encodeURIComponent(dslQuery) } : {})
        };
      }
    }
  };
}
