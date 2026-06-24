export interface FlatQueryResult {
  summary: string;
  totalCount: number;
  returnedCount: number;
  /** Offset of the first returned row (pagination). */
  offset?: number;
  /** True when more rows exist beyond this page (offset + returnedCount < totalCount). */
  hasMore?: boolean;
  /** Offset to pass to fetch the next page (only present when hasMore). */
  nextOffset?: number;
  appliedFilters?: Record<string, unknown>;
  kind?: string;
  headings?: string[];
  format?: "object" | "tree";
  rows: Array<Record<string, unknown>>;
}

/**
 * Actionable next-page hint appended to a summary when more rows exist, or "" otherwise.
 * The API caps each call, so callers paginate by re-invoking with offset = nextOffset.
 */
export function paginationSuffix(result: Pick<FlatQueryResult, "hasMore" | "nextOffset" | "offset">): string {
  return result.hasMore && result.nextOffset !== undefined
    ? ` Rappeler le même outil avec offset=${result.nextOffset} pour la page suivante (page courante depuis l'offset ${result.offset ?? 0}).`
    : "";
}

interface DiscoverySearchResultBlock {
  kind?: string;
  count?: number;
  offset?: number;
  headings?: string[];
  results?: unknown[];
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
  options: { entityLabel?: string; appliedFilters?: Record<string, unknown>; format?: "object" | "tree" } = {}
): FlatQueryResult {
  const format = options.format ?? "object";

  let blocks: unknown[];
  if (Array.isArray(raw)) {
    blocks = raw;
  } else {
    const envelope = toRecord(raw);
    blocks = Array.isArray(envelope?.items) ? envelope.items : [];
  }
  const firstBlock = blocks.find(isResultBlock);

  if (!firstBlock) {
    const summary = blocks.length === 0
      ? "0 résultat trouvé (réponse Discovery vide ou format inattendu)."
      : "0 résultat trouvé.";
    return {
      summary,
      totalCount: 0,
      returnedCount: 0,
      appliedFilters: options.appliedFilters,
      format,
      rows: []
    };
  }

  const headings = Array.isArray(firstBlock.headings) ? firstBlock.headings : [];
  const rawRows = Array.isArray(firstBlock.results) ? firstBlock.results : [];
  let rows: Array<Record<string, unknown>>;
  if (format === "tree") {
    rows = rawRows.map((r) =>
      r && typeof r === "object" ? (r as Record<string, unknown>) : { value: r }
    );
  } else {
    rows = headings.length > 0 ? arrayRowsToObjects(headings, rawRows) : rawRows.map((r) =>
      r && typeof r === "object" ? (r as Record<string, unknown>) : { value: r }
    );
  }

  const totalCount = typeof firstBlock.count === "number" ? firstBlock.count : rows.length;
  const returnedCount = rows.length;
  const kind = typeof firstBlock.kind === "string" ? firstBlock.kind : undefined;

  const label = options.entityLabel ?? kind ?? "objet";
  const filtersDesc = options.appliedFilters && Object.keys(options.appliedFilters).length > 0
    ? ` (filtres: ${Object.entries(options.appliedFilters).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")})`
    : "";
  const formatNote = format === "tree" ? " [format=tree, résultats hiérarchiques]" : "";
  const truncated = returnedCount < totalCount;
  const summary = truncated
    ? `${totalCount} ${label} correspondants en base${filtersDesc}, ${returnedCount} retournés (résultats tronqués)${formatNote}.`
    : `${totalCount} ${label} correspondants en base${filtersDesc}${formatNote}.`;

  return {
    summary,
    totalCount,
    returnedCount,
    appliedFilters: options.appliedFilters,
    kind,
    headings: headings.length > 0 ? headings : undefined,
    format,
    rows
  };
}
