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
    oauthClientSecret: process.env.OAUTH_CLIENT_SECRET?.trim()
  };
}
