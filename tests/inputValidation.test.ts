import { describe, expect, it } from "vitest";
import { findSchema } from "../src/tools/find.js";

describe("input validation", () => {
  it("applies the default find limit", () => {
    const parsed = findSchema.parse({ kind: "Host" });
    expect(parsed.limit).toBe(50);
  });

  it("rejects a malformed kind", () => {
    expect(() => findSchema.parse({ kind: "Host; drop table" })).toThrow();
  });
});
