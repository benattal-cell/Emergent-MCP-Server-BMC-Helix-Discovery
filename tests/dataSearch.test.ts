import { describe, expect, it, vi } from "vitest";
import { dataSearchTools } from "../src/tools/dataSearch.js";

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

describe("discovery_data_search", () => {
  it("requires explicit user confirmation before any execution", async () => {
    const client = fakeClient();
    const tool = dataSearchTools(client).discovery_data_search;

    const result = await tool.handler({
      request: "Explore hosts",
      query: "SEARCH Host SHOW name"
    });

    expect(result.stage).toBe("confirmation_required");
    expect(result.executed).toBe(false);
    expect(client.queryJson).not.toHaveBeenCalled();
  });

  it("blocks invalid DSL during query validation", async () => {
    const client = fakeClient();
    const tool = dataSearchTools(client).discovery_data_search;

    const result = await tool.handler({
      request: "Explore hosts",
      query: "SEARCH Host ORDER BY name asc SHOW name",
      userConfirmed: true
    });

    expect(result.stage).toBe("query_validation");
    expect(result.executed).toBe(false);
    expect(client.queryJson).not.toHaveBeenCalled();
  });

  it("blocks an unknown primary kind from taxonomy", async () => {
    const client = fakeClient();
    const tool = dataSearchTools(client).discovery_data_search;

    const result = await tool.handler({
      request: "Explore made-up kind",
      query: "SEARCH FooBarKind SHOW name",
      userConfirmed: true
    });

    expect(result.stage).toBe("taxonomy");
    expect(result.executed).toBe(false);
    expect(client.queryJson).not.toHaveBeenCalled();
  });

  it("executes valid confirmed queries with known primary kinds", async () => {
    const client = fakeClient();
    const tool = dataSearchTools(client).discovery_data_search;

    const result = await tool.handler({
      request: "Explore hosts",
      query: "SEARCH Host SHOW name",
      userConfirmed: true
    });

    expect(result.stage).toBe("executed");
    expect(result.executed).toBe(true);
    expect(result.preflight).toMatchObject({ queryValidated: true, taxonomyChecked: true });
    expect(client.queryJson).toHaveBeenCalledTimes(1);
  });
});
