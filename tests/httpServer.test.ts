import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpServer } from "../src/index.js";
import { normalizeApiError } from "../src/utils/errors.js";
import { testConfig, obtainAccessToken, pkcePair } from "./helpers/oauthFlow.js";

let currentServer: import("node:http").Server | undefined;

async function startServer() {
  const server = await createHttpServer(testConfig());
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
    expect(response.headers.get("www-authenticate")).toContain("oauth-protected-resource");
  });

  it("rejects /mcp with an unknown bearer token", async () => {
    const { baseUrl } = await startServer();
    const response = await fetch(`${baseUrl}/mcp`, { method: "GET", headers: { Authorization: "Bearer wrong" } });
    expect(response.status).toBe(401);
  });

  it("completes the OAuth authorization_code + PKCE flow and accesses /mcp", async () => {
    const { baseUrl } = await startServer();
    const { accessToken, refreshToken } = await obtainAccessToken(baseUrl);
    expect(accessToken).toBeTruthy();
    expect(refreshToken).toBeTruthy();

    const response = await fetch(`${baseUrl}/mcp`, { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } });
    expect(response.status).not.toBe(401);
  });

  it("rejects authorize with a redirect_uri outside the allowlist", async () => {
    const { baseUrl } = await startServer();
    const query = new URLSearchParams({
      response_type: "code",
      client_id: "unregistered",
      redirect_uri: "https://evil.example/cb",
      code_challenge: "abc",
      code_challenge_method: "S256"
    });
    const response = await fetch(`${baseUrl}/oauth/authorize?${query.toString()}`, { redirect: "manual" });
    expect(response.status).toBe(400);
  });

  it("rejects a token exchange with a wrong PKCE verifier", async () => {
    const { baseUrl } = await startServer();
    const redirectUri = "http://localhost/cb";
    const reg = await fetch(`${baseUrl}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: [redirectUri] })
    });
    const { client_id: clientId } = (await reg.json()) as { client_id: string };
    const { challenge } = pkcePair();
    const query = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256"
    });
    const authRes = await fetch(`${baseUrl}/oauth/authorize?${query.toString()}`, { redirect: "manual" });
    const code = new URL(authRes.headers.get("location") ?? "http://x/").searchParams.get("code");
    expect(code).toBeTruthy();

    const tokenRes = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code ?? "",
        code_verifier: "the-wrong-verifier",
        redirect_uri: redirectUri,
        client_id: clientId
      })
    });
    expect(tokenRes.status).toBe(400);
    expect((await tokenRes.json()).error).toBe("invalid_grant");
  });

  it("issues a new access token from a refresh token", async () => {
    const { baseUrl } = await startServer();
    const { refreshToken } = await obtainAccessToken(baseUrl);
    const response = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken })
    });
    expect(response.status).toBe(200);
    const tokens = await response.json();
    expect(tokens.access_token).toBeTruthy();
  });

  it("never reveals BMC token in normalized errors", () => {
    const normalized = normalizeApiError(new Error("operation failed with super-secret-bmc-token"));
    expect(JSON.stringify(normalized)).not.toContain("super-secret-bmc-token");
  });
});
