import { describe, expect, it } from "vitest";
import { deriveHostRole } from "../src/tools/hostRole.js";

describe("deriveHostRole", () => {
  it("derives Database Server from SQL Server software", () => {
    const result = deriveHostRole(["Microsoft SQL Server 2019", "Control-M Agent"]);
    expect(result.role).toBe("Database Server");
    expect(result.matched).toContain("Microsoft SQL Server 2019");
  });

  it("falls back to Generic Host when no software type matches", () => {
    const result = deriveHostRole(["Custom internal worker"]);
    expect(result.role).toBe("Generic Host");
    expect(result.matched).toEqual([]);
  });
});
