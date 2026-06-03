import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";
import { structuredOutputSchema } from "./outputSchemas.js";

export const startScanSchema = z.object({
  target: z.string().min(1),
  label: z.string().min(1).optional(),
  confirm: z.boolean()
}).strict();

export function discoveryRunTools(client: DiscoveryClient) {
  return {
    discovery_start_scan: {
      description: "DESTRUCTIVE / SIDE EFFECT. Trigger a scan against a target (IP / hostname / range). Requires confirm=true to actually run, otherwise refuses. Use only when the user explicitly asks to launch a new discovery scan. Do NOT call to 'check' or 'verify' something — that's read-only territory, use discovery_find_hosts / discovery_execute_dsl instead.",
      schema: startScanSchema,
      outputSchema: structuredOutputSchema,
      handler: async (input: z.infer<typeof startScanSchema>) => client.startScan(input)
    }
  };
}
