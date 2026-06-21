import { z } from "zod";
import type { DiscoveryClient } from "../discoveryClient.js";
import { eur, kpiDashboard } from "../svg/kpi.js";
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
  windowsVmGuestOs?: string[];
  windowsVmOsVersions?: string[];
  guestWindowsVcpus?: number;
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

  requiredWindowsVersion?: string;
  costStandard?: number;
  costDatacenter?: number;
}

export interface OptimizationOpportunity {

  type: "redundant_standard_on_datacenter_host" | "underloaded_datacenter_host" | "consolidation_candidate" | "windows_affinity_pod" | "baremetal_to_datacenter_migration" | "version_consolidation_via_downgrade";

  scope: { hostId?: string; clusterId?: string; hostName?: string; clusterName?: string };
  currentCost: number;
  optimizedCost: number;
  saving: number;
  evidence: string;

  rationale: string;
}

export interface VersionLicensingRow {
  version: string;
  hosts: number;
  licenseableCores: number;
  licensePacks: number;
  editionStandardHosts: number;
  editionDatacenterHosts: number;
  estimatedCost: number;
}

export interface EditionBreakdown {
  standard: { hosts: number; cores: number; cost: number };
  datacenter: { hosts: number; cores: number; cost: number };
  none: { hosts: number };
  undetermined: { hosts: number };
}

export interface ClusterLicensingRow {
  clusterId: string;
  clusterName?: string;
  esxHosts: number;
  clusterCores: number;
  licensePacks: number;
  versionsPresent: string[];
  editionsPresent: string[];
  highestVersion: string;
  totalWindowsVcpus: number;
  costStrictPerVersion: number;
  costOptimizedDowngrade: number;
  savingDowngrade: number;
  partial: boolean;
  undeterminedHostIds: string[];

}

export interface WindowsLicenseReport {
  summary: string;
  hosts: LicensedHost[];
  optimizationOpportunities: OptimizationOpportunity[];
  parameters: LicenseParameters & { priceAssumptions: PriceAssumptions };

  versionLicensing: VersionLicensingRow[];
  editionBreakdown: EditionBreakdown;
  clusterLicensing: ClusterLicensingRow[];
  undeterminedHosts: LicensedHost[];
  totals: {
    physicalHosts: number;
    licenseableHosts: number;
    licenseableCores: number;
    estimatedMedianCost: number;

    savingsAcquired: number;
    savingsConsolidation: number;
    savingsBaremetalMigration: number;

    potentialSavings: number;
    undeterminedHosts: number;
  };
  generatedDslQueries: ReturnType<typeof buildWindowsLicenseQueries>;
  markdownReport: string;
  recommendationPrompt: string;
}

