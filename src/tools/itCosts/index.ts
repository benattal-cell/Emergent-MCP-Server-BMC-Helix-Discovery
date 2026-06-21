import { z } from "zod";
import { loadItCostRows } from "./dataLoader.js";
import { listCategories, searchItCosts, searchItCostsSchema } from "./search.js";
import { estimateCost, estimateCostSchema } from "./estimate.js";
import { compareAlternatives, compareAlternativesSchema } from "./compare.js";
import { eur, kpiDashboard, countBy, type Kpi, type BarDatum } from "../../svg/kpi.js";
import { renderVisual } from "../../svg/renderer.js";

function slug(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase() || "it_cost";
}

function visualName(prefix: string, value: string): string {
  return `${prefix}_${slug(value)}`.slice(0, 90);
}

function countSubcategories(categories: Record<string, string[]>): number {
  return Object.values(categories).reduce((sum, subcategories) => sum + subcategories.length, 0);
}

const costSchema = z.object({
  mode: z.enum(["categories", "search", "estimate", "compare"]).describe("categories: familles du catalogue ; search: recherche du catalogue ; estimate: coût min/médian/max d'un composant ; compare: alternatives annualisées + économie."),
  // [search]
  query: z.string().min(1).optional().describe("[search] Recherche texte (Composant, Notes / Hypothèses)."),
  category: z.string().min(1).optional().describe("[search] Filtre exact sur Catégorie."),
  subcategory: z.string().min(1).optional().describe("[search] Filtre exact sur Sous-catégorie."),
  limit: z.number().int().min(1).max(50).default(10).describe("[search] Nombre max de lignes (défaut 10, max 50)."),
  // [estimate]
  component: z.string().min(1).optional().describe("[estimate] Composant à estimer (fuzzy sur Composant)."),
  horizon: z.enum(["monthly", "annual", "5_years"]).default("annual").describe("[estimate] Horizon de normalisation."),
  scenario: z.enum(["min", "median", "max", "all"]).default("all").describe("[estimate] Scénario ('all' = min/médian/max)."),
  // [estimate] + [compare]
  quantity: z.number().positive().optional().describe("[estimate/compare] Quantité (requise pour estimate et compare)."),
  // [compare]
  workload_type: z.string().min(1).optional().describe("[compare] Type de charge à comparer (ex: VM 4vCPU 16Go)."),
  current_solution: z.string().min(1).optional().describe("[compare] Solution actuelle (fuzzy), pour calculer l'économie.")
}).strict();

function missingArgs(mode: string, fields: string): { content: { type: "text"; text: string }[]; structuredContent: Record<string, unknown>; isError: true } {
  const text = `mode="${mode}" requiert : ${fields}.`;
  return { content: [{ type: "text", text }], structuredContent: { mode, error: text }, isError: true };
}

