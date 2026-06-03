import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";
import { structuredOutputSchema } from "./outputSchemas.js";

const emptySchema = z.object({}).strict();
const kindSchema = z.object({ kind: z.string().min(1) }).strict();

export function taxonomyTools(client: DiscoveryClient) {
  return {
    discovery_taxonomy_sections: {
      description: "Internal/metadata. List the taxonomy sections of the Discovery model. Rarely needed by end users — use only if you must introspect the data model structure before writing a query.",
      schema: emptySchema,
      outputSchema: structuredOutputSchema,
      handler: async () => client.getTaxonomySections()
    },
    discovery_taxonomy_locales: {
      description: "Internal/metadata. List the available locales (languages) for the Discovery taxonomy. Rarely needed.",
      schema: emptySchema,
      outputSchema: structuredOutputSchema,
      handler: async () => client.getTaxonomyLocales()
    },
    discovery_taxonomy_node_kinds: {
      description: "List all node kinds (entity types) available in this Discovery instance — e.g. Host, SoftwareInstance, Database, BusinessApplication, etc. Use this when you need to know what entity types exist before writing a query, or when the user asks 'what kinds of data does Discovery know about?'.",
      schema: z.object({ includeInfo: z.boolean().default(false) }).strict(),
      outputSchema: structuredOutputSchema,
      handler: async (input: { includeInfo: boolean }) => client.getTaxonomyNodeKinds(input.includeInfo)
    },
    discovery_taxonomy_node_kind_details: {
      description: "Return full metadata for one node kind (its attributes, relationships, description). Use when you need to know what a specific kind contains, e.g. 'what attributes does Host have?'.",
      schema: kindSchema,
      outputSchema: structuredOutputSchema,
      handler: async (input: z.infer<typeof kindSchema>) => client.getTaxonomyNodeKindDetails(input.kind)
    },
    discovery_taxonomy_node_kind_field_lists: {
      description: "List the predefined field lists available for a node kind. A field list is a curated set of attributes to show in a query result. Rarely needed by end users.",
      schema: kindSchema,
      outputSchema: structuredOutputSchema,
      handler: async (input: z.infer<typeof kindSchema>) => client.getTaxonomyNodeKindFieldLists(input.kind)
    },
    discovery_taxonomy_node_fields: {
      description: "Return all fields (attributes) of a node kind for a given field list. Use this BEFORE writing a discovery_execute_dsl query to know the exact attribute names available on a kind.",
      schema: z.object({ kind: z.string().min(1), fieldList: z.string().min(1) }).strict(),
      outputSchema: structuredOutputSchema,
      handler: async (input: { kind: string; fieldList: string }) =>
        client.getTaxonomyNodeKindFieldListFields(input.kind, input.fieldList)
    },
    discovery_taxonomy_relationship_kinds: {
      description: "List all relationship kinds (e.g. HostedSoftware, RunningSoftware, ContainedIn) in this Discovery instance. Use when building queries that traverse relationships between entities.",
      schema: z.object({ includeInfo: z.boolean().default(false) }).strict(),
      outputSchema: structuredOutputSchema,
      handler: async (input: { includeInfo: boolean }) => client.getTaxonomyRelationshipKinds(input.includeInfo)
    },
    discovery_taxonomy_relkind_details: {
      description: "Return full metadata for one relationship kind — what it connects, its direction, its attributes. Use before traversing relationships in a complex DSL query.",
      schema: kindSchema,
      outputSchema: structuredOutputSchema,
      handler: async (input: z.infer<typeof kindSchema>) => client.getTaxonomyRelationshipKindDetails(input.kind)
    }
  };
}
