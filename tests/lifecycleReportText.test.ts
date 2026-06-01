import { describe, expect, it, vi } from "vitest";
import { lifecycleTools } from "../src/tools/lifecycle.js";

describe("discovery_lifecycle_report text summary", () => {
  it("includes the headline summary and markdown rows table", async () => {
    const rows = [
      { name: "Oracle", lifecycle_risk: "EOS Exceeded" },
      { name: "SQL Server", lifecycle_risk: "EOSS Exceeded" }
    ];
    const client = {
      queryJson: vi.fn().mockResolvedValue({ summary: "2 logiciels à risque", totalCount: 2, returnedCount: 2, rows })
    };

    const result = await lifecycleTools(client as never).discovery_lifecycle_report.handler({
      limit: 100,
      riskWindowDays: 182,
      onlyAtRisk: true
    });
    const text = result.content.find((block) => block.type === "text")?.text ?? "";

    expect(text).toContain("2 logiciels à risque");
    expect(text).toContain("| name | lifecycle_risk |");
    expect(text).toContain("| Oracle | EOS Exceeded |");
    expect(text).toContain("| SQL Server | EOSS Exceeded |");
  });
});
