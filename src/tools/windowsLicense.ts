import { z } from "zod";
import type { DiscoveryClient } from "../discoveryClient.js";
import { eur, kpiGrid } from "../svg/kpi.js";
import { renderVisual } from "../svg/renderer.js";
import { loadItCostRows, type ItCostRow } from "./itCosts/dataLoader.js";
import { structuredOutputSchema } from "./outputSchemas.js";

const WINDOWS_LICENSE_MAX_ROWS = 20_000;
const WINDOWS_LICENSE_PAGE_SIZE = 500;

const windowsLicenseSchema = z.object({
  minCoresPerHost: z.number().int().min(1).default(16),
  minCoresPerProc: z.number().int().min(1).default(8),
  coresPerLicensePack: z.number().int().min(1).default(2),
  standardVmsPerLicense: z.number().int().min(1).default(2),
  datacenterUnlimitedVms: z.boolean().default(true),
  priceProfile: z.enum(["license_microsoft", "virtualized_infra"]).default("license_microsoft"),
  underloadedVmThreshold: z.number().int().min(0).default(4),
  currentDatacenterHostIds: z.array(z.string().min(1)).default([]),
  currentStandardHostIds: z.array(z.string().min(1)).default([]),
  maxRows: z.number().int().min(1).max(50_000).default(WINDOWS_LICENSE_MAX_ROWS)
}).strict();

export type WindowsLicenseInput = z.infer<typeof windowsLicenseSchema>;

export interface CpuLookupResult { coresPerSocket: number; sourceUrl: string }
export type CpuCoreLookup = (cpuModel: string) => Promise<CpuLookupResult | null>;

export interface PhysicalHostInventoryRow {
  id: string;
  name: string;
  role: "esx" | "baremetal" | "hyperv";
  clusterId?: string;
  clusterName?: string;
  os?: string;
  vendor?: string;
  model?: string;
  configNumProcessors?: number;
  processorType?: string;
  processorInfoType?: string;
  processorInfoNumCores?: unknown;
  processorInfoNumSockets?: unknown;
  processorInfoCoresPerSocket?: unknown;
  processorInfoCoresPerSocketSpecs?: unknown;
  hostNumCores?: unknown;
  hostNumProcessors?: unknown;
  hostCoresPerProcessor?: unknown;
  totalVmCount?: number;
  windowsVmCount?: number;
  windowsVmVcpuCount?: number;
  hasStandardLicenses?: boolean;
  hasDatacenterLicense?: boolean;
}

export interface ResolvedHost extends PhysicalHostInventoryRow {
  cores?: number;
  processors?: number;
  coreSource: string;
  coreSourceUrl?: string;
  estimated?: boolean;
}

export interface LicenseParameters {
  minCoresPerHost: number;
  minCoresPerProc: number;
  coresPerLicensePack: number;
  standardVmsPerLicense: number;
  datacenterUnlimitedVms: boolean;
  priceProfile: "license_microsoft" | "virtualized_infra";
  underloadedVmThreshold: number;
}

export interface PriceAssumptions {
  standardPer2Cores: number;
  datacenterPer2Cores: number;
  standardComponent: string;
  datacenterComponent: string;
  standardCategory: string;
  datacenterCategory: string;
  scenario: "median";
  currency: "EUR";
}

export interface LicensedHost extends ResolvedHost {
  licenseableCores?: number;
  licensePacks?: number;
  windowsWorkloads: number;
  recommendedEdition: "standard" | "datacenter" | "none" | "undetermined";
  costStandard?: number;
  costDatacenter?: number;
}

export interface OptimizationOpportunity {
  type: "redundant_standard_on_datacenter_host" | "underloaded_datacenter_host" | "consolidation_candidate" | "windows_affinity_pod";
  scope: { hostId?: string; clusterId?: string; hostName?: string; clusterName?: string };
  currentCost: number;
  optimizedCost: number;
  saving: number;
  evidence: string;
}

