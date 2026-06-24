import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";
import { ApiError } from "../utils/errors.js";
import { structuredOutputSchema } from "./outputSchemas.js";
import { matchCommonRelationships } from "./commonRelationships.js";
import { buildDslCookbook, enrichDslError, extractDiscoveryErrorMessage, validateDiscoveryQuery } from "./query.js";

const executeDslSchema = z
  .object({
    request: z.string().min(1),
    query: z.string().min(1),
    confirm: z.boolean().default(false).describe("Double validation. false (défaut) = PRÉVISUALISATION : valide la requête et estime le nombre de lignes SANS exécuter. true = exécute — à ne mettre qu'APRÈS validation explicite de l'utilisateur (le coût en tokens peut être conséquent)."),
    // deprecated alias for `confirm`, kept for back-compat
    userConfirmed: z.boolean().optional(),
    // deprecated: ignoré, conservé pour compat appelants
    provenance: z.enum(["curated", "exploratory"]).optional(),
    offset: z.number().int().min(0).default(0).describe("Pagination : index de départ (0 = début). Si la réponse précédente a hasMore=true, rappeler avec offset=nextOffset."),
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

export async function getKnownKinds(client: DiscoveryClient): Promise<Set<string> | null> {
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

export function executeDslTools(client: DiscoveryClient) {
  return {
    discovery_execute_dsl: {
      description: [
        "Primary DSL query executor / run query / submit query / direct query runner / execute query and return rows. Execute a raw BMC Discovery DSL query and return rows. This is THE tool to run any validated dslQuery — typically one produced by discovery_build_query, but any well-formed DSL works. Two safety gates run before execution: (1) local syntax validation (clause ordering, LOOKUP+WHERE, count(traverse), ASC keyword), (2) taxonomy check on referenced node kinds. On gate failure, returns actionable errors plus curated TRAVERSE paths from common_relationships to fix and retry. TWO-STEP CONFIRMATION (token cost): the FIRST call (confirm=false, default) validates the query and ESTIMATES the matching row count WITHOUT executing (stage='confirmation_required'); show that estimate to the user and only re-call with confirm=true once they approve. Never set confirm=true on your own.",
        "",
        "Exécute une requête DSL BMC Discovery brute et renvoie les lignes. C'est L'outil pour exécuter toute dslQuery validée — typiquement issue de discovery_build_query, mais tout DSL bien formé fonctionne.",
        "",
        "Complete DSL cookbook (grammar + curated examples), embedded here so it loads with tools/list at connection time:",
        buildDslCookbook()
      ].join("\n"),
      schema: executeDslSchema,
      outputSchema: structuredOutputSchema,
      handler: async (input: z.infer<typeof executeDslSchema>) => {
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
              "La requête comporte des erreurs de syntaxe/clause. Corrige-la puis relance discovery_execute_dsl. Des chemins de traversée curés correspondant à ta demande sont fournis dans relationshipHints — utilise traverseSpec (ou traverseReversed si matchedDirection='reverse') au lieu d'inventer une relation.",
              "The query has syntax/clause errors. Fix it then call discovery_execute_dsl again. Curated traversal paths matching your request are provided in relationshipHints — use traverseSpec (or traverseReversed when matchedDirection='reverse') instead of inventing a relationship."
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
                `Le kind « ${primary} » n'existe pas dans la taxonomy live de cette instance. Les chemins curés fournis ci-dessous dans relationshipHints utilisent des kinds réels ; choisis un kind valide (voir suggestions/knownKindsSample) ou appelle discovery_taxonomy(resource="node_kinds"), corrige la requête puis relance.`,
                `Kind "${primary}" does not exist in this instance's live taxonomy. The curated paths below in relationshipHints use real kinds; pick a valid kind (see suggestions/knownKindsSample) or call discovery_taxonomy(resource="node_kinds"), fix the query, then retry.`
              )
            };
          }
          const unknownTraversal = traversalKinds.filter((k) => !known.has(k));
          if (unknownTraversal.length > 0) {
            warnings.push(
              msg(
                lang,
                `Kinds de traversal non reconnus (vérifie via discovery_taxonomy(resource="node_kind", kind=…)) : ${unknownTraversal.join(", ")}`,
                `Unrecognized traversal kinds (verify via discovery_taxonomy(resource="node_kind", kind=…)): ${unknownTraversal.join(", ")}`
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

        // --- Gate 3 : double validation (coût en tokens) ---
        const confirmed = input.confirm || input.userConfirmed === true;
        if (!confirmed) {
          let estimatedRows: number | null = null;
          try {
            const countOnly = await client.queryJson(input.query, 0, {
              entityLabel: msg(lang, "estimation execute DSL", "execute DSL estimate"),
              appliedFilters: {}
            });
            estimatedRows = countOnly.totalCount;
          } catch {
            // count-only peut échouer sur du DSL exotique : on demande confirmation quand même.
          }
          return {
            stage: "confirmation_required",
            executed: false,
            valid: true,
            taxonomyChecked,
            warnings,
            query: input.query,
            estimatedRows,
            message: msg(
              lang,
              `Validation requise avant exécution. Requête VALIDE${estimatedRows !== null ? `, ~${estimatedRows} ligne(s) correspondante(s)` : ""}. L'exécuter peut renvoyer un volume important — coût en tokens potentiellement conséquent. PRÉSENTE ce résumé (requête + nombre de lignes) à l'utilisateur et ne relance avec confirm=true QUE s'il valide.`,
              `Confirmation required before execution. Query VALID${estimatedRows !== null ? `, ~${estimatedRows} matching row(s)` : ""}. Executing it may return a large volume — token cost can be significant. SHOW this summary (query + row count) to the user and only re-call with confirm=true if they approve.`
            )
          };
        }

        // --- Exécution ---
        let result: unknown;
        try {
          result = await client.queryJson(input.query, undefined, {
            entityLabel: msg(lang, "résultats execute DSL", "execute DSL results"),
            appliedFilters: {},
            offset: input.offset
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
