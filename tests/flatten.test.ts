import { describe, expect, it } from "vitest";
import { flattenDiscoveryQueryResult, paginationSuffix } from "../src/utils/flatten.js";

describe("flattenDiscoveryQueryResult", () => {
  it("parses array-root object format (real BMC response)", () => {
    const raw = [{
      kind: "Host",
      count: 1,
      offset: 0,
      headings: ["name", "hostname", "os", "key"],
      results: [["mcr-bcoapqa-01", "mcr-bcoapqa-01", "RHEL 7.3", "XUDt..."]]
    }];
    const r = flattenDiscoveryQueryResult(raw, { entityLabel: "hôtes", format: "object" });
    expect(r.totalCount).toBe(1);
    expect(r.returnedCount).toBe(1);
    expect(r.rows[0]).toMatchObject({ name: "mcr-bcoapqa-01", os: "RHEL 7.3" });
  });

  it("still parses object-with-items envelope (backward compat)", () => {
    const raw = { count: 1, limit: 50, items: [{ kind: "Host", count: 1, headings: ["name"], results: [["x"]] }] };
    const r = flattenDiscoveryQueryResult(raw, { format: "object" });
    expect(r.totalCount).toBe(1);
    expect(r.rows[0]).toMatchObject({ name: "x" });
  });

  it("handles tree format by keeping nodes as-is", () => {
    const raw = [{
      kind: "Host",
      count: 1,
      headings: ["name"],
      results: [{ name: "root", children: [{ name: "child" }] }]
    }];
    const r = flattenDiscoveryQueryResult(raw, { format: "tree" });
    expect(r.rows[0]).toMatchObject({ name: "root" });
    expect(r.summary).toContain("[format=tree");
  });

  it("returns clean 0-result without crashing", () => {
    expect(flattenDiscoveryQueryResult([]).totalCount).toBe(0);
    expect(flattenDiscoveryQueryResult({}).totalCount).toBe(0);
    expect(flattenDiscoveryQueryResult([]).summary).toContain("vide ou format inattendu");
  });

  it("paginationSuffix gives an actionable next-page hint only when more rows exist", () => {
    expect(paginationSuffix({ hasMore: true, nextOffset: 500, offset: 0 })).toContain("offset=500");
    expect(paginationSuffix({ hasMore: false })).toBe("");
    expect(paginationSuffix({ hasMore: true })).toBe(""); // no nextOffset -> nothing to suggest
  });
});
