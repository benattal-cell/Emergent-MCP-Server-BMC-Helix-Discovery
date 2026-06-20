import dotenv from "dotenv";

dotenv.config();

export interface AppConfig {
  baseUrl: string;
  apiVersion: string;
  token?: string;
  mcpServerApiKey: string;
  port: number;
  publicBaseUrl?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
  nvdApiKey?: string;
  /** Emit visual blocks (PNG) by default. Set MCP_DEFAULT_VISUAL=false for text-only, token-efficient deployments. */
  defaultVisual: boolean;
  /** Also emit the raw SVG as a resource block. On by default; set MCP_INCLUDE_SVG=false to slim payloads for PNG-only clients. */
  includeSvgResource: boolean;
}

export function loadConfig(): AppConfig {
  const baseUrl = process.env.BMC_DISCOVERY_BASE_URL?.trim();
  const mcpServerApiKey = process.env.MCP_SERVER_API_KEY?.trim();

  if (!baseUrl) {
    throw new Error("Missing required env var: BMC_DISCOVERY_BASE_URL");
  }
  if (!mcpServerApiKey) {
    throw new Error("Missing required env var: MCP_SERVER_API_KEY");
  }

  const rawPort = process.env.PORT?.trim() ?? "8001";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("Invalid PORT env var");
  }

  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    apiVersion: process.env.BMC_DISCOVERY_API_VERSION?.trim() || "v1.18",
    token: process.env.BMC_DISCOVERY_TOKEN?.trim(),
    mcpServerApiKey,
    port,
    publicBaseUrl: process.env.PUBLIC_BASE_URL?.trim(),
    oauthClientId: process.env.OAUTH_CLIENT_ID?.trim(),
    oauthClientSecret: process.env.OAUTH_CLIENT_SECRET?.trim(),
    nvdApiKey: process.env.NVD_API_KEY?.trim(),
    defaultVisual: (process.env.MCP_DEFAULT_VISUAL?.trim().toLowerCase() ?? "true") !== "false",
    includeSvgResource: (process.env.MCP_INCLUDE_SVG?.trim().toLowerCase() ?? "true") !== "false"
  };
}