function escDouble(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function hostShowColumns(role: PhysicalHostInventoryRow["role"]): string {
  const roleExpr = `'${role}' AS 'role'`;
  const columns = [
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
    `NODECOUNT(TRAVERSE Host:HostedSoftware:RunningSoftware:VirtualMachine WHERE vm_guest_os MATCHES "(?i).*Windows.*" or os MATCHES "(?i).*Windows.*" or os_type = "Windows") AS 'windows_vm_count'`,
    `NODES(TRAVERSE Host:HostedSoftware:RunningSoftware:VirtualMachine WHERE vm_guest_os MATCHES "(?i).*Windows.*" or os MATCHES "(?i).*Windows.*" or os_type = "Windows").num_logical_processors AS 'windows_vm_vcpus'`,
    `NODES(TRAVERSE Host:HostedSoftware:RunningSoftware:VirtualMachine WHERE vm_guest_os MATCHES "(?i).*Windows.*" or os MATCHES "(?i).*Windows.*" or os_type = "Windows").vm_guest_os AS 'windows_vm_guest_os'`,
    `NODES(TRAVERSE Host:HostedSoftware:RunningSoftware:VirtualMachine WHERE vm_guest_os MATCHES "(?i).*Windows.*" or os MATCHES "(?i).*Windows.*" or os_type = "Windows").os AS 'windows_vm_os'`,
    "#:HostContainment::Cluster.#id AS 'cluster_id'",
    "#:HostContainment::Cluster.name AS 'cluster_name'"
  ];
  return columns.join(", ");
}

export function buildWindowsLicenseQueries(vcenterTypeContains = "vCenter") {
  const vcenter = escDouble(vcenterTypeContains);
  return {
    esx: `SEARCH SoftwareInstance WHERE type HAS SUBWORD "${vcenter}" TRAVERSE ServiceProvider:SoftwareService:Service:Cluster TRAVERSE HostContainer:HostContainment:ContainedHost:Host WHERE os HAS SUBWORD "ESX" or os HAS SUBWORD "ESXi" SHOW ${hostShowColumns("esx")}`,
    esxGuestVersions: `SEARCH SoftwareInstance WHERE type HAS SUBWORD "${vcenter}" TRAVERSE ServiceProvider:SoftwareService:Service:Cluster TRAVERSE HostContainer:HostContainment:ContainedHost:Host WHERE os HAS SUBWORD "ESX" or os HAS SUBWORD "ESXi" TRAVERSE Host:HostedSoftware:RunningSoftware:VirtualMachine TRAVERSE HostContainer:HostContainment:ContainedHost:Host WHERE os_type = "Windows" SHOW #ContainedHost:HostContainment:HostContainer:VirtualMachine.#RunningSoftware:HostedSoftware:Host:Host.#id AS 'esx_id', os AS 'guest_windows_os'`,
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

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => stringList(item));
  if (typeof value === "string" && value.trim() !== "") return [value.trim()];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  return [];
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
    windowsVmVcpuCount: numberValue(rowValue(row, ["windows_vm_vcpu_count", "windows_vm_vcpus", "guest_windows_vcpus", "Windows VM vCPUs"]), "sum") ?? 0,
    windowsVmGuestOs: [
      ...stringList(rowValue(row, ["windows_vm_guest_os", "Windows VM Guest OS"])),
      ...stringList(rowValue(row, ["windows_vm_os", "Windows VM OS"]))
    ],
    windowsVmOsVersions: stringList(rowValue(row, ["windows_vm_os", "Windows VM OS"])),
    guestWindowsVcpus: numberValue(rowValue(row, ["guest_windows_vcpus", "Guest Windows vCPUs"]), "sum") ?? 0
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
      windowsVmGuestOs: [...new Set([...(existing.windowsVmGuestOs ?? []), ...(host.windowsVmGuestOs ?? [])])],
      windowsVmOsVersions: [...new Set([...(existing.windowsVmOsVersions ?? []), ...(host.windowsVmOsVersions ?? [])])],
      guestWindowsVcpus: Math.max(host.guestWindowsVcpus ?? 0, existing.guestWindowsVcpus ?? 0),
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


const WINDOWS_VERSION_ORDER = ["2000", "2003", "2008", "2008 R2", "2012", "2012 R2", "2016", "2019", "2022", "2025"];

export function parseWindowsVersion(value: string): string | null {
  const normalized = value.toLowerCase();
  if (!normalized.includes("windows") || !normalized.includes("server")) return null;
  if (/2008\s*r2/i.test(value)) return "2008 R2";
  if (/2012\s*r2/i.test(value)) return "2012 R2";
  for (const version of WINDOWS_VERSION_ORDER.filter((v) => !v.endsWith("R2"))) {
    if (new RegExp(`\\b${version}\\b`).test(normalized)) return version;
  }
  return null;
}

export function parseWindowsEdition(value: string): "Standard" | "Datacenter" | "Enterprise" | "Web" | null {
  if (/standard/i.test(value)) return "Standard";
  if (/datacenter/i.test(value)) return "Datacenter";
  if (/enterprise/i.test(value)) return "Enterprise";
  if (/\bweb\b/i.test(value)) return "Web";
  return null;
}

function detectWindowsVersion(value: string): string | undefined {
  return parseWindowsVersion(value) ?? undefined;
}

function versionRank(version: string): number {
  return WINDOWS_VERSION_ORDER.indexOf(version);
}

function highestWindowsVersion(versions: string[]): string | undefined {
  return versions.slice().sort((a, b) => versionRank(b) - versionRank(a))[0];
}

export function requiredWindowsVersionForHost(host: PhysicalHostInventoryRow): string {
  const candidates: string[] = [];
  if (host.role === "baremetal" || host.role === "hyperv") candidates.push(...stringList(host.os));
  if (host.role === "esx" || host.role === "hyperv") candidates.push(...(host.windowsVmOsVersions ?? []), ...(host.windowsVmGuestOs ?? []));
  const versions = candidates.map(detectWindowsVersion).filter((version): version is string => Boolean(version));
  if (versions.length === 0) return "indéterminée";
  return highestWindowsVersion(versions) ?? "indéterminée";
}

function hostEstimatedCost(host: LicensedHost): number {
  if (host.recommendedEdition === "datacenter") return host.costDatacenter ?? 0;
  if (host.recommendedEdition === "standard") return host.costStandard ?? 0;
  return 0;
}

export function calculateLicenseForHost(host: ResolvedHost, input: LicenseParameters, prices: PriceAssumptions): LicensedHost {
  const requiredWindowsVersion = requiredWindowsVersionForHost(host);
  if (!host.cores || host.coreSource === "undetermined") return { ...host, windowsWorkloads: 0, recommendedEdition: "undetermined", requiredWindowsVersion };
  const processors = host.processors ?? numberValue(host.hostNumProcessors) ?? numberValue(host.processorInfoNumSockets) ?? host.configNumProcessors ?? 1;
  const licenseableCores = packRoundUp(Math.max(host.cores, input.minCoresPerHost, input.minCoresPerProc * processors), input.coresPerLicensePack);
  const licensePacks = licenseableCores / input.coresPerLicensePack;
  const windowsWorkloads = Math.max(host.windowsVmCount ?? 0, host.role === "baremetal" ? 1 : 0);
  if (windowsWorkloads === 0) return { ...host, licenseableCores, licensePacks, windowsWorkloads, recommendedEdition: "none", requiredWindowsVersion, costStandard: 0, costDatacenter: 0 };
  const standardLicenseSets = Math.max(1, Math.ceil(windowsWorkloads / input.standardVmsPerLicense));
  const costStandard = licensePacks * standardLicenseSets * prices.standardPer2Cores;
  const costDatacenter = input.datacenterUnlimitedVms ? licensePacks * prices.datacenterPer2Cores : Number.POSITIVE_INFINITY;
  return {
    ...host,
    licenseableCores,
    licensePacks,
    windowsWorkloads,
    recommendedEdition: costDatacenter < costStandard ? "datacenter" : "standard",
    requiredWindowsVersion,
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
        evidence: `${host.name}: Datacenter couvre ${host.windowsWorkloads} workload(s) Windows; les licences Standard équivalentes coûteraient ${eur(host.costStandard)}.`,
        rationale: "Hôte couvert en Datacenter (VM illimitées). Toute licence Standard sur le même hôte fait double emploi → retrait. Économie = somme des licences Standard redondantes."
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
        evidence: `${host.name}: ${host.windowsWorkloads} VM/workload(s) Windows, sous le seuil ${input.underloadedVmThreshold}; Standard est moins cher que Datacenter.`,
        rationale: "Sous le seuil de VM Windows, Standard (2 VM/licence) revient moins cher que Datacenter sur ces cœurs → bascule d'édition. Économie = coûtDatacenter − coûtStandard."
      });
    }

    if (host.role === "baremetal" && host.recommendedEdition !== "none" && host.recommendedEdition !== "undetermined") {
      const currentCost = hostEstimatedCost(host);
      if (currentCost > 0) {
        opportunities.push({
          type: "baremetal_to_datacenter_migration",
          scope: { hostId: host.id, hostName: host.name },
          currentCost,
          optimizedCost: 0,
          saving: currentCost,
          evidence: `${host.name}: baremetal ${host.licenseableCores ?? "?"} cœurs licencié en physique (${eur(currentCost)}). Virtualisé sur un cluster ESX déjà Datacenter, sa charge Windows est absorbée (VM illimitées) → licence physique récupérable.`,
          rationale: "Une licence Datacenter sur l'ESX couvre un nombre illimité de VM Windows. Migrer un serveur physique en VM sur un cluster déjà Datacenter rend sa licence physique inutile. Économie = potentiel MAXIMAL (coût physique actuel)."
        });
      }
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
        evidence: `${totalWindowsVms} VM Windows (${totalWindowsVcpus || "vCPU inconnus"} vCPU) réparties sur ${clusterHosts.length} ESX; consolidation théorique sur ${targetHosts} hôte(s) Windows.`,
        rationale: "Regrouper les VM Windows sur moins d'hôtes physiques réduit le nombre d'hôtes à licencier en Datacenter. Économie = coût des hôtes libérés."
      });
      opportunities.push({
        type: "windows_affinity_pod",
        scope: { clusterId, clusterName: clusterHosts[0].clusterName },
        currentCost,
        optimizedCost,
        saving: currentCost - optimizedCost,
        evidence: `Créer un pod d'affinité Windows de ${targetHosts} ESX pour ${totalWindowsVcpus || "vCPU Windows inconnus"} vCPU Windows au lieu de licencier tout le cluster.`,
        rationale: "Créer un cluster dédié aux VM Windows permet de ne licencier que ces hôtes en Datacenter plutôt que tout le cluster mixte. Économie = coût des hôtes non-Windows libérés."
      });
    }
  }

  return opportunities.sort((a, b) => b.saving - a.saving);
}