export function itCostTools() {
  const rows = loadItCostRows();
  return {
    discovery_cost: {
      description: "Coûts IT de référence / Value Review (base de connaissance locale `it_cost_knowledge_base.csv`). Un seul outil, paramètre `mode` :\n- categories : liste hiérarchique des catégories/sous-catégories (cadrage avant recherche).\n- search : recherche du catalogue (filtres query/category/subcategory).\n- estimate : coût total min/médian/max d'un `component` × `quantity` sur un `horizon`.\n- compare : alternatives annualisées pour un `workload_type` × `quantity`, et l'économie médiane si `current_solution` est fourni.",
      schema: costSchema,
      handler: async (input: z.infer<typeof costSchema>) => {
        switch (input.mode) {
          case "categories": {
            const result = listCategories(rows);
            const bars: BarDatum[] = Object.entries(result).map(([category, subs]) => ({ label: category, value: subs.length }));
            const svg = kpiDashboard("Catégories coûts IT", [
              { label: "Catégories", value: String(Object.keys(result).length), hint: "Familles de coûts" },
              { label: "Sous-catégories", value: String(countSubcategories(result)), hint: "Niveaux de classement" },
              { label: "Références", value: String(rows.length), hint: "Lignes du catalogue" }
            ], bars, { barTitle: "Sous-catégories par catégorie", maxBars: 12 });
            return renderVisual(svg, {
              name: "it_cost_categories",
              textSummary: `${Object.keys(result).length} catégories et ${countSubcategories(result)} sous-catégories disponibles.`,
              structuredContent: result
            });
          }
          case "search": {
            const args = searchItCostsSchema.parse({ query: input.query, category: input.category, subcategory: input.subcategory, limit: input.limit });
            const result = searchItCosts(rows, args);
            const bars = countBy(result as unknown as Array<Record<string, unknown>>, ["Catégorie"]);
            const svg = kpiDashboard("Recherche coûts IT", [
              { label: "Résultats", value: String(result.length), hint: args.query ? `Query: ${args.query}` : "Catalogue filtré" },
              { label: "Catégorie", value: args.category ?? "Toutes", hint: args.subcategory ? `Sous-catégorie: ${args.subcategory}` : undefined }
            ], bars, { barTitle: "Par catégorie", maxBars: 12 });
            return renderVisual(svg, {
              name: visualName("it_cost_search", args.query ?? args.category ?? "all"),
              textSummary: `${result.length} coûts IT trouvés.`,
              structuredContent: { result, count: result.length }
            });
          }
          case "estimate": {
            const parsed = estimateCostSchema.safeParse({ component: input.component, quantity: input.quantity, horizon: input.horizon, scenario: input.scenario });
            if (!parsed.success) return missingArgs("estimate", "component + quantity");
            const result = estimateCost(rows, parsed.data);
            const kpis: Kpi[] = "error" in result
              ? [
                { label: "Erreur", value: "0 €", hint: result.error.message },
                { label: "Suggestions", value: String(result.error.suggestions.length), hint: result.error.suggestions[0] }
              ]
              : [
                { label: "Coût min", value: eur(result.costs.min), hint: result.horizon },
                { label: "Coût médian", value: eur(result.costs.median), hint: `${result.quantity} × ${result.unit}` },
                { label: "Coût max", value: eur(result.costs.max), hint: result.currency }
              ];
            const bars: BarDatum[] = "error" in result
              ? []
              : [
                { label: "Min", value: result.costs.min },
                { label: "Médian", value: result.costs.median },
                { label: "Max", value: result.costs.max }
              ];
            const svg = kpiDashboard("Estimation coût IT", kpis, bars, { barTitle: `Scénarios (${result && "horizon" in result ? result.horizon : "annual"})`, formatValue: eur });
            return renderVisual(svg, {
              name: visualName("it_cost_estimate", parsed.data.component),
              textSummary: "error" in result ? result.error.message : `${result.component}: coût médian ${eur(result.costs.median)} (${result.horizon}).`,
              structuredContent: result
            });
          }
          case "compare":
          default: {
            const parsed = compareAlternativesSchema.safeParse({ workload_type: input.workload_type, quantity: input.quantity, current_solution: input.current_solution });
            if (!parsed.success) return missingArgs("compare", "workload_type + quantity");
            const result = compareAlternatives(rows, parsed.data);
            const kpis: Kpi[] = result.kpi && result.kpi.current_component
              ? [
                {
                  label: "Économie annuelle",
                  value: eur(result.kpi.annual_savings_median),
                  hint: result.kpi.headline_component,
                  delta: result.kpi.savings_pct === null ? undefined : { text: `${result.kpi.savings_pct}%`, positive: result.kpi.annual_savings_median >= 0 }
                },
                { label: "Économie 5 ans", value: eur(result.kpi.five_year_savings_median), hint: "Projection médiane" },
                { label: "Meilleure alternative", value: result.kpi.headline_component, hint: "Triée par économie" }
              ]
              : [
                { label: "Alternatives", value: String(result.alternatives.length), hint: parsed.data.workload_type },
                { label: "Moins chère", value: result.alternatives[0]?.component ?? "N/A", hint: result.alternatives[0] ? eur(result.alternatives[0].annual_cost_median) : undefined }
              ];
            const bars: BarDatum[] = result.alternatives.map((alt) => ({ label: alt.component, value: alt.annual_cost_median }));
            const svg = kpiDashboard("Comparaison alternatives", kpis, bars, { barTitle: "Coût annuel par alternative", formatValue: eur });
            return renderVisual(svg, {
              name: visualName("it_cost_compare", parsed.data.workload_type),
              textSummary: result.kpi
                ? `${result.alternatives.length} alternatives comparées. Meilleure option: ${result.kpi.headline_component}.`
                : "Aucune alternative comparable trouvée.",
              structuredContent: result
            });
          }
        }
      },
      isVisual: true as const
    }
  };
}

export { compareAlternatives } from "./compare.js";
export { estimateCost, estimateRowCost } from "./estimate.js";
export { listCategories, searchItCosts } from "./search.js";
