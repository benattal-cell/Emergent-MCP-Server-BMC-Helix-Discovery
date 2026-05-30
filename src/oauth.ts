import crypto from "node:crypto";

export interface OAuthConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
}

type AuthCode = { clientId: string; redirectUri: string; codeChallenge?: string; method?: string; expiresAt: number };
const codes = new Map<string, AuthCode>();
const tokens = new Map<string, { clientId: string; expiresAt: number }>();

export function createOAuthServer(config: OAuthConfig) {
  function metadata() {
    return {
      issuer: config.issuer,
      authorization_endpoint: `${config.issuer}/oauth/authorize`,
      token_endpoint: `${config.issuer}/oauth/token`,
      registration_endpoint: `${config.issuer}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "client_credentials", "refresh_token"],
      token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic", "none"],
      code_challenge_methods_supported: ["S256", "plain"]
    };
  }

  function issueToken(clientId: string): string {
    const token = crypto.randomBytes(24).toString("base64url");
    tokens.set(token, { clientId, expiresAt: Date.now() + 3600_000 });
    return token;
  }

  function validateAccessToken(token: string): boolean {
    const t = tokens.get(token);
    if (!t) return false;
    if (Date.now() > t.expiresAt) {
      tokens.delete(token);
      return false;
    }
    return true;
  }

  function createAuthCode(clientId: string, redirectUri: string, codeChallenge?: string, method?: string): string {
    const code = crypto.randomBytes(20).toString("base64url");
    codes.set(code, { clientId, redirectUri, codeChallenge, method, expiresAt: Date.now() + 300_000 });
    return code;
  }

  return { metadata, issueToken, validateAccessToken, createAuthCode, codes, config };
}