export function buildEditionBreakdown(hosts: LicensedHost[]): EditionBreakdown {
  return hosts.reduce<EditionBreakdown>((acc, host) => {
    if (host.coreSource === "undetermined" || host.recommendedEdition === "undetermined") {
      acc.undetermined.hosts += 1;
      return acc;
    }
    if (host.recommendedEdition === "standard") {
      acc.standard.hosts += 1;
      acc.standard.cores += host.licenseableCores ?? 0;
      acc.standard.cost += host.costStandard ?? 0;
    } else if (host.recommendedEdition === "datacenter") {
      acc.datacenter.hosts += 1;
      acc.datacenter.cores += host.licenseableCores ?? 0;
      acc.datacenter.cost += host.costDatacenter ?? 0;
    } else if (host.recommendedEdition === "none") {
      acc.none.hosts += 1;
    }
    return acc;
  }, {
    standard: { hosts: 0, cores: 0, cost: 0 },
    datacenter: { hosts: 0, cores: 0, cost: 0 },
    none: { hosts: 0 },
    undetermined: { hosts: 0 }
  });
}

export function buildVersionLicensing(hosts: LicensedHost[]): VersionLicensingRow[] {
  const buckets = new Map<string, VersionLicensingRow>();
  for (const host of hosts) {
    if (host.coreSource === "undetermined" || host.recommendedEdition === "undetermined") continue;
    const version = host.requiredWindowsVersion || "indéterminée";
    const row = buckets.get(version) ?? { version, hosts: 0, licenseableCores: 0, licensePacks: 0, editionStandardHosts: 0, editionDatacenterHosts: 0, estimatedCost: 0 };
    row.hosts += 1;
    row.licenseableCores += host.licenseableCores ?? 0;
    row.licensePacks += host.licensePacks ?? 0;
    if (host.recommendedEdition === "standard") row.editionStandardHosts += 1;
    if (host.recommendedEdition === "datacenter") row.editionDatacenterHosts += 1;
    row.estimatedCost += hostEstimatedCost(host);
    buckets.set(version, row);
  }
  return [...buckets.values()].sort((a, b) => {
    const rankA = WINDOWS_VERSION_ORDER.indexOf(a.version);
    const rankB = WINDOWS_VERSION_ORDER.indexOf(b.version);
    const normalizedA = rankA < 0 ? -1 : rankA;
    const normalizedB = rankB < 0 ? -1 : rankB;
    return normalizedB - normalizedA || a.version.localeCompare(b.version);
  });
}

