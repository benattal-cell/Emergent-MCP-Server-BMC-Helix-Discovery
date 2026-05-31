import { describe, expect, it } from "vitest";
import { buildOsLifecycleQuery } from "../src/tools/osLifecycle.js";

const baseInput = {
  onlyAtRisk: false,
  riskWindowDays: 182,
  limit: 100
};

describe("buildOsLifecycleQuery", () => {
  it("starts from Host and traverses only OS SupportDetail", () => {
    const query = buildOsLifecycleQuery(baseInput);

    expect(query).toContain("SEARCH Host WITH");
    expect(query).toContain("#ElementWithDetail:SupportDetail:OSDetail:SupportDetail.end_support_date");
    expect(query).toContain("#ElementWithDetail:SupportDetail:OSDetail:SupportDetail.failure_reason");
    expect(query).toContain("(@detail_type = 'OS' or @support_type = 'OS')");
    expect(query).toContain("name AS 'Host', os AS 'OS', vendor AS 'Vendor', virtual AS 'Virtual'");
  });

  it("filters at-risk hosts by EOS earlier than current time", () => {
    const query = buildOsLifecycleQuery({
      ...baseInput,
      onlyAtRisk: true
    });

    expect(query).toContain("(@end_support_date and @end_support_date < currentTime())");
    expect(query).toContain("EOS Exceeded");
  });

  it("builds the risk-window filter from riskWindowDays", () => {
    const query = buildOsLifecycleQuery({
      ...baseInput,
      riskWindowDays: 30
    }, "window");

    expect(query).toContain("@end_support_date >= currentTime()");
    expect(query).toContain("@end_support_date < currentTime() + 2592000000000000");
    expect(query).toContain("EOS less than 30 days away");
  });

  it("treats not pertinent failure_reason as not missing data", () => {
    const query = buildOsLifecycleQuery(baseInput);

    expect(query).toContain('@failure_reason MATCHES "(?i).*not pertinent.*"');
    expect(query).toContain("and 'Not pertinent'");
    expect(query).toContain("or 'Missing lifecycle dates'");
    expect(query.indexOf("Not pertinent")).toBeLessThan(query.indexOf("Missing lifecycle dates"));
  });

  it("adds flexible OS regex filters", () => {
    const query = buildOsLifecycleQuery({
      ...baseInput,
      osContains: "(?i)Windows Server"
    });

    expect(query).toContain('os MATCHES "(?i)Windows Server"');
  });
});
