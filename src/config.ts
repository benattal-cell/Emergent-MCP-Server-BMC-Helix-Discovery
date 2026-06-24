import dotenv from "dotenv";

dotenv.config();

export interface AppConfig {
  baseUrl: string;
  apiVersion: string;
  token?: string;
  port: number;
  /** Public issuer URL used in OAuth metadata (defaults to http://localhost:PORT). */
  publicBaseUrl?: string;
  /** Allowed redirect_uri prefixes for the OAuth flow (DCR + authorize). */
  oauthRedirectAllowlist: string[];
  /** Optional shared consent password. When set, /oauth/authorize shows a login gate. */
  oauthLoginPassword?: string;
  nvdApiKey?: string;
  /** Emit visual blocks (PNG) by default. Set MCP_DEFAULT_VISUAL=false for text-only, token-efficient deployments. */
  defaultVisual: boolean;
  /** Also emit the raw SVG as a resource block. On by default; set MCP_INCLUDE_SVG=false to slim payloads for PNG-only clients. */
  includeSvgResource: boolean;
  /**
   * Optional per-call row cap for the paginated list tools, to fit a token budget.
   * null = no cap (the API's natural per-call max governs). A positive integer caps each
   * page; callers paginate with offset = nextOffset. Count-only queries (limit=0) bypass it.
   */
  resultLimit: number | null;
}

// Known OAuth callback prefixes for the LLM clients we support, plus localhost for desktop apps.
// Extend via OAUTH_REDIRECT_ALLOWLIST (comma-separated); entries are merged with these defaults.
const DEFAULT_REDIRECT_ALLOWLIST = [
  "https://chatgpt.com/",
  "https://chat.openai.com/",
  "https://platform.openai.com/",
  "https://claude.ai/",
  "https://claude.com/",
  "https://chat.mistral.ai/",
  "http://localhost",
  "http://127.0.0.1"
];

function parseAllowlist(raw: string | undefined): string[] {
  const extra = (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return [...new Set([...DEFAULT_REDIRECT_ALLOWLIST, ...extra])];
}

// MCP_RESULT_LIMIT: optional per-call row cap for the paginated list tools.
// "" / "0" / "none" / "off" / "false" -> null (no cap); a positive integer -> that cap.
function parseResultLimit(raw: string | undefined): number | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "" || value === "0" || value === "none" || value === "off" || value === "false") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function loadConfig(): AppConfig {
  const baseUrl = process.env.BMC_DISCOVERY_BASE_URL?.trim();

  if (!baseUrl) {
    throw new Error("Missing required env var: BMC_DISCOVERY_BASE_URL");
  }

  const rawPort = process.env.PORT?.trim() ?? "3000";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("Invalid PORT env var");
  }

  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    apiVersion: process.env.BMC_DISCOVERY_API_VERSION?.trim() || "v1.18",
    token: process.env.BMC_DISCOVERY_TOKEN?.trim(),
    port,
    publicBaseUrl: process.env.PUBLIC_BASE_URL?.trim(),
    oauthRedirectAllowlist: parseAllowlist(process.env.OAUTH_REDIRECT_ALLOWLIST),
    oauthLoginPassword: process.env.OAUTH_LOGIN_PASSWORD?.trim() || undefined,
    nvdApiKey: process.env.NVD_API_KEY?.trim(),
    defaultVisual: (process.env.MCP_DEFAULT_VISUAL?.trim().toLowerCase() ?? "true") !== "false",
    includeSvgResource: (process.env.MCP_INCLUDE_SVG?.trim().toLowerCase() ?? "true") !== "false",
    resultLimit: parseResultLimit(process.env.MCP_RESULT_LIMIT)
  };
}