function sortedVersions(versions: Iterable<string>): string[] {
  return [...versions].sort((a, b) => versionRank(b) - versionRank(a));
}

function sortedStrings(values: Iterable<string>): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function hostWindowsOsValues(host: LicensedHost): string[] {
  return [
    ...(host.windowsVmOsVersions ?? []),
    ...(host.windowsVmGuestOs ?? []),
    ...(host.role === "baremetal" || host.role === "hyperv" ? stringList(host.os) : [])
  ];
}

function clusterLicenseCost(clusterCores: number, prices: PriceAssumptions, input: LicenseParameters): number {
  if (clusterCores <= 0) return 0;
  return Math.round((packRoundUp(clusterCores, input.coresPerLicensePack) / input.coresPerLicensePack) * prices.datacenterPer2Cores);
}

export function buildClusterLicensing(hosts: LicensedHost[], input: LicenseParameters, prices: PriceAssumptions): ClusterLicensingRow[] {
  const clusters = new Map<string, LicensedHost[]>();
  for (const host of hosts.filter((candidate) => candidate.role === "esx" && candidate.clusterId)) {
    const bucket = clusters.get(host.clusterId!) ?? [];
    bucket.push(host);
    clusters.set(host.clusterId!, bucket);
  }

  return [...clusters.entries()].map(([clusterId, clusterHosts]) => {
    const resolvedHosts = clusterHosts.filter((host) => host.coreSource !== "undetermined" && host.licenseableCores);
    const undeterminedHostIds = clusterHosts.filter((host) => host.coreSource === "undetermined").map((host) => host.id);
    const clusterCores = resolvedHosts.reduce((sum, host) => sum + (host.licenseableCores ?? 0), 0);
    const licensePacks = clusterCores / input.coresPerLicensePack;
    const osValues = clusterHosts.flatMap(hostWindowsOsValues);
    const versionsPresent = sortedVersions(new Set(osValues.map(parseWindowsVersion).filter((version): version is string => Boolean(version))));
    const editionsPresent = sortedStrings(new Set(osValues.map(parseWindowsEdition).filter((edition): edition is "Standard" | "Datacenter" | "Enterprise" | "Web" => Boolean(edition))));
    const highestVersion = highestWindowsVersion(versionsPresent) ?? "indéterminée";
    const costPerClusterVersion = clusterLicenseCost(clusterCores, prices, input);
    const costStrictPerVersion = versionsPresent.length * costPerClusterVersion;
    const costOptimizedDowngrade = versionsPresent.length > 0 ? costPerClusterVersion : 0;
    return {
      clusterId,
      clusterName: clusterHosts[0]?.clusterName,
      esxHosts: clusterHosts.length,
      clusterCores,
      licensePacks,
      versionsPresent,
      editionsPresent,
      highestVersion,
      totalWindowsVcpus: clusterHosts.reduce((sum, host) => sum + (host.guestWindowsVcpus ?? host.windowsVmVcpuCount ?? 0), 0),
      costStrictPerVersion,
      costOptimizedDowngrade,
      savingDowngrade: Math.max(0, costStrictPerVersion - costOptimizedDowngrade),
      partial: undeterminedHostIds.length > 0,
      undeterminedHostIds
    };
  }).sort((a, b) => (b.clusterCores - a.clusterCores) || a.clusterId.localeCompare(b.clusterId));
}

