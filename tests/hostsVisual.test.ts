import { describe, expect, it, vi } from "vitest";
import { hostTools } from "../src/tools/hosts.js";

describe("discovery_find_host_software visual handler", () => {
  it("deduplicates host software and returns visual content plus structuredContent", async () => {
    const client = {
      findHostSoftware: vi.fn().mockResolvedValue({
        summary: "3 software rows found.",
        totalCount: 3,
        returnedCount: 3,
        rows: [
          { type: "Microsoft SQL Server", name: "SQL Server", instance: "MSSQLSERVER", product_version: "2019", "#:::Host.key": "H1" },
          { type: "Microsoft SQL Server", name: "SQL Server", instance: "MSSQLSERVER", product_version: "2019", "#:::Host.key": "H1" },
          { type: "Control-M Agent", name: "Control-M", instance: "agent", product_version: "9", "#:::Host.key": "H1" }
        ]
      })
    } as never;

    const result = await hostTools(client).discovery_find_host_software.handler({ hostNameContains: "db01", limit: 50 });
    expect(result.structuredContent.deduplicatedCount).toBe(2);
    expect(result.structuredContent.hostRole.role).toBe("Database Server");
    expect(result.content.some((block) => block.type === "image" || block.resource?.mimeType === "image/svg+xml")).toBe(true);
    expect(result.structuredContent.rows).toHaveLength(2);
  });
});
