import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";
import { validateDiscoveryQuery } from "./query.js";
import { structuredOutputSchema } from "./outputSchemas.js";
// CONTRAT requis depuis commonRelationships.js :
//   - findTraversePath({ fromKind, toKind }) -> { traverseSpec, toKind, priority, note } | null
//       Cherche dans common_relationships.csv la ligne dont fromKinds inclut fromKind ET
//       toKinds inclut toKind. Tie-break: golden > common > occasional. Réutilise le parseur
//       loadCommonRelationships() existant — NE PAS réimplémenter le parsing.
//   - listTraverseTargets(fromKind) -> Array<{ toKind, priority, note }>
//       Toutes les cibles connues depuis un kind (pour suggérer en cas de chemin absent).
//   - getAntiPatterns() -> string[]   (les lignes "# anti;" du CSV)
import { findTraversePath, listTraverseTargets, getAntiPatterns } from "./commonRelationships.js";

/* ────────────────────────────────────────────────────────────────────────
 * Modèle d'entrée — le LLM fournit une INTENTION structurée, jamais du DSL.
 * Un seul objet `condition`, récursif, réutilisé dans 4 contextes :
 *   - WHERE du SEARCH
 *   - WHERE d'un TRAVERSE
 *   - WHERE interne d'un NODECOUNT
 *   - NODECOUNT lui-même comme membre gauche d'une condition (prédicat sur le compte)
 * ──────────────────────────────────────────────────────────────────────── */

const TRAVERSE_MODE = z.enum(["wildcard", "csv_path"]);

// Opérateurs FERMÉS — le LLM choisit dans une liste, il ne tape pas de syntaxe.
const TEXTUAL_OPERATORS = ["has_subword", "has_substring", "matches_regex", "equals", "exists", "not_exists"] as const;
const NUMERIC_OPERATORS = ["gt", "gte", "lt", "lte", "eq"] as const;

type TextualOperator = (typeof TEXTUAL_OPERATORS)[number];
type NumericOperator = (typeof NUMERIC_OPERATORS)[number];

interface FieldLeft {
  type: "field";
  name: string;
}

interface NodecountLeft {
  type: "nodecount";
  targetKind: string;
  mode?: "wildcard" | "csv_path";
  where?: Condition[];
}

interface Condition {
  left: FieldLeft | NodecountLeft;
  operator: string; // validé selon left.type dans le handler
  value?: string | number;
}

// Zod récursif via z.lazy + annotation explicite du type.
const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z
    .object({
      left: z.union([
        z.object({ type: z.literal("field"), name: z.string().min(1) }).strict(),
        z
          .object({
            type: z.literal("nodecount"),
            targetKind: z.string().min(1),
            mode: TRAVERSE_MODE.optional(),
            where: z.array(conditionSchema).optional()
          })
          .strict()
      ]),
      operator: z.string().min(1),
      value: z.union([z.string(), z.number()]).optional()
    })
    .strict()
);

const traversalSchema = z
  .object({
    targetKind: z.string().min(1),
    mode: TRAVERSE_MODE.optional(), // défaut wildcard, appliqué dans le handler
    where: z.array(conditionSchema).optional()
  })
  .strict();

const aggregateSchema = z
  .object({
    targetKind: z.string().min(1),
    mode: TRAVERSE_MODE.optional(),
    where: z.array(conditionSchema).optional(),
    as: z.string().min(1) // alias de la colonne calculée (AS ...)
  })
  .strict();

const showSchema = z
  .object({
    mode: z.enum(["fields", "summary", "high_detail"]).optional(), // défaut "fields"
    fields: z.array(z.string().min(1)).optional(),
    aggregates: z.array(aggregateSchema).optional(), // NODECOUNT(...) AS label en colonne
    explode: z.string().min(1).optional()
  })
  .strict();

export const buildQuerySchema = z
  .object({
    searchKind: z.string().min(1),
    where: z.array(conditionSchema).optional(),
    traversals: z.array(traversalSchema).optional(),
    show: showSchema.optional(),
    language: z.enum(["fr", "en"]).optional()
  })
  .strict();

