import crypto from "node:crypto";
import type { AppConfig } from "../../src/config.js";

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    baseUrl: "https://example.test",
    apiVersion: "v1.18",
    token: "super-secret-bmc-token",
    port: 0,
    oauthRedirectAllowlist: ["http://localhost", "http://127.0.0.1"],
    defaultVisual: true,
    includeSvgResource: true,
    resultLimit: null,
    ...overrides
  };
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest().toString("base64url");
  return { verifier, challenge };
}

/** Runs the full authorization_code + PKCE flow against a running server and returns the tokens. */
export async function obtainAccessToken(
  baseUrl: string,
  redirectUri = "http://localhost/cb"
): Promise<{ accessToken: string; refreshToken: string; clientId: string }> {
  const reg = await fetch(`${baseUrl}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: [redirectUri] })
  });
  if (reg.status !== 201) throw new Error(`register failed: ${reg.status}`);
  const { client_id: clientId } = (await reg.json()) as { client_id: string };

  const { verifier, challenge } = pkcePair();
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "test-state"
  });
  const authRes = await fetch(`${baseUrl}/oauth/authorize?${query.toString()}`, { redirect: "manual" });
  const location = authRes.headers.get("location");
  if (!location) throw new Error(`authorize did not redirect (status ${authRes.status})`);
  const code = new URL(location).searchParams.get("code");
  if (!code) throw new Error(`no authorization code in redirect: ${location}`);

  const tokenRes = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      client_id: clientId
    })
  });
  if (tokenRes.status !== 200) throw new Error(`token exchange failed: ${tokenRes.status}`);
  const tokens = (await tokenRes.json()) as { access_token: string; refresh_token: string };
  return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, clientId };
}
