import { z } from "zod";
import { loadItCostRows } from "./dataLoader.js";
import { emptySchema, listCategories, searchItCosts, searchItCostsSchema } from "./search.js";
import { estimateCost, estimateCostSchema } from "./estimate.js";
import { compareAlternatives, compareAlternativesSchema } from "./compare.js";
import { eur, kpiGrid, type Kpi } from "../../svg/kpi.js";
import { renderVisual } from "../../svg/renderer.js";
import { arrayResultOutputSchema, itCostCompareOutputSchema, structuredOutputSchema } from "../outputSchemas.js";

function slug(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase() || "it_cost";
}

function visualName(prefix: string, value: string): string {
  return `${prefix}_${slug(value)}`.slice(0, 90);
}

function countSubcategories(categories: Record<string, string[]>): number {
  return Object.values(categories).reduce((sum, subcategories) => sum + subcategories.length, 0);
}

export function itCostTools() {
  const rows = loadItCostRows();
  return {
    search_it_costs: {
      description: "Recherche dans la base de connaissance des coûts IT de référence. Filtres optionnels par catégorie et sous-catégorie. Utile pour découvrir les composants disponibles avant d'estimer.",
      schema: searchItCostsSchema,
      outputSchema: arrayResultOutputSchema,
      handler: async (input: z.infer<typeof searchItCostsSchema>) => {
        const result = searchItCosts(rows, input);
        const svg = kpiGrid("Recherche coûts IT", [
          { label: "Résultats", value: String(result.length), hint: input.query ? `Query: ${input.query}` : "Catalogue filtré" },
          { label: "Catégorie", value: input.category ?? "Toutes", hint: input.subcategory ? `Sous-catégorie: ${input.subcategory}` : undefined }
        ], { columns: 2 });
        return renderVisual(svg, {
          name: visualName("it_cost_search", input.query ?? input.category ?? "all"),
          textSummary: `${result.length} coûts IT trouvés.`,
          structuredContent: result
        });
      },
      isVisual: true as const
    },
    list_categories: {
      description: "Liste hiérarchique des catégories et sous-catégories disponibles dans la base de coûts.",
      schema: emptySchema,
      outputSchema: structuredOutputSchema,
      handler: async () => {
        const result = listCategories(rows);
        const svg = kpiGrid("Catégories coûts IT", [
          { label: "Catégories", value: String(Object.keys(result).length), hint: "Familles de coûts" },
          { label: "Sous-catégories", value: String(countSubcategories(result)), hint: "Niveaux de classement" },
          { label: "Références", value: String(rows.length), hint: "Lignes du catalogue" }
        ]);
        return renderVisual(svg, {
          name: "it_cost_categories",
          textSummary: `${Object.keys(result).length} catégories et ${countSubcategories(result)} sous-catégories disponibles.`,
          structuredContent: result
        });
      },
      isVisual: true as const
    },
    estimate_cost: {
      description: "Estime le coût total pour une quantité donnée d'un composant, sur un horizon temporel (mensuel, annuel, 5 ans). Renvoie min/médian/max et les hypothèses utilisées.",
      schema: estimateCostSchema,
      outputSchema: structuredOutputSchema,
      handler: async (input: z.infer<typeof estimateCostSchema>) => {
        const result = estimateCost(rows, input);
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
        const svg = kpiGrid("Estimation coût IT", kpis);
        return renderVisual(svg, {
          name: visualName("it_cost_estimate", input.component),
          textSummary: "error" in result ? result.error.message : `${result.component}: coût médian ${eur(result.costs.median)} (${result.horizon}).`,
          structuredContent: result
        });
      },
      isVisual: true as const
    },
    compare_alternatives: {
      description: "Compare les alternatives disponibles pour un type de charge (ex: VM 4vCPU 16Go, Base Oracle EE, Suite bureautique). Renvoie les coûts annualisés triés et, si le composant actuel est précisé, calcule l'économie potentielle.",
      schema: compareAlternativesSchema,
      outputSchema: itCostCompareOutputSchema,
      handler: async (input: z.infer<typeof compareAlternativesSchema>) => {
        const result = compareAlternatives(rows, input);
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
            { label: "Alternatives", value: String(result.alternatives.length), hint: input.workload_type },
            { label: "Moins chère", value: result.alternatives[0]?.component ?? "N/A", hint: result.alternatives[0] ? eur(result.alternatives[0].annual_cost_median) : undefined }
          ];
        const svg = kpiGrid("Comparaison alternatives", kpis);
        return renderVisual(svg, {
          name: visualName("it_cost_compare", input.workload_type),
          textSummary: result.kpi
            ? `${result.alternatives.length} alternatives comparées. Meilleure option: ${result.kpi.headline_component}.`
            : "Aucune alternative comparable trouvée.",
          structuredContent: result
        });
      },
      isVisual: true as const
    }
  };
}

export { compareAlternatives } from "./compare.js";
export { estimateCost, estimateRowCost } from "./estimate.js";
export { listCategories, searchItCosts } from "./search.js";
