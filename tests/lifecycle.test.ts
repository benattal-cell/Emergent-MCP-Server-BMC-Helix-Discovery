import { describe, expect, it } from "vitest";
import { buildLifecycleQuery } from "../src/tools/lifecycle.js";

const baseInput = {
  riskWindowDays: 182,
  includeUrlEncoded: false,
  onlyAtRisk: false
};

describe("buildLifecycleQuery", () => {
  it("builds the risk-window from riskWindowDays", () => {
    const query = buildLifecycleQuery({
      ...baseInput,
      riskWindowDays: 30
    });

    expect(query).toContain("currentTime() + 2592000000000000");
    expect(query).toContain("EOS less than 30 days away");
  });

  it("uses nodecount traversal and has subword for hostNameContains", () => {
    const query = buildLifecycleQuery({
      ...baseInput,
      hostNameContains: "PROD-WEB-01"
    });

    expect(query).toContain("nodecount(traverse RunningSoftware:HostedSoftware:Host:Host where");
    expect(query).toContain('name has subword "PROD-WEB-01"');
    expect(query).toContain('hostname has subword "PROD-WEB-01"');
    expect(query).toContain('dns_name has subword "PROD-WEB-01"');
    expect(query).not.toContain("matches '");
  });

  it("escapes double quotes in publisherContains", () => {
    const query = buildLifecycleQuery({
      ...baseInput,
      publisherContains: 'Microsoft "Corp"'
    });

    expect(query).toContain('(publisher has subword "Microsoft \\"Corp\\"" or type has subword "Microsoft \\"Corp\\"" or @support_publisher has subword "Microsoft \\"Corp\\"")');
  });

  it("matches publisherContains against publisher, type, and support publisher", () => {
    const query = buildLifecycleQuery({
      ...baseInput,
      publisherContains: "Microsoft"
    });

    expect(query).toContain('publisher has subword "Microsoft"');
    expect(query).toContain('type has subword "Microsoft"');
    expect(query).toContain('@support_publisher has subword "Microsoft"');
  });

  it("uses has subword for productContains", () => {
    const query = buildLifecycleQuery({
      ...baseInput,
      productContains: "SQL Server"
    });

    expect(query).toContain('product has subword "SQL Server"');
  });

  it("joins all text filters with and in the where clause", () => {
    const query = buildLifecycleQuery({
      ...baseInput,
      hostNameContains: "PROD-WEB-01",
      publisherContains: "Microsoft",
      productContains: "SQL Server"
    });
    const whereClause = query.slice(query.indexOf(" where ") + " where ".length, query.indexOf(" order by "));

    expect(whereClause).toContain(') and nodecount(traverse RunningSoftware:HostedSoftware:Host:Host where name has subword "PROD-WEB-01"');
    expect(whereClause).toContain(') > 0 and (publisher has subword "Microsoft" or type has subword "Microsoft" or @support_publisher has subword "Microsoft") and product has subword "SQL Server"');
  });
});
