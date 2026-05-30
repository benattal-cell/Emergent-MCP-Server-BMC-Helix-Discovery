import { describe, expect, it } from "vitest";
import { eur, kpiGrid } from "../src/svg/kpi.js";

describe("kpiGrid", () => {
  it("renders a readable SVG KPI grid", () => {
    const svg = kpiGrid("Synthèse", [
      { label: "Médian", value: eur(123456), hint: "annual", delta: { text: "+12%", positive: true } }
    ]);

    expect(svg).toContain("<svg");
    expect(svg).toContain("Synthèse");
    expect(svg).toContain("MÉDIAN");
    expect(svg).toContain("123");
  });
});
