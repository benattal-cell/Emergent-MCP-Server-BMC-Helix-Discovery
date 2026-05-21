import { describe, expect, it } from "vitest";
import { findHostsSchema } from "../src/tools/hosts.js";
import { queryJsonSchema, rawGetSchema } from "../src/tools/query.js";

describe("input validation", () => {
  it("enforces query limit max", () => {
    expect(() => queryJsonSchema.parse({ query: [], limit: 501 })).toThrow();
  });

  it("rejects invalid raw_get external URL", () => {
    expect(() => rawGetSchema.parse({ path: "https://evil.com/api/about" })).toThrow();
  });

  it("supports default host limit", () => {
    const parsed = findHostsSchema.parse({ nameContains: "linux" });
    expect(parsed.limit).toBe(50);
  });
});
