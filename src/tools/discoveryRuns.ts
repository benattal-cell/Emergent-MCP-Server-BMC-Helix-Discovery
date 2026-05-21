import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";

export const startScanSchema = z.object({
  target: z.string().min(1),
  label: z.string().min(1).optional(),
  confirm: z.boolean()
}).strict();

export function discoveryRunTools(client: DiscoveryClient) {
  return {
    discovery_start_scan: {
      schema: startScanSchema,
      handler: async (input: z.infer<typeof startScanSchema>) => client.startScan(input)
    }
  };
}
