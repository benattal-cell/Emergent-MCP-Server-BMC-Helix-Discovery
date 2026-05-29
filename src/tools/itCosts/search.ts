import { z } from "zod";
import type { ItCostRow } from "./dataLoader.js";
import { normalizeText } from "./fuzzy.js";

export const searchItCostsSchema = z.object({
  query: z.string().min(1).optional().describe("Recherche texte insensible à la casse sur Composant et Notes / Hypothèses."),
  category: z.string().min(1).optional().describe("Filtre exact insensible à la casse sur Catégorie."),
  subcategory: z.string().min(1).optional().describe("Filtre exact insensible à la casse sur Sous-catégorie."),
  limit: z.number().int().min(1).max(50).default(10).describe("Nombre maximum de lignes retournées (défaut 10, max 50).")
}).strict();

export const emptySchema = z.object({}).strict();

function exactNormalized(value: string, expected: string): boolean {
  return normalizeText(value) === normalizeText(expected);
}

export function searchItCosts(rows: ItCostRow[], input: z.infer<typeof searchItCostsSchema>): ItCostRow[] {
  const query = input.query ? normalizeText(input.query) : null;
  return rows.filter((row) => {
    if (input.category && !exactNormalized(row["Catégorie"], input.category)) return false;
    if (input.subcategory && !exactNormalized(row["Sous-catégorie"], input.subcategory)) return false;
    if (query) {
      const haystack = normalizeText(`${row["Composant"]} ${row["Notes / Hypothèses"]}`);
      if (!haystack.includes(query)) return false;
    }
    return true;
  }).slice(0, input.limit);
}

export function listCategories(rows: ItCostRow[]): Record<string, string[]> {
  const categories: Record<string, Set<string>> = {};
  for (const row of rows) {
    categories[row["Catégorie"]] ??= new Set<string>();
    categories[row["Catégorie"]].add(row["Sous-catégorie"]);
  }
  return Object.fromEntries(Object.entries(categories)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, subcategories]) => [category, [...subcategories].sort((a, b) => a.localeCompare(b))]));
}
