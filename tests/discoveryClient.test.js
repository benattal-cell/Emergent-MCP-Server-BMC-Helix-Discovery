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
});
