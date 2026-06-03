import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";
import { ApiError } from "../utils/errors.js";
import { structuredOutputSchema } from "./outputSchemas.js";
import { matchCommonRelationships } from "./commonRelationships.js";
import { SEARCH_DATA_DESCRIPTION, enrichDslError, extractDiscoveryErrorMessage, validateDiscoveryQuery } from "./query.js";

const dataSearchSchema = z
  .object({
    request: z.string().min(1),
    query: z.string().min(1),
    // deprecated: ignoré, conservé pour compat appelants
    userConfirmed: z.boolean().optional(),
    // deprecated: ignoré, conservé pour compat appelants
    provenance: z.enum(["curated", "exploratory"]).optional(),
    limit: z.number().int().min(1).max(500).optional(),
    language: z.enum(["fr", "en"]).optional()
  })
  .strict();

// Cache 10 min de la liste des node kinds connus de l'instance
let kindCache: { at: number; kinds: Set<string> } | null = null;
const KIND_TTL_MS = 10 * 60 * 1000;

function normalizeKindNames(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const o = item as Record<string, unknown>;
          return (o.name ?? o.kind ?? o.nodekind ?? o.id) as string | undefined;
        }
        return undefined;
      })
      .filter((v): v is string => typeof v === "string" && v.length > 0);
  }
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const key of ["results", "nodekinds", "kinds", "data"]) {
      if (Array.isArray(o[key])) return normalizeKindNames(o[key]);
    }
  }
  return [];
}

async function getKnownKinds(client: DiscoveryClient): Promise<Set<string> | null> {
  if (kindCache && Date.now() - kindCache.at < KIND_TTL_MS) return kindCache.kinds;
  try {
    const raw = await client.getTaxonomyNodeKinds(false);
    const names = normalizeKindNames(raw);
    if (names.length === 0) return null; // shape non parsable -> fail-open
    const set = new Set(names);
    kindCache = { at: Date.now(), kinds: set };
    return set;
  } catch {
    return null; // taxonomy injoignable -> fail-open (la validation requête s'applique quand même)
  }
}

function extractPrimaryKind(query: string): string | null {
  return primarySearchKind(query) ?? null;
}

function primarySearchKind(query: string): string | undefined {
  const m = /\bSEARCH\s+([A-Za-z][A-Za-z0-9_]*)/i.exec(query);
  return m?.[1];
}

function relationshipHints(request: string, query: string) {
  const { results, antiPatterns } = matchCommonRelationships({
    keywords: request,
    kind: primarySearchKind(query),
    limit: 8
  });
  return { relationshipHints: results, antiPatterns };
}

function extractTraversalKinds(query: string): string[] {
  const kinds = new Set<string>();
  // Forme :role:rel:role:Kind  et  ::Kind
  const re1 = /:[A-Za-z0-9_]*:[A-Za-z0-9_]*:([A-Za-z][A-Za-z0-9_]*)/g;
  const re2 = /::([A-Za-z][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(query)) !== null) kinds.add(m[1]);
  while ((m = re2.exec(query)) !== null) kinds.add(m[1]);
  return [...kinds];
}

function msg(language: "fr" | "en" | undefined, fr: string, en: string): string {
  return (language ?? "fr") === "fr" ? fr : en;
}

