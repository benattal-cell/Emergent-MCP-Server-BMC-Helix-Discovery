import { describe, expect, it } from "vitest";
import { rowsToMarkdownTable } from "../src/tools/shared/markdownTable.js";

describe("rowsToMarkdownTable", () => {
  it("produces a markdown table with header and rows", () => {
    const table = rowsToMarkdownTable([{ name: "A", eos: "2014" }, { name: "B", eos: "2015" }]);

    expect(table).toContain("| name | eos |");
    expect(table).toContain("| --- | --- |");
    expect(table).toContain("| A | 2014 |");
    expect(table).toContain("| B | 2015 |");
  });

  it("returns an empty string for empty rows", () => {
    expect(rowsToMarkdownTable([])).toBe("");
  });

  it("can truncate and append the number of remaining rows", () => {
    const table = rowsToMarkdownTable([{ name: "A" }, { name: "B" }, { name: "C" }], { maxRows: 2 });

    expect(table).toContain("| A |");
    expect(table).toContain("| B |");
    expect(table).not.toContain("| C |");
    expect(table).toContain("... et 1 autres lignes");
  });
});