export interface WindowsLicenseReport {
  summary: string;
  hosts: LicensedHost[];
  optimizationOpportunities: OptimizationOpportunity[];
  parameters: LicenseParameters & { priceAssumptions: PriceAssumptions };
  undeterminedHosts: LicensedHost[];
  totals: {
    physicalHosts: number;
    licenseableHosts: number;
    licenseableCores: number;
    estimatedMedianCost: number;
    potentialSavings: number;
    undeterminedHosts: number;
  };
  generatedDslQueries: ReturnType<typeof buildWindowsLicenseQueries>;
  recommendationPrompt: string;
}

function escDouble(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function hostShowColumns(role: PhysicalHostInventoryRow["role"]): string {
  const roleExpr = `'${role}' AS 'role'`;
  return [
    "#id AS 'id'",
    "name AS 'name'",
    roleExpr,
    "os AS 'os'",
    "os_type AS 'os_type'",
    "vendor AS 'vendor'",
    "model AS 'model'",
    "num_cores AS 'host_num_cores'",
    "num_processors AS 'host_num_processors'",
    "cores_per_processor AS 'host_cores_per_processor'",
    "processor_type AS 'host_processor_type'",
    "#Host:Detail:Hardware:ProcessorInfo.num_cores AS 'processorinfo_num_cores'",
    "#Host:Detail:Hardware:ProcessorInfo.num_sockets AS 'processorinfo_num_sockets'",
    "#Host:Detail:Hardware:ProcessorInfo.cores_per_socket AS 'processorinfo_cores_per_socket'",
    "#Host:Detail:Hardware:ProcessorInfo.cores_per_socket_specs AS 'processorinfo_cores_per_socket_specs'",
    "#Host:Detail:Hardware:ProcessorInfo.type AS 'processorinfo_type'",
    "#Hardware:ReferenceData:ReferenceData:HardwareReferenceData.vendor AS 'hrd_vendor'",
    "#Hardware:ReferenceData:ReferenceData:HardwareReferenceData.model AS 'hrd_model'",
    "#Hardware:ReferenceData:ReferenceData:HardwareReferenceData.config_num_processors AS 'hrd_config_num_processors'",
    "NODECOUNT(TRAVERSE Host:HostedSoftware:RunningSoftware:VirtualMachine) AS 'total_vm_count'",
    "NODECOUNT(TRAVERSE Host:HostedSoftware:RunningSoftware:VirtualMachine WHERE vm_guest_os MATCHES \"(?i).*Windows.*\" or os MATCHES \"(?i).*Windows.*\" or os_type = \"Windows\") AS 'windows_vm_count'",
    "NODES(TRAVERSE Host:HostedSoftware:RunningSoftware:VirtualMachine WHERE vm_guest_os MATCHES \"(?i).*Windows.*\" or os MATCHES \"(?i).*Windows.*\" or os_type = \"Windows\").num_logical_processors AS 'windows_vm_vcpus'",
    "#:HostContainment::Cluster.#id AS 'cluster_id'",
    "#:HostContainment::Cluster.name AS 'cluster_name'"
  ].join(", ");
}

export function buildWindowsLicenseQueries(vcenterTypeContains = "vCenter") {
  const vcenter = escDouble(vcenterTypeContains);
  return {
    esx: `SEARCH SoftwareInstance WHERE type HAS SUBWORD "${vcenter}" TRAVERSE ServiceProvider:SoftwareService:Service:Cluster TRAVERSE HostContainer:HostContainment:ContainedHost:Host SHOW ${hostShowColumns("esx")}`,
    baremetal: `SEARCH Host WHERE os_type = "Windows" AND NOT virtual SHOW ${hostShowColumns("baremetal")}`,
    hyperv: `SEARCH Host WHERE NODECOUNT(TRAVERSE Host:HostedSoftware:RunningSoftware:VirtualMachine WHERE type HAS SUBWORD "Hyper-V" or vm_type HAS SUBWORD "Hyper-V" or vm MATCHES "(?i).*Hyper-V.*") > 0 SHOW ${hostShowColumns("hyperv")}`
  };
}

function firstValue(value: unknown): unknown {
  return Array.isArray(value) ? value.find((v) => v !== null && v !== undefined && v !== "") : value;
}

function firstString(...values: unknown[]): string | undefined {
  for (const raw of values) {
    const value = firstValue(raw);
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return undefined;
}

function numberValue(value: unknown, mode: "first" | "sum" = "first"): number | undefined {
  if (Array.isArray(value)) {
    const nums = value.map((v) => numberValue(v)).filter((v): v is number => typeof v === "number" && v > 0);
    if (nums.length === 0) return undefined;
    return mode === "sum" ? nums.reduce((a, b) => a + b, 0) : nums[0];
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ".").trim());
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function rowValue(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (row[key] !== undefined && row[key] !== null) return row[key];
  return undefined;
}

export function normalizeInventoryRow(row: Record<string, unknown>, fallbackRole: PhysicalHostInventoryRow["role"]): PhysicalHostInventoryRow | null {
  const id = firstString(rowValue(row, ["id", "#id", "key", "node_id"]));
  if (!id) return null;
  const role = firstString(row.role, row.Role) as PhysicalHostInventoryRow["role"] | undefined;
  const model = firstString(row.model, row.Model, row.hrd_model, row["Hardware Model"]);
  const hrdVendor = firstString(row.hrd_vendor, row["Hardware Vendor"]);
  const vendor = firstString(row.vendor, row.Vendor, hrdVendor);
  return {
    id,
    name: firstString(row.name, row.Name, row.hostname, row.Hostname) ?? id,
    role: role === "esx" || role === "baremetal" || role === "hyperv" ? role : fallbackRole,
    clusterId: firstString(row.cluster_id, row["cluster_id"], row["Cluster Id"], row["Cluster ID"]),
    clusterName: firstString(row.cluster_name, row["Cluster"], row["Cluster Name"]),
    os: firstString(row.os, row.OS),
    vendor,
    model,
    configNumProcessors: numberValue(rowValue(row, ["hrd_config_num_processors", "config_num_processors", "Hardware Config Processors"])),
    processorType: firstString(row.host_processor_type, row.processor_type, row["processor_type"]),
    processorInfoType: firstString(row.processorinfo_type, row["processorinfo_type"]),
    processorInfoNumCores: rowValue(row, ["processorinfo_num_cores", "ProcessorInfo.num_cores"]),
    processorInfoNumSockets: rowValue(row, ["processorinfo_num_sockets", "ProcessorInfo.num_sockets"]),
    processorInfoCoresPerSocket: rowValue(row, ["processorinfo_cores_per_socket", "ProcessorInfo.cores_per_socket"]),
    processorInfoCoresPerSocketSpecs: rowValue(row, ["processorinfo_cores_per_socket_specs", "ProcessorInfo.cores_per_socket_specs"]),
    hostNumCores: rowValue(row, ["host_num_cores", "num_cores"]),
    hostNumProcessors: rowValue(row, ["host_num_processors", "num_processors"]),
    hostCoresPerProcessor: rowValue(row, ["host_cores_per_processor", "cores_per_processor"]),
    totalVmCount: numberValue(rowValue(row, ["total_vm_count", "Total VMs"])) ?? 0,
    windowsVmCount: numberValue(rowValue(row, ["windows_vm_count", "Windows VMs"])) ?? 0,
    windowsVmVcpuCount: numberValue(rowValue(row, ["windows_vm_vcpu_count", "windows_vm_vcpus", "Windows VM vCPUs"]), "sum") ?? 0
  };
}

export function dedupeHosts(hosts: PhysicalHostInventoryRow[]): PhysicalHostInventoryRow[] {
  const byId = new Map<string, PhysicalHostInventoryRow>();
  const roleRank: Record<PhysicalHostInventoryRow["role"], number> = { esx: 3, hyperv: 2, baremetal: 1 };
  for (const host of hosts) {
    const existing = byId.get(host.id);
    if (!existing || roleRank[host.role] > roleRank[existing.role]) byId.set(host.id, { ...existing, ...host });
    else byId.set(host.id, {
      ...host,
      ...existing,
      windowsVmCount: Math.max(host.windowsVmCount ?? 0, existing.windowsVmCount ?? 0),
      windowsVmVcpuCount: Math.max(host.windowsVmVcpuCount ?? 0, existing.windowsVmVcpuCount ?? 0),
      totalVmCount: Math.max(host.totalVmCount ?? 0, existing.totalVmCount ?? 0)
    });
  }
  return [...byId.values()];
}

function resolveFirstPass(host: PhysicalHostInventoryRow): ResolvedHost | null {
  const piNumCores = numberValue(host.processorInfoNumCores, "sum");
  if (piNumCores) return { ...host, cores: piNumCores, processors: numberValue(host.processorInfoNumSockets), coreSource: "processorinfo.num_cores" };

  const sockets = numberValue(host.processorInfoNumSockets) ?? host.configNumProcessors;
  const coresPerSocket = numberValue(host.processorInfoCoresPerSocket);
  if (sockets && coresPerSocket) return { ...host, cores: sockets * coresPerSocket, processors: sockets, coreSource: "processorinfo.sockets_x_cps" };

  const coresPerSocketSpecs = numberValue(host.processorInfoCoresPerSocketSpecs);
  if (sockets && coresPerSocketSpecs) return { ...host, cores: sockets * coresPerSocketSpecs, processors: sockets, coreSource: "processorinfo.specs" };

  const hostNumCores = numberValue(host.hostNumCores);
  if (hostNumCores) return { ...host, cores: hostNumCores, processors: numberValue(host.hostNumProcessors) ?? sockets, coreSource: "host.num_cores" };

  const hostProcessors = numberValue(host.hostNumProcessors) ?? sockets;
  const hostCoresPerProcessor = numberValue(host.hostCoresPerProcessor);
  if (hostProcessors && hostCoresPerProcessor) return { ...host, cores: hostProcessors * hostCoresPerProcessor, processors: hostProcessors, coreSource: "host.procs_x_cpp" };

  return null;
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}

function modeOrMedian(values: number[]): number {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  if (ranked.length > 0 && ranked[0][1] > 1) return ranked[0][0];
  return median(values);
}

function preciseCpuModel(host: PhysicalHostInventoryRow): string | undefined {
  const cpu = firstString(host.processorInfoType, host.processorType);
  if (!cpu) return undefined;
  const normalized = cpu.toLowerCase().replace(/\s+/g, " ").trim();
  if (/^(intel\s+)?xeon$/.test(normalized) || /^(amd\s+)?epyc$/.test(normalized) || normalized === "intel xeon processor") return undefined;
  if (!/\d/.test(normalized)) return undefined;
  return cpu;
}

const cpuLookupCache = new Map<string, CpuLookupResult | null>();

export function clearCpuLookupCache(): void {
  cpuLookupCache.clear();
}

export async function defaultCpuCoreLookup(cpuModel: string): Promise<CpuLookupResult | null> {
  const url = `https://www.techpowerup.com/cpu-specs/?ajaxsrch=${encodeURIComponent(cpuModel)}`;
  const res = await fetch(url, { headers: { accept: "text/html,application/json" } });
  if (!res.ok) return null;
  const text = await res.text();
  const match = text.match(/(\d+)\s*(?:CPU\s*)?Cores?/i);
  if (!match) return null;
  const coresPerSocket = Number(match[1]);
  return Number.isFinite(coresPerSocket) && coresPerSocket > 0 ? { coresPerSocket, sourceUrl: url } : null;
}

export async function resolveHostCores(hosts: PhysicalHostInventoryRow[], cpuLookup: CpuCoreLookup = defaultCpuCoreLookup): Promise<ResolvedHost[]> {
  const resolved = new Map<string, ResolvedHost>();
  const unresolved: PhysicalHostInventoryRow[] = [];
  const modelObservations = new Map<string, number[]>();

  for (const host of hosts) {
    const firstPass = resolveFirstPass(host);
    if (firstPass?.cores) {
      resolved.set(host.id, firstPass);
      if (host.model) {
        const values = modelObservations.get(host.model) ?? [];
        values.push(firstPass.cores);
        modelObservations.set(host.model, values);
      }
    } else {
      unresolved.push(host);
    }
  }

  const modelCores = new Map([...modelObservations.entries()].map(([model, values]) => [model, modeOrMedian(values)]));
  const stillUnresolved: PhysicalHostInventoryRow[] = [];
  for (const host of unresolved) {
    const twinCores = host.model ? modelCores.get(host.model) : undefined;
    if (twinCores) {
      resolved.set(host.id, { ...host, cores: twinCores, processors: numberValue(host.hostNumProcessors) ?? host.configNumProcessors, coreSource: `model_twin:${host.model}` });
    } else {
      stillUnresolved.push(host);
    }
  }

  for (const host of stillUnresolved) {
    const cpu = preciseCpuModel(host);
    const sockets = numberValue(host.processorInfoNumSockets) ?? numberValue(host.hostNumProcessors) ?? host.configNumProcessors;
    if (cpu && sockets) {
      const cached = cpuLookupCache.has(cpu) ? cpuLookupCache.get(cpu)! : await cpuLookup(cpu);
      if (!cpuLookupCache.has(cpu)) cpuLookupCache.set(cpu, cached);
      if (cached?.coresPerSocket) {
        resolved.set(host.id, { ...host, cores: cached.coresPerSocket * sockets, processors: sockets, coreSource: `web:${cpu}`, coreSourceUrl: cached.sourceUrl, estimated: true });
        continue;
      }
    }
    resolved.set(host.id, { ...host, processors: numberValue(host.hostNumProcessors) ?? numberValue(host.processorInfoNumSockets) ?? host.configNumProcessors, coreSource: "undetermined", estimated: true });
  }

  return hosts.map((host) => resolved.get(host.id) ?? { ...host, coreSource: "undetermined", estimated: true });
}

function packRoundUp(value: number, packSize: number): number {
  return Math.ceil(value / packSize) * packSize;
}

function priceRowsFor(priceProfile: WindowsLicenseInput["priceProfile"], rows: ItCostRow[]): PriceAssumptions {
  const standard = rows.find((row) => row["Catégorie"] === "LICENCE MICROSOFT" && row["Composant"] === "Windows Server Standard (par 2 cores)");
  const dcCategory = priceProfile === "virtualized_infra" ? "INFRA VIRTUALISÉE" : "LICENCE MICROSOFT";
  const datacenter = rows.find((row) => row["Catégorie"] === dcCategory && row["Composant"] === "Windows Server Datacenter (par 2 cores)");
  if (!standard || !datacenter) throw new Error(`Windows Server price rows not found for profile ${priceProfile}`);
  return {
    standardPer2Cores: standard["Coût unitaire médian (€)"],
    datacenterPer2Cores: datacenter["Coût unitaire médian (€)"],
    standardComponent: standard["Composant"],
    datacenterComponent: datacenter["Composant"],
    standardCategory: standard["Catégorie"],
    datacenterCategory: datacenter["Catégorie"],
    scenario: "median",
    currency: "EUR"
  };
}

export function calculateLicenseForHost(host: ResolvedHost, input: LicenseParameters, prices: PriceAssumptions): LicensedHost {
  if (!host.cores || host.coreSource === "undetermined") return { ...host, windowsWorkloads: 0, recommendedEdition: "undetermined" };
  const processors = host.processors ?? numberValue(host.hostNumProcessors) ?? numberValue(host.processorInfoNumSockets) ?? host.configNumProcessors ?? 1;
  const licenseableCores = packRoundUp(Math.max(host.cores, input.minCoresPerHost, input.minCoresPerProc * processors), input.coresPerLicensePack);
  const licensePacks = licenseableCores / input.coresPerLicensePack;
  const windowsWorkloads = Math.max(host.windowsVmCount ?? 0, host.role === "baremetal" ? 1 : 0);
  if (windowsWorkloads === 0) return { ...host, licenseableCores, licensePacks, windowsWorkloads, recommendedEdition: "none", costStandard: 0, costDatacenter: 0 };
  const standardLicenseSets = Math.max(1, Math.ceil(windowsWorkloads / input.standardVmsPerLicense));
  const costStandard = licensePacks * standardLicenseSets * prices.standardPer2Cores;
  const costDatacenter = input.datacenterUnlimitedVms ? licensePacks * prices.datacenterPer2Cores : Number.POSITIVE_INFINITY;
  return {
    ...host,
    licenseableCores,
    licensePacks,
    windowsWorkloads,
    recommendedEdition: costDatacenter < costStandard ? "datacenter" : "standard",
    costStandard: Math.round(costStandard),
    costDatacenter: Number.isFinite(costDatacenter) ? Math.round(costDatacenter) : undefined
  };
}

export function calculateLicenses(hosts: ResolvedHost[], input: LicenseParameters, prices: PriceAssumptions): LicensedHost[] {
  return hosts.map((host) => calculateLicenseForHost(host, input, prices));
}

export function findOptimizationOpportunities(hosts: LicensedHost[], input: LicenseParameters): OptimizationOpportunity[] {
  const opportunities: OptimizationOpportunity[] = [];
  const dcIds = new Set(hosts.filter((host) => host.hasDatacenterLicense).map((host) => host.id));
  const standardIds = new Set(hosts.filter((host) => host.hasStandardLicenses).map((host) => host.id));

  for (const host of hosts) {
    const datacenterCurrent = dcIds.has(host.id) || host.recommendedEdition === "datacenter";
    const standardPresent = standardIds.has(host.id) || (datacenterCurrent && (host.costStandard ?? 0) > (host.costDatacenter ?? 0));
    if (datacenterCurrent && standardPresent && host.costStandard !== undefined && host.costDatacenter !== undefined && host.costStandard > host.costDatacenter) {
      opportunities.push({
        type: "redundant_standard_on_datacenter_host",
        scope: { hostId: host.id, hostName: host.name },
        currentCost: host.costStandard,
        optimizedCost: host.costDatacenter,
        saving: host.costStandard - host.costDatacenter,
        evidence: `${host.name}: Datacenter couvre ${host.windowsWorkloads} workload(s) Windows; les licences Standard équivalentes coûteraient ${eur(host.costStandard)}.`
      });
    }

    const currentDatacenterCost = host.hasDatacenterLicense || host.recommendedEdition === "datacenter" ? host.costDatacenter : undefined;
    if (currentDatacenterCost !== undefined && host.costStandard !== undefined && host.windowsWorkloads > 0 && host.windowsWorkloads <= input.underloadedVmThreshold && currentDatacenterCost > host.costStandard) {
      opportunities.push({
        type: "underloaded_datacenter_host",
        scope: { hostId: host.id, hostName: host.name },
        currentCost: currentDatacenterCost,
        optimizedCost: host.costStandard,
        saving: currentDatacenterCost - host.costStandard,
        evidence: `${host.name}: ${host.windowsWorkloads} VM/workload(s) Windows, sous le seuil ${input.underloadedVmThreshold}; Standard est moins cher que Datacenter.`
      });
    }
  }

  const clusters = new Map<string, LicensedHost[]>();
  for (const host of hosts.filter((h) => h.role === "esx" && h.clusterId && h.licenseableCores && (h.windowsVmCount ?? 0) > 0)) {
    const bucket = clusters.get(host.clusterId!) ?? [];
    bucket.push(host);
    clusters.set(host.clusterId!, bucket);
  }
  for (const [clusterId, clusterHosts] of clusters) {
    if (clusterHosts.length < 2) continue;
    const totalWindowsVms = clusterHosts.reduce((sum, host) => sum + (host.windowsVmCount ?? 0), 0);
    const totalWindowsVcpus = clusterHosts.reduce((sum, host) => sum + (host.windowsVmVcpuCount ?? 0), 0);
    const currentCost = clusterHosts.reduce((sum, host) => sum + (host.costDatacenter ?? host.costStandard ?? 0), 0);
    const avgHostCapacityCores = Math.max(1, Math.round(clusterHosts.reduce((sum, host) => sum + (host.licenseableCores ?? 0), 0) / clusterHosts.length));
    const targetHosts = totalWindowsVcpus > 0
      ? Math.max(1, Math.ceil(totalWindowsVcpus / avgHostCapacityCores))
      : Math.max(1, Math.ceil(totalWindowsVms / Math.max(1, input.underloadedVmThreshold * 2)));
    const sorted = clusterHosts.slice().sort((a, b) => (a.costDatacenter ?? a.costStandard ?? 0) - (b.costDatacenter ?? b.costStandard ?? 0));
    const optimizedCost = sorted.slice(0, targetHosts).reduce((sum, host) => sum + (host.costDatacenter ?? host.costStandard ?? 0), 0);
    if (currentCost > optimizedCost) {
      opportunities.push({
        type: "consolidation_candidate",
        scope: { clusterId, clusterName: clusterHosts[0].clusterName },
        currentCost,
        optimizedCost,
        saving: currentCost - optimizedCost,
        evidence: `${totalWindowsVms} VM Windows (${totalWindowsVcpus || "vCPU inconnus"} vCPU) réparties sur ${clusterHosts.length} ESX; consolidation théorique sur ${targetHosts} hôte(s) Windows.`
      });
      opportunities.push({
        type: "windows_affinity_pod",
        scope: { clusterId, clusterName: clusterHosts[0].clusterName },
        currentCost,
        optimizedCost,
        saving: currentCost - optimizedCost,
        evidence: `Créer un pod d'affinité Windows de ${targetHosts} ESX pour ${totalWindowsVcpus || "vCPU Windows inconnus"} vCPU Windows au lieu de licencier tout le cluster.`
      });
    }
  }

  return opportunities.sort((a, b) => b.saving - a.saving);
}

function parametersFromInput(input: WindowsLicenseInput): LicenseParameters {
  return {
    minCoresPerHost: input.minCoresPerHost,
    minCoresPerProc: input.minCoresPerProc,
    coresPerLicensePack: input.coresPerLicensePack,
    standardVmsPerLicense: input.standardVmsPerLicense,
    datacenterUnlimitedVms: input.datacenterUnlimitedVms,
    priceProfile: input.priceProfile,
    underloadedVmThreshold: input.underloadedVmThreshold
  };
}

export async function buildWindowsLicenseReportFromHosts(hostsInput: PhysicalHostInventoryRow[], input: WindowsLicenseInput, options: { costRows?: ItCostRow[]; cpuLookup?: CpuCoreLookup } = {}): Promise<WindowsLicenseReport> {
  const parameters = parametersFromInput(input);
  const prices = priceRowsFor(input.priceProfile, options.costRows ?? loadItCostRows());
  const hostsWithCurrent = hostsInput.map((host) => ({
    ...host,
    hasDatacenterLicense: host.hasDatacenterLicense || input.currentDatacenterHostIds.includes(host.id),
    hasStandardLicenses: host.hasStandardLicenses || input.currentStandardHostIds.includes(host.id)
  }));
  const resolved = await resolveHostCores(dedupeHosts(hostsWithCurrent), options.cpuLookup);
  const licensed = calculateLicenses(resolved, parameters, prices);
  const undeterminedHosts = licensed.filter((host) => host.coreSource === "undetermined");
  const determinedHosts = licensed.filter((host) => host.coreSource !== "undetermined");
  const optimizationOpportunities = findOptimizationOpportunities(licensed, parameters);
  const estimatedMedianCost = determinedHosts.reduce((sum, host) => sum + (host.recommendedEdition === "datacenter" ? host.costDatacenter ?? 0 : host.costStandard ?? 0), 0);
  const potentialSavings = optimizationOpportunities.reduce((sum, opportunity) => sum + Math.max(0, opportunity.saving), 0);
  const totals = {
    physicalHosts: licensed.length,
    licenseableHosts: determinedHosts.filter((host) => host.recommendedEdition !== "none").length,
    licenseableCores: determinedHosts.reduce((sum, host) => sum + (host.licenseableCores ?? 0), 0),
    estimatedMedianCost,
    potentialSavings,
    undeterminedHosts: undeterminedHosts.length
  };
  const recommendationPrompt = `Priorise les optimizationOpportunities par économie décroissante et rédige une recommandation client par opportunité. Utilise uniquement les montants déjà calculés dans currentCost/optimizedCost/saving. Signale les hôtes estimated=true comme « à confirmer » avant engagement. Les hôtes coreSource=undetermined sont à vérifier (scan/permissions) et ne doivent pas être intégrés comme 0 cœur.`;
  return {
    summary: `${totals.licenseableHosts} hôte(s) licenciable(s), ${totals.licenseableCores} cœur(s) licenciables, coût médian estimé ${eur(totals.estimatedMedianCost)}.`,
    hosts: licensed,
    optimizationOpportunities,
    parameters: { ...parameters, priceAssumptions: prices },
    undeterminedHosts,
    totals,
    generatedDslQueries: buildWindowsLicenseQueries(),
    recommendationPrompt
  };
}

async function inventoryRows(client: DiscoveryClient, query: string, role: PhysicalHostInventoryRow["role"], maxRows: number): Promise<PhysicalHostInventoryRow[]> {
  const result = await client.searchData(query, {
    entityLabel: `hôtes physiques Windows licensing:${role}`,
    appliedFilters: { windowsLicense: true, role },
    maxRows,
    pageSize: WINDOWS_LICENSE_PAGE_SIZE
  });
  return (result.rows as Array<Record<string, unknown>>).map((row) => normalizeInventoryRow(row, role)).filter((row): row is PhysicalHostInventoryRow => row !== null);
}

export function windowsLicenseTools(client: DiscoveryClient) {
  return {
    discovery_windows_license_report: {
      description: "Build and execute a Windows Server licensing report by physical host (ESX, baremetal Windows, Hyper-V). Resolves physical cores with a 7-step cascade, calculates Standard vs Datacenter costs from the IT cost CSV, precomputes optimization opportunities, returns KPI SVG and a recommendationPrompt for the LLM. USE THIS DIRECTLY; do not delegate to discovery_search_data.",
      schema: windowsLicenseSchema,
      outputSchema: structuredOutputSchema,
      handler: async (input: WindowsLicenseInput) => {
        const queries = buildWindowsLicenseQueries();
        const [esx, baremetal, hyperv] = await Promise.all([
          inventoryRows(client, queries.esx, "esx", input.maxRows),
          inventoryRows(client, queries.baremetal, "baremetal", input.maxRows),
          inventoryRows(client, queries.hyperv, "hyperv", input.maxRows)
        ]);
        const report = await buildWindowsLicenseReportFromHosts([...esx, ...baremetal, ...hyperv], input);
        const svg = kpiGrid("Windows licensing", [
          { label: "Hôtes licenciables", value: String(report.totals.licenseableHosts), hint: `${report.totals.physicalHosts} physiques` },
          { label: "Cœurs licenciables", value: String(report.totals.licenseableCores), hint: input.priceProfile },
          { label: "Coût estimé", value: eur(report.totals.estimatedMedianCost), hint: "médian CSV" },
          { label: "Économies", value: eur(report.totals.potentialSavings), hint: `${report.optimizationOpportunities.length} opportunité(s)`, delta: { text: "potentiel", positive: true } },
          { label: "À vérifier", value: String(report.totals.undeterminedHosts), hint: "cœurs indéterminés", alert: report.totals.undeterminedHosts > 0 }
        ], { columns: 3 });
        return renderVisual(svg, {
          name: "windows_license_report",
          textSummary: `${report.summary}\n\n${report.recommendationPrompt}`,
          structuredContent: report
        });
      },
      isVisual: true as const
    }
  };
}
