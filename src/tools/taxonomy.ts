import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";

const emptySchema = z.object({}).strict();

const kindSchema = z.object({
  kind: z.string().min(1)
}).strict();

export function taxonomyTools(client: DiscoveryClient) {
  return {
    discovery_taxonomy_sections: {
      schema: emptySchema,
      handler: async () => client.getTaxonomySections()
    },
    discovery_taxonomy_locales: {
      schema: emptySchema,
      handler: async () => client.getTaxonomyLocales()
    },
    discovery_taxonomy_node_kinds: {
      schema: z.object({ includeInfo: z.boolean().default(false) }).strict(),
      handler: async (input: { includeInfo: boolean }) => client.getTaxonomyNodeKinds(input.includeInfo)
    },
    discovery_taxonomy_node_kind_details: {
      schema: kindSchema,
      handler: async (input: z.infer<typeof kindSchema>) => client.getTaxonomyNodeKindDetails(input.kind)
    },
    discovery_taxonomy_node_kind_field_lists: {
      schema: kindSchema,
      handler: async (input: z.infer<typeof kindSchema>) => client.getTaxonomyNodeKindFieldLists(input.kind)
    },
    discovery_taxonomy_node_fields: {
      schema: z.object({ kind: z.string().min(1), fieldList: z.string().min(1) }).strict(),
      handler: async (input: { kind: string; fieldList: string }) =>
        client.getTaxonomyNodeKindFieldListFields(input.kind, input.fieldList)
    },
    discovery_taxonomy_relationship_kinds: {
      schema: z.object({ includeInfo: z.boolean().default(false) }).strict(),
      handler: async (input: { includeInfo: boolean }) => client.getTaxonomyRelationshipKinds(input.includeInfo)
    },
    discovery_taxonomy_relkind_details: {
      schema: kindSchema,
      handler: async (input: z.infer<typeof kindSchema>) => client.getTaxonomyRelationshipKindDetails(input.kind)
    }
  };
}
