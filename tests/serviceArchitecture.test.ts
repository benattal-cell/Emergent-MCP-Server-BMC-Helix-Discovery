import { describe, expect, it, vi } from "vitest";
import { buildServiceArchitectureHtml, buildServiceArchitectureSvg } from "../src/svg/serviceArchitectureHtml.js";
import { serviceArchitectureTools } from "../src/tools/serviceArchitecture.js";
import { serviceArchitectureOutputSchema } from "../src/tools/outputSchemas.js";

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
    expect(html).toContain('id="static-graph"');
    expect(html).toContain('<svg id="chart" viewBox="0 0 ');
    expect(html).toContain("shared_copy_1");
    expect(html).toContain("duplicated from");
    expect(html).toContain("D3 bundle unavailable or scripts disabled; showing the server-rendered static architecture diagram.");
    expect(html).toContain("d3.tree()");
    expect(html).toContain("linkVertical");
    expect(html).toContain("append('rect')");
    expect(html).toContain('["Type",d.data.type]');
    expect(html).toContain('["Port",d.data.port]');
    expect(html).toContain('["Vendor",d.data.publisher]');
    expect(html.toLowerCase()).not.toContain("unpkg.com");
    expect(html.toLowerCase()).not.toContain("jsdelivr");
  });

  it("builds a standalone static SVG for native MCP visual resources", () => {
    const svg = buildServiceArchitectureSvg(
      [
        { id: "root", kind: "BusinessApplication", name: "Billing" },
        { id: "a", kind: "SoftwareInstance", name: "API" }
      ],
      [{ from: "root", to: "a", kind: "Contains" }],
      "root",
      "Billing architecture"
    );

    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('id="static-graph"');
    expect(svg).toContain("Billing architecture");
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
    expect(Array.isArray(result.content)).toBe(true);
    expect(Array.isArray(result.structuredContent)).toBe(false);
    expect(result.structuredContent).toMatchObject({ count: 2, summary: '2 service(s) résolu(s) pour "Jira".' });
    expect(result.structuredContent.diagrams).toHaveLength(2);
    expect(() => serviceArchitectureOutputSchema.parse(result.structuredContent)).not.toThrow();
    expect(result.structuredContent.diagrams[0]).toMatchObject({
      root: { id: "root-1", name: "Jira Production" },
      summary: "Jira Production: 2 nœuds, 2 niveaux"
    });
    const svgResource = result.content.find((block: { resource?: { mimeType?: string } }) => block.resource?.mimeType === "image/svg+xml");
    const htmlResource = result.content.find((block: { resource?: { mimeType?: string } }) => block.resource?.mimeType === "text/html");
    const textBlock = result.content.find((block: { type?: string; text?: string }) => block.type === "text");
    expect(svgResource?.resource.text).toContain("Jira architecture");
    expect(svgResource?.resource.text).toContain('id="static-graph"');
    expect(htmlResource?.resource.text).toContain("Jira architecture");
    expect(htmlResource?.resource.text).toContain("80, 443");
    expect(htmlResource?.resource.text).toContain("NGINX");
    expect(htmlResource?.resource.text).not.toContain("ignored-db");
    expect(textBlock?.text).toContain("Jira Production: 2 nœuds, 2 niveaux");
  });

  it("falls back to BusinessApplicationInstance and returns a clear error when no service matches", async () => {
    const client = {
      searchData: vi.fn().mockResolvedValue({ rows: [] }),
      getNodeGraph: vi.fn()
    } as never;

    const result = await serviceArchitectureTools(client).discovery_service_architecture.handler({ serviceName: "Missing" });

    expect(client.searchData).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ isError: true });
    expect(result.content[0]).toEqual({ type: "text", text: 'Aucun BusinessService ou BusinessApplicationInstance trouvé pour le nom "Missing".' });
  });
});
