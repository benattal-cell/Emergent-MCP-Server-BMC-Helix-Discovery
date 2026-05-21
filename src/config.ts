import dotenv from "dotenv";

dotenv.config();

export interface AppConfig {
  baseUrl: string;
  apiVersion: string;
  token?: string;
  verifyTls: boolean;
  timeoutMs: number;
}

export function loadConfig(): AppConfig {
  const baseUrl = process.env.BMC_DISCOVERY_BASE_URL?.trim();
  if (!baseUrl) {
    throw new Error("Missing required env var: BMC_DISCOVERY_BASE_URL");
  }

  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    apiVersion: process.env.BMC_DISCOVERY_API_VERSION?.trim() || "v1.18",
    token: process.env.BMC_DISCOVERY_TOKEN?.trim(),
    verifyTls: (process.env.BMC_DISCOVERY_VERIFY_TLS?.trim().toLowerCase() ?? "true") !== "false",
    timeoutMs: Number(process.env.BMC_DISCOVERY_TIMEOUT_MS ?? 30000)
  };
}
