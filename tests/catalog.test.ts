import { describe, expect, it, vi } from "vitest";
import { loadCatalog, lookupByName, lookupByType, getCatalogDigest } from "../src/discovery/catalog.js";
import { assistantGuideTools } from "../src/tools/assistantGuide.js";

describe("Discovery catalog cache", () => {
  it("loads nominal objects and distinct SoftwareInstance types without storing instance names", async () => {
    const types = Array.from({ length: 582 }, (_, i) => ({ type: `Type-${i}` }));
    const searchData = vi.fn().mockImplementation(async (query: string) => {
      if (query === "SEARCH BusinessService SHOW name, kind, #id") {
        return { rows: [{ name: "Jira", kind: "BusinessService", "#id": "bs-1" }, { name: "Jira", kind: "BusinessService", "#id": "bs-duplicate" }] };
      }
      if (query === "SEARCH BusinessApplicationInstance SHOW name, kind, #id") {
        return { rows: [{ name: "Jira Production", kind: "BusinessApplicationInstance", "#id": "app-1" }] };
      }
      if (query === "SEARCH Host SHOW name, kind, #id") {
        return { rows: [{ name: "mcr-sqldb-38", kind: "Host", "#id": "host-1" }] };
      }
      if (query === "search SoftwareInstance show type processwith unique()") {
        return { rows: [{ type: "SQL Server" }, { value: "Oracle" }, { type: "SQL Server" }, ...types], totalCount: 585, returnedCount: 585 };
      }
      throw new Error(`unexpected query: ${query}`);
    });

    await loadCatalog({ searchData } as never);

    expect(searchData).toHaveBeenCalledWith("search SoftwareInstance show type processwith unique()", expect.objectContaining({
      omitOffset: true
    }));
    expect(lookupByName("jira")).toEqual([{ name: "Jira", kind: "BusinessService", id: "bs-1" }, { name: "Jira Production", kind: "BusinessApplicationInstance", id: "app-1" }]);
    expect(lookupByType("sql")).toEqual([{ type: "SQL Server" }]);
    expect(getCatalogDigest().softwareTypes.length).toBe(584);
    expect(getCatalogDigest()).toMatchObject({
      services: [{ name: "Jira" }],
      apps: [{ name: "Jira Production" }],
      hosts: [{ name: "mcr-sqldb-38" }],
      truncated: false
    });
  });

  it("marks SoftwareInstance type registry as truncated when unique query fails", async () => {
    const searchData = vi.fn().mockImplementation(async (query: string) => {
      if (query.includes("BusinessService") || query.includes("BusinessApplicationInstance") || query.includes("Host")) return { rows: [] };
      if (query === "search SoftwareInstance show type processwith unique()") throw new Error("software type query failed");
      throw new Error(`unexpected query: ${query}`);
    });

    await loadCatalog({ searchData } as never);

    expect(lookupByType("oracle")).toEqual([]);
    expect(getCatalogDigest()).toMatchObject({ softwareTypes: [], truncated: true });
  });

  it("injects the catalog digest into the assistant guide", async () => {
    const searchData = vi.fn().mockImplementation(async (query: string) => {
      if (query === "SEARCH BusinessService SHOW name, kind, #id") return { rows: [{ name: "Jira", "#id": "bs-1" }] };
      if (query.includes("BusinessApplicationInstance") || query.includes("Host")) return { rows: [] };
      if (query === "search SoftwareInstance show type processwith unique()") return { rows: [{ type: "SQL Server" }] };
      throw new Error(`unexpected query: ${query}`);
    });
    await loadCatalog({ searchData } as never);

    const result = await assistantGuideTools().discovery_tool_guide.handler({ request: "architecture Jira SQL", maxUseCases: 2, language: "fr" });

    expect(result.catalogDigest).toMatchObject({ services: [{ name: "Jira" }], softwareTypes: [{ type: "SQL Server" }], truncated: false });
    expect(result.guidance).toContain("Catalogue Discovery connu");
    expect(result.guidance).toContain("Jira");
    expect(result.guidance).toContain("SQL Server");
    expect(result.globalRules.some((rule: string) => rule.startsWith("R-A1"))).toBe(true);
    expect(result.globalRules.some((rule: string) => rule.startsWith("R-A4"))).toBe(true);
  });
});
