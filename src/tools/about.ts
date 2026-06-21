import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";
import { kpiGrid, statusBadge } from "../svg/kpi.js";
import { renderVisual } from "../svg/renderer.js";

export const emptyInputSchema = z.object({}).strict();

const aboutSchema = z.object({
  check: z.boolean().default(false).describe("false (défaut) = métadonnées de l'instance ; true = health-check (joignabilité + correspondance de la version d'API configurée).")
}).strict();

const aboutOutputSchema = z.object({
  about: z.unknown().optional(),
  reachable: z.boolean().optional(),
  configuredApiVersion: z.string().optional(),
  supportedApiVersions: z.array(z.string()).optional(),
  warning: z.string().optional()
}).passthrough();

export function aboutTools(client: DiscoveryClient, configuredApiVersion: string) {
  return {
    discovery_about: {
      description: "Métadonnées de l'instance BMC Helix Discovery (version, versions d'API supportées, capacités). Avec `check=true`, effectue un health-check : joignabilité + correspondance de la version d'API configurée (renvoie un `warning` en cas d'écart) — à lancer avant d'autres outils si un appel a échoué. Aucune authentification requise pour cet endpoint. NE PAS utiliser pour des questions sur les hosts, logiciels ou la conformité.",
      schema: aboutSchema,
      outputSchema: aboutOutputSchema,
      handler: async (input: z.infer<typeof aboutSchema>) => {
        const about = (await client.getAbout()) as Record<string, unknown>;
        if (input.check) {
          const supported = extractSupportedVersions(about);
          const warning = supported.length > 0 && !supported.includes(configuredApiVersion)
            ? `Configured API version ${configuredApiVersion} is not listed in /api/about`
            : undefined;
          const result = { reachable: true, configuredApiVersion, supportedApiVersions: supported, warning };
          const svg = statusBadge(!warning, warning ? "API version mismatch" : "Discovery joignable", warning ?? `API ${configuredApiVersion}`);
          return renderVisual(svg, {
            name: "discovery_api_status",
            textSummary: warning ?? `Discovery reachable with configured API version ${configuredApiVersion}.`,
            structuredContent: result
          });
        }
        const payload = about && typeof about === "object" ? about : {};
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
    }
  };
}

function extractSupportedVersions(payload: Record<string, unknown>): string[] {
  const candidates = [payload.supportedApiVersions, payload.apiVersions, payload.versions].find(Array.isArray);
  return Array.isArray(candidates) ? candidates.filter((v): v is string => typeof v === "string") : [];
}
