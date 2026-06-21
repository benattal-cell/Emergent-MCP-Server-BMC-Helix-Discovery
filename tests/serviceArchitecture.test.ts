import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadCatalog } from "../src/discovery/catalog.js";
import { buildServiceArchitectureHtml, buildServiceArchitectureSvg } from "../src/svg/serviceArchitectureHtml.js";
import { serviceArchitectureTools } from "../src/tools/serviceArchitecture.js";
import { serviceArchitectureOutputSchema } from "../src/tools/outputSchemas.js";

beforeEach(async () => {
  await loadCatalog({ searchData: vi.fn().mockResolvedValue({ rows: [] }) } as never);
});

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
    expect(html).toContain("scaleExtent([0.05,12])");
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
  it("resolves a BusinessService by name and returns a service-only dependency tree", async () => {
    const rows = [
      { name: "Apex-Watches.com (AWS)", id: "r", depends_on: ["Apex-CRM (VMware On-prem)", "Apex-Luxury.com", "Apex-Fitness.com"] },
      { name: "Apex-CRM (VMware On-prem)", id: "crm", depends_on: ["Core-Infrastructure", "Core-Networks", "Core-Storage"] },
      { name: "Apex-Luxury.com", id: "lux", depends_on: null },
      { name: "Apex-Fitness.com", id: "fit", depends_on: null },
      { name: "Core-Infrastructure", id: "ci", depends_on: null },
      { name: "Core-Networks", id: "cn", depends_on: null },
      { name: "Core-Storage", id: "cs", depends_on: null }
    ];
    const client = {
      searchData: vi.fn().mockImplementation(async (query: string) => {
        if (query.includes('WHERE #id = "r"')) return { rows };
        if (query.includes("SEARCH BusinessService")) return { rows: [{ name: "Apex-Watches.com (AWS)", kind: "BusinessService", "#id": "r" }] };
        return { rows: [] };
      }),
      getNodeGraph: vi.fn()
    } as never;

    const result = await serviceArchitectureTools(client).discovery_service_architecture.handler({
      serviceName: "Apex-Watches.com",
      depth: 3,
      title: "Apex service architecture",
      kindFilter: ["SoftwareInstance"],
      maxNodes: 10
    });

    expect(client.searchData).toHaveBeenCalledWith(
      'SEARCH BusinessService WHERE name HAS SUBWORD "Apex-Watches.com" SHOW name, kind, #id',
      { entityLabel: "resolver:BusinessService", appliedFilters: { target: "Apex-Watches.com", kind: "BusinessService" }, maxRows: 1000, pageSize: 250 }
    );
    expect(client.searchData).toHaveBeenCalledWith(
      `SEARCH BusinessService WHERE #id = "r"
  EXPAND Dependant:Dependency:DependedUpon:BusinessService
  SHOW name, #id AS id,
       #Dependant:Dependency:DependedUpon:BusinessService.name AS depends_on`,
      { entityLabel: "service_arch:closure", appliedFilters: { rootId: "r" }, maxRows: 1000, pageSize: 250 }
    );
    expect(client.getNodeGraph).not.toHaveBeenCalled();
    expect(result.structuredContent).toMatchObject({ count: 1, summary: '1 service(s) résolu(s) pour "Apex-Watches.com".' });
    expect(result.structuredContent.diagrams).toHaveLength(1);
    expect(() => serviceArchitectureOutputSchema.parse(result.structuredContent)).not.toThrow();

    const diagram = result.structuredContent.diagrams[0];
    expect(diagram).toMatchObject({
      root: { id: "r", name: "Apex-Watches.com (AWS)" },
      summary: "Apex-Watches.com (AWS): 7 nœuds, 3 niveaux",
      truncated: false,
      crossLinks: []
    });
    expect(diagram.nodes).toHaveLength(7);
    expect(new Set(diagram.nodes.map((node: { id: string }) => node.id)).size).toBe(7);
    expect(diagram.edges).toHaveLength(6);

    const distances = new Map<string, number>([["r", 0]]);
    for (const edge of diagram.edges as Array<{ from: string; to: string }>) {
      distances.set(edge.to, (distances.get(edge.from) ?? 0) + 1);
    }
    expect(Math.max(...distances.values())).toBe(2);

    const htmlResource = result.content.find((block: { resource?: { mimeType?: string } }) => block.resource?.mimeType === "text/html");
    const textBlock = result.content.find((block: { type?: string; text?: string }) => block.type === "text");
    expect(htmlResource?.resource.text).toContain("Apex service architecture");
    expect(htmlResource?.resource.text).toContain("Core-Storage");
    expect(textBlock?.text).toContain("Apex-Watches.com (AWS): 7 nœuds, 3 niveaux");
  });

  it("keeps the first parent in the rendered tree and exposes extra parents as crossLinks", async () => {
    const rows = [
      { name: "Root Service", id: "r", depends_on: ["Parent A", "Parent B"] },
      { name: "Parent A", id: "a", depends_on: ["Core-Storage"] },
      { name: "Parent B", id: "b", depends_on: ["Core-Storage"] },
      { name: "Core-Storage", id: "cs", depends_on: null }
    ];
    const client = {
      searchData: vi.fn().mockImplementation(async (query: string) => {
        if (query.includes('WHERE #id = "r"')) return { rows };
        if (query.includes("SEARCH BusinessService")) return { rows: [{ name: "Root Service", kind: "BusinessService", "#id": "r" }] };
        return { rows: [] };
      }),
      getNodeGraph: vi.fn()
    } as never;

    const result = await serviceArchitectureTools(client).discovery_service_architecture.handler({ serviceName: "Root", depth: 3 });
    const diagram = result.structuredContent.diagrams[0];

    expect(diagram.nodes).toHaveLength(4);
    expect(diagram.edges).toEqual(expect.arrayContaining([
      { from: "r", to: "a", kind: "Dependency" },
      { from: "r", to: "b", kind: "Dependency" },
      { from: "a", to: "cs", kind: "Dependency" }
    ]));
    expect(diagram.edges).not.toContainEqual({ from: "b", to: "cs", kind: "Dependency" });
    expect(diagram.crossLinks).toEqual([{ from: "b", to: "cs", kind: "Dependency" }]);
    expect(client.getNodeGraph).not.toHaveBeenCalled();
  });

  it("falls back to BusinessApplicationInstance and returns a clear error when no service matches", async () => {
    const client = {
      searchData: vi.fn().mockResolvedValue({ rows: [] }),
      getNodeGraph: vi.fn()
    } as never;

    const result = await serviceArchitectureTools(client).discovery_service_architecture.handler({ serviceName: "Missing" });

    // resolveTarget queries 5 kinds by name (BusinessService, BusinessApplicationInstance, Host, NetworkDevice, Database) + SoftwareInstance by type.
    expect(client.searchData).toHaveBeenCalledTimes(6);
    expect(result).toMatchObject({ isError: true, structuredContent: { status: "none", target: "Missing" } });
    expect(result.content[0]).toEqual({ type: "text", text: "Rien trouvé pour Missing." });
    expect(client.getNodeGraph).not.toHaveBeenCalled();
  });

  it("redirects non-BusinessService targets to the dependency map without rendering a tree", async () => {
    const client = {
      searchData: vi.fn().mockImplementation(async (query: string) => {
        if (query.includes("SEARCH Host")) return { rows: [{ name: "jira-host", kind: "Host", "#id": "host-1" }] };
        return { rows: [] };
      }),
      getNodeGraph: vi.fn()
    } as never;

    const result = await serviceArchitectureTools(client).discovery_service_architecture.handler({ serviceName: "jira-host", targetKind: "Host" });

    expect(result).toMatchObject({
      isError: false,
      structuredContent: { status: "redirect", recommendedTool: "discovery_dependency_map", layout: "hierarchical" }
    });
    expect(result.content[0].text).toContain("réservée aux BusinessService");
    expect(result.content[0].text).toContain("discovery_dependency_map");
    expect(result.content.some((block: { type?: string; resource?: unknown }) => block.type === "image" || block.resource)).toBe(false);
    expect(client.getNodeGraph).not.toHaveBeenCalled();
  });

  it("returns ambiguous without rendering when several objects match", async () => {
    const client = {
      searchData: vi.fn().mockImplementation(async (query: string) => {
        if (query.includes("BusinessService")) return { rows: [{ name: "Jira", kind: "BusinessService", "#id": "bs-1" }] };
        if (query.includes("Host")) return { rows: [{ name: "jira-host", kind: "Host", "#id": "host-1" }] };
        return { rows: [] };
      }),
      getNodeGraph: vi.fn()
    } as never;

    const result = await serviceArchitectureTools(client).discovery_service_architecture.handler({ serviceName: "Jira" });

    expect(result).toMatchObject({ isError: true, structuredContent: { status: "ambiguous" } });
    expect(result.structuredContent.candidates).toHaveLength(2);
    expect(result.content.some((block: { type?: string; resource?: unknown }) => block.type === "image" || block.resource)).toBe(false);
    expect(client.getNodeGraph).not.toHaveBeenCalled();
  });
});
