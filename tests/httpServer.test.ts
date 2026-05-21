import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpServer } from "../src/index.js";
import { normalizeApiError } from "../src/utils/errors.js";

let currentServer: import("node:http").Server | undefined;

async function startServer() {
  const server = await createHttpServer({
    baseUrl: "https://example.test",
    apiVersion: "v1.18",
    token: "super-secret-bmc-token",
    mcpServerApiKey: "good-key",
    port: 0
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  currentServer = server;
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

afterEach(async () => {
  if (currentServer) {
    await new Promise<void>((resolve, reject) => currentServer?.close((error) => (error ? reject(error) : resolve())));
    currentServer = undefined;
  }
  vi.restoreAllMocks();
});

describe("http server security", () => {
  it("returns health", async () => {
    const { baseUrl } = await startServer();
    const response = await fetch(`${baseUrl}/health`);
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data).toEqual({ status: "ok", service: "bmc-helix-discovery-mcp" });
  });

  it("rejects /mcp without authorization", async () => {
    const { baseUrl } = await startServer();
    const response = await fetch(`${baseUrl}/mcp`, { method: "GET" });
    expect(response.status).toBe(401);
  });

  it("rejects /mcp with wrong token", async () => {
    const { baseUrl } = await startServer();
    const response = await fetch(`${baseUrl}/mcp`, { method: "GET", headers: { Authorization: "Bearer wrong" } });
    expect(response.status).toBe(401);
  });

  it("accepts /mcp with good token", async () => {
    const { baseUrl } = await startServer();
    const response = await fetch(`${baseUrl}/mcp`, { method: "GET", headers: { Authorization: "Bearer good-key" } });
    expect(response.status).not.toBe(401);
  });

  it("never reveals BMC token in normalized errors", () => {
    const normalized = normalizeApiError(new Error("operation failed with super-secret-bmc-token"));
    expect(JSON.stringify(normalized)).not.toContain("super-secret-bmc-token");
  });
});