/* ────────────────────────────────────────────────────────────────────────
 * Helpers de rendu DSL
 * ──────────────────────────────────────────────────────────────────────── */

class TraversalNotFound extends Error {
  constructor(public fromKind: string, public toKind: string) {
    super(`Aucun chemin CSV de ${fromKind} vers ${toKind}`);
  }
}

function escapeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// Compose le segment de traverse complet à partir d'un spec CSV + kind cible,
// en normalisant le ":" final (le CSV est incohérent là-dessus : cf. lignes 22 vs 27).
function composeCsvTraverse(spec: string, targetKind: string): string {
  const normalized = spec.endsWith(":") ? spec : `${spec}:`;
  return `${normalized}${targetKind}`;
}

// fromKind = kind du set sur lequel porte la traversée (pour résoudre le chemin CSV).
function resolveTraverse(fromKind: string, ref: { targetKind: string; mode?: "wildcard" | "csv_path" }): string {
  const mode = ref.mode ?? "wildcard";
  if (mode === "wildcard") return `:::${ref.targetKind}`;
  const path = findTraversePath({ fromKind, toKind: ref.targetKind });
  if (!path) throw new TraversalNotFound(fromKind, ref.targetKind);
  return composeCsvTraverse(path.traverseSpec, ref.targetKind);
}

const TEXTUAL_TOKEN: Record<Exclude<TextualOperator, "exists" | "not_exists">, string> = {
  has_subword: "HAS SUBWORD",
  has_substring: "HAS SUBSTRING",
  matches_regex: "MATCHES",
  equals: "="
};

const NUMERIC_TOKEN: Record<NumericOperator, string> = {
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  eq: "="
};

function renderValue(value: string | number | undefined): string {
  if (typeof value === "number") return String(value);
  return `"${escapeValue(String(value ?? ""))}"`;
}

// contextKind = kind du set sur lequel cette condition s'applique (pour les NODECOUNT internes).
function renderCondition(cond: Condition, contextKind: string): string {
  if (cond.left.type === "field") {
    const op = cond.operator as TextualOperator;
    if (!(TEXTUAL_OPERATORS as readonly string[]).includes(op)) {
      throw new Error(`Opérateur textuel invalide "${cond.operator}" sur le champ "${cond.left.name}". Autorisés : ${TEXTUAL_OPERATORS.join(", ")}.`);
    }
    if (op === "exists") return cond.left.name;
    if (op === "not_exists") return `NOT ${cond.left.name}`;
    return `${cond.left.name} ${TEXTUAL_TOKEN[op]} ${renderValue(cond.value)}`;
  }

  // left.type === "nodecount" → prédicat numérique sur un compte de voisins.
  const op = cond.operator as NumericOperator;
  if (!(NUMERIC_OPERATORS as readonly string[]).includes(op)) {
    throw new Error(`Opérateur numérique invalide "${cond.operator}" sur un NODECOUNT. Autorisés : ${NUMERIC_OPERATORS.join(", ")}.`);
  }
  if (cond.value === undefined) throw new Error("Un prédicat NODECOUNT exige une valeur numérique (value).");
  const traverse = resolveTraverse(contextKind, cond.left);
  const inner = cond.left.where?.length ? ` WHERE ${renderConditions(cond.left.where, cond.left.targetKind)}` : "";
  return `NODECOUNT(TRAVERSE ${traverse}${inner}) ${NUMERIC_TOKEN[op]} ${renderValue(cond.value)}`;
}

function renderConditions(list: Condition[], contextKind: string): string {
  return list.map((condition) => renderCondition(condition, contextKind)).join(" AND ");
}

/* ────────────────────────────────────────────────────────────────────────
 * Vérifications taxonomy (tolérantes — best-effort, ne cassent jamais)
 * ──────────────────────────────────────────────────────────────────────── */

function extractStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v as string[];
    }
  }
  return [];
}

async function knownNodeKinds(client: DiscoveryClient): Promise<Set<string> | null> {
  try {
    const raw = await client.getTaxonomyNodeKinds(false);
    const names = extractStringArray(raw).concat(
      Array.isArray(raw)
        ? (raw as Array<Record<string, unknown>>).map((r) => (typeof r?.name === "string" ? r.name : "")).filter(Boolean)
        : []
    );
    return names.length > 0 ? new Set(names) : null;
  } catch {
    return null; // taxonomy indisponible → on ne bloque pas la composition
  }
}

