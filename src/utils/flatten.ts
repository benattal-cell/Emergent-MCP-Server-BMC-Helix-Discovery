export interface FlatQueryResult {
  summary: string;
  totalCount: number;
  returnedCount: number;
  appliedFilters?: Record<string, unknown>;
  kind?: string;
  headings?: string[];
  rows: Array<Record<string, unknown>>;
}

interface DiscoverySearchResultBlock {
  kind?: string;
  count?: number;
  offset?: number;
  headings?: string[];
  results?: unknown[];
}

interface DiscoveryEnvelope {
  count?: number;
  limit?: number;
  items?: unknown[];
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isResultBlock(value: unknown): value is DiscoverySearchResultBlock {
  const rec = toRecord(value);
  if (!rec) return false;
  return "results" in rec || "headings" in rec || "count" in rec;
}

function arrayRowsToObjects(headings: string[], rows: unknown[]): Array<Record<string, unknown>> {
  return rows.map((row) => {
    if (Array.isArray(row)) {
      const obj: Record<string, unknown> = {};
      headings.forEach((h, i) => {
        obj[h] = row[i];
      });
      return obj;
    }
    if (row && typeof row === "object") {
      return row as Record<string, unknown>;
    }
    return { value: row };
  });
}

/**
 * Convert the BMC Discovery /data/search response envelope into a flat,
 * LLM-friendly shape. Discovery returns:
 *   { count: 1, limit: 500, items: [{ kind, count: 1439, headings, results }] }
 * We turn that into:
 *   { summary, totalCount, returnedCount, kind, headings, rows }
 *
 * `summary` is a short human-readable sentence that the LLM reads first.
 * If the LLM truncates the rest, at least the headline number survives.
 */
export function flattenDiscoveryQueryResult(
  raw: unknown,
  options: { entityLabel?: string; appliedFilters?: Record<string, unknown> } = {}
): FlatQueryResult {
  const envelope = toRecord(raw) as DiscoveryEnvelope | undefined;
  const items = Array.isArray(envelope?.items) ? envelope!.items! : [];
  const firstBlock = items.find(isResultBlock);

  if (!firstBlock) {
    return {
      summary: "0 résultat trouvé.",
      totalCount: 0,
      returnedCount: 0,
      appliedFilters: options.appliedFilters,
      rows: []
    };
  }

  const headings = Array.isArray(firstBlock.headings) ? firstBlock.headings : [];
  const rawRows = Array.isArray(firstBlock.results) ? firstBlock.results : [];
  const rows = headings.length > 0 ? arrayRowsToObjects(headings, rawRows) : rawRows.map((r) =>
    r && typeof r === "object" ? (r as Record<string, unknown>) : { value: r }
  );

  const totalCount = typeof firstBlock.count === "number" ? firstBlock.count : rows.length;
  const returnedCount = rows.length;
  const kind = typeof firstBlock.kind === "string" ? firstBlock.kind : undefined;

  const label = options.entityLabel ?? kind ?? "objet";
  const filtersDesc = options.appliedFilters && Object.keys(options.appliedFilters).length > 0
    ? ` (filtres: ${Object.entries(options.appliedFilters).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")})`
    : "";
  const truncated = returnedCount < totalCount;
  const summary = truncated
    ? `${totalCount} ${label} correspondants en base${filtersDesc}, ${returnedCount} retournés (résultats tronqués).`
    : `${totalCount} ${label} correspondants en base${filtersDesc}.`;

  return {
    summary,
    totalCount,
    returnedCount,
    appliedFilters: options.appliedFilters,
    kind,
    headings: headings.length > 0 ? headings : undefined,
    rows
  };
}
