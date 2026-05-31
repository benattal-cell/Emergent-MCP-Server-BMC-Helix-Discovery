import { describe, expect, it } from "vitest";
import { buildPatchComplianceQueries } from "../src/tools/patchCompliance.js";

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
