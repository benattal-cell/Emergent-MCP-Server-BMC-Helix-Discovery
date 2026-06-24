import { AppConfig } from "./config.js";
import { ApiError } from "./utils/errors.js";
import { sanitizeObject } from "./utils/sanitize.js";
import { flattenDiscoveryQueryResult, paginationSuffix, type FlatQueryResult } from "./utils/flatten.js";

const REQUEST_TIMEOUT_MS = 30000;

interface SearchOptions {
  /** Explicit row limit. Send `0` for a count-only query (totalCount, no rows). Omit for the API's natural cap. */
  limit?: number;
  offset?: number;
  format?: "object" | "tree";
  omitOffset?: boolean;
  entityLabel?: string;
  appliedFilters?: Record<string, unknown>;
}

export class DiscoveryClient {
  constructor(private readonly config: AppConfig) {}

  async getAbout(): Promise<unknown> {
    return this.request("GET", "/api/about", undefined, false);
  }

  private versionedPath(path: string): string {
    const normalized = path.startsWith("/") ? path : `/${path}`;
    return `/api/${this.config.apiVersion}${normalized}`;
  }

  async request(method: string, path: string, body?: unknown, authRequired = true): Promise<unknown> {
    if (!path.startsWith("/")) {
      throw new ApiError("Path must start with '/'", { code: "INVALID_PATH" });
    }

    if (authRequired && !this.config.token) {
      throw new ApiError("Missing BMC_DISCOVERY_TOKEN for authenticated endpoint", { code: "MISSING_TOKEN" });
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (authRequired && this.config.token) {
      headers.Authorization = `Bearer ${this.config.token}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.config.baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });

      const text = await response.text();
      let parsed: unknown;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new ApiError("Invalid JSON response from Discovery API", {
            status: response.status,
            code: "INVALID_JSON_RESPONSE",
            details: { raw: text.slice(0, 1000) }
          });
        }
      }

      if (!response.ok) {
        throw new ApiError(`Discovery API returned HTTP ${response.status}`, {
          status: response.status,
          code: mapStatusToCode(response.status),
          details: sanitizeObject(parsed)
        });
      }

      return parsed ?? {};
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new ApiError(`Request timeout after ${REQUEST_TIMEOUT_MS}ms`, { code: "TIMEOUT" });
      }
      throw new ApiError("Network or transport error while calling Discovery API", {
        code: "NETWORK_ERROR",
        details: error instanceof Error ? { message: error.message } : error
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async getNodeGraph(nodeId: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<unknown> {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      q.set(k, String(v));
    }
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return this.request("GET", this.versionedPath(`/data/nodes/${encodeURIComponent(nodeId)}/graph${suffix}`), undefined, true);
  }


  async queryJson(query: string, limit?: number, options: { entityLabel?: string; appliedFilters?: Record<string, unknown>; offset?: number } = {}): Promise<FlatQueryResult> {
    // Apply the configured token-budget cap (MCP_RESULT_LIMIT) on the user-facing paginated
    // path. An explicit `limit` wins (incl. 0 for count-only); otherwise the config cap, if any,
    // bounds each page and callers paginate with offset = nextOffset. Internal searchData callers
    // (catalog, resolver, …) are not capped.
    const effective = limit ?? this.config.resultLimit ?? undefined;
    return this.searchData(query, { ...(typeof effective === "number" ? { limit: effective } : {}), format: "object", ...options });
  }

  async searchData(query: string, options: SearchOptions = {}): Promise<FlatQueryResult> {
    const format = options.format === "tree" ? "tree" : "object";
    const offset = options.offset ?? 0;
    const params = new URLSearchParams({ format });
    if (!options.omitOffset) params.set("offset", String(offset));
    // No artificial cap. A `limit` is sent ONLY when the caller asks for one — notably `limit=0`
    // for a count-only query (totalCount without rows). Otherwise the API's natural page size
    // governs. One request, no pagination loop; totalCount/hasMore/nextOffset are exposed so a
    // future offset system can build on them.
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    const path = `${this.versionedPath("/data/search")}?${params.toString()}`;
    const data = await this.request("POST", path, { query }, true);
    const flat = flattenDiscoveryQueryResult(data, {
      entityLabel: options.entityLabel,
      appliedFilters: options.appliedFilters,
      format
    });
    const hasMore = flat.returnedCount > 0 && offset + flat.returnedCount < flat.totalCount;
    const nextOffset = hasMore ? offset + flat.returnedCount : undefined;
    const summary = flat.summary + paginationSuffix({ hasMore, nextOffset, offset });
    return { ...flat, summary, offset, hasMore, ...(nextOffset !== undefined ? { nextOffset } : {}) };
  }

  async getTaxonomySections(): Promise<unknown> {
    return this.request("GET", this.versionedPath(`/taxonomy/sections`), undefined, true);
  }

  async getTaxonomyLocales(): Promise<unknown> {
    return this.request("GET", this.versionedPath(`/taxonomy/locales`), undefined, true);
  }

  async getTaxonomyNodeKinds(includeInfo = false): Promise<unknown> {
    return this.request("GET", this.versionedPath(includeInfo ? `/taxonomy/nodekinds?format=info` : `/taxonomy/nodekinds`), undefined, true);
  }

  async getTaxonomyNodeKindDetails(kind: string): Promise<unknown> {
    return this.request("GET", this.versionedPath(`/taxonomy/nodekinds/${encodeURIComponent(kind)}`), undefined, true);
  }

  async getTaxonomyNodeKindFieldLists(kind: string): Promise<unknown> {
    return this.request("GET", this.versionedPath(`/taxonomy/nodekinds/${encodeURIComponent(kind)}/fieldlists`), undefined, true);
  }

  async getTaxonomyNodeKindFieldListFields(kind: string, fieldList: string): Promise<unknown> {
    return this.request("GET", this.versionedPath(`/taxonomy/nodekinds/${encodeURIComponent(kind)}/fieldlists/${encodeURIComponent(fieldList)}`), undefined, true);
  }

  async getTaxonomyRelationshipKinds(includeInfo = false): Promise<unknown> {
    return this.request("GET", this.versionedPath(includeInfo ? `/taxonomy/relkinds?format=info` : `/taxonomy/relkinds`), undefined, true);
  }

  async getTaxonomyRelationshipKindDetails(kind: string): Promise<unknown> {
    return this.request("GET", this.versionedPath(`/taxonomy/relkinds/${encodeURIComponent(kind)}`), undefined, true);
  }
}

function mapStatusToCode(status: number): string {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "SERVER_ERROR";
  return "HTTP_ERROR";
}