async function highDetailAvailable(client: DiscoveryClient, kind: string): Promise<boolean> {
  try {
    const raw = await client.getTaxonomyNodeKindFieldLists(kind);
    return extractStringArray(raw).includes("report_high_detail");
  } catch {
    return false;
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * Rendu du SHOW
 * ──────────────────────────────────────────────────────────────────────── */

interface ShowResult {
  clause: string;
  warnings: string[];
}

function renderShow(show: z.infer<typeof showSchema> | undefined, finalKind: string, highDetailOk: boolean): ShowResult {
  const warnings: string[] = [];
  const mode = show?.mode ?? "fields";

  if (mode === "summary") return { clause: "SHOW SUMMARY", warnings };

  if (mode === "high_detail") {
    if (highDetailOk) return { clause: 'SHOW TAXONOMY "report_high_detail"', warnings };
    warnings.push(`report_high_detail indisponible sur ${finalKind} — repli sur SHOW name, #id.`);
    return { clause: "SHOW name, #id", warnings };
  }

  // mode "fields"
  const parts: string[] = [...(show?.fields ?? [])];
  for (const agg of show?.aggregates ?? []) {
    const traverse = resolveTraverse(finalKind, agg);
    const inner = agg.where?.length ? ` WHERE ${renderConditions(agg.where, agg.targetKind)}` : "";
    parts.push(`NODECOUNT(TRAVERSE ${traverse}${inner}) AS ${agg.as}`);
  }
  if (parts.length === 0) parts.push("name", "#id"); // défaut minimal & sûr
  let clause = `SHOW ${parts.join(", ")}`;
  if (show?.explode) clause += ` EXPLODE ${show.explode}`;
  return { clause, warnings };
}

/* ────────────────────────────────────────────────────────────────────────
 * Composition + assemblage
 * ──────────────────────────────────────────────────────────────────────── */

interface Composition {
  dslQuery: string;
  traversalSources: Array<{ fromKind: string; toKind: string; mode: string; spec: string }>;
  finalKind: string;
  showWarnings: string[];
}

function compose(input: z.infer<typeof buildQuerySchema>, highDetailOk: boolean): Composition {
  const traversalSources: Composition["traversalSources"] = [];

  // SEARCH + WHERE racine
  let dsl = `SEARCH ${input.searchKind}`;
  if (input.where?.length) dsl += ` WHERE ${renderConditions(input.where, input.searchKind)}`;

  // Chaîne de TRAVERSE — chaque hop change le set courant.
  let currentKind = input.searchKind;
  for (const hop of input.traversals ?? []) {
    const mode = hop.mode ?? "wildcard";
    const spec = resolveTraverse(currentKind, hop);
    traversalSources.push({ fromKind: currentKind, toKind: hop.targetKind, mode, spec });
    dsl += ` TRAVERSE ${spec}`;
    if (hop.where?.length) dsl += ` WHERE ${renderConditions(hop.where, hop.targetKind)}`;
    currentKind = hop.targetKind;
  }

  const show = renderShow(input.show, currentKind, highDetailOk);
  dsl += ` ${show.clause}`;

  return { dslQuery: dsl, traversalSources, finalKind: currentKind, showWarnings: show.warnings };
}

/* ────────────────────────────────────────────────────────────────────────
 * Tool
 * ──────────────────────────────────────────────────────────────────────── */

export function buildQueryTools(client: DiscoveryClient) {
  return {
    discovery_build_query: {
      description: [
        "Compose une requête DSL BMC Discovery à partir d'une INTENTION structurée — c'est cet outil, et non le LLM, qui écrit le DSL.",
        "À utiliser pour TOUT besoin non couvert par un outil paramétré de niveau 1 (find_hosts, lifecycle_report, etc.).",
        "Le LLM fournit : searchKind, des conditions where[] (opérateurs FERMÉS : has_subword par défaut), des traversals[] (mode 'wildcard' = :::Kind par défaut, ou 'csv_path' = chemin validé du référentiel common_relationships pour les sauts qui changent le set comme vCenter→Cluster→Host), et un show modal (fields / summary / high_detail / aggregates NODECOUNT / explode).",
        "NODECOUNT s'exprime soit en colonne (show.aggregates), soit en PRÉDICAT dans un where (left.type='nodecount', opérateurs numériques) — ex. 'ESX avec plus de 10 VM Windows'.",
        "Cet outil N'EXÉCUTE PAS : il valide la syntaxe (clause-ordering, etc.) puis l'existence des kinds en taxonomy, et renvoie { dslQuery, ... }. Présenter dslQuery à l'utilisateur (qui peut la modifier), puis l'exécuter via discovery_data_search.",
        "Un chemin csv_path absent du référentiel est REFUSÉ (avec suggestions) — jamais inventé."
      ].join(" "),
      schema: buildQuerySchema,
      outputSchema: structuredOutputSchema,
      handler: async (input: z.infer<typeof buildQuerySchema>) => {
        const language = input.language ?? "fr";

        // Disponibilité de report_high_detail sur le kind final (pour proposer en fin, jamais imposer).
        const finalKindGuess = input.traversals?.length ? input.traversals[input.traversals.length - 1].targetKind : input.searchKind;
        const highDetailOk = await highDetailAvailable(client, finalKindGuess);

        // Composition (peut lever TraversalNotFound ou une erreur d'opérateur).
        let composition: Composition;
        try {
          composition = compose(input, highDetailOk);
        } catch (error) {
          if (error instanceof TraversalNotFound) {
            const targets = listTraverseTargets(error.fromKind);
            return {
              status: "traversal_not_found",
              executed: false,
              fromKind: error.fromKind,
              toKind: error.toKind,
              message:
                language === "fr"
                  ? `Aucun chemin validé de ${error.fromKind} vers ${error.toKind} dans le référentiel. Choisis une cible connue ou utilise mode="wildcard".`
                  : `No validated path from ${error.fromKind} to ${error.toKind} in the referential. Pick a known target or use mode="wildcard".`,
              knownTargetsFromHere: targets,
              antiPatterns: getAntiPatterns()
            };
          }
          return {
            status: "invalid_input",
            executed: false,
            message: error instanceof Error ? error.message : String(error),
            antiPatterns: getAntiPatterns()
          };
        }

        // Gate 1 — validation locale du DSL (clause ordering, LOOKUP+WHERE, count(traverse), etc.).
        const validation = validateDiscoveryQuery(composition.dslQuery);

        // Gate 2 — existence des kinds référencés (best-effort).
        const usedKinds = new Set<string>([input.searchKind, ...(input.traversals ?? []).map((t) => t.targetKind)]);
        const known = await knownNodeKinds(client);
        const unknownKinds = known ? [...usedKinds].filter((k) => !known.has(k)) : [];

        const nextAction =
          language === "fr"
            ? "Présente dslQuery à l'utilisateur pour validation ou modification, puis exécute-la via discovery_data_search."
            : "Show dslQuery to the user for validation or edits, then execute it via discovery_data_search.";

        return {
          status: validation.valid && unknownKinds.length === 0 ? "ready" : "needs_review",
          executed: false,
          dslQuery: composition.dslQuery,
          finalKind: composition.finalKind,
          traversalSources: composition.traversalSources,
          validation: { valid: validation.valid, errors: validation.errors, hints: validation.hints },
          taxonomy: { checked: known !== null, unknownKinds },
          showWarnings: composition.showWarnings,
          highDetailAvailable: highDetailOk,
          ...(highDetailOk && (input.show?.mode ?? "fields") !== "high_detail"
            ? {
                highDetailSuggestion:
                  language === "fr"
                    ? `Pour le détail complet, je peux remplacer le SHOW par TAXONOMY "report_high_detail" (disponible sur ${composition.finalKind}).`
                    : `For full detail, I can switch the SHOW to TAXONOMY "report_high_detail" (available on ${composition.finalKind}).`
              }
            : {}),
          antiPatterns: getAntiPatterns(),
          nextAction
        };
      }
    }
  };
}
