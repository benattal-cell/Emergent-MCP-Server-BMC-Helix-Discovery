import { describe, expect, it, vi } from "vitest";
import { buildServiceArchitectureHtml } from "../src/svg/serviceArchitectureHtml.js";
import { serviceArchitectureTools } from "../src/tools/serviceArchitecture.js";

describe("buildServiceArchitectureHtml", () => {
  it("builds a self-contained D3 architecture document and marks duplicated nodes", () => {
    const html = buildServiceArchitectureHtml(
      [
        { id: "root", kind: "BusinessApplication", name: "Billing" },
        { id: "a", kind: "SoftwareInstance", name: "API", type: "Tomcat", port: "8443", publisher: "Apache" },
        { id: "b", kind: "Database", name: "DB" },
        { id: "shared", kind: "Host", name: "shared-host" }
      ],
      [
        { from: "root", to: "a", kind: "Contains" },
        { from: "root", to: "b", kind: "Contains" },
        { from: "a", to: "shared", kind: "RunsOn" },
        { from: "b", to: "shared", kind: "RunsOn" }
      ],
      "root",
      "Billing architecture"
    );

    expect(html).toContain("Billing architecture");
    expect(html).toContain("shared_copy_1");
    expect(html).toContain("duplicated from");
    expect(html).toContain("d3.tree()");
    expect(html.toLowerCase()).not.toContain("unpkg.com");
    expect(html.toLowerCase()).not.toContain("jsdelivr");
  });
});

describe("discovery_service_architecture", () => {
  it("collects graph nodes and returns summary plus html", async () => {
    const client = {
      getNodeGraph: vi.fn().mockResolvedValue({
        nodes: [
          { id: "root", kind: "Host", name: "app01" },
          { id: "si", kind: "SoftwareInstance", name: "nginx", type: "Web Server", listening_ports: [80, 443], vendor: "NGINX" }
        ],
        links: [{ src_id: "root", tgt_id: "si", kind: "HostedSoftware" }]
      })
    } as never;

    const result = await serviceArchitectureTools(client).discovery_service_architecture.handler({ rootId: "root", depth: 1, title: "App01" });

    expect(result.summary).toContain("2 nœuds");
    expect(result.html).toContain("App01");
    expect(result.html).toContain("80, 443");
    expect(result.html).toContain("NGINX");
  });
});
