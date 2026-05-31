import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";
import { renderVisual } from "../svg/renderer.js";
import { hostCardOutputSchema } from "./outputSchemas.js";

export const hostCardSchema = z.object({ hostName: z.string().min(1) }).strict();

export function hostCardTools(client: DiscoveryClient) {
  return {
    discovery_host_card: {
      description: "Render a visual ID card for a host",
      schema: hostCardSchema,
      outputSchema: hostCardOutputSchema,
      handler: async (input: z.infer<typeof hostCardSchema>) => {
        const h = await client.findHosts({ nameContains: input.hostName, limit: 1 }) as { rows?: Array<Record<string, unknown>> };
        const host = h.rows?.[0] ?? { name: input.hostName, os: "n/a", type: "n/a", key: "n/a" };
        const name = String(host.name ?? input.hostName);
        const os = String(host.os ?? "n/a");
        const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='700' height='200'><text x='20' y='40'>${name}</text><text x='20' y='70'>${os}</text></svg>`;
        return renderVisual(svg, {
          name: `host_card_${name.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase()}`,
          textSummary: `Host: ${name}`,
          structuredContent: { host, rawSearchResult: h }
        });
      },
      isVisual: true as const
    }
  };
}
