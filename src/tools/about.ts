import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";
import { kpiGrid, statusBadge } from "../svg/kpi.js";
import { renderVisual } from "../svg/renderer.js";

export const emptyInputSchema = z.object({}).strict();

export function aboutTools(client: DiscoveryClient, configuredApiVersion: string) {
  return {
    discovery_about: {
      description: "Returns metadata about the BMC Helix Discovery instance (version, supported API versions, capabilities). Use this to verify connectivity to Discovery or to check what API version is available. No authentication required for this endpoint. Do NOT use for user-facing questions about hosts, software, or compliance.",
      schema: emptyInputSchema,
      handler: async () => {
        const about = await client.getAbout();
        const payload = about && typeof about === "object" ? about as Record<string, unknown> : {};
        const version = [payload.version, payload.productVersion, payload.build_version].find((v) => typeof v === "string") as string | undefined;
        const edition = [payload.edition, payload.product, payload.name].find((v) => typeof v === "string") as string | undefined;
        const svg = kpiGrid("Discovery", [
          { label: "Version", value: version ?? "Inconnue", hint: edition },
          { label: "API configurée", value: configuredApiVersion }
        ], { columns: 2 });
        return renderVisual(svg, {
          name: "discovery_about",
          textSummary: `Discovery metadata retrieved${version ? ` (version ${version})` : ""}.`,
          structuredContent: { about }
        });
      },
      isVisual: true as const
    },
    discovery_get_api_status: {
      description: "Checks if Discovery is reachable AND if the configured API version matches what the instance supports. Use this as a health-check before running other tools, especially if previous calls failed. Returns a warning if there's a version mismatch.",
      schema: emptyInputSchema,
      handler: async () => {
        const about = (await client.getAbout()) as Record<string, unknown>;
        const supported = extractSupportedVersions(about);
        const warning = supported.length > 0 && !supported.includes(configuredApiVersion)
          ? `Configured API version ${configuredApiVersion} is not listed in /api/about`
          : undefined;
        const result = {
          reachable: true,
          configuredApiVersion,
          supportedApiVersions: supported,
          warning
        };
        const svg = statusBadge(!warning, warning ? "API version mismatch" : "Discovery joignable", warning ?? `API ${configuredApiVersion}`);
        return renderVisual(svg, {
          name: "discovery_api_status",
          textSummary: warning ?? `Discovery reachable with configured API version ${configuredApiVersion}.`,
          structuredContent: result
        });
      },
      isVisual: true as const
    }
  };
}

function extractSupportedVersions(payload: Record<string, unknown>): string[] {
  const candidates = [payload.supportedApiVersions, payload.apiVersions, payload.versions].find(Array.isArray);
  return Array.isArray(candidates) ? candidates.filter((v): v is string => typeof v === "string") : [];
}
