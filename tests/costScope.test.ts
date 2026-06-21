import { describe, expect, it, vi } from "vitest";
import { buildScopeQuery, bucketize, buildScopeCostReport, resolveScopeVms } from "../src/tools/itCosts/scope.js";
import { itCostTools } from "../src/tools/itCosts/index.js";
import { loadItCostRows } from "../src/tools/itCosts/dataLoader.js";

const rows = loadItCostRows();

describe("cost scope", () => {
  it("builds a service scope query with the real model idioms", () => {
    const query = buildScopeQuery({ type: "service", name: "Apex" });
    expect(query).toContain('search BusinessService where name has subword "Apex"');
    expect(query).toContain("traverse :::Host where virtual");
    expect(query).toContain("#:::ProcessorInfo.num_logical_processors as vcpu");
    expect(query).toContain("logical_ram");
  });

  it("builds a fleet scope query with an optional os filter", () => {
    expect(buildScopeQuery({ type: "fleet" })).toContain("search Host where virtual");
    expect(buildScopeQuery({ type: "fleet", osContains: "Windows" })).toContain('where virtual and os has subword "Windows"');
  });

  it("buckets VMs by snapped vCPU and averages RAM", () => {
    const buckets = bucketize([
      { name: "a", vcpu: 4, ramGb: 16, os: "" },
      { name: "b", vcpu: 3, ramGb: 16, os: "" },
      { name: "c", vcpu: 8, ramGb: 32, os: "" }
    ]);
    expect(buckets).toEqual([
      { vcpu: 4, ramGb: 16, count: 2, label: "VM 4 vCPU / 16 Go" },
      { vcpu: 8, ramGb: 32, count: 1, label: "VM 8 vCPU / 32 Go" }
    ]);
  });

  it("converts logical_ram (Mo) to Go and rounds vCPU", async () => {
    const client = { searchData: vi.fn().mockResolvedValue({ rows: [{ name: "vm1", vcpu: "4", logical_ram: 16384, os: "Linux" }] }) } as never;
    const vms = await resolveScopeVms(client, { type: "fleet" });
    expect(vms).toEqual([{ name: "vm1", vcpu: 4, ramGb: 16, os: "Linux" }]);
  });

  it("computes current cost and cloud provider totals for compare", () => {
    const vms = [
      { name: "a", vcpu: 4, ramGb: 16, os: "" },
      { name: "b", vcpu: 4, ramGb: 16, os: "" }
    ];
    const report = buildScopeCostReport(rows, vms, { type: "service", name: "X" }, "compare");
    expect(report.vmCount).toBe(2);
    expect(report.currentAnnual).toBeGreaterThan(0);
    expect(report.providers.length).toBeGreaterThan(0);
    expect(report.bestProvider).toBeTruthy();
  });

  it("runs a scope compare end to end through discovery_cost", async () => {
    const client = { searchData: vi.fn().mockResolvedValue({ rows: [
      { name: "vm1", vcpu: 4, logical_ram: 16384, os: "Linux" },
      { name: "vm2", vcpu: 8, logical_ram: 32768, os: "Windows" }
    ] }) } as never;
    const result = await itCostTools(client).discovery_cost.handler({ mode: "compare", scope: { type: "service", name: "Apex" }, horizon: "annual", scenario: "all", limit: 10 });
    expect(result.structuredContent.vmCount).toBe(2);
    expect(result.content.some((block: { type?: string; resource?: { mimeType?: string } }) => block.type === "image" || block.resource?.mimeType === "image/svg+xml")).toBe(true);
  });

  it("errors clearly when the scope resolves to no VMs", async () => {
    const client = { searchData: vi.fn().mockResolvedValue({ rows: [] }) } as never;
    const result = await itCostTools(client).discovery_cost.handler({ mode: "compare", scope: { type: "host", name: "ghost" }, horizon: "annual", scenario: "all", limit: 10 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Aucune VM");
  });
});
