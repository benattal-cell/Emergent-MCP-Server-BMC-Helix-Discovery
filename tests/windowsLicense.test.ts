import { describe, expect, it, vi } from "vitest";
import type { ItCostRow } from "../src/tools/itCosts/dataLoader.js";
import {
  buildWindowsLicenseQueries,
  buildWindowsLicenseReportFromHosts,
  calculateLicenses,
  clearCpuLookupCache,
  findOptimizationOpportunities,
  resolveHostCores,
  type PhysicalHostInventoryRow,
  type PriceAssumptions,
  type WindowsLicenseInput
} from "../src/tools/windowsLicense.js";

function costRow(category: string, component: string, median: number): ItCostRow {
  return {
    "Catégorie": category,
    "Sous-catégorie": "Systèmes",
    "Composant": component,
    "Unité de mesure": "Licence perpétuelle",
    "Coût unitaire min (€)": median,
    "Coût unitaire médian (€)": median,
    "Coût unitaire max (€)": median,
    "Devise": "EUR",
    "Fréquence": "One-shot",
    "Notes / Hypothèses": "test",
    "Source / Référence": "test",
    "Date de mise à jour": "2026-01"
  };
}

const costRows = [
  costRow("LICENCE MICROSOFT", "Windows Server Standard (par 2 cores)", 95),
  costRow("LICENCE MICROSOFT", "Windows Server Datacenter (par 2 cores)", 450),
  costRow("INFRA VIRTUALISÉE", "Windows Server Datacenter (par 2 cores)", 800)
];

const params = {
  minCoresPerHost: 16,
  minCoresPerProc: 8,
  coresPerLicensePack: 2,
  standardVmsPerLicense: 2,
  datacenterUnlimitedVms: true,
  priceProfile: "license_microsoft" as const,
  underloadedVmThreshold: 4,
  currentDatacenterHostIds: [],
  currentStandardHostIds: [],
  maxRows: 20000
} satisfies WindowsLicenseInput;

const prices: PriceAssumptions = {
  standardPer2Cores: 95,
  datacenterPer2Cores: 450,
  standardComponent: "Windows Server Standard (par 2 cores)",
  datacenterComponent: "Windows Server Datacenter (par 2 cores)",
  standardCategory: "LICENCE MICROSOFT",
  datacenterCategory: "LICENCE MICROSOFT",
  scenario: "median",
  currency: "EUR"
};

function host(id: string, extra: Partial<PhysicalHostInventoryRow>): PhysicalHostInventoryRow {
  return { id, name: id, role: "esx", windowsVmCount: 1, totalVmCount: 1, ...extra };
}

describe("Windows license core resolution", () => {
  it("resolves cores through cascade levels 1 to 7 and keeps undetermined distinct from zero", async () => {
    clearCpuLookupCache();
    const lookup = vi.fn().mockResolvedValue({ coresPerSocket: 24, sourceUrl: "https://cpu.example/xeon-6248" });
    const hosts = [
      host("level1", { processorInfoNumCores: [20, 20] }),
      host("level2", { processorInfoNumSockets: 2, processorInfoCoresPerSocket: 18 }),
      host("level3", { processorInfoNumSockets: 2, processorInfoCoresPerSocketSpecs: 16 }),
      host("level4a", { hostNumCores: 28 }),
      host("level4b", { hostNumProcessors: 2, hostCoresPerProcessor: 14 }),
      host("level6", { processorInfoNumSockets: 2, processorInfoType: "Intel Xeon Gold 6248" }),
      host("level7", { processorType: "Intel Xeon" })
    ];

    const resolved = await resolveHostCores(hosts, lookup);
    const byId = Object.fromEntries(resolved.map((h) => [h.id, h]));

    expect(byId.level1).toMatchObject({ cores: 40, coreSource: "processorinfo.num_cores" });
    expect(byId.level2).toMatchObject({ cores: 36, coreSource: "processorinfo.sockets_x_cps" });
    expect(byId.level3).toMatchObject({ cores: 32, coreSource: "processorinfo.specs" });
    expect(byId.level4a).toMatchObject({ cores: 28, coreSource: "host.num_cores" });
    expect(byId.level4b).toMatchObject({ cores: 28, coreSource: "host.procs_x_cpp" });
    expect(byId.level6).toMatchObject({ cores: 48, coreSource: "web:Intel Xeon Gold 6248", coreSourceUrl: "https://cpu.example/xeon-6248", estimated: true });
    expect(byId.level7).toMatchObject({ coreSource: "undetermined", estimated: true });
    expect(byId.level7.cores).toBeUndefined();
  });

  it("uses model twinning from resolved hosts before web lookup", async () => {
    const hosts = [
      host("scanned", { model: "PowerEdge M640", processorInfoNumCores: 40 }),
      host("unscanned", { model: "PowerEdge M640", processorType: "Intel Xeon Gold 6138", hostNumProcessors: 2 })
    ];

    const resolved = await resolveHostCores(hosts, vi.fn().mockResolvedValue({ coresPerSocket: 20, sourceUrl: "unused" }));
    const twin = resolved.find((h) => h.id === "unscanned");

    expect(twin).toMatchObject({ cores: 40, coreSource: "model_twin:PowerEdge M640" });
  });

  it("caches mocked web CPU lookups and marks web-derived cores as estimated", async () => {
    clearCpuLookupCache();
    const lookup = vi.fn().mockResolvedValue({ coresPerSocket: 20, sourceUrl: "https://cpu.example/6138" });
    const hosts = [
      host("web1", { processorInfoNumSockets: 2, processorInfoType: "Intel Xeon Gold 6138" }),
      host("web2", { processorInfoNumSockets: 4, processorInfoType: "Intel Xeon Gold 6138" })
    ];

    const resolved = await resolveHostCores(hosts, lookup);

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(resolved[0]).toMatchObject({ cores: 40, estimated: true, coreSourceUrl: "https://cpu.example/6138" });
    expect(resolved[1]).toMatchObject({ cores: 80, estimated: true, coreSourceUrl: "https://cpu.example/6138" });
  });
});