function versionRowSort(rows: VersionLicensingRow[]): VersionLicensingRow[] {
  return rows.sort((a, b) => {
    const rankA = versionRank(a.version);
    const rankB = versionRank(b.version);
    const normalizedA = rankA < 0 ? -1 : rankA;
    const normalizedB = rankB < 0 ? -1 : rankB;
    return normalizedB - normalizedA || a.version.localeCompare(b.version);
  });
}

export function buildGlobalVersionLicensing(hosts: LicensedHost[], clusters: ClusterLicensingRow[], _input: LicenseParameters): VersionLicensingRow[] {
  const buckets = new Map<string, VersionLicensingRow>();
  const add = (version: string, hostsCount: number, cores: number, packs: number, standardHosts: number, datacenterHosts: number, cost: number) => {
    const row = buckets.get(version) ?? { version, hosts: 0, licenseableCores: 0, licensePacks: 0, editionStandardHosts: 0, editionDatacenterHosts: 0, estimatedCost: 0 };
    row.hosts += hostsCount;
    row.licenseableCores += cores;
    row.licensePacks += packs;
    row.editionStandardHosts += standardHosts;
    row.editionDatacenterHosts += datacenterHosts;
    row.estimatedCost += cost;
    buckets.set(version, row);
  };

  const clusteredEsxIds = new Set(clusters.flatMap((cluster) => hosts.filter((host) => host.role === "esx" && host.clusterId === cluster.clusterId).map((host) => host.id)));
  for (const cluster of clusters) {
    add(cluster.highestVersion, cluster.esxHosts, cluster.clusterCores, cluster.licensePacks, 0, cluster.esxHosts, cluster.costOptimizedDowngrade);
  }
  for (const host of hosts) {
    if (host.coreSource === "undetermined" || host.recommendedEdition === "undetermined" || clusteredEsxIds.has(host.id)) continue;
    add(host.requiredWindowsVersion || "indéterminée", 1, host.licenseableCores ?? 0, host.licensePacks ?? 0, host.recommendedEdition === "standard" ? 1 : 0, host.recommendedEdition === "datacenter" ? 1 : 0, hostEstimatedCost(host));
  }
  return versionRowSort([...buckets.values()]);
}

function clusterOptimizationOpportunities(clusters: ClusterLicensingRow[]): OptimizationOpportunity[] {
  return clusters
    .filter((cluster) => cluster.savingDowngrade > 0 && cluster.highestVersion !== "indéterminée")
    .map((cluster) => ({
      type: "version_consolidation_via_downgrade" as const,
      scope: { clusterId: cluster.clusterId, clusterName: cluster.clusterName },
      currentCost: cluster.costStrictPerVersion,
      optimizedCost: cluster.costOptimizedDowngrade,
      saving: cluster.savingDowngrade,
      evidence: `${cluster.clusterName ?? cluster.clusterId}: ${cluster.clusterCores} cœurs ESX, versions Windows ${cluster.versionsPresent.join(", ")}; licence cible ${cluster.highestVersion} via downgrade rights.`,
      rationale: "Les downgrade rights permettent à une licence Windows Server de version supérieure de couvrir les versions antérieures sur le même cluster. La Software Assurance et les droits contractuels doivent être confirmés par l'auditeur avant engagement."
    }));
}

