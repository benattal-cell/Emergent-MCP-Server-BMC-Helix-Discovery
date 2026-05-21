import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";

const jsonInput = z.union([z.array(z.unknown()), z.record(z.unknown())]);

export const queryJsonSchema = z.object({
  query: jsonInput,
  limit: z.number().int().min(1).max(500).default(50)
}).strict();

export const rawGetSchema = z.object({
  path: z.string().min(5).refine((value) => value.startsWith("/api/") && !/^https?:\/\//i.test(value), {
    message: "path must be a relative /api/... path"
  })
}).strict();

export function queryTools(client: DiscoveryClient) {
  return {
    discovery_query_json: {
      schema: queryJsonSchema,
      handler: async (input: z.infer<typeof queryJsonSchema>) => client.queryJson(input.query, input.limit)
    },
    discovery_raw_get: {
      schema: rawGetSchema,
      handler: async (input: z.infer<typeof rawGetSchema>) => client.request("GET", input.path, undefined, !input.path.startsWith("/api/about"))
    }
  };
}
