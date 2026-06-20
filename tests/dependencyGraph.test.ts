import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadCatalog } from "../src/discovery/catalog.js";

vi.mock("../src/svg/cytoscapeBundle.js", () => ({
  cytoscapeJsSource: "function cytoscape(){}"
}));

import { dependencyScopeTools } from "../src/tools/dependencyScope.js";
import { dependencyMapTools } from "../src/tools/dependencyMap.js";

function fakeClient(graph: Record<string, unknown>, hostName = "PROD-WEB-01") {
  return {
    searchData: vi.fn().mockImplementation(async (query: string) => {
      if (query.includes("Host") && query.includes(hostName)) {
        return { summary: "1 host", totalCount: 1, returnedCount: 1, rows: [{ "#id": "0123456789abcdef0123456789abcdef0123456789abcdef01234567", id: "0123456789abcdef0123456789abcdef0123456789abcdef01234567", name: hostName, kind: "Host" }] };
      }
      return { summary: "0", totalCount: 0, returnedCount: 0, rows: [] };
    }),
    getNodeGraph: vi.fn().mockResolvedValue(graph)
  } as never;
}

const sampleGraph = {
  nodes: [
    { id: "0123456789abcdef0123456789abcdef0123456789abcdef01234567", kind: "Host", name: "PROD-WEB-01", short_name: "PROD-WEB-01" },
    { id: "11111111111111111111111111111111111111111111111111111111", kind: "SoftwareInstance", name: "nginx", short_name: "nginx" },
    { id: "22222222222222222222222222222222222222222222222222222222", kind: "SoftwareInstance", name: "Node.js", short_name: "Node.js" }
  ],
  links: [
    { src_id: "0123456789abcdef0123456789abcdef0123456789abcdef01234567", tgt_id: "11111111111111111111111111111111111111111111111111111111", kind: "HostedSoftware" },
    { src_id: "0123456789abcdef0123456789abcdef0123456789abcdef01234567", tgt_id: "22222222222222222222222222222222222222222222222222222222", kind: "HostedSoftware" }
  ]
};

beforeEach(async () => {
  await loadCatalog({ searchData: vi.fn().mockResolvedValue({ rows: [] }) } as never);
});

describe("discovery_dependency_scope", () => {
  it("resolves a host name and returns counts", async () => {
    const client = fakeClient(sampleGraph);
    const tools = dependencyScopeTools(client);
    const result = await tools.discovery_dependency_scope.handler({ target: "PROD-WEB-01" });
    expect(result.structuredContent.resolved.type).toBe("host_name");
    expect(result.structuredContent.resolved.id).toBe("0123456789abcdef0123456789abcdef0123456789abcdef01234567");
    expect(result.structuredContent.counts.nodes).toBe(3);
    expect(result.structuredContent.counts.relations).toBe(2);
    expect(result.content.some((block) => block.type === "image" || block.resource?.mimeType === "image/svg+xml")).toBe(true);
    expect(result.content.some((block) => block.resource?.mimeType === "text/html")).toBe(true);
  });

  it("returns none when target cannot be resolved", async () => {
    const client = fakeClient(sampleGraph);
    const result = await dependencyScopeTools(client).discovery_dependency_scope.handler({ target: "Jira" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ status: "none", target: "Jira" });
    expect(result.content[0].text).toContain("Rien trouvé pour Jira");
    expect(client.getNodeGraph).not.toHaveBeenCalled();
  });
});

