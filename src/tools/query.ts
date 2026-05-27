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
      description: "ADVANCED FALLBACK. Execute a raw BMC Discovery DSL query (search/show language) and return the flattened result with summary. DO NOT INVENT a DSL query when one of these specialized tools can do the job: discovery_find_hosts (host inventory), discovery_find_software_instances (software inventory), discovery_find_host_software (software on one host), discovery_lifecycle_report (EOL/EOS with publisher/product filters built in), discovery_cve_executive_summary (CVE impact). Only use this when the user's question CANNOT be expressed with any specialized tool, OR when discovery_build_lifecycle_query / discovery_build_cve_software_query has already produced a validated DSL string that you now want to execute. Invalid DSL returns an error.",
      schema: queryJsonSchema,
      handler: async (input: z.infer<typeof queryJsonSchema>) => client.queryJson(input.query, input.limit, { entityLabel: "résultats", appliedFilters: {} })
    },
    discovery_search_tree_data: {
      description: "ADVANCED FALLBACK. Same as discovery_search_data but returns results in tree (hierarchical) format instead of flat. Use only when nested parent-child results are explicitly required in one shot. For most use cases use discovery_search_data with the flat format, or better, a specialized tool.",
      schema: queryTreeSchema,
      handler: async (input: z.infer<typeof queryTreeSchema>) => client.searchData(input.query, { limit: input.limit, format: "tree", entityLabel: "résultats hiérarchiques", appliedFilters: {} })
    },
    discovery_topology_services: {
      description: "ADVANCED. Call the Discovery /topology/services endpoint with a free-form payload. Use only when explicitly asked for topology/service-map data and no higher-level tool fits. Requires knowledge of the Discovery topology API. Do NOT use as a fallback for inventory or compliance queries.",
      schema: topologyServicesSchema,
      handler: async (input: z.infer<typeof topologyServicesSchema>) => client.getTopologyServices(input.payload)
    }
  };
}
