import { z } from "zod";
import type { CostFrequency, ItCostRow } from "./dataLoader.js";
import { findBestComponent } from "./fuzzy.js";

export const estimateCostSchema = z.object({
  component: z.string().min(1).describe("Nom ou fragment du composant à estimer (recherche fuzzy sur Composant)."),
  quantity: z.number().positive().describe("Quantité à multiplier par le coût unitaire."),
  horizon: z.enum(["monthly", "annual", "5_years"]).default("annual").describe("Horizon de normalisation: monthly, annual ou 5_years."),
  scenario: z.enum(["min", "median", "max", "all"]).default("all").describe("Scénario souhaité. 'all' retourne min/médian/max.")
}).strict();

export type CostHorizon = "monthly" | "annual" | "5_years";

type Scenario = "min" | "median" | "max" | "all";

export interface CostEstimate {
  component: string;
  unit: string;
  quantity: number;
  horizon: CostHorizon;
  costs: { min: number; median: number; max: number };
  currency: "EUR";
  assumptions: string;
  source: string;
  data_freshness: string;
}

export interface CostEstimateError {
  error: { message: string; suggestions: string[] };
}

function multiplierFor(frequency: CostFrequency, horizon: CostHorizon): { multiplier: number; note: string } {
  if (frequency === "Mensuel") {
    if (horizon === "monthly") return { multiplier: 1, note: "Coût mensuel conservé tel quel." };
    if (horizon === "annual") return { multiplier: 12, note: "Coût mensuel normalisé en annuel (×12)." };
    return { multiplier: 60, note: "Coût mensuel normalisé sur 5 ans (×60)." };
  }
  if (frequency === "Annuel") {
    if (horizon === "monthly") return { multiplier: 1 / 12, note: "Coût annuel normalisé en mensuel (÷12)." };
    if (horizon === "annual") return { multiplier: 1, note: "Coût annuel conservé tel quel." };
    return { multiplier: 5, note: "Coût annuel normalisé sur 5 ans (×5)." };
  }
  if (frequency === "One-shot") {
    if (horizon === "monthly") return { multiplier: 1 / 60, note: "Coût one-shot annualisé sur 5 ans puis ramené au mois (÷60)." };
    if (horizon === "annual") return { multiplier: 1 / 5, note: "Coût one-shot annualisé sur 5 ans (÷5)." };
    return { multiplier: 1, note: "Coût one-shot compté une seule fois sur l'horizon 5 ans." };
  }
  return { multiplier: 0, note: "Composant marqué Inclus: coût forcé à 0 EUR." };
}

export function estimateRowCost(row: ItCostRow, quantity: number, horizon: CostHorizon): CostEstimate {
  const normalization = multiplierFor(row["Fréquence"], horizon);
  const factor = quantity * normalization.multiplier;
  return {
    component: row["Composant"],
    unit: row["Unité de mesure"],
    quantity,
    horizon,
    costs: {
      min: Math.round(row["Coût unitaire min (€)"] * factor),
      median: Math.round(row["Coût unitaire médian (€)"] * factor),
      max: Math.round(row["Coût unitaire max (€)"] * factor)
    },
    currency: "EUR",
    assumptions: `${row["Notes / Hypothèses"]} ${normalization.note}`.trim(),
    source: row["Source / Référence"],
    data_freshness: row["Date de mise à jour"]
  };
}

function applyScenario(estimate: CostEstimate, scenario: Scenario): CostEstimate {
  if (scenario === "all") return estimate;
  const selected = estimate.costs[scenario];
  return { ...estimate, costs: { min: selected, median: selected, max: selected } };
}

export function estimateCost(rows: ItCostRow[], input: z.infer<typeof estimateCostSchema>): CostEstimate | CostEstimateError {
  const match = findBestComponent(input.component, rows);
  if (!match.row) {
    return { error: { message: `Aucun composant de coût ne correspond à '${input.component}'.`, suggestions: match.suggestions.map((row) => row["Composant"]) } };
  }
  return applyScenario(estimateRowCost(match.row, input.quantity, input.horizon), input.scenario);
}
