import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";
import { ApiError } from "../utils/errors.js";

const taxonomyResource = z.enum([
  "sections",
  "locales",
  "node_kinds",
  "node_kind",
  "node_kind_field_lists",
  "node_kind_fields",
  "relationship_kinds",
  "relationship_kind"
]);

export const taxonomySchema = z.object({
  resource: taxonomyResource,
  kind: z.string().min(1).optional(),
  fieldList: z.string().min(1).optional(),
  includeInfo: z.boolean().optional()
}).strict();

const TAXONOMY_DESCRIPTION = [
  "FALLBACK schema introspection for BMC Helix Discovery. Inspect the LIVE data model (taxonomy) of this instance: node kinds, their attributes / field lists, and relationship kinds.",
  "",
  "Use this ONLY as a last resort — when the DSL cookbook embedded in discovery_execute_dsl, plus the kinds and fields you already know, were NOT enough to build a working custom query. Typical triggers: an unknown node kind, an attribute name you cannot guess, or a relationship you must confirm before traversing. Prefer the specialized tools and the cookbook first.",
  "",
  "Choose `resource`:",
  "- sections             : taxonomy sections (model structure). No other param.",
  "- locales              : available languages. No other param.",
  "- node_kinds           : list every entity type (Host, SoftwareInstance, ...). Optional includeInfo=true for descriptions.",
  "- node_kind            : full metadata for one kind. Requires `kind`.",
  "- node_kind_field_lists : predefined field lists of a kind. Requires `kind`.",
  "- node_kind_fields     : all attributes of a kind for one field list. Requires `kind` and `fieldList`.",
  "- relationship_kinds   : list every relationship kind (HostedSoftware, ...). Optional includeInfo=true.",
  "- relationship_kind    : full metadata for one relationship kind. Requires `kind`."
].join("\n");

export function taxonomyTools(client: DiscoveryClient) {
  return {
    discovery_taxonomy: {
      description: TAXONOMY_DESCRIPTION,
      schema: taxonomySchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async (input: z.infer<typeof taxonomySchema>) => {
        const { resource, kind, fieldList, includeInfo } = input;
        const requireKind = (): string => {
          if (!kind) {
            throw new ApiError(`resource="${resource}" requires a "kind" parameter.`, { code: "INVALID_TAXONOMY_REQUEST" });
          }
          return kind;
        };

        switch (resource) {
          case "sections":
            return client.getTaxonomySections();
          case "locales":
            return client.getTaxonomyLocales();
          case "node_kinds":
            return client.getTaxonomyNodeKinds(includeInfo ?? false);
          case "node_kind":
            return client.getTaxonomyNodeKindDetails(requireKind());
          case "node_kind_field_lists":
            return client.getTaxonomyNodeKindFieldLists(requireKind());
          case "node_kind_fields": {
            const targetKind = requireKind();
            if (!fieldList) {
              throw new ApiError(`resource="node_kind_fields" requires a "fieldList" parameter.`, { code: "INVALID_TAXONOMY_REQUEST" });
            }
            return client.getTaxonomyNodeKindFieldListFields(targetKind, fieldList);
          }
          case "relationship_kinds":
            return client.getTaxonomyRelationshipKinds(includeInfo ?? false);
          case "relationship_kind":
            return client.getTaxonomyRelationshipKindDetails(requireKind());
        }
      }
    }
  };
}
