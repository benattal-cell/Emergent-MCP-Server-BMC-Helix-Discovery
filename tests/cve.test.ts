import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildDiscoveryDsl, cpeToRegex, cveTools } from "../src/tools/cve.js";

const tomcatCpe = "cpe:2.3:a:apache:tomcat:*:*:*:*:*:*:*:*";

function extractFirstRegex(dsl: string): RegExp {
  const match = dsl.match(/cpe_string_23 matches '([^']+)'/);
  if (!match) throw new Error(`No CPE regex in DSL: ${dsl}`);
  return new RegExp(match[1]);
}

describe("CVE CPE matching", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("converts wildcard CPE segments to regex wildcards while escaping literal dots", () => {
    expect(cpeToRegex(tomcatCpe)).toContain("cpe:2\\.3:a:apache:tomcat:.*");
  });

  it("keeps an explicit version literal instead of widening it to every version", () => {
    const regex = cpeToRegex("cpe:2.3:a:apache:tomcat:11.0.0:*:*:*:*:*:*:*");
    const versionSegment = regex.split(":")[5];

    expect(versionSegment).toBe("11\\.0\\.0");
    expect(versionSegment).not.toContain(".*");
  });

  it("keeps escaped Cisco parentheses as a valid literal regex", () => {
    const regex = cpeToRegex("cpe:2.3:a:cisco:unified_communications_manager:11.5\\(1\\):*:*:*:*:*:*:*");

    expect(() => new RegExp(regex)).not.toThrow();
    expect(new RegExp(regex).test("cpe:2.3:a:cisco:unified_communications_manager:11.5(1):x")).toBe(true);
  });

  it("builds a regex DSL that matches all versioned Tomcat CPE strings", () => {
    const dsl = buildDiscoveryDsl([tomcatCpe]);
    const regex = extractFirstRegex(dsl);
    const rows = Array.from({ length: 22 }, (_, i) => ({ cpe_string_23: `cpe:2.3:a:apache:tomcat:10.1.${i}:*:*:*:*:*:*:*` }));

    expect(rows.filter((row) => regex.test(row.cpe_string_23))).toHaveLength(22);
  });

  it("does not add a type fallback for firmware or OS CPEs", () => {
    const dsl = buildDiscoveryDsl(["cpe:2.3:o:apache:tomcat:*:*:*:*:*:*:*:*"]);

    expect(dsl).not.toContain("type has subword");
  });

  it("does not add a type fallback for precise application versions", () => {
    const dsl = buildDiscoveryDsl(["cpe:2.3:a:apache:tomcat:11.0.0:*:*:*:*:*:*:*"]);

    expect(dsl).not.toContain("type has subword");
  });

  it("executes the Discovery impact query when executive summary receives no rows", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        vulnerabilities: [{
          cve: {
            configurations: [{
              nodes: [{ cpeMatch: [{ criteria: tomcatCpe }] }]
            }]
          }
        }]
      })
    }));
    const impactedRows = Array.from({ length: 3 }, (_, i) => ({
      Type: "Apache Tomcat",
      "Full Version": `10.1.${i}`,
      CPE: `cpe:2.3:a:apache:tomcat:10.1.${i}:*:*:*:*:*:*:*`,
      "Host Name": `host-${i}`,
      "Service Name": "Jira"
    }));
    const client = {
      searchData: vi.fn().mockResolvedValue({ rows: impactedRows, totalCount: 3, returnedCount: 3 })
    } as never;

    const result = await cveTools(client, {}).discovery_cve_executive_summary.handler({
      cveId: "CVE-2026-34500",
      topN: 5,
      discoveryRows: []
    });

    expect(client.searchData).toHaveBeenCalledWith(expect.stringContaining("cpe_string_23 matches"), expect.objectContaining({ entityLabel: "actifs impactés", maxRows: expect.any(Number) }));
    expect(result.cveSummary.impactedRowsCount).toBe(3);
    expect(JSON.stringify(result)).not.toContain("nextExecutionTool");
    expect(JSON.stringify(result)).not.toContain("discovery_search_data");
  });
});
