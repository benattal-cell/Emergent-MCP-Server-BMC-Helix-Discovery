import { describe, expect, it } from "vitest";
import { findSchema } from "../src/tools/find.js";

describe("input validation", () => {
  it("accepts a bare kind and exposes no per-call limit param", () => {
    const parsed = findSchema.parse({ kind: "Host" });
    expect(parsed.kind).toBe("Host");
    expect("limit" in parsed).toBe(false);
  });

  it("rejects a malformed kind", () => {
    expect(() => findSchema.parse({ kind: "Host; drop table" })).toThrow();
  });
});
