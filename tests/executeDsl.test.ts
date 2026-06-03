import { describe, expect, it, vi } from "vitest";
import { executeDslTools } from "../src/tools/executeDsl.js";

function fakeClient() {
  return {
    getTaxonomyNodeKinds: vi.fn().mockResolvedValue(["Host", "SoftwareInstance"]),
    queryJson: vi.fn().mockResolvedValue({
      summary: "mock",
      totalCount: 1,
      returnedCount: 1,
      rows: [{ name: "host-1" }]
    })
  } as never;
}

describe("discovery_execute_dsl", () => {
  it("executes a valid query directly without userConfirmed or provenance", async () => {
    const client = fakeClient();
    const tool = executeDslTools(client).discovery_execute_dsl;

    const result = await tool.handler({
      request: "Explore hosts",
      query: "SEARCH Host SHOW name"
    });

    expect(result.stage).toBe("executed");
    expect(result.executed).toBe(true);
    expect(result.preflight).toMatchObject({ queryValidated: true, taxonomyChecked: true });
    expect(client.queryJson).toHaveBeenCalledTimes(1);
    expect(client.queryJson).toHaveBeenCalledWith("SEARCH Host SHOW name", 100, expect.any(Object));
  });

  it("keeps blocking invalid DSL during query validation without confirmation", async () => {
    const client = fakeClient();
    const tool = executeDslTools(client).discovery_execute_dsl;

    const result = await tool.handler({
      request: "Explore hosts",
      query: "SEARCH Host ORDER BY name asc SHOW name"
    });

    expect(result.stage).toBe("query_validation");
    expect(result.executed).toBe(false);
    expect(client.queryJson).not.toHaveBeenCalled();
  });

  it("adds curated relationship hints and anti-patterns on Gate 1 validation failure", async () => {
    const client = fakeClient();
    const tool = executeDslTools(client).discovery_execute_dsl;

    const result = await tool.handler({
      request: "vcenter esx cluster",
      query: "SEARCH SoftwareInstance ORDER BY name asc SHOW name"
    });

    expect(result.stage).toBe("query_validation");
    expect(result.executed).toBe(false);
    expect(result.relationshipHints).toEqual(expect.any(Array));
    expect(result.relationshipHints.length).toBeGreaterThan(0);
    expect(result.antiPatterns).toEqual(expect.any(Array));
    expect(client.queryJson).not.toHaveBeenCalled();
  });

  it("blocks an unknown primary kind from taxonomy", async () => {
    const client = fakeClient();
    const tool = executeDslTools(client).discovery_execute_dsl;

    const result = await tool.handler({
      request: "Explore made-up kind",
      query: "SEARCH FooBarKind SHOW name"
    });

    expect(result.stage).toBe("taxonomy");
    expect(result.executed).toBe(false);
    expect(client.queryJson).not.toHaveBeenCalled();
  });

  it("adds curated relationship hints on Gate 2 taxonomy failure", async () => {
    const client = fakeClient();
    const tool = executeDslTools(client).discovery_execute_dsl;

    const result = await tool.handler({
      request: "vcenter esx cluster",
      query: "SEARCH FooBarKind SHOW name"
    });

    expect(result.stage).toBe("taxonomy");
    expect(result.executed).toBe(false);
    expect(result.relationshipHints).toEqual(expect.any(Array));
    expect(result.relationshipHints.length).toBeGreaterThan(0);
    expect(client.queryJson).not.toHaveBeenCalled();
  });

  it("ignores deprecated provenance and still keeps validation and taxonomy gates", async () => {
    const client = fakeClient();
    const tool = executeDslTools(client).discovery_execute_dsl;

    const result = await tool.handler({
      request: "Run lifecycle DSL from builder",
      query: "SEARCH FooBarKind SHOW name",
      provenance: "curated"
    });

    expect(result.stage).toBe("taxonomy");
    expect(result.executed).toBe(false);
    expect(client.queryJson).not.toHaveBeenCalled();
  });
});
