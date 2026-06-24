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

  it("makes a single request with no limit param when none is given (API's natural cap governs)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ items: [{ kind: "Host", count: 5, headings: ["name"], results: Array.from({ length: 5 }, (_, i) => [`h${i}`]) }] }) }));
    const client = new DiscoveryClient(config);

    const result = await client.searchData("SEARCH Host WHERE name HAS SUBWORD \"prod\" SHOW name");

    expect(fetch).toHaveBeenCalledOnce();
    const url = String((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]);
    expect(url).toContain("/api/v1.18/data/search?");
    expect(url).toContain("format=object");
    expect(url).toContain("offset=0");
    expect(url).not.toContain("limit=");
    expect(result.returnedCount).toBe(5);
    expect(result.hasMore).toBe(false);
  });

  it("can intentionally omit offset for single-page aggregate queries", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ results: [] }) }));
    const client = new DiscoveryClient(config);

    await client.searchData("search SoftwareInstance show type processwith unique()", { omitOffset: true });

    const url = String((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]);
    expect(url).not.toContain("offset=");
  });

  it("honors an explicit limit=0 (count-only)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ items: [{ count: 42, headings: ["name"], results: [] }] }) }));
    const client = new DiscoveryClient(config);

    const result = await client.searchData("SEARCH Host SHOW name", { limit: 0 });

    const url = String((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]);
    expect(url).toContain("limit=0");
    expect(result.totalCount).toBe(42);
    expect(result.returnedCount).toBe(0);
  });

  it("exposes offset/hasMore/nextOffset when the API returns fewer rows than the total", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ items: [{ count: 30, headings: ["name"], results: Array.from({ length: 10 }, (_, i) => [`row-${i}`]) }] }) }));
    const client = new DiscoveryClient(config);

    const result = await client.searchData("SEARCH Host SHOW name", { offset: 0 });

    expect(fetch).toHaveBeenCalledOnce();
    expect(result.offset).toBe(0);
    expect(result.returnedCount).toBe(10);
    expect(result.totalCount).toBe(30);
    expect(result.hasMore).toBe(true);
    expect(result.nextOffset).toBe(10);
    expect(result.summary).toContain("offset=10"); // actionable next-page hint
  });
});
