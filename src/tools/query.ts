import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";

const jsonInput = z.union([z.array(z.unknown()), z.record(z.unknown())]);

export const queryJsonSchema = z.object({
  query: jsonInput,
  limit: z.number().int().min(1).max(500).default(50)
}).strict();

export const queryTreeSchema = z.object({
  query: jsonInput,
  limit: z.number().int().min(1).max(500).default(50)
}).strict();


export const topologyServicesSchema = z.object({
  payload: z.record(z.unknown())
}).strict();

export function queryTools(client: DiscoveryClient) {
  return {
    discovery_search_data: {
      schema: queryJsonSchema,
      handler: async (input: z.infer<typeof queryJsonSchema>) => client.queryJson(input.query, input.limit)
    },
    discovery_search_tree_data: {
      schema: queryTreeSchema,
      handler: async (input: z.infer<typeof queryTreeSchema>) => client.searchData(input.query, { limit: input.limit, format: "tree" })
    },
    discovery_topology_services: {
      schema: topologyServicesSchema,
      handler: async (input: z.infer<typeof topologyServicesSchema>) => client.getTopologyServices(input.payload)
    }
  };
}
