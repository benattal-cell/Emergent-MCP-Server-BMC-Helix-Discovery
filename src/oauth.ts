import crypto from "node:crypto";

export interface OAuthConfig {
  /** Public issuer URL (e.g. https://my-server.up.railway.app). */
  issuer: string;
  /** Allowed redirect_uri prefixes (prefix match). Empty = reject all. */
  redirectAllowlist: string[];
  /** Optional shared consent password. When set, /authorize shows a login gate. */
  loginPassword?: string;
  accessTokenTtlMs?: number;
  refreshTokenTtlMs?: number;
  codeTtlMs?: number;
}

export type CodeChallengeMethod = "S256" | "plain";

export interface RegisteredClient {
  clientId: string;
  redirectUris: string[];
  createdAt: number;
}

interface AuthCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: CodeChallengeMethod;
  expiresAt: number;
}

interface StoredToken {
  clientId: string;
  expiresAt: number;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export type GrantResult =
  | { ok: true; tokens: IssuedTokens }
  | { ok: false; error: string };

const DEFAULT_ACCESS_TTL_MS = 3600_000; // 1h
const DEFAULT_REFRESH_TTL_MS = 30 * 24 * 3600_000; // 30d
const DEFAULT_CODE_TTL_MS = 300_000; // 5min

function randomId(bytes = 24): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function createOAuthServer(config: OAuthConfig) {
  const clients = new Map<string, RegisteredClient>();
  const codes = new Map<string, AuthCode>();
  const accessTokens = new Map<string, StoredToken>();
  const refreshTokens = new Map<string, StoredToken>();

  const accessTtl = config.accessTokenTtlMs ?? DEFAULT_ACCESS_TTL_MS;
  const refreshTtl = config.refreshTokenTtlMs ?? DEFAULT_REFRESH_TTL_MS;
  const codeTtl = config.codeTtlMs ?? DEFAULT_CODE_TTL_MS;

  function metadata() {
    return {
      issuer: config.issuer,
      authorization_endpoint: `${config.issuer}/oauth/authorize`,
      token_endpoint: `${config.issuer}/oauth/token`,
      registration_endpoint: `${config.issuer}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256", "plain"]
    };
  }

  function isRedirectAllowed(redirectUri: string): boolean {
    if (!redirectUri) return false;
    return config.redirectAllowlist.some((prefix) => prefix.length > 0 && redirectUri.startsWith(prefix));
  }

  function registerClient(redirectUris: unknown): RegisteredClient | { error: string } {
    const list = Array.isArray(redirectUris) ? redirectUris : [];
    const valid = list.filter((u): u is string => typeof u === "string" && u.length > 0);
    if (valid.length === 0) return { error: "redirect_uris is required" };
    const rejected = valid.filter((u) => !isRedirectAllowed(u));
    if (rejected.length > 0) return { error: `redirect_uri not in allowlist: ${rejected.join(", ")}` };
    const client: RegisteredClient = { clientId: `mcp-${randomId(16)}`, redirectUris: valid, createdAt: Date.now() };
    clients.set(client.clientId, client);
    return client;
  }

  function getClient(clientId: string): RegisteredClient | undefined {
    return clients.get(clientId);
  }

  /** A redirect_uri is acceptable if the registered client declared it, or (for non-DCR clients) it is globally allowlisted. */
  function isRedirectAcceptable(clientId: string, redirectUri: string): boolean {
    const client = clients.get(clientId);
    if (client) return client.redirectUris.includes(redirectUri);
    return isRedirectAllowed(redirectUri);
  }

  function createAuthCode(clientId: string, redirectUri: string, codeChallenge: string, method: CodeChallengeMethod): string {
    const code = randomId(24);
    codes.set(code, { clientId, redirectUri, codeChallenge, codeChallengeMethod: method, expiresAt: Date.now() + codeTtl });
    return code;
  }

  function verifyPkce(verifier: string, challenge: string, method: CodeChallengeMethod): boolean {
    if (!verifier) return false;
    if (method === "plain") return verifier === challenge;
    const hash = crypto.createHash("sha256").update(verifier).digest().toString("base64url");
    return hash === challenge;
  }

  function issueTokens(clientId: string): IssuedTokens {
    const accessToken = randomId(32);
    const refreshToken = randomId(32);
    accessTokens.set(accessToken, { clientId, expiresAt: Date.now() + accessTtl });
    refreshTokens.set(refreshToken, { clientId, expiresAt: Date.now() + refreshTtl });
    return { accessToken, refreshToken, expiresIn: Math.floor(accessTtl / 1000) };
  }

  function exchangeCode(params: { code: string; codeVerifier: string; redirectUri: string; clientId?: string }): GrantResult {
    const record = codes.get(params.code);
    // Single-use: always drop the code once looked up.
    codes.delete(params.code);
    if (!record || Date.now() > record.expiresAt) return { ok: false, error: "invalid_grant" };
    if (record.redirectUri !== params.redirectUri) return { ok: false, error: "invalid_grant" };
    if (params.clientId && params.clientId !== record.clientId) return { ok: false, error: "invalid_grant" };
    if (!verifyPkce(params.codeVerifier, record.codeChallenge, record.codeChallengeMethod)) {
      return { ok: false, error: "invalid_grant" };
    }
    return { ok: true, tokens: issueTokens(record.clientId) };
  }

  function refresh(refreshToken: string): GrantResult {
    const record = refreshTokens.get(refreshToken);
    // Rotation: invalidate the presented refresh token.
    refreshTokens.delete(refreshToken);
    if (!record || Date.now() > record.expiresAt) return { ok: false, error: "invalid_grant" };
    return { ok: true, tokens: issueTokens(record.clientId) };
  }

  function validateAccessToken(token: string): boolean {
    const record = accessTokens.get(token);
    if (!record) return false;
    if (Date.now() > record.expiresAt) {
      accessTokens.delete(token);
      return false;
    }
    return true;
  }

  function requiresConsent(): boolean {
    return Boolean(config.loginPassword && config.loginPassword.length > 0);
  }

  function checkConsentPassword(password: string | undefined): boolean {
    if (!requiresConsent()) return true;
    return password === config.loginPassword;
  }

  return {
    config,
    metadata,
    isRedirectAllowed,
    registerClient,
    getClient,
    isRedirectAcceptable,
    createAuthCode,
    exchangeCode,
    refresh,
    validateAccessToken,
    requiresConsent,
    checkConsentPassword
  };
}

export type OAuthServer = ReturnType<typeof createOAuthServer>;
