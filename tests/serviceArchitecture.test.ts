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
    expect(html).toContain("linkVertical");
    expect(html).toContain("append('rect')");
    expect(html).toContain('["Type",d.data.type]');
    expect(html).toContain('["Port",d.data.port]');
    expect(html).toContain('["Vendor",d.data.publisher]');
    expect(html.toLowerCase()).not.toContain("unpkg.com");
    expect(html.toLowerCase()).not.toContain("jsdelivr");
  });
});

describe("discovery_service_architecture", () => {
  it("resolves services by name and returns one diagram per match", async () => {
    const client = {
      searchData: vi.fn().mockResolvedValue({
        rows: [
          { name: "Jira Production", "#id": "root-1" },
          { name: "Jira Test", "#id": "root-2" }
        ]
      }),
      getNodeGraph: vi.fn().mockImplementation(async (id: string) => id.endsWith("-si") ? { nodes: [], links: [] } : ({
        nodes: [
          { id, kind: "BusinessService", name: id === "root-1" ? "Jira Production" : "Jira Test" },
          { id: `${id}-si`, kind: "SoftwareInstance", name: "nginx", type: "Web Server", listening_ports: [80, 443], vendor: "NGINX" },
          { id: `${id}-ignored`, kind: "Database", name: "ignored-db" }
        ],
        links: [
          { src_id: id, tgt_id: `${id}-si`, kind: "HostedSoftware" },
          { src_id: id, tgt_id: `${id}-ignored`, kind: "Detail" }
        ]
      }))
    } as never;

    const result = await serviceArchitectureTools(client).discovery_service_architecture.handler({
      serviceName: "Jira",
      depth: 1,
      title: "Jira architecture",
      kindFilter: ["BusinessService", "SoftwareInstance"],
      maxNodes: 10
    });

    expect(client.searchData).toHaveBeenCalledWith(
      'SEARCH BusinessService WHERE name HAS SUBWORD "Jira" SHOW name, #id',
      { entityLabel: "services", appliedFilters: { serviceName: "Jira" } }
    );
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ summary: "2 nœuds, 2 niveaux", name: "Jira Production" });
    expect(result[0].html).toContain("Jira architecture");
    expect(result[0].html).toContain("80, 443");
    expect(result[0].html).toContain("NGINX");
    expect(result[0].html).not.toContain("ignored-db");
  });

  it("falls back to BusinessApplicationInstance and returns a clear error when no service matches", async () => {
    const client = {
      searchData: vi.fn().mockResolvedValue({ rows: [] }),
      getNodeGraph: vi.fn()
    } as never;

    const result = await serviceArchitectureTools(client).discovery_service_architecture.handler({ serviceName: "Missing" });

    expect(client.searchData).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ error: 'Aucun BusinessService ou BusinessApplicationInstance trouvé pour le nom "Missing".' });
  });
});
