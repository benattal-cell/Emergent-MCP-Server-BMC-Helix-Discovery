import { beforeEach, describe, expect, it, vi } from "vitest";
import { DiscoveryClient } from "../src/discoveryClient.js";

const config = {
  baseUrl: "https://example.test",
  apiVersion: "v1.18",
  token: "secret",
  verifyTls: true,
  timeoutMs: 1000
};

describe("DiscoveryClient", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("calls about without auth", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "{}" }));
    const client = new DiscoveryClient(config);
    await client.getAbout();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("normalizes http errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "{}" }));
    const client = new DiscoveryClient(config);
    await expect(client.request("GET", "/api/v1.18/test", undefined, true)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("does not add a default limit to raw search requests", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ results: [] }) }));
    const client = new DiscoveryClient(config);

    await client.searchData("SEARCH Host WHERE name HAS SUBWORD \"prod\" SHOW name");

    const url = String((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]);
    expect(url).toContain("/api/v1.18/data/search?");
    expect(url).toContain("format=object");
    expect(url).not.toContain("limit=");
  });

  it("can intentionally omit offset for single-page aggregate queries", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ results: [] }) }));
    const client = new DiscoveryClient(config);

    await client.searchData("search SoftwareInstance show type processwith unique()", { limit: 20000, omitOffset: true });

    const url = String((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]);
    expect(url).toContain("limit=20000");
    expect(url).not.toContain("offset=");
  });

  it("can page raw search requests beyond 100 rows when maxRows is requested", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      const offset = Number(parsed.searchParams.get("offset") || 0);
      const limit = Number(parsed.searchParams.get("limit") || 100);
      const rows = Array.from({ length: Math.max(0, Math.min(limit, 125 - offset)) }, (_, i) => [`row-${offset + i}`]);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ items: [{ kind: "SoftwareInstance", count: 125, headings: ["type"], results: rows }] })
      };
    }));
    const client = new DiscoveryClient(config);

    const result = await client.searchData("search SoftwareInstance show type processwith unique()", { maxRows: 200, pageSize: 60 });

    expect(result.returnedCount).toBe(125);
    expect(result.rows).toHaveLength(125);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(String((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0])).toContain("limit=60");
  });

  it("applies the server result-limit policy to normal searches", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ results: [] }) }));
    const client = new DiscoveryClient({ ...config, resultLimit: 25 } as never);

    await client.searchData("SEARCH Host SHOW name");

    const url = String((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]);
    expect(url).toContain("limit=25");
  });

  it("honors an explicit limit=0 (count-only) even with no result-limit policy", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ items: [{ count: 42, headings: ["name"], results: [] }] }) }));
    const client = new DiscoveryClient(config);

    const result = await client.searchData("SEARCH Host SHOW name", { limit: 0 });

    const url = String((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]);
    expect(url).toContain("limit=0");
    expect(result.totalCount).toBe(42);
    expect(result.returnedCount).toBe(0);
  });

  it("exposes pagination (offset/hasMore/nextOffset) when the policy caps a page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ items: [{ count: 30, headings: ["name"], results: Array.from({ length: 10 }, (_, i) => [`row-${i}`]) }] }) }));
    const client = new DiscoveryClient({ ...config, resultLimit: 10 } as never);

    const result = await client.searchData("SEARCH Host SHOW name", { offset: 0 });

    const url = String((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]);
    expect(url).toContain("limit=10");
    expect(url).toContain("offset=0");
    expect(result.offset).toBe(0);
    expect(result.hasMore).toBe(true);
    expect(result.nextOffset).toBe(10);
  });

});
