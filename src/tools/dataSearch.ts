import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";
import { structuredOutputSchema } from "./outputSchemas.js";
import { validateDiscoveryQuery } from "./query.js";

const dataSearchSchema = z
  .object({
    request: z.string().min(1),
    query: z.string().min(1),
    userConfirmed: z.boolean().default(false),
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
  const m = /\bsearch\s+([A-Za-z][A-Za-z0-9_]*)/i.exec(query);
  return m ? m[1] : null;
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
      description:
        "GUARDED exploratory DSL search for NON-STANDARD use cases only. Call this ONLY after discovery_tool_guide shows that NO specialized (level-1) tool covers the need AND the user has explicitly agreed to a data-search attempt. Pass userConfirmed=true only once the user said yes. This tool REFUSES to run until (1) the candidate query passes local DSL validation and (2) the node kinds it references exist in the live taxonomy. On failure it returns what to fix in a `stage` field and does NOT execute. NEVER use raw discovery_search_data for a non-standard case — use this instead.",
      schema: dataSearchSchema,
      outputSchema: structuredOutputSchema,
      handler: async (input: z.infer<typeof dataSearchSchema>) => {
        const lang =
          input.language ??
          (/[àâçéèêëîïôûùü]|requête|données|vulnérabilit/i.test(input.request) ? "fr" : "en");

        // --- Gate 0 : confirmation explicite de l'utilisateur (filet de sécurité Porte A) ---
        if (!input.userConfirmed) {
          return {
            stage: "confirmation_required",
            executed: false,
            request: input.request,
            query: input.query,
            message: msg(
              lang,
              "Ce cas n'est pas une capacité standard. Demande explicitement à l'utilisateur s'il veut tenter une exploration data search (DSL), puis rappelle discovery_data_search avec userConfirmed=true.",
              "This is not a standard capability. Ask the user explicitly whether to attempt a data-search (DSL) exploration, then call discovery_data_search again with userConfirmed=true."
            )
          };
        }

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
            message: msg(
              lang,
              "La requête comporte des erreurs de syntaxe/clause. Corrige-la puis relance discovery_data_search.",
              "The query has syntax/clause errors. Fix it then call discovery_data_search again."
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
              message: msg(
                lang,
                `Le kind « ${primary} » n'existe pas dans la taxonomy de cette instance. Choisis un kind valide (voir suggestions/knownKindsSample) ou appelle discovery_taxonomy_node_kinds, corrige la requête puis relance.`,
                `Kind "${primary}" does not exist in this instance's taxonomy. Pick a valid kind (see suggestions/knownKindsSample) or call discovery_taxonomy_node_kinds, fix the query, then retry.`
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
        const result = await client.queryJson(input.query, input.limit ?? 100, {
          entityLabel: msg(lang, "résultats data search", "data search results"),
          appliedFilters: {}
        });

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
