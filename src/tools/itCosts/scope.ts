import { z } from "zod";
import type { DiscoveryClient } from "../../discoveryClient.js";
import type { ItCostRow } from "./dataLoader.js";
import { estimateCost } from "./estimate.js";
import { compareAlternatives } from "./compare.js";

// Scope = a Discovery target that resolves to a set of VMs (modelled as `Host where virtual`).
// Traversals + sizing attributes are sourced from the real model (common_relationships.csv +
// windows_license): VM unit = Host(virtual), vCPU = #:::ProcessorInfo.num_logical_processors,
// RAM = logical_ram (Mo), wildcard traversal `:::Host`.
export const scopeSchema = z.object({
  type: z.enum(["service", "host", "vcenter", "fleet"]).describe("service: VMs d'un BusinessService ; host: VMs hébergées par un hôte ; vcenter: VMs gérées par un vCenter (chaîne vCenter→Cluster→Host→guests) ; fleet: tout le parc virtuel (filtre os optionnel)."),
  name: z.string().min(1).optional().describe("Nom du service / hôte / vCenter (requis pour service/host/vcenter), matché en HAS SUBWORD."),
  osContains: z.string().min(1).optional().describe("Filtre OS optionnel (ex. 'Windows', 'Linux').")
}).strict();
export type CostScope = z.infer<typeof scopeSchema>;

export interface ScopedVm { name: string; vcpu: number; ramGb: number; os: string; }
export interface SizeBucket { label: string; vcpu: number; ramGb: number; count: number; }
export interface BucketCost extends SizeBucket { annual: number; matched: boolean; }
export interface ScopeCostReport {
  scope: CostScope;
  vmCount: number;
  buckets: BucketCost[];
  currentAnnual: number;
  providers: Array<{ provider: string; annual: number; complete: boolean }>;
  bestProvider?: { provider: string; annual: number; savingsAnnual: number; savingsPct: number };
  warnings: string[];
}

const CLOUD_PROVIDERS = ["CLOUD AWS", "CLOUD AZURE", "CLOUD GCP"] as const;
const STD_VCPU = [2, 4, 8, 16, 32, 64];
const SHOW = "show name, uuid, os, os_class, os_type, logical_ram, #:::ProcessorInfo.num_logical_processors as vcpu";

