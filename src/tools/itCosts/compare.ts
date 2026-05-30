import { z } from "zod";
import type { ItCostRow } from "./dataLoader.js";
import { componentScore, findBestComponent, tokenize } from "./fuzzy.js";
import { estimateRowCost } from "./estimate.js";

export const compareAlternativesSchema = z.object({
  workload_type: z.string().min(1).describe("Type de charge à comparer, ex: VM 4 vCPU 16Go RAM."),
  quantity: z.number().positive().describe("Quantité de charges/composants à comparer."),
  current_solution: z.string().min(1).optional().describe("Solution actuelle optionnelle, fuzzy match sur Composant.")
}).strict();

export interface AlternativeComparison {
  component: string;
  category: string;
  annual_cost_median: number;
  annual_cost_min: number;
  annual_cost_max: number;
  unit: string;
  source: string;
}

export interface SavingsComparison {
  alternative: string;
  annual_savings_median: number;
  five_year_savings_median: number;
  savings_pct: number;
}

export interface CompareAlternativesKpi {
  headline_component: string;
  current_component: string | null;
  annual_savings_median: number;
  five_year_savings_median: number;
  savings_pct: number | null;
  currency: "EUR";
  horizon: "annual";
}

function comparableRows(rows: ItCostRow[], workloadType: string, current?: ItCostRow): ItCostRow[] {
  const requiredSpecTokens = tokenize(workloadType).filter((token) => /^(\d+vcpu|\d+gb)$/.test(token));
  const scored = rows.map((row) => ({ row, score: componentScore(workloadType, row) }));
  const preferredSubcategory = current?.["Sous-catégorie"];
  const threshold = preferredSubcategory ? 0.12 : 0.2;
  const filtered = scored.filter(({ row, score }) => {
    const rowTokens = new Set(tokenize(row["Composant"]));
    if (requiredSpecTokens.length > 0 && !requiredSpecTokens.every((token) => rowTokens.has(token))) return false;
    if (preferredSubcategory && row["Sous-catégorie"] === preferredSubcategory) return score > 0.05;
    return score >= threshold;
  });
  return filtered
    .sort((a, b) => b.score - a.score || a.row["Composant"].localeCompare(b.row["Composant"]))
    .map((entry) => entry.row);
}

export function compareAlternatives(rows: ItCostRow[], input: z.infer<typeof compareAlternativesSchema>) {
  const currentMatch = input.current_solution ? findBestComponent(input.current_solution, rows).row : null;
  const candidates = comparableRows(rows, input.workload_type, currentMatch ?? undefined);
  const alternatives = candidates.map((row): AlternativeComparison => {
    const estimate = estimateRowCost(row, input.quantity, "annual");
    return {
      component: row["Composant"],
      category: row["Catégorie"],
      annual_cost_median: estimate.costs.median,
      annual_cost_min: estimate.costs.min,
      annual_cost_max: estimate.costs.max,
      unit: row["Unité de mesure"],
      source: row["Source / Référence"]
    };
  }).sort((a, b) => a.annual_cost_median - b.annual_cost_median).slice(0, 10);

  const currentEstimate = currentMatch ? estimateRowCost(currentMatch, input.quantity, "annual") : null;
  const currentSolution = currentEstimate ? { component: currentEstimate.component, annual_cost_median: currentEstimate.costs.median } : undefined;
  const savings: SavingsComparison[] | undefined = currentSolution
    ? alternatives
      .filter((alternative) => alternative.component !== currentSolution.component)
      .map((alternative) => {
        const annualSavings = Math.round(currentSolution.annual_cost_median - alternative.annual_cost_median);
        return {
          alternative: alternative.component,
          annual_savings_median: annualSavings,
          five_year_savings_median: annualSavings * 5,
          savings_pct: currentSolution.annual_cost_median === 0 ? 0 : Math.round((annualSavings / currentSolution.annual_cost_median) * 100)
        };
      })
      .sort((a, b) => b.annual_savings_median - a.annual_savings_median)
    : undefined;

  const bestSaving = savings?.[0];
  const kpi: CompareAlternativesKpi | null = alternatives.length > 0
    ? {
      headline_component: bestSaving?.alternative ?? alternatives[0].component,
      current_component: currentSolution?.component ?? null,
      annual_savings_median: bestSaving?.annual_savings_median ?? 0,
      five_year_savings_median: (bestSaving?.annual_savings_median ?? 0) * 5,
      savings_pct: currentSolution ? (bestSaving?.savings_pct ?? 0) : null,
      currency: "EUR",
      horizon: "annual"
    }
    : null;

  return {
    workload_type: input.workload_type,
    quantity: input.quantity,
    alternatives,
    current_solution: currentSolution,
    savings_vs_current: savings,
    kpi
  };
}
