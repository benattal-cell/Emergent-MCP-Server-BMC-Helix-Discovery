import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";

export const emptyInputSchema = z.object({}).strict();

export function aboutTools(client: DiscoveryClient, configuredApiVersion: string) {
  return {
    discovery_about: {
      description: "Returns metadata about the BMC Helix Discovery instance (version, supported API versions, capabilities). Use this to verify connectivity to Discovery or to check what API version is available. No authentication required for this endpoint. Do NOT use for user-facing questions about hosts, software, or compliance.",
      schema: emptyInputSchema,
      handler: async () => {
        const about = await client.getAbout();
        return { about };
      }
    },
    discovery_get_api_status: {
      description: "Checks if Discovery is reachable AND if the configured API version matches what the instance supports. Use this as a health-check before running other tools, especially if previous calls failed. Returns a warning if there's a version mismatch.",
      schema: emptyInputSchema,
      handler: async () => {
        const about = (await client.getAbout()) as Record<string, unknown>;
        const supported = extractSupportedVersions(about);
        return {
          reachable: true,
          configuredApiVersion,
          supportedApiVersions: supported,
          warning: supported.length > 0 && !supported.includes(configuredApiVersion)
            ? `Configured API version ${configuredApiVersion} is not listed in /api/about`
            : undefined
        };
      }
    }
  };
}

function extractSupportedVersions(payload: Record<string, unknown>): string[] {
  const candidates = [payload.supportedApiVersions, payload.apiVersions, payload.versions].find(Array.isArray);
  return Array.isArray(candidates) ? candidates.filter((v): v is string => typeof v === "string") : [];
}
