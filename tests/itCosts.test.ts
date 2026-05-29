import { describe, expect, it } from "vitest";
import { compareAlternatives, estimateCost, estimateRowCost, searchItCosts } from "../src/tools/itCosts/index.js";
import { loadItCostRows } from "../src/tools/itCosts/dataLoader.js";

const rows = loadItCostRows();

describe("IT cost tools", () => {
  it("normalizes monthly costs to annual", () => {
    const result = estimateCost(rows, { component: "AWS EC2 m5.xlarge", quantity: 10, horizon: "annual", scenario: "all" });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.costs.median).toBe(140 * 10 * 12);
  });

  it("normalizes annual costs to monthly", () => {
    const result = estimateCost(rows, { component: "Oracle Database Enterprise Edition", quantity: 2, horizon: "monthly", scenario: "all" });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.costs.median).toBe(2000);
  });

  it("annualizes one-shot costs over five years", () => {
    const result = estimateRowCost({
      "Catégorie": "TEST",
      "Sous-catégorie": "One-shot",
      "Composant": "Setup ponctuel de référence",
      "Unité de mesure": "Projet",
      "Coût unitaire min (€)": 600,
      "Coût unitaire médian (€)": 1000,
      "Coût unitaire max (€)": 1600,
      "Devise": "EUR",
      "Fréquence": "One-shot",
      "Notes / Hypothèses": "Fixture de test hors catalogue.",
      "Source / Référence": "Unit Test",
      "Date de mise à jour": "2025-01"
    }, 10, "annual");
    expect(result.costs.median).toBe(2000);
  });

  it("returns suggestions for unknown components instead of throwing", () => {
    const result = estimateCost(rows, { component: "Totally unknown platform", quantity: 1, horizon: "annual", scenario: "all" });
    expect("error" in result).toBe(true);
    if (!("error" in result)) return;
    expect(result.error.suggestions).toHaveLength(3);
  });

  it("compares VM 4vCPU 16Go alternatives", () => {
    const result = compareAlternatives(rows, { workload_type: "VM 4vCPU 16Go", quantity: 100, current_solution: "VMware 4 vCPU 16 Go" });
    expect(result.alternatives.length).toBeGreaterThanOrEqual(3);
    expect(result.alternatives.map((a) => a.component).join("\n")).toContain("VMware");
    expect(result.alternatives.map((a) => a.component).join("\n")).toContain("AWS");
    expect(result.alternatives.map((a) => a.component).join("\n")).toContain("Azure");
  });

  it("computes positive savings when an alternative is cheaper than current", () => {
    const result = compareAlternatives(rows, { workload_type: "VM 4vCPU 16Go", quantity: 100, current_solution: "VMware vSphere" });
    expect(result.savings_vs_current?.some((s) => s.annual_savings_median > 0)).toBe(true);
  });

  it("applies category and query filters with AND logic", () => {
    const result = searchItCosts(rows, { category: "CLOUD AWS", query: "m5.xlarge", limit: 10 });
    expect(result).toHaveLength(1);
    expect(result[0]["Catégorie"]).toBe("CLOUD AWS");
    expect(result[0]["Composant"]).toContain("m5.xlarge");
  });
});
