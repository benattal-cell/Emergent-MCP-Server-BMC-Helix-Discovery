function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((item) => cell(item)).join(", ");
  if (typeof value === "object") return JSON.stringify(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function rowsToMarkdownTable(rows: Array<Record<string, unknown>>, opts: { maxRows?: number } = {}): string {
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const columns = Object.keys(rows[0] ?? {});
  if (columns.length === 0) return "";
  const visibleRows = typeof opts.maxRows === "number" && opts.maxRows >= 0 ? rows.slice(0, opts.maxRows) : rows;
  const lines = [
    `| ${columns.map(cell).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...visibleRows.map((row) => `| ${columns.map((column) => cell(row[column])).join(" | ")} |`)
  ];
  const remaining = rows.length - visibleRows.length;
  if (remaining > 0) lines.push(`... et ${remaining} autres lignes`);
  return lines.join("\n");
}

export function appendRowsMarkdownSummary(summary: string | undefined, rows: Array<Record<string, unknown>>, opts: { maxRows?: number } = {}): string {
  const table = rowsToMarkdownTable(rows, opts);
  return [summary ?? "", table].filter((part) => part.trim() !== "").join("\n\n");
}
