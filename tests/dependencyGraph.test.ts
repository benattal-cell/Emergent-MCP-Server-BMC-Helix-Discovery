import { describe, expect, it, vi } from "vitest";
import { dependencyScopeTools } from "../src/tools/dependencyScope.js";
import { dependencyMapTools } from "../src/tools/dependencyMap.js";

function fakeClient(graph: Record<string, unknown>, hostName = "PROD-WEB-01") {
  return {
    findHosts: vi.fn().mockResolvedValue({
      summary: "1 hôtes correspondants en base.",
      totalCount: 1,
      returnedCount: 1,
      rows: [{ id: "NODE_ID_FOCUS_AAAAAAAA", name: hostName, os: "Linux", type: "Linux", key: "legacy-key" }]
    }),
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
    expect(result.nodeKinds.SoftwareInstance).toBe(2);
    expect(result.relationKinds.HostedSoftware).toBe(2);
    expect(result.counts.outbound).toBe(2);
  });
});

describe("discovery_dependency_map", () => {
  it("returns resource + text content blocks", async () => {
    const client = fakeClient(sampleGraph);
    const tools = dependencyMapTools(client);
    const result = await tools.discovery_dependency_map.handler({ target: "PROD-WEB-01", depth: 1, maxNodes: 60, engine: "dot" });
    const types = result.content.map((c) => c.type);
    expect(types).toContain("resource");
    expect(types).toContain("text");
  }, 30000);
});
