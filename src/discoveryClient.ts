import { AppConfig } from "./config.js";
import { ApiError } from "./utils/errors.js";
import { sanitizeObject } from "./utils/sanitize.js";

const DISCOVERY_SCAN_ENDPOINT = "/scan"; // TODO: replace with exact discovery run/scan endpoint path (without /api/{version}).
const REQUEST_TIMEOUT_MS = 30000;

export interface QueryResult {
  count: number;
  limit: number;
  items: unknown[];
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

  async getNodeGraph(nodeId: string): Promise<unknown> {
    return this.request("GET", this.versionedPath(`/data/nodes/${encodeURIComponent(nodeId)}/graph`), undefined, true);
  }

  async getTopologyServices(payload: unknown): Promise<unknown> {
    return this.request("POST", this.versionedPath(`/topology/services`), payload, true);
  }

  async queryJson(query: unknown, limit = 50): Promise<QueryResult> {
    const queryText = typeof query === "string" ? query : JSON.stringify(query);
    const path = `${this.versionedPath("/data/search")}?offset=0&limit=${encodeURIComponent(String(limit))}`;
    const data = await this.request("POST", path, { query: queryText }, true);
    return normalizeListResult(data, limit);
  }

  findHosts(params: { nameContains?: string; osContains?: string; limit?: number }): Promise<QueryResult> {
    const conditions: unknown[] = [];
    if (params.nameContains) conditions.push(substringCondition("name", params.nameContains));
    if (params.osContains) conditions.push(substringCondition("os", params.osContains));

    const hostNode = {
      type: "node",
      label: "host",
      kind: "Host",
      required: true,
      condition: mergeConditions(conditions),
      show: ["name", "os", "type", "key"].map((name) => ({ type: "attr", name }))
    };

    return this.queryJson([hostNode], params.limit ?? 50);
  }

  findSoftwareInstances(params: { typeContains?: string; nameContains?: string; instanceContains?: string; limit?: number }): Promise<QueryResult> {
    const conditions: unknown[] = [];
    if (params.typeContains) conditions.push(substringCondition("type", params.typeContains));
    if (params.nameContains) conditions.push(substringCondition("name", params.nameContains));
    if (params.instanceContains) conditions.push(substringCondition("instance", params.instanceContains));

    const node = {
      type: "node",
      label: "software",
      kind: "SoftwareInstance",
      required: true,
      condition: mergeConditions(conditions),
      show: ["type", "name", "instance", "product_version"].map((name) => ({ type: "attr", name }))
    };

    return this.queryJson([node], params.limit ?? 50);
  }

  findHostSoftware(params: { hostNameContains: string; softwareTypeContains?: string; limit?: number }): Promise<QueryResult> {
    const hostNode = {
      type: "node",
      label: "host",
      kind: "Host",
      required: true,
      condition: substringCondition("name", params.hostNameContains),
      show: [{ type: "attr", name: "name" }, { type: "attr", name: "key" }]
    };

    const softwareNode = {
      type: "node",
      label: "software",
      kind: "SoftwareInstance",
      required: true,
      condition: params.softwareTypeContains ? substringCondition("type", params.softwareTypeContains) : undefined,
      show: ["type", "name", "instance", "product_version"].map((name) => ({ type: "attr", name }))
    };

    const rel = { type: "relation", label: "hosted", kind: "HostedSoftware", left: "host", right: "software" };
    return this.queryJson([hostNode, softwareNode, rel], params.limit ?? 50);
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

function substringCondition(attrName: string, value: string): unknown {
  return { type: "substring", left: { type: "attr", name: attrName }, right: value };
}
function mergeConditions(conditions: unknown[]): unknown {
  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return { type: "and", conditions };
}
function normalizeListResult(raw: unknown, limit: number): QueryResult {
  const items = Array.isArray(raw) ? raw : (raw && typeof raw === "object" && Array.isArray((raw as { results?: unknown[] }).results)) ? (raw as { results: unknown[] }).results : [];
  return { count: items.length, limit, items };
}
function mapStatusToCode(status: number): string {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "SERVER_ERROR";
  return "HTTP_ERROR";
}
