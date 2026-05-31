import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";
import { kpiGrid, type Kpi } from "../svg/kpi.js";
import { renderVisual } from "../svg/renderer.js";
import { deriveHostRole } from "./hostRole.js";
import { flatRowsOutputSchema, hostSoftwareOutputSchema } from "./outputSchemas.js";

export const findHostsSchema = z.object({
  nameContains: z.string().min(1).optional(),
  osContains: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).default(50)
}).strict();

export const findSoftwareInstancesSchema = z.object({
  typeContains: z.string().min(1).optional(),
  nameContains: z.string().min(1).optional(),
  instanceContains: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).default(50)
}).strict();

export const findHostSoftwareSchema = z.object({
  hostNameContains: z.string().min(1),
  softwareTypeContains: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).default(50)
}).strict();

function slug(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase() || "discovery";
}

function topCounts(rows: Array<Record<string, unknown>>, fields: string[], max = 2): string {
  const counts = rows.reduce<Record<string, number>>((acc, row) => {
    const value = fields.map((field) => row[field]).find((v) => typeof v === "string" && v.trim() !== "");
    const key = typeof value === "string" ? value : "Unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, max).map(([key, count]) => `${key}: ${count}`).join(" · ") || "Aucune répartition";
}

function dedupeRows(rows: Array<Record<string, unknown>>, keys: string[]): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = keys.map((field) => String(row[field] ?? "")).join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function softwareType(row: Record<string, unknown>): string | undefined {
  return typeof row.type === "string" ? row.type : (typeof row.Type === "string" ? row.Type : undefined);
}

export function hostTools(client: DiscoveryClient) {
  return {
    discovery_find_hosts: {
      description: "Find hosts (servers, VMs, devices) in BMC Helix Discovery. The `nameContains` parameter performs a case-insensitive partial match across ALL host attributes (name, hostname, dns_name, fqdn, aliases, etc.), so you can pass either a short hostname or a FQDN fragment. Returns: name, hostname, dns_name, os, type, key, id. Use when the user asks 'how many Linux servers do we have?', 'show me hosts named PROD-*', 'list all Windows machines'. For software installed on a specific host, use discovery_find_host_software instead.",
      schema: findHostsSchema,
      outputSchema: flatRowsOutputSchema,
      handler: async (input: z.infer<typeof findHostsSchema>) => {
        const result = await client.findHosts(input);
        const rows = result.rows as Array<Record<string, unknown>>;
        const svg = kpiGrid("Recherche hôtes", [
          { label: "Hôtes", value: String(result.totalCount ?? rows.length), hint: `${result.returnedCount ?? rows.length} retournés` },
          { label: "OS principaux", value: String(new Set(rows.map((row) => row.os).filter(Boolean)).size), hint: topCounts(rows, ["os", "OS"]) },
          { label: "Types", value: String(new Set(rows.map((row) => row.type).filter(Boolean)).size), hint: topCounts(rows, ["type", "kind"]) }
        ]);
        return renderVisual(svg, { name: `hosts_${slug(input.nameContains ?? input.osContains ?? "all")}`, textSummary: result.summary, structuredContent: result });
      },
      isVisual: true as const
    },
    discovery_find_software_instances: {
      description: "Find software instances (running applications, databases, middlewares) across all hosts, filtered by type/name/instance. Returns: {summary, totalCount, returnedCount, rows[]} with type, name, instance, product_version. Use when the user asks 'list all Oracle databases', 'find Apache instances', 'where is MySQL deployed?'. ALWAYS use the `summary` field for the headline count. For software on ONE specific host, prefer discovery_find_host_software.",
      schema: findSoftwareInstancesSchema,
      outputSchema: flatRowsOutputSchema,
      handler: async (input: z.infer<typeof findSoftwareInstancesSchema>) => {
        const result = await client.findSoftwareInstances(input);
        const rows = result.rows as Array<Record<string, unknown>>;
        const svg = kpiGrid("Instances logicielles", [
          { label: "Instances", value: String(result.totalCount ?? rows.length), hint: `${result.returnedCount ?? rows.length} retournées` },
          { label: "Types", value: String(new Set(rows.map(softwareType).filter(Boolean)).size), hint: topCounts(rows, ["type", "Type"]) }
        ], { columns: 2 });
        return renderVisual(svg, { name: `software_instances_${slug(input.typeContains ?? input.nameContains ?? "all")}`, textSummary: result.summary, structuredContent: result });
      },
      isVisual: true as const
    },
    discovery_find_host_software: {
      description: "List software running on a specific host (by partial host name). Optionally filter by software type. Returns: {summary, totalCount, returnedCount, rows[]} with host + installed software and versions. Use when the user asks 'what's running on SAP-PROD-01?', 'show all databases on host X', 'inventory for server Y'. Quote the `summary` field for the headline.",
      schema: findHostSoftwareSchema,
      outputSchema: hostSoftwareOutputSchema,
      handler: async (input: z.infer<typeof findHostSoftwareSchema>) => {
        const result = await client.findHostSoftware(input);
        const distinctRows = dedupeRows(result.rows as Array<Record<string, unknown>>, ["type", "name", "instance", "product_version", "#:::Host.key"]);
        const role = deriveHostRole(distinctRows.map((row) => softwareType(row)).filter((type): type is string => Boolean(type)));
        const hasLifecycleRisk = distinctRows.some((row) => ["lifecycle_risk", "Lifecycle Risk", "end_support_date", "End of Support"].some((key) => row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== ""));
        // TODO: replace the hook above with the centralized lifecycle risk classifier when lifecycle inventory rows expose normalized EOL/EOS fields here.
        const structuredContent = { ...result, rawRows: result.rows, rows: distinctRows, deduplicatedCount: distinctRows.length, hostRole: role, lifecycleRiskDetected: hasLifecycleRisk };
        const kpis: Kpi[] = [
          { label: "Logiciels distincts", value: String(distinctRows.length), hint: `${result.returnedCount ?? result.rows.length} lignes brutes` },
          { label: "Rôle", value: role.role, hint: role.matched.join(", ") || "Aucun mapping" },
          { label: "Lifecycle", value: hasLifecycleRisk ? "À vérifier" : "Non détecté", hint: "Hook EOL/EOS", alert: hasLifecycleRisk }
        ];
        const svg = kpiGrid("Logiciels de l'hôte", kpis);
        return renderVisual(svg, { name: `host_software_${slug(input.hostNameContains)}`, textSummary: `${distinctRows.length} logiciels distincts. Rôle dérivé: ${role.role}.`, structuredContent });
      },
      isVisual: true as const
    }
  };
}