function md(value: unknown): string {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function hostSortCost(host: LicensedHost): number {
  return hostEstimatedCost(host);
}

function roleHostTable(hosts: LicensedHost[], role: LicensedHost["role"], title: string): string {
  const sorted = hosts
    .filter((host) => host.role === role && host.coreSource !== "undetermined")
    .slice()
    .sort((a, b) => hostSortCost(b) - hostSortCost(a));
  const rows = sorted.length > 0
    ? sorted.map((host) => `| ${md(host.name)} | ${host.cores ?? "?"} | ${md(host.coreSource)} | ${host.windowsVmCount ?? 0} | ${host.recommendedEdition} | ${host.licensePacks ?? "?"} | ${host.costStandard === undefined ? "n/a" : eur(host.costStandard)} | ${host.costDatacenter === undefined ? "n/a" : eur(host.costDatacenter)} |`)
    : ["| Aucun | - | - | 0 | - | - | - | - |"];
  return [
    title,
    "| Hôte | Cœurs | coreSource | VM Windows | Édition | Packs | Coût Standard | Coût Datacenter |",
    "|---|---:|---|---:|---|---:|---:|---:|",
    ...rows
  ].join("\n");
}

function hostTable(hosts: LicensedHost[]): string {
  return [
    roleHostTable(hosts, "esx", "## Hôtes ESX"),
    roleHostTable(hosts, "baremetal", "## Hôtes baremetal Windows"),
    roleHostTable(hosts, "hyperv", "## Hôtes Hyper-V")
  ].join("\n\n");
}

function clusterLicensingTable(rows: ClusterLicensingRow[]): string {
  const body = rows.length > 0
    ? rows.map((row) => `| ${md(row.clusterName ?? row.clusterId)} | ${row.esxHosts} | ${row.clusterCores} | ${md(row.versionsPresent.join(", ") || "indéterminée")} | ${md(row.editionsPresent.join(", ") || "indéterminée")} | ${md(row.highestVersion)} | ${eur(row.costStrictPerVersion)} | ${eur(row.costOptimizedDowngrade)} | ${row.partial ? "partiel" : "complet"} |`)
    : ["| Aucun | 0 | 0 | indéterminée | indéterminée | indéterminée | 0 € | 0 € | n/a |"];
  return [
    "**Licensing par cluster (modèle strict)**",
    "| Cluster | ESX | Cœurs cluster | Versions | Éditions | Version cible | Coût strict/version | Coût optimisé downgrade | Statut |",
    "|---|---:|---:|---|---|---|---:|---:|---|",
    ...body
  ].join("\n");
}

function versionTable(rows: VersionLicensingRow[]): string {
  return [
    "**Cœurs à licencier par version Windows**",
    "| Version | Hôtes | Cœurs | Packs (2c) | Standard / Datacenter | Coût est. |",
    "|---------|-------|-------|------------|----------------------|-----------|",
    ...(rows.length > 0 ? rows.map((row) => `| ${md(row.version)} | ${row.hosts} | ${row.licenseableCores} | ${row.licensePacks} | ${row.editionStandardHosts} / ${row.editionDatacenterHosts} | ${eur(row.estimatedCost)} |`) : ["| n/a | 0 | 0 | 0 | 0 / 0 | 0 € |"]),
    "",
    "*Note: Version = plus haute version déployée sur l'hôte (downgrade rights). SA éventuelle (hors scope) conditionne les droits d'upgrade — à vérifier côté contrat client.*"
  ].join("\n");
}

function editionBreakdownText(breakdown: EditionBreakdown): string {
  return [
    "**Répartition Standard / Datacenter**",
    `Standard : ${breakdown.standard.hosts} hôte(s), ${breakdown.standard.cores} cœur(s), ${eur(breakdown.standard.cost)}.`,
    `Datacenter : ${breakdown.datacenter.hosts} hôte(s), ${breakdown.datacenter.cores} cœur(s), ${eur(breakdown.datacenter.cost)}.`,
    `Sans VM Windows : ${breakdown.none.hosts} hôte(s) (aucune licence requise).`,
    `À vérifier : ${breakdown.undetermined.hosts} hôte(s) (cœurs ou version indéterminés).`
  ].join("\n");
}

function savingsBreakdownText(totals: WindowsLicenseReport["totals"]): string {
  const lines = [
    "**Économies par nature**",
    `Économies acquises (retrait de redondances) : ${eur(totals.savingsAcquired)}`,
    `Économies par réorganisation (consolidation/pod) : ${eur(totals.savingsConsolidation)}  ⚠ sous réserve d'opération`,
    `Potentiel migration baremetal → Datacenter : ${eur(totals.savingsBaremetalMigration)}  ⚠ sous réserve technique`
  ];
  if (totals.savingsBaremetalMigration > 0) {
    lines.push("ℹ️ Les économies de migration baremetal→VM supposent une capacité disponible sur un cluster Datacenter existant et la faisabilité technique de la virtualisation (performance, support éditeur, dépendances matérielles). À valider avant engagement.");
  }
  return lines.join("\n");
}

function undeterminedText(hosts: LicensedHost[]): string {
  if (hosts.length === 0) return "## Hôtes à vérifier (scan/permissions)\nAucun.";
  return [
    "## Hôtes à vérifier (scan/permissions)",
    "| Hôte | Rôle | Modèle | Processeur | config_num_processors | coreSource |",
    "|---|---|---|---|---:|---|",
    ...hosts.map((host) => `| ${md(host.name)} | ${host.role} | ${md(host.model ?? "?")} | ${md(host.processorInfoType ?? host.processorType ?? "?")} | ${host.configNumProcessors ?? "?"} | ${host.coreSource} |`)
  ].join("\n");
}

function opportunityScopeLabel(opportunity: OptimizationOpportunity): string {
  return opportunity.scope.clusterName ?? opportunity.scope.clusterId ?? opportunity.scope.hostName ?? opportunity.scope.hostId ?? "scope inconnu";
}

function topOpportunitiesText(opportunities: OptimizationOpportunity[]): string {
  const top = opportunities.slice().sort((a, b) => b.saving - a.saving).slice(0, 5);
  if (top.length === 0) return "**Top 5 opportunités d'optimisation**\nAucune opportunité chiffrée détectée.";
  return [
    "**Top 5 opportunités d'optimisation**",
    ...top.map((opportunity, index) => `${index + 1}. ${opportunity.type} (${md(opportunityScopeLabel(opportunity))}) — économie ${eur(opportunity.saving)} : ${opportunity.rationale}`)
  ].join("\n");
}

function savingsByNature(opportunities: OptimizationOpportunity[]) {
  return opportunities.reduce((acc, opportunity) => {
    const saving = Math.max(0, opportunity.saving);
    if (opportunity.type === "redundant_standard_on_datacenter_host" || opportunity.type === "underloaded_datacenter_host") {
      acc.savingsAcquired += saving;
    } else if (opportunity.type === "consolidation_candidate" || opportunity.type === "windows_affinity_pod" || opportunity.type === "version_consolidation_via_downgrade") {
      acc.savingsConsolidation += saving;
    } else if (opportunity.type === "baremetal_to_datacenter_migration") {
      acc.savingsBaremetalMigration += saving;
    }
    return acc;
  }, { savingsAcquired: 0, savingsConsolidation: 0, savingsBaremetalMigration: 0 });
}

export function buildWindowsLicenseTextSummary(report: WindowsLicenseReport): string {
  return [
    report.summary,
    editionBreakdownText(report.editionBreakdown),
    savingsBreakdownText(report.totals),
    clusterLicensingTable(report.clusterLicensing),
    versionTable(report.versionLicensing),
    topOpportunitiesText(report.optimizationOpportunities),
    report.markdownReport,
    report.recommendationPrompt
  ].join("\n\n");
}

export function buildWindowsLicenseMarkdown(hosts: LicensedHost[], _versionLicensing: VersionLicensingRow[], _editionBreakdown: EditionBreakdown, _clusterLicensing: ClusterLicensingRow[] = []): string {
  return [hostTable(hosts), undeterminedText(hosts.filter((host) => host.coreSource === "undetermined"))].join("\n\n");
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
  const clusterLicensing = buildClusterLicensing(licensed, parameters, prices);
  const optimizationOpportunities = [
    ...findOptimizationOpportunities(licensed, parameters),
    ...clusterOptimizationOpportunities(clusterLicensing)
  ].sort((a, b) => b.saving - a.saving);
  const versionLicensing = buildGlobalVersionLicensing(licensed, clusterLicensing, parameters);
  const editionBreakdown = buildEditionBreakdown(licensed);
  const markdownReport = buildWindowsLicenseMarkdown(licensed, versionLicensing, editionBreakdown, clusterLicensing);
  const estimatedMedianCost = determinedHosts.reduce((sum, host) => sum + (host.recommendedEdition === "datacenter" ? host.costDatacenter ?? 0 : host.costStandard ?? 0), 0);
  const savings = savingsByNature(optimizationOpportunities);
  const potentialSavings = savings.savingsAcquired + savings.savingsConsolidation + savings.savingsBaremetalMigration;
  const totals = {
    physicalHosts: licensed.length,
    licenseableHosts: determinedHosts.filter((host) => host.recommendedEdition !== "none").length,
    licenseableCores: determinedHosts.reduce((sum, host) => sum + (host.licenseableCores ?? 0), 0),
    estimatedMedianCost,
    ...savings,
    potentialSavings,
    undeterminedHosts: undeterminedHosts.length
  };
  const recommendationPrompt = `Priorise les optimizationOpportunities par économie décroissante et rédige une recommandation client par opportunité. Cite le rationale de chaque opportunité pour expliquer le COMMENT, puis utilise uniquement les montants déjà calculés dans currentCost/optimizedCost/saving. Compare la photo des versions Windows présentes par cluster avec le contrat client fourni séparément (Software Assurance, droits de version et downgrade rights) avant toute conclusion d'achat. Signale les hôtes estimated=true comme « à confirmer » avant engagement. Les hôtes coreSource=undetermined sont à vérifier (scan/permissions) et ne doivent pas être intégrés comme 0 cœur.`;
  return {
    summary: `${totals.licenseableHosts} hôte(s) licenciable(s), ${totals.licenseableCores} cœur(s) licenciables, coût médian estimé ${eur(totals.estimatedMedianCost)}.`,
    hosts: licensed,
    optimizationOpportunities,
    parameters: { ...parameters, priceAssumptions: prices },
    versionLicensing,
    editionBreakdown,
    clusterLicensing,
    undeterminedHosts,
    totals,
    generatedDslQueries: buildWindowsLicenseQueries(),
    markdownReport,
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

async function esxGuestVersionMap(client: DiscoveryClient, query: string, maxRows: number): Promise<Map<string, string[]>> {
  const result = await client.searchData(query, {
    entityLabel: "versions Windows invitées par ESX",
    appliedFilters: { windowsLicense: true, role: "esxGuestVersions" },
    maxRows,
    pageSize: WINDOWS_LICENSE_PAGE_SIZE
  });
  const versionsByEsx = new Map<string, string[]>();
  for (const row of result.rows as Array<Record<string, unknown>>) {
    const esxId = firstString(rowValue(row, ["esx_id", "ESX ID", "id"]));
    if (!esxId) continue;
    const versions = stringList(rowValue(row, ["guest_windows_os", "Guest Windows OS"]));
    if (versions.length === 0) continue;
    const existing = versionsByEsx.get(esxId) ?? [];
    versionsByEsx.set(esxId, [...existing, ...versions]);
  }
  for (const [esxId, versions] of versionsByEsx) versionsByEsx.set(esxId, [...new Set(versions)]);
  return versionsByEsx;
}

export function windowsLicenseTools(client: DiscoveryClient) {
  return {
    discovery_windows_license_report: {
      description: "Build and execute a Windows Server licensing report by physical host (ESX, baremetal Windows, Hyper-V). Resolves physical cores with a 7-step cascade, calculates Standard vs Datacenter costs from the IT cost CSV, precomputes optimization opportunities, returns KPI SVG and a recommendationPrompt for the LLM. USE THIS DIRECTLY; do not delegate to discovery_execute_dsl.",
      schema: windowsLicenseSchema,
      outputSchema: structuredOutputSchema,
      handler: async (input: WindowsLicenseInput) => {
        const queries = buildWindowsLicenseQueries();
        const [esx, baremetal, hyperv, esxGuestVersions] = await Promise.all([
          inventoryRows(client, queries.esx, "esx", input.maxRows),
          inventoryRows(client, queries.baremetal, "baremetal", input.maxRows),
          inventoryRows(client, queries.hyperv, "hyperv", input.maxRows),
          esxGuestVersionMap(client, queries.esxGuestVersions, input.maxRows)
        ]);
        const esxWithGuestVersions = esx.map((host) => ({
          ...host,
          windowsVmOsVersions: esxGuestVersions.get(host.id) ?? []
        }));
        const report = await buildWindowsLicenseReportFromHosts([...esxWithGuestVersions, ...baremetal, ...hyperv], input);
        const svg = kpiDashboard("Windows licensing", [
          { label: "Hôtes licenciables", value: String(report.totals.licenseableHosts), hint: `${report.totals.physicalHosts} physiques` },
          { label: "Cœurs licenciables", value: String(report.totals.licenseableCores), hint: input.priceProfile },
          { label: "Coût estimé", value: eur(report.totals.estimatedMedianCost), hint: "médian CSV" },
          { label: "Économies acquises", value: eur(report.totals.savingsAcquired), hint: "redondances", delta: { text: "sûr", positive: true } },
          { label: "Réorganisation", value: eur(report.totals.savingsConsolidation), hint: "consolidation/pod", delta: { text: "sous réserve", positive: true } },
          { label: "Migration baremetal", value: eur(report.totals.savingsBaremetalMigration), hint: "potentiel max", delta: { text: "à valider", positive: true } },
          { label: "À vérifier", value: String(report.totals.undeterminedHosts), hint: "cœurs indéterminés", alert: report.totals.undeterminedHosts > 0 }
        ], [
          { label: "Acquises", value: report.totals.savingsAcquired },
          { label: "Consolidation", value: report.totals.savingsConsolidation },
          { label: "Migration baremetal", value: report.totals.savingsBaremetalMigration }
        ], { barTitle: "Leviers d'économies", formatValue: eur });
        return renderVisual(svg, {
          name: "windows_license_report",
          textSummary: buildWindowsLicenseTextSummary(report),
          structuredContent: report
        });
      },
      isVisual: true as const
    }
  };
}
