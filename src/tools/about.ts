import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";

export const emptyInputSchema = z.object({}).strict();

export function aboutTools(client: DiscoveryClient, configuredApiVersion: string) {
  return {
    discovery_about: {
      schema: emptyInputSchema,
      handler: async () => {
        const about = await client.getAbout();
        return { about };
      }
    },
    discovery_get_api_status: {
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