describe("discovery_dependency_map", () => {
  it("returns ambiguous without rendering when target resolves to multiple objects", async () => {
    const client = fakeClient(sampleGraph);
    client.searchData = vi.fn().mockImplementation(async (query: string) => {
      if (query.includes("BusinessService")) return { rows: [{ "#id": "bs-1", name: "Jira", kind: "BusinessService" }] };
      if (query.includes("Host")) return { rows: [{ "#id": "host-1", name: "jira-host", kind: "Host" }] };
      return { rows: [] };
    });
    const result = await dependencyMapTools(client).discovery_dependency_map.handler({ target: "Jira", depth: 1, maxNodes: 60, iterations: 120, linLog: false, gravity: 1, scalingRatio: 10, layout: "concentric" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ status: "ambiguous" });
    expect(result.structuredContent.candidates).toHaveLength(2);
    expect(result.content[0].text).toContain("[id: bs-1]");
    expect(result.content[0].text).toContain("[id: host-1]");
    expect(result.content[0].text).toContain("targetKind=<kind>");
    expect(result.content[0].text).toContain("target=<id exact>");
    expect(result.content.some((block) => block.type === "image" || block.resource)).toBe(false);
    expect(client.getNodeGraph).not.toHaveBeenCalled();
  });

  it("follows reversed relationships when expanding the dependency map", async () => {
    const graph = {
      nodes: [
        { id: "0123456789abcdef0123456789abcdef0123456789abcdef01234567", kind: "Host", name: "PROD-WEB-01" },
        { id: "33333333333333333333333333333333333333333333333333333333", kind: "SoftwareInstance", name: "Jira Core" }
      ],
      relationships: [
        { src_id: "33333333333333333333333333333333333333333333333333333333", tgt_id: "0123456789abcdef0123456789abcdef0123456789abcdef01234567", kind: "HostedSoftware" }
      ]
    };
    const client = fakeClient(graph);
    const result = await dependencyMapTools(client).discovery_dependency_map.handler({ target: "0123456789abcdef0123456789abcdef0123456789abcdef01234567", depth: 1, maxNodes: 60, iterations: 120, linLog: false, gravity: 1, scalingRatio: 10, layout: "concentric" });
    const sc = (result as { structuredContent: { nodes: Array<{ id: string }>; edges: Array<{ from: string; to: string }> } }).structuredContent;
    expect(sc.nodes.map((node) => node.id)).toContain("33333333333333333333333333333333333333333333333333333333");
    expect(sc.edges).toContainEqual({ from: "33333333333333333333333333333333333333333333333333333333", to: "0123456789abcdef0123456789abcdef0123456789abcdef01234567", kind: "HostedSoftware" });
  }, 30000);

  it("returns image, svg resource, html resource, then text", async () => {
    const client = fakeClient(sampleGraph);
    const tools = dependencyMapTools(client);
    const result = await tools.discovery_dependency_map.handler({ target: "PROD-WEB-01", depth: 1, maxNodes: 60, iterations: 120, linLog: false, gravity: 1, scalingRatio: 10, layout: "concentric" });
    expect(result.content.some((block) => block.type === "image" || block.resource?.mimeType === "image/svg+xml")).toBe(true);
    // SVG resource is emitted by default (MCP_INCLUDE_SVG, opt-out).
    const svgResource = result.content.find((block) => block.resource?.mimeType === "image/svg+xml");
    expect(svgResource?.type).toBe("resource");
    const htmlResource = result.content.find((block) => block.resource?.mimeType === "text/html") as { type: "resource"; resource: { mimeType: string; text: string } };
    expect(htmlResource).toBeTruthy();
    expect(htmlResource.resource.mimeType).toBe("text/html");
    expect(result.content.some((block) => block.type === "text")).toBe(true);

    const html = htmlResource.resource.text.toLowerCase();
    expect(html).toContain("cytoscape");
    expect(html).not.toContain("unpkg.com");
    expect(html).not.toContain("jsdelivr");
    expect(html).not.toContain("cdnjs");
    expect(html).not.toContain("googleapis");

    const sc = (result as { structuredContent: { nodes: Array<{ x: number; y: number }> } }).structuredContent;
    expect(sc.nodes.length).toBeGreaterThan(0);
    sc.nodes.forEach((n) => { expect(Number.isFinite(n.x)).toBe(true); expect(Number.isFinite(n.y)).toBe(true); });
  }, 30000);

  it("force layout produces distinct finite coordinates", async () => {
    const graph = {
      nodes: Array.from({ length: 5 }, (_, i) => ({ id: `N${i}AAAAAAAAAAAAAAA`, kind: "SoftwareInstance", name: `n${i}` })),
      links: [
        { src_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", tgt_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", kind: "r" },
        { src_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", tgt_id: "cccccccccccccccccccccccccccccccccccccccccccccccccccc", kind: "r" },
        { src_id: "cccccccccccccccccccccccccccccccccccccccccccccccccccc", tgt_id: "dddddddddddddddddddddddddddddddddddddddddddddddddddd", kind: "r" },
        { src_id: "dddddddddddddddddddddddddddddddddddddddddddddddddddd", tgt_id: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", kind: "r" }
      ]
    };
    const client = fakeClient(graph, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    const result = await dependencyMapTools(client).discovery_dependency_map.handler({ target: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", depth: 1, maxNodes: 60, iterations: 120, linLog: false, gravity: 1, scalingRatio: 10, layout: "concentric" });
    const nodes = (result as { structuredContent: { nodes: Array<{ x: number; y: number }> } }).structuredContent.nodes;
    expect(nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
    const uniqueX = new Set(nodes.map((n) => n.x.toFixed(2)));
    expect(uniqueX.size).toBeGreaterThan(1);
  }, 30000);
});
