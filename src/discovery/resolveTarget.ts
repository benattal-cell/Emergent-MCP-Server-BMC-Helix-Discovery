import { DiscoveryClient } from "../discoveryClient.js";
import { lookupByName, lookupByType } from "./catalog.js";

export interface ResolvedCandidate {
  id: string;
  name: string;
  kind: string;
}

export type ResolveTargetResult =
  | { status: "node_id"; id: string }
  | { status: "none"; target: string }
  | { status: "unique"; id: string; name: string; kind: string }
  | { status: "ambiguous"; candidates: ResolvedCandidate[] };

const LIVE_KINDS = ["BusinessService", "BusinessApplicationInstance", "Host"] as const;

export function looksLikeNodeId(value: string): boolean {
  return value.length >= 16 && !/\s/.test(value) && /^[A-Za-z0-9+/=_\-]+$/.test(value);
}

function escapeDiscoveryDoubleQuoted(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function rowString(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return undefined;
}

function addCandidate(candidates: Map<string, ResolvedCandidate>, candidate: ResolvedCandidate): void {
  const key = candidate.id || `${candidate.kind}:${candidate.name}`.toLowerCase();
  if (!candidates.has(key)) candidates.set(key, candidate);
}

async function liveLookup(client: DiscoveryClient, target: string): Promise<ResolvedCandidate[]> {
  const needle = escapeDiscoveryDoubleQuoted(target);
  const queries = [
    ...LIVE_KINDS.map((kind) => ({
      kind,
      query: `SEARCH ${kind} WHERE name HAS SUBWORD "${needle}" SHOW name, kind, #id`
    })),
    {
      kind: "SoftwareInstance",
      query: `SEARCH SoftwareInstance WHERE type HAS SUBWORD "${needle}" SHOW name, type, kind, #id`
    }
  ];

  const candidates = new Map<string, ResolvedCandidate>();
  await Promise.all(queries.map(async ({ kind, query }) => {
    try {
      const result = await client.searchData(query, {
        entityLabel: `resolver:${kind}`,
        appliedFilters: { target, kind },
        maxRows: 1000,
        pageSize: 250
      });
      for (const row of result.rows as Array<Record<string, unknown>>) {
        const id = rowString(row, ["#id", "id", "key", "node_id"]);
        if (!id) continue;
        const name = rowString(row, ["name", "Name", "type", "Type"]) ?? id;
        const resolvedKind = rowString(row, ["kind", "Kind"]) ?? kind;
        addCandidate(candidates, { id, name, kind: resolvedKind });
      }
    } catch {
      // Resolver fallback must never crash the caller; unresolved kinds simply contribute no candidates.
    }
  }));
  return [...candidates.values()];
}

export async function resolveTarget(client: DiscoveryClient, input: string): Promise<ResolveTargetResult> {
  const target = input.trim();
  if (looksLikeNodeId(target)) return { status: "node_id", id: target };

  const candidates = new Map<string, ResolvedCandidate>();
  for (const entry of lookupByName(target)) addCandidate(candidates, entry);

  const cachedTypeMatches = lookupByType(target);
  const liveCandidates = await liveLookup(client, target);
  for (const candidate of liveCandidates) addCandidate(candidates, candidate);

  const resolved = [...candidates.values()];
  if (cachedTypeMatches.length > 0 && resolved.length === 0) return { status: "none", target };
  if (resolved.length === 0) return { status: "none", target };
  if (resolved.length === 1) return { status: "unique", ...resolved[0] };
  return { status: "ambiguous", candidates: resolved };
}
