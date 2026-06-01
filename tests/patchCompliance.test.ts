import { describe, expect, it } from "vitest";
import { buildPatchComplianceQueries, patchComplianceSchema, patchComplianceTools } from "../src/tools/patchCompliance.js";

const baseInput = {
  kbList: ["KB4018271", "KB5000001"],
  complianceMode: "all" as const,
  hostingFilter: "any" as const,
  limit: 100
};

describe("buildPatchComplianceQueries", () => {
  it("builds a Host-based non-compliance query with missing-KB count for all mode", () => {
    const { targetQuery, nonCompliantQuery } = buildPatchComplianceQueries(baseInput);

    expect(targetQuery).toContain("SEARCH Host WHERE os_type = \"Windows\"");
    expect(nonCompliantQuery).toContain("SEARCH Host WHERE os_type = \"Windows\"");
    expect(nonCompliantQuery).toContain("NODECOUNT(TRAVERSE :HostedSoftware::Patch WHERE (name = 'KB4018271' or name = 'KB5000001')) < 2");
    expect(nonCompliantQuery).toContain("#:HostedSoftware::Patch.name AS 'Installed KBs'");
  });

  it("uses zero installed KBs as non-compliant for any mode", () => {
    const { nonCompliantQuery } = buildPatchComplianceQueries({
      ...baseInput,
      complianceMode: "any"
    });

    expect(nonCompliantQuery).toContain("NODECOUNT(TRAVERSE :HostedSoftware::Patch WHERE (name = 'KB4018271' or name = 'KB5000001')) = 0");
    expect(nonCompliantQuery).not.toContain("< 2");
  });

  it("adds hosted software filters for with and without modes only", () => {
    const withQuery = buildPatchComplianceQueries({
      ...baseInput,
      hostsSoftwareMatching: "(?i)SQL Server",
      hostingFilter: "with"
    }).nonCompliantQuery;
    const withoutQuery = buildPatchComplianceQueries({
      ...baseInput,
      hostsSoftwareMatching: "(?i)SQL Server",
      hostingFilter: "without"
    }).nonCompliantQuery;
    const anyQuery = buildPatchComplianceQueries({
      ...baseInput,
      hostsSoftwareMatching: "(?i)SQL Server",
      hostingFilter: "any"
    }).nonCompliantQuery;

    expect(withQuery).toContain('NODECOUNT(TRAVERSE :HostedSoftware::SoftwareInstance WHERE (type MATCHES "(?i)SQL Server" or name MATCHES "(?i)SQL Server")) > 0');
    expect(withoutQuery).toContain('NODECOUNT(TRAVERSE :HostedSoftware::SoftwareInstance WHERE (type MATCHES "(?i)SQL Server" or name MATCHES "(?i)SQL Server")) = 0');
    expect(anyQuery).not.toContain("SoftwareInstance WHERE");
  });

  it("adds flexible OS regex filters", () => {
    const { nonCompliantQuery } = buildPatchComplianceQueries({
      ...baseInput,
      osContains: "(?i)Windows Server 2019"
    });

    expect(nonCompliantQuery).toContain('os MATCHES "(?i)Windows Server 2019"');
  });
});


describe("patchComplianceSchema", () => {
  it("treats an empty hostsSoftwareMatching string as omitted", () => {
    const parsed = patchComplianceSchema.parse({ kbList: ["KB1"], hostsSoftwareMatching: "" });
    expect(parsed.hostsSoftwareMatching).toBeUndefined();
  });
});

describe("discovery_patch_compliance_report", () => {
  it("includes non-compliant host rows as a markdown table in textSummary", async () => {
    const client = {
      queryJson: async (query: string) => {
        if (query.includes("Installed KBs")) {
          return {
            totalCount: 1,
            rows: [{ Host: "srv-a", OS: "Windows Server 2019", "Installed KB Count": 1, "Installed KBs": ["KB1"] }]
          };
        }
        return { totalCount: 2, rows: [{ Host: "srv-a" }, { Host: "srv-b" }] };
      }
    } as never;

    const result = await patchComplianceTools(client).discovery_patch_compliance_report.handler({
      kbList: ["KB1", "KB2"],
      complianceMode: "all",
      hostingFilter: "any",
      limit: 100
    });

    const textBlock = result.content.find((block) => block.type === "text");
    const structured = result.structuredContent as { summary: string };
    expect(textBlock?.text).toContain(structured.summary);
    expect(textBlock?.text).toContain("| Host | OS | Installed KB Count | Missing KBs |");
    expect(textBlock?.text).toContain("KB2");
  });

  it("documents when hostsSoftwareMatching is applied", () => {
    expect(patchComplianceTools({} as never).discovery_patch_compliance_report.description).toContain("ONLY used when hostingFilter is 'with' or 'without'");
  });
});
