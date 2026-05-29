import { describe, expect, it, vi } from "vitest";
import { dependencyScopeTools } from "../src/tools/dependencyScope.js";
import { dependencyMapTools } from "../src/tools/dependencyMap.js";

function fakeClient(graph: Record<string, unknown>, hostName = "PROD-WEB-01") {
  return {
    findHosts: vi.fn().mockResolvedValue({ summary: "1 hôtes correspondants en base.", totalCount: 1, returnedCount: 1, rows: [{ id: "NODE_ID_FOCUS_AAAAAAAA", name: hostName }] }),
    getNodeGraph: vi.fn().mockResolvedValue(graph)
  } as never;
}

const sampleGraph = {
  nodes: [
    { id: "NODE_ID_FOCUS_AAAAAAAA", kind: "Host", name: "PROD-WEB-01", short_name: "PROD-WEB-01" },
    { id: "NODE_ID_SI_NGINX_BBBBB", kind: "SoftwareInstance", name: "nginx", short_name: "nginx" },
    { id: "NODE_ID_SI_NODE_CCCCCC", kind: "SoftwareInstance", name: "Node.js", short_name: "Node.js" }
  ],
  links: [
    { src_id: "NODE_ID_FOCUS_AAAAAAAA", tgt_id: "NODE_ID_SI_NGINX_BBBBB", kind: "HostedSoftware" },
    { src_id: "NODE_ID_FOCUS_AAAAAAAA", tgt_id: "NODE_ID_SI_NODE_CCCCCC", kind: "HostedSoftware" }
  ]
};

describe("discovery_dependency_scope", () => {
  it("resolves a host name and returns counts", async () => {
    const client = fakeClient(sampleGraph);
    const tools = dependencyScopeTools(client);
    const result = await tools.discovery_dependency_scope.handler({ target: "PROD-WEB-01" });
    expect(result.resolved.type).toBe("host_name");
    expect(result.resolved.id).toBe("NODE_ID_FOCUS_AAAAAAAA");
    expect(result.counts.nodes).toBe(3);
    expect(result.counts.relations).toBe(2);
  });
});

describe("discovery_dependency_map", () => {
  it("returns image, svg resource, html resource, then text", async () => {
    const client = fakeClient(sampleGraph);
    const tools = dependencyMapTools(client);
    const result = await tools.discovery_dependency_map.handler({ target: "PROD-WEB-01", depth: 1, maxNodes: 60, iterations: 120, linLog: false, gravity: 1, scalingRatio: 10 });
    expect(result.content).toHaveLength(4);
    expect(result.content[0].type).toBe("image");
    expect(result.content[1].type).toBe("resource");
    expect((result.content[1] as { type: "resource"; resource: { mimeType: string } }).resource.mimeType).toBe("image/svg+xml");
    expect(result.content[2].type).toBe("resource");
    const htmlResource = result.content[2] as { type: "resource"; resource: { mimeType: string; text: string } };
    expect(htmlResource.resource.mimeType).toBe("text/html");
    expect(result.content[3].type).toBe("text");

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
        { src_id: "N0AAAAAAAAAAAAAAA", tgt_id: "N1AAAAAAAAAAAAAAA", kind: "r" },
        { src_id: "N1AAAAAAAAAAAAAAA", tgt_id: "N2AAAAAAAAAAAAAAA", kind: "r" },
        { src_id: "N2AAAAAAAAAAAAAAA", tgt_id: "N3AAAAAAAAAAAAAAA", kind: "r" },
        { src_id: "N3AAAAAAAAAAAAAAA", tgt_id: "N4AAAAAAAAAAAAAAA", kind: "r" }
      ]
    };
    const client = fakeClient(graph, "N0AAAAAAAAAAAAAAA");
    client.findHosts = vi.fn().mockResolvedValue({ summary: "", totalCount: 1, returnedCount: 1, rows: [{ id: "N0AAAAAAAAAAAAAAA", name: "N0" }] });
    const result = await dependencyMapTools(client).discovery_dependency_map.handler({ target: "N0AAAAAAAAAAAAAAA", depth: 1, maxNodes: 60, iterations: 120, linLog: false, gravity: 1, scalingRatio: 10 });
    const nodes = (result as { structuredContent: { nodes: Array<{ x: number; y: number }> } }).structuredContent.nodes;
    expect(nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
    const uniqueX = new Set(nodes.map((n) => n.x.toFixed(2)));
    expect(uniqueX.size).toBeGreaterThan(1);
  }, 30000);
});
