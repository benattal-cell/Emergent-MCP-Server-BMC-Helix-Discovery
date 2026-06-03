import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { structuredOutputSchema } from "./outputSchemas.js";
import { decodeCsv } from "./commonRelationships.js";
import { componentScore } from "./itCosts/fuzzy.js";
import type { ItCostRow } from "./itCosts/dataLoader.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const priorityOrder = {
  golden: 0,
  common: 1,
  occasional: 2
} as const;

const csvOperatorSchema = z.enum(["has subword", "has substring", "is"]);
const mappedOperatorSchema = z.enum(["has_subword", "has_substring", "is"]);

export const resolveKindSchema = z.object({
  alias: z.string().min(1),
  limit: z.number().int().positive().default(5)
}).strict();

type Priority = keyof typeof priorityOrder;
type CsvOperator = z.infer<typeof csvOperatorSchema>;
type MappedOperator = z.infer<typeof mappedOperatorSchema>;

interface KindAliasEntry {
  alias: string;
  normalizedAlias: string;
  kind: string;
  filterField: string;
  filterOperator: CsvOperator | "";
  filterValue: string;
  priority: string;
  note: string;
  originalIndex: number;
}

export interface ResolvedKindCandidate {
  kind: string;
  filter?: { field: string; operator: MappedOperator; value: string | boolean };
  priority: string;
  matchedAlias: string;
  confidence: number;
  note: string;
  ambiguous: boolean;
}

export interface ResolveKindSuggestion {
  alias: string;
  kind: string;
  priority: string;
  confidence: number;
  note: string;
}

interface KindAliasDataset {
  entries: KindAliasEntry[];
}

function resolveCsvPath(): string {
  const candidates = [
    path.resolve(__dirname, "../data/kind_aliases.csv"),
    path.resolve(__dirname, "../../src/data/kind_aliases.csv")
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`kind_aliases.csv not found. Checked: ${candidates.join(", ")}`);
  }
  return found;
}

function normalizeAlias(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function priorityRank(priority: string): number {
  return priority in priorityOrder ? priorityOrder[priority as Priority] : Number.MAX_SAFE_INTEGER;
}

function parseKindAliasesCsv(csvText: string): KindAliasDataset {
  const entries: KindAliasEntry[] = [];
  let originalIndex = 0;

  for (const rawLine of csvText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;
    if (line.toLowerCase().startsWith("alias;")) continue;

    const columns = line.split(";");
    if (columns.length < 2) continue;

    const [aliasRaw, kindRaw, filterFieldRaw = "", filterOperatorRaw = "", filterValueRaw = "", priorityRaw = "", ...noteParts] = columns;
    const alias = aliasRaw.trim();
    const kind = kindRaw.trim();
    if (!alias || !kind) continue;

    const filterOperator = filterOperatorRaw.trim();
    const parsedOperator = filterOperator === "" ? "" : csvOperatorSchema.parse(filterOperator);

    entries.push({
      alias,
      normalizedAlias: normalizeAlias(alias),
      kind,
      filterField: filterFieldRaw.trim(),
      filterOperator: parsedOperator,
      filterValue: filterValueRaw.trim(),
      priority: priorityRaw.trim(),
      note: noteParts.join(";").trim(),
      originalIndex: originalIndex++
    });
  }

  return { entries };
}

let kindAliasesCache: KindAliasDataset | null = null;

function loadKindAliases(): KindAliasDataset {
  if (kindAliasesCache) return kindAliasesCache;
  const buffer = readFileSync(resolveCsvPath());
  kindAliasesCache = parseKindAliasesCsv(decodeCsv(buffer));
  return kindAliasesCache;
}

function mapOperator(operator: CsvOperator): MappedOperator {
  if (operator === "has subword") return "has_subword";
  if (operator === "has substring") return "has_substring";
  return "is";
}

function parseFilterValue(operator: CsvOperator, value: string): string | boolean {
  if (operator !== "is") return value;
  const normalized = normalizeAlias(value);
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`L'opérateur booléen "is" exige une valeur true ou false, reçu: ${value}`);
}