export function dataSearchTools(client: DiscoveryClient) {
  return {
    discovery_data_search: {
      description: [
        "Exécute une requête DSL BMC Discovery et renvoie les lignes. Valide la syntaxe puis la taxonomy AVANT d'exécuter ; en cas d'erreur, renvoie un message actionnable (erreurs + chemins TRAVERSE suggérés depuis common_relationships) à corriger et relancer. Utiliser data_search quand aucun outil paramétré de niveau 1 ne couvre le besoin. Les outils paramétrés (find_hosts, lifecycle_report, etc.) restent préférés quand ils existent car ils ajoutent dédup, rôle dérivé et KPI visuels.",
        "",
        "Reference DSL block for this data_search path:",
        ...SEARCH_DATA_DESCRIPTION
      ].join("\n"),
      schema: dataSearchSchema,
      outputSchema: structuredOutputSchema,
      handler: async (input: z.infer<typeof dataSearchSchema>) => {
        const lang =
          input.language ??
          (/[àâçéèêëîïôûùü]|requête|données|vulnérabilit/i.test(input.request) ? "fr" : "en");

        // --- Gate 1 : validation de la requête (local, aucun appel API) ---
        const validation = validateDiscoveryQuery(input.query);
        if (!validation.valid) {
          return {
            stage: "query_validation",
            executed: false,
            valid: false,
            errors: validation.errors,
            hints: validation.hints,
            query: input.query,
            ...relationshipHints(input.request, input.query),
            message: msg(
              lang,
              "La requête comporte des erreurs de syntaxe/clause. Corrige-la puis relance discovery_data_search. Des chemins de traversée curés correspondant à ta demande sont fournis dans relationshipHints — utilise traverseSpec (ou traverseReversed si matchedDirection='reverse') au lieu d'inventer une relation.",
              "The query has syntax/clause errors. Fix it then call discovery_data_search again. Curated traversal paths matching your request are provided in relationshipHints — use traverseSpec (or traverseReversed when matchedDirection='reverse') instead of inventing a relationship."
            )
          };
        }

        // --- Gate 2 : vérification taxonomy des kinds référencés ---
        const known = await getKnownKinds(client);
        const primary = extractPrimaryKind(input.query);
        const traversalKinds = extractTraversalKinds(input.query);
        const warnings: string[] = [];
        let taxonomyChecked = false;

        if (known) {
          taxonomyChecked = true;
          if (primary && !known.has(primary)) {
            const lower = primary.toLowerCase();
            const suggestions = [...known]
              .filter((k) => k.toLowerCase().includes(lower) || lower.includes(k.toLowerCase()))
              .slice(0, 8);
            return {
              stage: "taxonomy",
              executed: false,
              unknownKind: primary,
              suggestions,
              knownKindsSample: [...known].slice(0, 30),
              query: input.query,
              ...relationshipHints(input.request, input.query),
              message: msg(
                lang,
                `Le kind « ${primary} » n'existe pas dans la taxonomy live de cette instance. Les chemins curés fournis ci-dessous dans relationshipHints utilisent des kinds réels ; choisis un kind valide (voir suggestions/knownKindsSample) ou appelle discovery_taxonomy_node_kinds, corrige la requête puis relance.`,
                `Kind "${primary}" does not exist in this instance's live taxonomy. The curated paths below in relationshipHints use real kinds; pick a valid kind (see suggestions/knownKindsSample) or call discovery_taxonomy_node_kinds, fix the query, then retry.`
              )
            };
          }
          const unknownTraversal = traversalKinds.filter((k) => !known.has(k));
          if (unknownTraversal.length > 0) {
            warnings.push(
              msg(
                lang,
                `Kinds de traversal non reconnus (vérifie via discovery_taxonomy_node_kind_details) : ${unknownTraversal.join(", ")}`,
                `Unrecognized traversal kinds (verify via discovery_taxonomy_node_kind_details): ${unknownTraversal.join(", ")}`
              )
            );
          }
        } else {
          warnings.push(
            msg(
              lang,
              "Taxonomy non vérifiable (cache/API indisponible) — exécution autorisée, mais vérifie les kinds manuellement si le résultat est vide.",
              "Taxonomy could not be verified (cache/API unavailable) — execution allowed, but verify kinds manually if results are empty."
            )
          );
        }

        // --- Exécution ---
        let result: unknown;
        try {
          result = await client.queryJson(input.query, input.limit ?? 100, {
            entityLabel: msg(lang, "résultats data search", "data search results"),
            appliedFilters: {}
          });
        } catch (error) {
          if (error instanceof ApiError && error.status === 400) {
            const message = extractDiscoveryErrorMessage(error);
            return {
              stage: "executed",
              executed: false,
              code: "DSL_SYNTAX_ERROR",
              ...enrichDslError(message),
              submitted_query: input.query,
              ...relationshipHints(input.request, input.query)
            };
          }
          throw error;
        }

        return {
          stage: "executed",
          executed: true,
          preflight: { queryValidated: true, taxonomyChecked },
          warnings,
          generated_dsl_query: input.query,
          ...((result as unknown as Record<string, unknown>) ?? {})
        };
      }
    }
  };
}
