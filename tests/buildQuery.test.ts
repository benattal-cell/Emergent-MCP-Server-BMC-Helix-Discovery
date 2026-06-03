import { describe, expect, it, vi } from "vitest";

vi.mock("../src/tools/commonRelationships.js", () => ({
  findTraversePath: vi.fn(({ fromKind, toKind }: { fromKind: string; toKind: string }) => {
    if (fromKind === "Host" && toKind === "SoftwareInstance") {
      return {
        traverseSpec: "Host:HostedSoftware:RunningSoftware:",
        toKind: "SoftwareInstance",
        priority: "golden",
        note: "mocked path"
      };
    }
    return null;
  }),
  listTraverseTargets: vi.fn((fromKind: string) =>
    fromKind === "Host" ? [{ toKind: "SoftwareInstance", priority: "golden", note: "mocked target" }] : []
  ),
  getAntiPatterns: vi.fn(() => ["mocked anti-pattern"])
}));

const { buildQueryTools } = await import("../src/tools/buildQuery.js");

const mockClient = {
  getTaxonomyNodeKinds: vi.fn().mockResolvedValue(["Host", "SoftwareInstance", "VirtualMachine"]),
  getTaxonomyNodeKindFieldLists: vi.fn().mockResolvedValue([])
};

describe("discovery_build_query", () => {
  it("composes SEARCH + WHERE intent with the safe default SHOW", async () => {
    const tool = buildQueryTools(mockClient as never).discovery_build_query;

    const result = await tool.handler({
      searchKind: "Host",
      where: [{ left: { type: "field", name: "os" }, operator: "has_subword", value: "Linux" }],
      language: "fr"
    });

    expect(result.status).not.toBe("invalid_input");
    expect(result.status).not.toBe("traversal_not_found");
    expect(result.executed).toBe(false);
    expect(result.dslQuery).toBe('SEARCH Host WHERE os HAS SUBWORD "Linux" SHOW name, #id');
  });

  it("renders NODECOUNT predicates for ESX-like VM counts", async () => {
    const tool = buildQueryTools(mockClient as never).discovery_build_query;

    const result = await tool.handler({
      searchKind: "Host",
      where: [
        {
          left: {
            type: "nodecount",
            targetKind: "VirtualMachine",
            where: [{ left: { type: "field", name: "os" }, operator: "has_subword", value: "Windows" }]
          },
          operator: "gt",
          value: 10
        }
      ],
      language: "fr"
    });

    expect(result.executed).toBe(false);
    expect(result.dslQuery).toContain('NODECOUNT(TRAVERSE :::VirtualMachine WHERE os HAS SUBWORD "Windows") > 10');
  });

  it("refuses missing csv_path traversals with suggestions and no dslQuery", async () => {
    const tool = buildQueryTools(mockClient as never).discovery_build_query;

    const result = await tool.handler({
      searchKind: "Host",
      traversals: [{ targetKind: "Cluster", mode: "csv_path" }],
      language: "en"
    });

    expect(result.status).toBe("traversal_not_found");
    expect(result).not.toHaveProperty("dslQuery");
    expect(result.knownTargetsFromHere).toEqual([{ toKind: "SoftwareInstance", priority: "golden", note: "mocked target" }]);
  });

  it("falls back when high_detail is unavailable", async () => {
    const tool = buildQueryTools(mockClient as never).discovery_build_query;

    const result = await tool.handler({
      searchKind: "Host",
      show: { mode: "high_detail" },
      language: "fr"
    });

    expect(result.executed).toBe(false);
    expect(result.highDetailAvailable).toBe(false);
    expect(result.dslQuery).toBe("SEARCH Host SHOW name, #id");
    expect(result.showWarnings.length).toBeGreaterThan(0);
  });
});
