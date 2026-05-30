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

});
