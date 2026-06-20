import { describe, expect, it } from "vitest";
import { findHostsSchema } from "../src/tools/hosts.js";

describe("input validation", () => {
  it("supports default host limit", () => {
    const parsed = findHostsSchema.parse({ nameContains: "linux" });
    expect(parsed.limit).toBe(50);
  });
});