function esc(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function buildScopeQuery(scope: CostScope): string {
  const name = esc(scope.name ?? "");
  if (scope.type === "service") {
    return `search BusinessService where name has subword "${name}"\n  traverse :::Host where virtual\n  ${SHOW}`;
  }
  if (scope.type === "host") {
    return `search Host where name has subword "${name}"\n  traverse :::Host where virtual\n  ${SHOW}`;
  }
  if (scope.type === "vcenter") {
    // vCenter→Cluster→Host(ESX) per common_relationships.csv, then ESX→guest VMs via :::Host where virtual.
    return `search SoftwareInstance where name has subword "${name}" and type has subword "vCenter"\n  traverse ServiceProvide:SoftwareService:Service:Cluster\n  traverse HostContainer:HostContainment:ContainedHost:Host\n  traverse :::Host where virtual\n  ${SHOW}`;
  }
  const where = scope.osContains ? `virtual and os has subword "${esc(scope.osContains)}"` : "virtual";
  return `search Host where ${where}\n  ${SHOW}`;
}

function num(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export async function resolveScopeVms(client: DiscoveryClient, scope: CostScope): Promise<ScopedVm[]> {
  const result = await client.searchData(buildScopeQuery(scope), {
    entityLabel: `cost_scope:${scope.type}`,
    appliedFilters: { ...scope }
  });
  return (result.rows as Array<Record<string, unknown>>).map((row) => ({
    name: typeof row.name === "string" ? row.name : "",
    vcpu: Math.round(num(row.vcpu)),
    ramGb: Math.round(num(row.logical_ram) / 1024),
    os: typeof row.os === "string" ? row.os : ""
  }));
}

function snapVcpu(vcpu: number): number {
  if (vcpu <= 1) return 2;
  // Snap to the nearest standard size; ties round UP (provision the next size up).
  return STD_VCPU.reduce((best, candidate) => (Math.abs(candidate - vcpu) <= Math.abs(best - vcpu) ? candidate : best), STD_VCPU[0]);
}

export function bucketize(vms: ScopedVm[]): SizeBucket[] {
  const map = new Map<number, { ramSum: number; count: number }>();
  for (const vm of vms) {
    const vcpu = snapVcpu(vm.vcpu);
    const entry = map.get(vcpu) ?? { ramSum: 0, count: 0 };
    entry.ramSum += vm.ramGb > 0 ? vm.ramGb : vcpu * 4; // assume 1:4 vCPU:RAM when RAM is missing
    entry.count += 1;
    map.set(vcpu, entry);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([vcpu, entry]) => {
      const ramGb = Math.max(1, Math.round(entry.ramSum / entry.count));
      return { vcpu, ramGb, count: entry.count, label: `VM ${vcpu} vCPU / ${ramGb} Go` };
    });
}

export function buildScopeCostReport(rows: ItCostRow[], vms: ScopedVm[], scope: CostScope, mode: "estimate" | "compare"): ScopeCostReport {
  const warnings: string[] = [];
  const allBuckets = bucketize(vms);
  const buckets: BucketCost[] = [];
  // Track per-provider total AND how many buckets it could actually price: a provider that
  // lacks an instance for a size must NOT win on an incomplete (artificially low) total.
  const providerAgg = new Map<string, { annual: number; covered: number }>();
  let currentAnnual = 0;

  for (const bucket of allBuckets) {
    const estimate = estimateCost(rows, { component: `VM ${bucket.vcpu} vCPU ${bucket.ramGb} Go`, quantity: bucket.count, horizon: "annual", scenario: "all" });
    const matched = !("error" in estimate);
    const annual = matched ? estimate.costs.median : 0;
    if (!matched) warnings.push(`Aucun profil interne pour ${bucket.label} (coût actuel non chiffré pour ce bucket).`);
    currentAnnual += annual;
    buckets.push({ ...bucket, annual, matched });

    if (mode === "compare") {
      const comparison = compareAlternatives(rows, { workload_type: `VM ${bucket.vcpu}vCPU`, quantity: bucket.count });
      for (const provider of CLOUD_PROVIDERS) {
        const inProvider = comparison.alternatives.filter((alt) => alt.category === provider);
        if (inProvider.length === 0) continue;
        const cheapest = Math.min(...inProvider.map((alt) => alt.annual_cost_median));
        const agg = providerAgg.get(provider) ?? { annual: 0, covered: 0 };
        agg.annual += cheapest;
        agg.covered += 1;
        providerAgg.set(provider, agg);
      }
    }
  }

  const bucketCount = allBuckets.length;
  const providers = [...providerAgg.entries()]
    .map(([provider, agg]) => ({ provider, annual: Math.round(agg.annual), complete: agg.covered === bucketCount }))
    .sort((a, b) => a.annual - b.annual);

  const incomplete = providers.filter((provider) => !provider.complete).map((provider) => provider.provider);
  if (incomplete.length > 0) {
    warnings.push(`Couverture catalogue partielle pour ${incomplete.join(", ")} (taille(s) de VM sans équivalent) — exclu(s) du choix "meilleure option".`);
  }

  let bestProvider: ScopeCostReport["bestProvider"];
  const completeProviders = providers.filter((provider) => provider.complete);
  if (mode === "compare" && completeProviders.length > 0) {
    const best = completeProviders[0];
    const savingsAnnual = Math.round(currentAnnual - best.annual);
    bestProvider = {
      provider: best.provider,
      annual: best.annual,
      savingsAnnual,
      savingsPct: currentAnnual > 0 ? Math.round((savingsAnnual / currentAnnual) * 100) : 0
    };
  }

  return { scope, vmCount: vms.length, buckets, currentAnnual: Math.round(currentAnnual), providers, bestProvider, warnings };
}
