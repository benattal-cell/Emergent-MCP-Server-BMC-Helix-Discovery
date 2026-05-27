import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";

export const findHostsSchema = z.object({
  nameContains: z.string().min(1).optional(),
  osContains: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).default(50)
}).strict();

export const findSoftwareInstancesSchema = z.object({
  typeContains: z.string().min(1).optional(),
  nameContains: z.string().min(1).optional(),
  instanceContains: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).default(50)
}).strict();

export const findHostSoftwareSchema = z.object({
  hostNameContains: z.string().min(1),
  softwareTypeContains: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).default(50)
}).strict();

export function hostTools(client: DiscoveryClient) {
  return {
    discovery_find_hosts: {
      description: "Find hosts (servers, VMs, devices) in BMC Helix Discovery, filtered by partial name match and/or OS. Returns: {summary, totalCount, returnedCount, rows[]} where each row has name, os, type, key. Use when the user asks 'how many Linux servers do we have?', 'show me hosts named PROD-*', 'list all Windows machines'. ALWAYS quote the headline count from the `summary` field — totalCount is the real count in Discovery, returnedCount is what fits the limit. For software installed on a specific host, use discovery_find_host_software instead.",
      schema: findHostsSchema,
      handler: async (input: z.infer<typeof findHostsSchema>) => client.findHosts(input)
    },
    discovery_find_software_instances: {
      description: "Find software instances (running applications, databases, middlewares) across all hosts, filtered by type/name/instance. Returns: {summary, totalCount, returnedCount, rows[]} with type, name, instance, product_version. Use when the user asks 'list all Oracle databases', 'find Apache instances', 'where is MySQL deployed?'. ALWAYS use the `summary` field for the headline count. For software on ONE specific host, prefer discovery_find_host_software.",
      schema: findSoftwareInstancesSchema,
      handler: async (input: z.infer<typeof findSoftwareInstancesSchema>) => client.findSoftwareInstances(input)
    },
    discovery_find_host_software: {
      description: "List software running on a specific host (by partial host name). Optionally filter by software type. Returns: {summary, totalCount, returnedCount, rows[]} with host + installed software and versions. Use when the user asks 'what's running on SAP-PROD-01?', 'show all databases on host X', 'inventory for server Y'. Quote the `summary` field for the headline.",
      schema: findHostSoftwareSchema,
      handler: async (input: z.infer<typeof findHostSoftwareSchema>) => client.findHostSoftware(input)
    }
  };
}
