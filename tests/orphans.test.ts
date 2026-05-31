import { describe, expect, it, vi } from "vitest";
import { buildFindOrphansQuery, orphansTools } from "../src/tools/orphans.js";

const validKinds = ["SoftwareInstance", "Host", "LoadBalancerPool"];
const validRelKinds = ["ObservedCommunication", "HostedSoftware", "BackendPool"];

function normalizeDsl(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function fakeClient(rows: Array<Record<string, unknown>>) {
  return {
    getTaxonomyNodeKinds: vi.fn().mockResolvedValue(validKinds),
    getTaxonomyRelationshipKinds: vi.fn().mockResolvedValue(validRelKinds),
    queryJson: vi.fn().mockResolvedValue({
      summary: "mock",
      totalCount: rows.length,
      returnedCount: rows.length,
      rows
    })
  } as never;
}

describe("buildFindOrphansQuery", () => {
  it("builds rationalization DSL with explicit noise filters", () => {
    const query = buildFindOrphansQuery({
      target_kind: "SoftwareInstance",
      target_filter: { type_matches: "(?i)Database Server$" },
      inbound_relation: { kind: "ObservedCommunication", source_kind: "SoftwareInstance", direction: "in" },
      noise_filters: {
        exclude_source_type_patterns: ["(?i)Management Agent", "(?i)Cluster Server", "(?i)NetWorker"],
        exclude_source_name_patterns: [],
        exclude_self_kind: true,
        exclude_same_host: false
      },
      include_active: false,
      include_inbound_detail: false,
      group_by: null,
      limit: 500
    });

    expect(normalizeDsl(query)).toBe(normalizeDsl(`SEARCH SoftwareInstance
WHERE type MATCHES "(?i)Database Server$"
SHOW name AS name, type AS type, host_name AS host, NODECOUNT(TRAVERSE :ObservedCommunication::SoftwareInstance WHERE type NOT MATCHES "(?i)(Management Agent|Cluster Server|NetWorker)" AND type != "SoftwareInstance") AS significant_inbound, NODECOUNT(TRAVERSE :ObservedCommunication::SoftwareInstance) AS total_inbound`));
  });

  it("builds hosts without hosted software DSL without noise filters", () => {
    const query = buildFindOrphansQuery({
      target_kind: "Host",
      target_filter: {},
      inbound_relation: { kind: "HostedSoftware", source_kind: "SoftwareInstance", direction: "out" },
      noise_filters: { exclude_source_type_patterns: [], exclude_source_name_patterns: [], exclude_self_kind: false, exclude_same_host: false },
      include_active: false,
      include_inbound_detail: false,
      group_by: null,
      limit: 500
    });

    expect(normalizeDsl(query)).toBe(normalizeDsl(`SEARCH Host
SHOW name AS name, type AS type, host_name AS host, NODECOUNT(TRAVERSE :HostedSoftware::SoftwareInstance) AS inbound_count`));
  });

  it("builds audit DSL without traverse WHERE when noise filters are empty", () => {
    const query = buildFindOrphansQuery({
      target_kind: "SoftwareInstance",
      target_filter: { type_matches: "(?i)Database Server$" },
      inbound_relation: { kind: "ObservedCommunication", source_kind: "SoftwareInstance", direction: "in" },
      noise_filters: { exclude_source_type_patterns: [], exclude_source_name_patterns: [], exclude_self_kind: false, exclude_same_host: false },
      include_active: false,
      include_inbound_detail: false,
      group_by: null,
      limit: 500
    });

    expect(normalizeDsl(query)).toBe(normalizeDsl(`SEARCH SoftwareInstance
WHERE type MATCHES "(?i)Database Server$"
SHOW name AS name, type AS type, host_name AS host, NODECOUNT(TRAVERSE :ObservedCommunication::SoftwareInstance) AS inbound_count`));
    expect(query).not.toContain("TRAVERSE :ObservedCommunication::SoftwareInstance WHERE");
  });
});

describe("discovery_find_orphans", () => {
  it("categorizes significant inbound rows from DSL counts", async () => {
    const client = fakeClient([{ name: "mcr-sqldb-38", type: "Microsoft SQL Server", host: "mcr-sqldb-38", significant_inbound: 5, total_inbound: 5 }]);
    const tool = orphansTools(client).discovery_find_orphans;
    const result = await tool.handler({
      target_kind: "SoftwareInstance",
      target_filter: { type_matches: "(?i)Database Server$" },
      inbound_relation: { kind: "ObservedCommunication", source_kind: "SoftwareInstance", direction: "in" },
      noise_filters: { exclude_source_type_patterns: ["(?i)Management Agent"], exclude_source_name_patterns: [], exclude_self_kind: true, exclude_same_host: false },
      include_active: true,
      include_inbound_detail: false,
      group_by: null,
      limit: 500
    });

    expect(result.structuredContent.rows[0]).toMatchObject({ name: "mcr-sqldb-38", significant_inbound: 5, category: "HAS_SIGNIFICANT_INBOUND" });
    expect(result.structuredContent.summary.generated_dsl_query).toContain("NODECOUNT(TRAVERSE :ObservedCommunication::SoftwareInstance WHERE");
  });

  it("categorizes host with zero inbound as NO_INBOUND", async () => {
    const client = fakeClient([{ name: "empty-host", type: "Host", inbound_count: 0 }]);
    const tool = orphansTools(client).discovery_find_orphans;
    const result = await tool.handler({
      target_kind: "Host",
      target_filter: {},
      inbound_relation: { kind: "HostedSoftware", source_kind: "SoftwareInstance", direction: "out" },
      noise_filters: { exclude_source_type_patterns: [], exclude_source_name_patterns: [], exclude_self_kind: false, exclude_same_host: false },
      include_active: false,
      include_inbound_detail: false,
      group_by: null,
      limit: 500
    });

    expect(result.structuredContent.rows[0]).toMatchObject({ name: "empty-host", category: "NO_INBOUND", inbound_count: 0 });
  });
});
