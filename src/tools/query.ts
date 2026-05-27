import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";

export const queryJsonSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(500).default(50)
}).strict();

export const queryTreeSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(500).default(50)
}).strict();

export const topologyServicesSchema = z.object({
  payload: z.record(z.unknown())
}).strict();

export function queryTools(client: DiscoveryClient) {
  return {
    discovery_search_data: {
      description: "ADVANCED. Execute a raw BMC Discovery DSL query (search/show language). Only use this when other higher-level tools (discovery_find_hosts, discovery_find_software_instances, discovery_lifecycle_report, discovery_build_cve_software_query) cannot express what the user wants. Prefer specialized tools first. The query must be valid Discovery DSL syntax — invalid queries return an error.",
      schema: queryJsonSchema,
      handler: async (input: z.infer<typeof queryJsonSchema>) => client.queryJson(input.query, input.limit)
    },
    discovery_search_tree_data: {
      description: "ADVANCED. Execute a Discovery DSL query and return results in tree format instead of flat 2D. Use only when nested/hierarchical results are needed (e.g., parent-child relationships in one shot). Most use cases should use discovery_search_data with the flat format.",
      schema: queryTreeSchema,
      handler: async (input: z.infer<typeof queryTreeSchema>) => client.searchData(input.query, { limit: input.limit, format: "tree" })
    },
    discovery_topology_services: {
      description: "ADVANCED. Call the Discovery /topology/services endpoint with a free-form payload. Use only when explicitly asked for topology/service-map data and no higher-level tool fits. Requires knowledge of the Discovery topology API.",
      schema: topologyServicesSchema,
      handler: async (input: z.infer<typeof topologyServicesSchema>) => client.getTopologyServices(input.payload)
    }
  };
}
