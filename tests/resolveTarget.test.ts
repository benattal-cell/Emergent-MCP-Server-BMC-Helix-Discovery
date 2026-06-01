import { describe, expect, it, vi } from "vitest";
import { loadCatalog } from "../src/discovery/catalog.js";
import { looksLikeNodeId, resolveTarget } from "../src/discovery/resolveTarget.js";

describe("resolveTarget", () => {
  it("detects node ids without querying Discovery", async () => {
    const client = { searchData: vi.fn() } as never;
    expect(looksLikeNodeId("0123456789abcdef0123456789abcdef0123456789abcdef01234567")).toBe(true);
    expect(looksLikeNodeId("ZbloutchMachinTruc42")).toBe(false);
    await expect(resolveTarget(client, "0123456789abcdef0123456789abcdef0123456789abcdef01234567")).resolves.toEqual({ status: "node_id", id: "0123456789abcdef0123456789abcdef0123456789abcdef01234567" });
    expect((client as { searchData: ReturnType<typeof vi.fn> }).searchData).not.toHaveBeenCalled();
  });

  it("returns unique candidates from the nominal cache", async () => {
    const searchData = vi.fn().mockImplementation(async (query: string) => {
      if (query === "SEARCH BusinessService SHOW name, kind, #id") return { rows: [{ name: "Jira", kind: "BusinessService", "#id": "bs-1" }] };
      if (query.includes("BusinessApplicationInstance") || query.includes("Host")) return { rows: [] };
      if (query === "search SoftwareInstance show type processwith unique()") return { rows: [] };
      throw new Error(`unexpected query: ${query}`);
    });
    await loadCatalog({ searchData } as never);

    const runtime = { searchData: vi.fn() } as never;
    await expect(resolveTarget(runtime, "Jira")).resolves.toEqual({ status: "unique", id: "bs-1", name: "Jira", kind: "BusinessService" });
  });

  it("returns none when cache and live lookup have no candidates", async () => {
    await loadCatalog({ searchData: vi.fn().mockResolvedValue({ rows: [] }) } as never);
    const client = { searchData: vi.fn().mockResolvedValue({ rows: [] }), getNodeGraph: vi.fn() } as never;

    await expect(resolveTarget(client, "Missing")).resolves.toEqual({ status: "none", target: "Missing" });
    expect((client as { getNodeGraph: ReturnType<typeof vi.fn> }).getNodeGraph).not.toHaveBeenCalled();
  });

  it("returns ambiguous when live lookup finds several candidates", async () => {
    await loadCatalog({ searchData: vi.fn().mockResolvedValue({ rows: [] }) } as never);
    const client = {
      searchData: vi.fn().mockImplementation(async (query: string) => {
        if (query.includes("BusinessService")) return { rows: [{ name: "Jira Service", kind: "BusinessService", "#id": "bs-1" }] };
        if (query.includes("Host")) return { rows: [{ name: "jira-host", kind: "Host", "#id": "host-1" }] };
        return { rows: [] };
      })
    } as never;

    const result = await resolveTarget(client, "Jira");
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") expect(result.candidates).toHaveLength(2);
  });
});
