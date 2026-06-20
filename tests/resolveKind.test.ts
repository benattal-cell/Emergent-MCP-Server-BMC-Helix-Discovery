import { afterEach, describe, expect, it } from "vitest";
import { resolveKind, resolveKindTools } from "../src/tools/resolveKind.js";
import { buildQueryTools } from "../src/tools/buildQuery.js";
import { createHttpServer } from "../src/index.js";

const mockClient = {
  getTaxonomyNodeKinds: async () => ["Host", "SoftwareInstance", "LoadBalancer"],
  getTaxonomyNodeKindFieldLists: async () => []
};

let currentServer: import("node:http").Server | undefined;

afterEach(async () => {
  if (currentServer) {
    await new Promise<void>((resolve, reject) => currentServer?.close((error) => (error ? reject(error) : resolve())));
    currentServer = undefined;
  }
});

describe("discovery_resolve_kind", () => {
  it("resolves a pure alias without filter", () => {
    const result = resolveKind({ alias: "serveur", limit: 5 });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ kind: "Host", matchedAlias: "serveur", confidence: 1, ambiguous: false });
    expect(result.candidates[0]).not.toHaveProperty("filter");
  });

  it("resolves a typed alias with a build-query textual filter", () => {
    const result = resolveKind({ alias: "vcenter", limit: 5 });

    expect(result.candidates[0]).toMatchObject({
      kind: "SoftwareInstance",
      filter: { field: "type", operator: "has_subword", value: "vCenter" },
      priority: "golden",
      confidence: 1,
      ambiguous: false
    });
  });

  it("resolves a boolean alias and buildQuery renders it without quotes", async () => {
    const resolved = resolveKind({ alias: "serveur virtuel", limit: 5 });

    expect(resolved.candidates[0]).toMatchObject({
      kind: "Host",
      filter: { field: "virtual", operator: "is", value: true },
      ambiguous: false
    });

    const tool = buildQueryTools(mockClient as never).discovery_build_query;
    const result = await tool.handler({
      searchKind: resolved.candidates[0].kind,
      where: [{ left: { type: "field", name: "virtual" }, operator: "is", value: true }],
      language: "fr"
    });

    expect(result.dslQuery).toBe("SEARCH Host WHERE virtual is true SHOW name, #id");
  });

  it("marks ambiguous aliases and returns all exact candidates", () => {
    const result = resolveKind({ alias: "load balancer", limit: 5 });

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.every((candidate) => candidate.ambiguous)).toBe(true);
    expect(result.guidance).toContain("Alias ambigu");
    expect(result.candidates.map((candidate) => candidate.kind)).toEqual(["NetworkDevice", "SoftwareInstance"]);
  });

  it("normalizes accents and case", () => {
    const result = resolveKind({ alias: "HÔTE", limit: 5 });

    expect(result.candidates[0]).toMatchObject({ kind: "Host", matchedAlias: "hote", confidence: 1 });
  });

  it("exports the resolver in its local tool factory", () => {
    expect(resolveKindTools()).toHaveProperty("discovery_resolve_kind");
  });

  it("lists discovery_resolve_kind through MCP tools/list", async () => {
    currentServer = await createHttpServer({
      baseUrl: "https://example.test",
      apiVersion: "v1.18",
      token: "bmc-token",
      mcpServerApiKey: "good-key",
      port: 0
    });
    await new Promise<void>((resolve) => currentServer?.listen(0, resolve));
    const address = currentServer.address();
    if (!address || typeof address === "string") throw new Error("No address");

    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer good-key", "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
    });
    const text = await response.text();
    const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
    if (!dataLine) throw new Error(`No SSE data line: ${text}`);
    const payload = JSON.parse(dataLine.slice("data: ".length));

    expect(response.status).toBe(200);
    expect(payload.result.tools.map((tool: { name: string }) => tool.name)).toContain("discovery_resolve_kind");
  });
});
