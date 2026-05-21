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
      schema: findHostsSchema,
      handler: async (input: z.infer<typeof findHostsSchema>) => client.findHosts(input)
    },
    discovery_find_software_instances: {
      schema: findSoftwareInstancesSchema,
      handler: async (input: z.infer<typeof findSoftwareInstancesSchema>) => client.findSoftwareInstances(input)
    },
    discovery_find_host_software: {
      schema: findHostSoftwareSchema,
      handler: async (input: z.infer<typeof findHostSoftwareSchema>) => client.findHostSoftware(input)
    }
  };
}