describe("Windows license calculations", () => {
  it("applies Microsoft minima and chooses the cheapest Standard vs Datacenter edition", () => {
    const licensed = calculateLicenses([
      { ...host("two-by-twenty", { windowsVmCount: 10 }), cores: 40, processors: 2, coreSource: "processorinfo.sockets_x_cps" },
      { ...host("minimums", { windowsVmCount: 1 }), cores: 4, processors: 1, coreSource: "host.num_cores" }
    ], params, prices);

    expect(licensed[0]).toMatchObject({ licenseableCores: 40, licensePacks: 20, costStandard: 9500, costDatacenter: 9000, recommendedEdition: "datacenter" });
    expect(licensed[1]).toMatchObject({ licenseableCores: 16, licensePacks: 8, costStandard: 760, costDatacenter: 3600, recommendedEdition: "standard" });
  });

  it("produces redundant Standard and underloaded Datacenter opportunities with coherent savings", () => {
    const licensed = calculateLicenses([
      { ...host("redundant", { windowsVmCount: 20, hasDatacenterLicense: true, hasStandardLicenses: true }), cores: 40, processors: 2, coreSource: "processorinfo.num_cores" },
      { ...host("underloaded", { windowsVmCount: 2, hasDatacenterLicense: true }), cores: 40, processors: 2, coreSource: "processorinfo.num_cores" }
    ], params, prices);

    const opportunities = findOptimizationOpportunities(licensed, params);

    expect(opportunities.find((o) => o.type === "redundant_standard_on_datacenter_host")).toMatchObject({ scope: { hostId: "redundant" }, currentCost: 19000, optimizedCost: 9000, saving: 10000 });
    expect(opportunities.find((o) => o.type === "underloaded_datacenter_host")).toMatchObject({ scope: { hostId: "underloaded" }, currentCost: 9000, optimizedCost: 1900, saving: 7100 });
  });


  it("uses Windows VM vCPU totals in cluster affinity-pod opportunities", () => {
    const licensed = calculateLicenses([
      { ...host("esx1", { clusterId: "cluster-a", clusterName: "Cluster A", windowsVmCount: 4, windowsVmVcpuCount: 24 }), cores: 40, processors: 2, coreSource: "processorinfo.num_cores" },
      { ...host("esx2", { clusterId: "cluster-a", clusterName: "Cluster A", windowsVmCount: 2, windowsVmVcpuCount: 16 }), cores: 40, processors: 2, coreSource: "processorinfo.num_cores" }
    ], params, prices);

    const opportunities = findOptimizationOpportunities(licensed, params);
    const pod = opportunities.find((o) => o.type === "windows_affinity_pod");

    expect(pod?.evidence).toContain("40 vCPU Windows");
    expect(pod?.saving).toBeGreaterThan(0);
  });

  it("excludes undetermined hosts from cost and core totals while keeping the verification bucket", async () => {
    const report = await buildWindowsLicenseReportFromHosts([
      host("known", { hostNumCores: 16, windowsVmCount: 1 }),
      host("unknown", { processorType: "Intel Xeon" })
    ], params, { costRows, cpuLookup: vi.fn().mockResolvedValue(null) });

    expect(report.totals.licenseableCores).toBe(16);
    expect(report.totals.estimatedMedianCost).toBe(760);
    expect(report.totals.undeterminedHosts).toBe(1);
    expect(report.undeterminedHosts).toHaveLength(1);
    expect(report.undeterminedHosts[0]).toMatchObject({ id: "unknown", coreSource: "undetermined" });
  });

  it("builds the three validated inventory source queries", () => {
    const queries = buildWindowsLicenseQueries();

    expect(queries.esx).toContain('SEARCH SoftwareInstance WHERE type HAS SUBWORD "vCenter"');
    expect(queries.esx).toContain("TRAVERSE ServiceProvider:SoftwareService:Service:Cluster");
    expect(queries.esx).toContain("TRAVERSE HostContainer:HostContainment:ContainedHost:Host");
    expect(queries.baremetal).toContain('SEARCH Host WHERE os_type = "Windows" AND NOT virtual');
    expect(queries.hyperv).toContain('type HAS SUBWORD "Hyper-V"');
    expect(queries.esx).toContain("NODECOUNT(TRAVERSE Host:HostedSoftware:RunningSoftware:VirtualMachine");
    expect(queries.esx).toContain("NODES(TRAVERSE Host:HostedSoftware:RunningSoftware:VirtualMachine");
    expect(queries.esx).toContain("AS 'windows_vm_vcpus'");
    expect(queries.esx).toContain("#Hardware:ReferenceData:ReferenceData:HardwareReferenceData.model");
    expect(queries.esx).not.toContain("#Host:Hardware:ReferenceData");
  });
});
