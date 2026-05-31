import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";
import { kpiGrid } from "../svg/kpi.js";
import { renderVisual } from "../svg/renderer.js";
import { flatRowsOutputSchema } from "./outputSchemas.js";

const patchComplianceSchema = z.object({
  kbList: z.array(z.string().min(1)).min(1).max(100),
  complianceMode: z.enum(["all", "any"]).default("all"),
  osContains: z.string().min(1).optional(),
  hostsSoftwareMatching: z.string().min(1).optional(),
  hostingFilter: z.enum(["with", "without", "any"]).default("any"),
  limit: z.number().int().min(1).max(1000).default(100)
}).strict();

type PatchComplianceInput = z.infer<typeof patchComplianceSchema>;

function escDouble(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escSingle(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function uniqueKbList(kbList: string[]): string[] {
  return [...new Set(kbList.map((kb) => kb.trim()).filter(Boolean))];
}

function patchNamePredicate(kbList: string[]): string {
  return `(${uniqueKbList(kbList).map((kb) => `name = '${escSingle(kb)}'`).join(" or ")})`;
}

function installedKbCountExpr(kbList: string[]): string {
  return `NODECOUNT(TRAVERSE :HostedSoftware::Patch WHERE ${patchNamePredicate(kbList)})`;
}

function targetFilters(input: PatchComplianceInput): string[] {
  const filters = [`os_type = "Windows"`];
  if (input.osContains) filters.push(`os MATCHES "${escDouble(input.osContains)}"`);

  if (input.hostsSoftwareMatching && input.hostingFilter !== "any") {
    const softwareMatch = `(type MATCHES "${escDouble(input.hostsSoftwareMatching)}" or name MATCHES "${escDouble(input.hostsSoftwareMatching)}")`;
    const countExpr = `NODECOUNT(TRAVERSE :HostedSoftware::SoftwareInstance WHERE ${softwareMatch})`;
    filters.push(input.hostingFilter === "with" ? `${countExpr} > 0` : `${countExpr} = 0`);
  }

  return filters;
}

function whereClause(filters: string[]): string {
  return filters.length > 0 ? ` WHERE ${filters.join(" and ")}` : "";
}

export function buildPatchComplianceQueries(input: PatchComplianceInput): { targetQuery: string; nonCompliantQuery: string } {
  const normalizedKbList = uniqueKbList(input.kbList);
  const filters = targetFilters({ ...input, kbList: normalizedKbList });
  const patchCount = installedKbCountExpr(normalizedKbList);
  const compliancePredicate = input.complianceMode === "all"
    ? `${patchCount} < ${normalizedKbList.length}`
    : `${patchCount} = 0`;
  const nonCompliantFilters = [...filters, compliancePredicate];
  const showColumns = [
    "name AS 'Host'",
    "hostname AS 'Hostname'",
    "os AS 'OS'",
    "vendor AS 'Vendor'",
    "virtual AS 'Virtual'",
    `${patchCount} AS 'Installed KB Count'`,
    "#:HostedSoftware::Patch.name AS 'Installed KBs'"
  ].join(", ");

  return {
    targetQuery: `SEARCH Host${whereClause(filters)} SHOW name AS 'Host'`,
    nonCompliantQuery: `SEARCH Host${whereClause(nonCompliantFilters)} SHOW ${showColumns}`
  };
}

function listFromValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return [value];
  if (value === null || value === undefined) return [];
  return [String(value)];
}

function addMissingKbColumn(rows: Array<Record<string, unknown>>, kbList: string[]): Array<Record<string, unknown>> {
  const normalized = uniqueKbList(kbList);
  return rows.map((row) => {
    const installed = new Set(listFromValue(row["Installed KBs"]).map((value) => value.toUpperCase()));
    const missing = normalized.filter((kb) => !installed.has(kb.toUpperCase()));
    return { ...row, "Missing KBs": missing.join(", ") };
  });
}

function appliedFiltersFor(input: PatchComplianceInput): Record<string, unknown> {
  const applied: Record<string, unknown> = {
    kbList: uniqueKbList(input.kbList),
    complianceMode: input.complianceMode,
    hostingFilter: input.hostingFilter
  };
  if (input.osContains) applied.osContains = input.osContains;
  if (input.hostsSoftwareMatching) applied.hostsSoftwareMatching = input.hostsSoftwareMatching;
  return applied;
}

export function patchComplianceTools(client: DiscoveryClient) {
  return {
    discovery_patch_compliance_report: {
      description: "Run a Windows host patch compliance report directly in Discovery. Starts from Host nodes (virtual and bare-metal), optionally filters by OS regex and by hosted SoftwareInstance type/name regex, then checks Patch nodes whose name equals every/any KB in kbList. Returns visual KPIs plus non-compliant hosts with missing KBs. USE THIS DIRECTLY; do not delegate to discovery_search_data.",
      schema: patchComplianceSchema,
      outputSchema: flatRowsOutputSchema,
      handler: async (input: PatchComplianceInput) => {
        const queries = buildPatchComplianceQueries(input);
        const appliedFilters = appliedFiltersFor(input);
        const [targeted, nonCompliant] = await Promise.all([
          client.queryJson(queries.targetQuery, 0, { entityLabel: "hôtes Windows ciblés", appliedFilters }),
          client.queryJson(queries.nonCompliantQuery, input.limit, { entityLabel: "hôtes non conformes", appliedFilters })
        ]);
        const rows = addMissingKbColumn(Array.isArray(nonCompliant.rows) ? nonCompliant.rows : [], input.kbList);
        const totalHosts = targeted.totalCount ?? 0;
        const nonCompliantCount = nonCompliant.totalCount ?? rows.length;
        const compliantCount = Math.max(totalHosts - nonCompliantCount, 0);
        const compliancePct = totalHosts > 0 ? Math.round((compliantCount / totalHosts) * 100) : 0;
        const result = {
          summary: `${nonCompliantCount} hôte(s) non conforme(s) sur ${totalHosts} hôte(s) Windows ciblé(s).`,
          totalCount: nonCompliantCount,
          returnedCount: rows.length,
          rows,
          compliance: { totalHosts, compliantCount, nonCompliantCount, compliancePct },
          generated_dsl_queries: queries,
          appliedFilters
        };
        const svg = kpiGrid("Patch compliance", [
          { label: "Hôtes ciblés", value: String(totalHosts), hint: input.osContains ?? "Windows" },
          { label: "% conformes", value: `${compliancePct}%`, hint: input.complianceMode === "all" ? "Tous les KB" : "Au moins un KB", alert: compliancePct < 95 },
          { label: "Non conformes", value: String(nonCompliantCount), hint: uniqueKbList(input.kbList).join(", "), alert: nonCompliantCount > 0 }
        ], { columns: 3 });
        return renderVisual(svg, { name: "patch_compliance_report", textSummary: result.summary, structuredContent: result });
      },
      isVisual: true as const
    }
  };
}
