import { describe, expect, it, vi } from "vitest";
import { findTools, buildFindQuery } from "../src/tools/find.js";

describe("discovery_find", () => {
  it("builds a generic search with a relationship scope", () => {
    const query = buildFindQuery({ kind: "SoftwareInstance", relatedToKind: "Host", relatedToName: "db01", limit: 50 } as never);
    expect(query).toContain("search SoftwareInstance where");
    expect(query).toContain('#:::Host.name has subword "db01"');
  });

  it("matches a free term across all attributes via the wildcard", () => {
    const query = buildFindQuery({ kind: "Host", contains: "Windows 2019", limit: 50 } as never);
    expect(query).toBe('search Host where * has subword "Windows 2019"');
  });

  it("derives the host role and returns visual content when listing a host's software", async () => {
    const client = {
      getTaxonomyNodeKinds: vi.fn().mockResolvedValue(["Host", "SoftwareInstance"]),
      queryJson: vi.fn().mockResolvedValue({
        summary: "2 software found.",
        totalCount: 2,
        returnedCount: 2,
        rows: [
          { type: "Microsoft SQL Server", name: "SQL", instance: "MSSQLSERVER", product_version: "2019" },
          { type: "Control-M Agent", name: "Control-M", instance: "agent", product_version: "9" }
        ]
      })
    } as never;

    const result = await findTools(client).discovery_find.handler({ kind: "SoftwareInstance", relatedToKind: "Host", relatedToName: "db01", limit: 50 });
    expect(result.structuredContent.hostRole.role).toBe("Database Server");
    expect(result.content.some((block) => block.type === "image" || block.resource?.mimeType === "image/svg+xml")).toBe(true);
  });

  it("rejects an unknown kind with suggestions and does not query", async () => {
    const client = {
      getTaxonomyNodeKinds: vi.fn().mockResolvedValue(["Host", "SoftwareInstance"]),
      queryJson: vi.fn()
    } as never;

    const result = await findTools(client).discovery_find.handler({ kind: "Hostt", limit: 50 });
    expect(result.unknownKind).toBe("Hostt");
    expect(client.queryJson).not.toHaveBeenCalled();
  });
});
