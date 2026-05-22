import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";

const riskWindowDaysDefault = 182;

const lifecycleSchema = z.object({
  riskWindowDays: z.number().int().min(1).max(3650).default(riskWindowDaysDefault),
  includeUrlEncoded: z.boolean().default(false),
  hostNameContains: z.string().min(1).optional(),
  publisherContains: z.string().min(1).optional(),
  productContains: z.string().min(1).optional(),
  typeIn: z.array(z.enum(["software", "OS", "hardware"])).min(1).optional(),
  onlyAtRisk: z.boolean().default(false)
}).strict();

function esc(value: string): string {
  return value.replace(/'/g, "\\'");
}

function buildWhereClause(input: z.infer<typeof lifecycleSchema>): string {
  const hasDates = "(@retirement_date or @end_support_date or @end_ext_support_date or @end_security_support_date)";
  const filters: string[] = [hasDates];

  if (input.hostNameContains) filters.push(`#:HostedSoftware:Host:Host.name matches '${esc(input.hostNameContains)}'`);
  if (input.publisherContains) filters.push(`publisher matches '${esc(input.publisherContains)}'`);
  if (input.productContains) filters.push(`product matches '${esc(input.productContains)}'`);
  if (input.typeIn && input.typeIn.length > 0) {
    const t = input.typeIn.map((v) => `type = '${v}'`).join(" or ");
    filters.push(`(${t})`);
  }

  if (input.onlyAtRisk) {
    filters.push("((@end_ext_support_date and @end_ext_support_date < currentTime()) or (@end_security_support_date and @end_security_support_date < currentTime()) or (@end_support_date and @end_support_date < currentTime()) or (@retirement_date and @retirement_date < currentTime()))");
  }

  return filters.join(" and ");
}

function buildLifecycleQuery(input: z.infer<typeof lifecycleSchema>): string {
  const windowNanos = input.riskWindowDays * 864000000000;
  const riskExpr = `(@end_ext_support_date and (@end_ext_support_date < currentTime() and 'EOES Exceeded') or @end_security_support_date and (@end_security_support_date < currentTime() and 'EOSS Exceeded') or @end_support_date and (@end_support_date < currentTime() and 'EOS Exceeded') or @retirement_date and (@retirement_date < currentTime() and 'EOL Exceeded') or (@retirement_date and (@retirement_date < currentTime() + ${windowNanos} and 'EOL less than ${input.riskWindowDays} days away') or @end_support_date and (@end_support_date < currentTime() + ${windowNanos} and 'EOS less than ${input.riskWindowDays} days away') or @end_security_support_date and (@end_security_support_date < currentTime() + ${windowNanos} and 'EOSS less than ${input.riskWindowDays} days away') or @end_ext_support_date and (@end_ext_support_date < currentTime() + ${windowNanos} and 'EOES less than ${input.riskWindowDays} days away')) or (@retirement_date and 'EOL more than ${input.riskWindowDays} days away' or @end_support_date and 'EOS more than ${input.riskWindowDays} days away' or @end_security_support_date and 'EOSS more than ${input.riskWindowDays} days away' or @end_ext_support_date and 'EOES more than ${input.riskWindowDays} days away'))`;

  return `search SoftwareInstance with value(#ElementWithDetail:SupportDetail:SoftwareDetail:SupportDetail.retirement_date) as retirement_date, value(#ElementWithDetail:SupportDetail:SoftwareDetail:SupportDetail.end_support_date) as end_support_date, value(#ElementWithDetail:SupportDetail:SoftwareDetail:SupportDetail.end_ext_support_date) as end_ext_support_date, value(#ElementWithDetail:SupportDetail:SoftwareDetail:SupportDetail.end_security_support_date) as end_security_support_date where ${buildWhereClause(input)} order by ${riskExpr} show name, key, known_names, type, edition, model, vendor, publisher, product, product_version, urls, failure_reason, default_retirement_date, customer_retirement_date, (retirement_date and formatTime(retirement_date, '%Y-%m-%d')) as 'End of Life', (end_support_date and formatTime(end_support_date, '%Y-%m-%d')) as 'End of Support', (end_security_support_date and formatTime(end_security_support_date, '%Y-%m-%d')) as 'End of Security Support', (end_ext_support_date and formatTime(end_ext_support_date, '%Y-%m-%d')) as 'End of Ext Support', ${riskExpr} as 'Lifecycle Risk', #:HostedSoftware:Host:Host.name as 'Host'`;
}

const lifecycleReportSchema = z.object({
  limit: z.number().int().min(1).max(500).default(100),
  riskWindowDays: z.number().int().min(1).max(3650).default(riskWindowDaysDefault),
  onlyAtRisk: z.boolean().default(false)
}).strict();

function buildGoldenLifecycleQuery(riskWindowDays: number, onlyAtRisk: boolean): string {
  const base = buildLifecycleQuery({
    riskWindowDays,
    includeUrlEncoded: false,
    onlyAtRisk,
    hostNameContains: undefined,
    publisherContains: undefined,
    productContains: undefined,
    typeIn: undefined
  });
  return base;
}

export function lifecycleTools(client: DiscoveryClient) {
  return {
    discovery_lifecycle_report: {
      schema: lifecycleReportSchema,
      handler: async (input: z.infer<typeof lifecycleReportSchema>) => {
        const query = buildGoldenLifecycleQuery(input.riskWindowDays, input.onlyAtRisk);
        return client.queryJson(query, input.limit);
      }
    },
    discovery_build_lifecycle_query: {
      schema: lifecycleSchema,
      handler: async (input: z.infer<typeof lifecycleSchema>) => {
        const dslQuery = buildLifecycleQuery(input);
        return {
          dslQuery,
          riskWindowDays: input.riskWindowDays,
          ...(input.includeUrlEncoded ? { urlEncodedQuery: encodeURIComponent(dslQuery) } : {})
        };
      }
    }
  };
}