function toCandidate(entry: KindAliasEntry, ambiguous: boolean): ResolvedKindCandidate {
  const candidate: ResolvedKindCandidate = {
    kind: entry.kind,
    priority: entry.priority,
    matchedAlias: entry.alias,
    confidence: 1,
    note: entry.note,
    ambiguous
  };

  if (entry.filterField || entry.filterOperator || entry.filterValue) {
    if (!entry.filterField || !entry.filterOperator || !entry.filterValue) {
      throw new Error(`Filtre incomplet pour l'alias "${entry.alias}" dans kind_aliases.csv.`);
    }
    candidate.filter = {
      field: entry.filterField,
      operator: mapOperator(entry.filterOperator),
      value: parseFilterValue(entry.filterOperator, entry.filterValue)
    };
  }

  return candidate;
}

function fuzzyScore(input: string, entry: KindAliasEntry): number {
  const row: ItCostRow = {
    "Catégorie": "Discovery",
    "Sous-catégorie": entry.kind,
    "Composant": entry.alias,
    "Unité de mesure": "alias",
    "Coût unitaire min (€)": 0,
    "Coût unitaire médian (€)": 0,
    "Coût unitaire max (€)": 0,
    "Devise": "EUR",
    "Fréquence": "Inclus",
    "Notes / Hypothèses": entry.note,
    "Source / Référence": "kind_aliases.csv",
    "Date de mise à jour": ""
  };
  return componentScore(input, row);
}

function fuzzySuggestions(input: string, entries: KindAliasEntry[], limit: number): ResolveKindSuggestion[] {
  const byAlias = new Map<string, KindAliasEntry>();
  for (const entry of entries) {
    const existing = byAlias.get(entry.normalizedAlias);
    if (!existing || priorityRank(entry.priority) < priorityRank(existing.priority) || (priorityRank(entry.priority) === priorityRank(existing.priority) && entry.originalIndex < existing.originalIndex)) {
      byAlias.set(entry.normalizedAlias, entry);
    }
  }

  return [...byAlias.values()]
    .map((entry) => ({
      entry,
      score: fuzzyScore(input, entry)
    }))
    .filter(({ score }) => score >= 0.35)
    .sort((left, right) => right.score - left.score || priorityRank(left.entry.priority) - priorityRank(right.entry.priority) || left.entry.originalIndex - right.entry.originalIndex)
    .slice(0, limit)
    .map(({ entry, score }) => ({
      alias: entry.alias,
      kind: entry.kind,
      priority: entry.priority,
      confidence: Number(score.toFixed(3)),
      note: entry.note
    }));
}

export function resolveKind(input: z.infer<typeof resolveKindSchema>) {
  const dataset = loadKindAliases();
  const normalized = normalizeAlias(input.alias);
  const exactMatches = dataset.entries
    .filter((entry) => entry.normalizedAlias === normalized)
    .sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority) || left.originalIndex - right.originalIndex);

  const ambiguous = exactMatches.length > 1;
  const candidates = exactMatches.map((entry) => toCandidate(entry, ambiguous));
  const suggestions = candidates.length === 0 ? fuzzySuggestions(input.alias, dataset.entries, input.limit ?? 5) : [];

  return {
    input: input.alias,
    normalizedInput: normalized,
    candidates,
    count: candidates.length,
    suggestions,
    guidance: ambiguous
      ? "Alias ambigu: ne devine pas. Demande à l'utilisateur de choisir le candidat avant d'appeler discovery_build_query."
      : candidates.length === 0
        ? "Aucun alias exact: les suggestions sont indicatives uniquement. Ne les applique pas automatiquement; confirme avec l'utilisateur."
        : "Utilise ce kind et le filtre éventuel comme searchKind et condition where initiale dans discovery_build_query."
  };
}

export function resolveKindTools() {
  return {
    discovery_resolve_kind: {
      description:
        "Pure local resolver for BMC Helix Discovery kind aliases. Call this BEFORE discovery_build_query to translate a user word (for example serveur, esx, vCenter, Oracle SQL) into searchKind plus an optional initial where condition. No Discovery API call is made; ambiguous aliases must be clarified instead of guessed.",
      schema: resolveKindSchema,
      outputSchema: structuredOutputSchema,
      handler: async (input: z.infer<typeof resolveKindSchema>) => resolveKind(input)
    }
  };
}
