import type { ItCostRow } from "./dataLoader.js";

export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/(\d+)\s*vcpu\b/g, "$1vcpu")
    .replace(/(\d+)\s*(go|gb)\b/g, "$1gb")
    .replace(/go\b/g, "gb")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const STOP_TOKENS = new Set(["vm", "instance", "instances", "mois", "an", "ans", "cloud", "compute", "ram"]);

export function tokenize(value: string): string[] {
  const normalized = normalizeText(value);
  return normalized.length === 0
    ? []
    : normalized.split(/\s+/).filter((token) => token.length > 1 && !STOP_TOKENS.has(token));
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  const current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }

  return previous[b.length];
}

function tokenOverlapScore(query: string, candidate: string): number {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return 0;
  const candidateTokens = new Set(tokenize(candidate));
  const matched = queryTokens.filter((token) => candidateTokens.has(token)).length;
  return matched / queryTokens.length;
}

export function componentScore(query: string, row: ItCostRow): number {
  const normalizedQuery = normalizeText(query);
  const component = normalizeText(row["Composant"]);
  const subcategory = normalizeText(row["Sous-catégorie"]);
  if (component === normalizedQuery) return 1;
  if (component.includes(normalizedQuery) || normalizedQuery.includes(component)) return 0.95;
  const overlap = Math.max(tokenOverlapScore(query, row["Composant"]), tokenOverlapScore(query, row["Sous-catégorie"]));
  const distance = levenshtein(normalizedQuery, component);
  const maxLen = Math.max(normalizedQuery.length, component.length, 1);
  const distanceScore = 1 - distance / maxLen;
  const subcategoryBoost = subcategory.includes(normalizedQuery) || normalizedQuery.includes(subcategory) ? 0.15 : 0;
  return Math.max(overlap, distanceScore * 0.7) + subcategoryBoost;
}

export function closestRows(query: string, rows: ItCostRow[], limit: number): ItCostRow[] {
  return [...rows]
    .map((row) => ({ row, score: componentScore(query, row) }))
    .sort((a, b) => b.score - a.score || a.row["Composant"].localeCompare(b.row["Composant"]))
    .slice(0, limit)
    .map((entry) => entry.row);
}

export function findBestComponent(query: string, rows: ItCostRow[]): { row: ItCostRow | null; suggestions: ItCostRow[] } {
  const ranked = [...rows]
    .map((row) => ({ row, score: componentScore(query, row) }))
    .sort((a, b) => b.score - a.score || a.row["Composant"].localeCompare(b.row["Composant"]));
  const best = ranked[0];
  if (best && best.score >= 0.45) return { row: best.row, suggestions: ranked.slice(0, 3).map((entry) => entry.row) };
  return { row: null, suggestions: ranked.slice(0, 3).map((entry) => entry.row) };
}
