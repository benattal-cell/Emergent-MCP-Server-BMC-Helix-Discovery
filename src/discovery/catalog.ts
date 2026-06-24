import { DiscoveryClient } from "../discoveryClient.js";
import type { FlatQueryResult } from "../utils/flatten.js";

export interface CatalogNameEntry {
  name: string;
  kind: "BusinessService" | "BusinessApplicationInstance" | "Host";
  id: string;
}

export interface CatalogSoftwareTypeEntry {
  type: string;
}

export interface CatalogDigest {
  services: Array<{ name: string }>;
  apps: Array<{ name: string }>;
  hosts: Array<{ name: string }>;
  softwareTypes: CatalogSoftwareTypeEntry[];
  truncated: boolean;
  nominalTruncated: boolean;
}

type NominalKind = CatalogNameEntry["kind"];

const NOMINAL_KINDS: NominalKind[] = ["BusinessService", "BusinessApplicationInstance", "Host"];
const DEFAULT_NOMINAL_DIGEST_LIMIT = 300;
const SOFTWARE_TYPES_QUERY = "search SoftwareInstance show type processwith unique()";

let nameRegistry = new Map<string, CatalogNameEntry[]>();
let byKind: Record<NominalKind, CatalogNameEntry[]> = {
  BusinessService: [],
  BusinessApplicationInstance: [],
  Host: []
};
let softwareTypeRegistry = new Map<string, CatalogSoftwareTypeEntry>();
let softwareTypesTruncated = false;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function rowString(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return undefined;
}

function rowFirstString(row: Record<string, unknown>): string | undefined {
  const value = Object.values(row)[0];
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function addNameEntry(registry: Map<string, CatalogNameEntry[]>, entry: CatalogNameEntry): void {
  const key = normalize(entry.name);
  const entries = registry.get(key) ?? [];
  if (!entries.some((existing) => existing.kind === entry.kind && normalize(existing.name) === key)) {
    entries.push(entry);
    registry.set(key, entries);
  }
}

function rows(result: FlatQueryResult): Array<Record<string, unknown>> {
  return result.rows as Array<Record<string, unknown>>;
}

async function loadNominalKind(client: DiscoveryClient, kind: NominalKind): Promise<CatalogNameEntry[]> {
  const result = await client.searchData(`SEARCH ${kind} SHOW name, kind, #id`, {
    entityLabel: `catalog:${kind}`,
    appliedFilters: { catalog: "nominal", kind }
  });
  const seenNames = new Set<string>();
  const entries: CatalogNameEntry[] = [];
  for (const row of rows(result)) {
    const name = rowString(row, ["name", "Name"]);
    if (!name) continue;
    const nameKey = normalize(name);
    if (seenNames.has(nameKey)) continue;
    seenNames.add(nameKey);
    entries.push({
      name,
      kind,
      id: rowString(row, ["#id", "id", "key", "node_id"]) ?? name
    });
  }
  return entries;
}

function softwareTypesFromRows(result: FlatQueryResult): Map<string, CatalogSoftwareTypeEntry> {
  const next = new Map<string, CatalogSoftwareTypeEntry>();
  for (const row of rows(result)) {
    const type = rowString(row, ["type", "Type"]) ?? rowFirstString(row);
    if (!type) continue;
    const key = normalize(type);
    if (!next.has(key)) next.set(key, { type });
  }
  return next;
}

async function loadSoftwareTypes(client: DiscoveryClient): Promise<{ registry: Map<string, CatalogSoftwareTypeEntry>; truncated: boolean }> {
  const result = await client.searchData(SOFTWARE_TYPES_QUERY, {
    entityLabel: "catalog:SoftwareInstanceTypes",
    appliedFilters: { catalog: "softwareTypes", mode: "single-page-unique" },
    omitOffset: true
  });
  return {
    registry: softwareTypesFromRows(result),
    truncated: false
  };
}

export async function loadCatalog(client: DiscoveryClient): Promise<void> {
  const nextRegistry = new Map<string, CatalogNameEntry[]>();
  const nextByKind: Record<NominalKind, CatalogNameEntry[]> = {
    BusinessService: [],
    BusinessApplicationInstance: [],
    Host: []
  };

  await Promise.all(NOMINAL_KINDS.map(async (kind) => {
    try {
      const entries = await loadNominalKind(client, kind);
      nextByKind[kind] = entries;
      for (const entry of entries) addNameEntry(nextRegistry, entry);
    } catch {
      nextByKind[kind] = [];
    }
  }));

  nameRegistry = nextRegistry;
  byKind = nextByKind;

  try {
    const loaded = await loadSoftwareTypes(client);
    softwareTypeRegistry = loaded.registry;
    softwareTypesTruncated = loaded.truncated;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ message: "Discovery software type catalog load failed", error: message })}\n`);
    softwareTypeRegistry = new Map<string, CatalogSoftwareTypeEntry>();
    softwareTypesTruncated = true;
  }
}

export function lookupByName(name: string): CatalogNameEntry[] {
  const key = normalize(name);
  if (!key) return [];
  const exact = nameRegistry.get(key) ?? [];
  const subword = [...nameRegistry.entries()]
    .filter(([nameLower]) => nameLower !== key && nameLower.includes(key))
    .flatMap(([, entries]) => entries);
  return [...exact, ...subword];
}

export function lookupByType(term: string): CatalogSoftwareTypeEntry[] {
  const key = normalize(term);
  if (!key) return [];
  const exact = softwareTypeRegistry.get(key);
  const matches = [...softwareTypeRegistry.entries()]
    .filter(([typeLower]) => typeLower !== key && typeLower.includes(key))
    .map(([, entry]) => entry);
  return [...(exact ? [exact] : []), ...matches];
}

function namesForKind(kind: NominalKind, limit: number): Array<{ name: string }> {
  return byKind[kind]
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ name }) => ({ name }));
}

export function getCatalogDigest(options: { nominalLimit?: number } = {}): CatalogDigest {
  const limit = options.nominalLimit ?? DEFAULT_NOMINAL_DIGEST_LIMIT;
  const totalNominal = NOMINAL_KINDS.reduce((sum, kind) => sum + byKind[kind].length, 0);
  return {
    services: namesForKind("BusinessService", limit),
    apps: namesForKind("BusinessApplicationInstance", limit),
    hosts: namesForKind("Host", limit),
    softwareTypes: [...softwareTypeRegistry.values()].sort((a, b) => a.type.localeCompare(b.type)),
    truncated: softwareTypesTruncated,
    nominalTruncated: totalNominal > (limit * NOMINAL_KINDS.length)
  };
}
