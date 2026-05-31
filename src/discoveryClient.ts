import { AppConfig } from "./config.js";
import { ApiError } from "./utils/errors.js";
import { sanitizeObject } from "./utils/sanitize.js";
import { flattenDiscoveryQueryResult, type FlatQueryResult } from "./utils/flatten.js";

const DISCOVERY_SCAN_ENDPOINT = "/scan";
const REQUEST_TIMEOUT_MS = 30000;

interface SearchOptions {
  limit?: number;
  maxRows?: number;
  pageSize?: number;
  format?: "object" | "tree";
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

  async getTopologyServices(payload: unknown): Promise<unknown> {
    return this.request("POST", this.versionedPath(`/topology/services`), payload, true);
  }

  async queryJson(query: string, limit?: number, options: { entityLabel?: string; appliedFilters?: Record<string, unknown> } = {}): Promise<FlatQueryResult> {
    return this.searchData(query, { ...(limit === undefined ? {} : { limit }), format: "object", ...options });
  }

  async searchData(query: string, options: SearchOptions = {}): Promise<FlatQueryResult> {
    const format = options.format === "tree" ? "tree" : "object";
    const fetchPage = async (offset: number, limit?: number): Promise<FlatQueryResult> => {
      const params = new URLSearchParams({
        offset: String(offset),
        format
      });
      if (limit !== undefined) params.set("limit", String(limit));
      const path = `${this.versionedPath("/data/search")}?${params.toString()}`;
      const data = await this.request("POST", path, { query }, true);
      return flattenDiscoveryQueryResult(data, {
        entityLabel: options.entityLabel,
        appliedFilters: options.appliedFilters,
        format
      });
    };

    if (options.maxRows === undefined) return fetchPage(0, options.limit);

    const pageSize = options.pageSize ?? options.limit ?? 500;
    const maxRows = Math.max(0, options.maxRows);
    const rows: Array<Record<string, unknown>> = [];
    let totalCount = 0;
    let first: FlatQueryResult | undefined;

    for (let offset = 0; rows.length < maxRows; offset += pageSize) {
      const page = await fetchPage(offset, Math.min(pageSize, maxRows - rows.length));
      if (!first) first = page;
      totalCount = page.totalCount;
      rows.push(...page.rows);
      if (page.returnedCount === 0 || rows.length >= page.totalCount) break;
    }

    const base = first ?? await fetchPage(0, 0);
    const returnedCount = rows.length;
    const label = options.entityLabel ?? base.kind ?? "objet";
    const filtersDesc = options.appliedFilters && Object.keys(options.appliedFilters).length > 0
      ? ` (filtres: ${Object.entries(options.appliedFilters).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")})`
      : "";
    const formatNote = format === "tree" ? " [format=tree, résultats hiérarchiques]" : "";
    const truncated = returnedCount < totalCount;
    const summary = truncated
      ? `${totalCount} ${label} correspondants en base${filtersDesc}, ${returnedCount} retournés (résultats tronqués)${formatNote}.`
      : `${totalCount} ${label} correspondants en base${filtersDesc}${formatNote}.`;

    return {
      ...base,
      summary,
      totalCount,
      returnedCount,
      rows
    };
  }

  findHosts(params: { nameContains?: string; osContains?: string; limit?: number }): Promise<FlatQueryResult> {
    const filters: string[] = [];
    const applied: Record<string, unknown> = {};
    if (params.nameContains) {
      filters.push(`* has subword "${escapeDiscoveryDoubleQuoted(params.nameContains)}"`);
      applied.nameContains = params.nameContains;
    }
    if (params.osContains) {
      filters.push(`os has subword "${escapeDiscoveryDoubleQuoted(params.osContains)}"`);
      applied.osContains = params.osContains;
    }
    const where = filters.length > 0 ? ` where ${filters.join(" and ")}` : "";
    const query = `search Host${where} show name, hostname, dns_name, os, type, key, #id as 'id'`;
    return this.queryJson(query, params.limit ?? 50, { entityLabel: "hôtes", appliedFilters: applied });
  }

  findSoftwareInstances(params: { typeContains?: string; nameContains?: string; instanceContains?: string; limit?: number }): Promise<FlatQueryResult> {
    const filters: string[] = [];
    const applied: Record<string, unknown> = {};
    if (params.typeContains) {
      filters.push(`type has subword "${escapeDiscoveryDoubleQuoted(params.typeContains)}"`);
      applied.typeContains = params.typeContains;
    }
    if (params.nameContains) {
      filters.push(`name has subword "${escapeDiscoveryDoubleQuoted(params.nameContains)}"`);
      applied.nameContains = params.nameContains;
    }
    if (params.instanceContains) {
      filters.push(`instance has subword "${escapeDiscoveryDoubleQuoted(params.instanceContains)}"`);
      applied.instanceContains = params.instanceContains;
    }
    const where = filters.length > 0 ? ` where ${filters.join(" and ")}` : "";
    const query = `search SoftwareInstance${where} show type, name, instance, product_version`;
    return this.queryJson(query, params.limit ?? 50, { entityLabel: "instances logicielles", appliedFilters: applied });
  }

  findHostSoftware(params: { hostNameContains: string; softwareTypeContains?: string; limit?: number }): Promise<FlatQueryResult> {
    const hostNeedle = escapeDiscoveryDoubleQuoted(params.hostNameContains);
    const hostFilter = `(#:::Host.name has subword "${hostNeedle}" or #:::Host.hostname has subword "${hostNeedle}" or #:::Host.dns_name has subword "${hostNeedle}")`;
    const swFilter = params.softwareTypeContains
      ? ` and type has subword "${escapeDiscoveryDoubleQuoted(params.softwareTypeContains)}"`
      : "";
    const query = `search SoftwareInstance where ${hostFilter}${swFilter} show type, name, instance, product_version, #:::Host.name, #:::Host.hostname, #:::Host.key`;
    const applied: Record<string, unknown> = { hostNameContains: params.hostNameContains };
    if (params.softwareTypeContains) applied.softwareTypeContains = params.softwareTypeContains;
    return this.queryJson(query, params.limit ?? 50, { entityLabel: "logiciels sur l'hôte", appliedFilters: applied });
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

  async startScan(params: { target: string; label?: string; confirm: boolean }): Promise<unknown> {
    if (!params.confirm) {
      throw new ApiError("Scan rejected: confirm must be true", { code: "SCAN_CONFIRMATION_REQUIRED" });
    }
    return this.request("POST", this.versionedPath(DISCOVERY_SCAN_ENDPOINT), { target: params.target, label: params.label }, true);
  }
}

function escapeDiscoveryLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function escapeDiscoveryDoubleQuoted(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function mapStatusToCode(status: number): string {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "SERVER_ERROR";
  return "HTTP_ERROR";
}
