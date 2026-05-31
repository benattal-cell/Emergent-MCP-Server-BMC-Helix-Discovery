import { describe, expect, it, vi } from "vitest";
import { loadCatalog } from "../src/discovery/catalog.js";
import { looksLikeNodeId, resolveTarget } from "../src/discovery/resolveTarget.js";

describe("resolveTarget", () => {
  it("detects node ids without querying Discovery", async () => {
    const client = { searchData: vi.fn() } as never;
    expect(looksLikeNodeId("NODE_ID_FOCUS_AAAAAAAA")).toBe(true);
    await expect(resolveTarget(client, "NODE_ID_FOCUS_AAAAAAAA")).resolves.toEqual({ status: "node_id", id: "NODE_ID_FOCUS_AAAAAAAA" });
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
    const client = { searchData: vi.fn().mockResolvedValue({ rows: [] }) } as never;

    await expect(resolveTarget(client, "Missing")).resolves.toEqual({ status: "none", target: "Missing" });
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
