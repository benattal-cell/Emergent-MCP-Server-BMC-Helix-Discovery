import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/utils/errors.js";
import { enrichDslError, getDslExamples, queryTools, validateDiscoveryQuery } from "../src/tools/query.js";

describe("DSL helper ergonomics", () => {
  it("enriches misplaced traversal syntax errors", () => {
    const result = enrichDslError("Syntax error, unexpected 'traverse' on line 1");
    expect(result.original_message).toBe("Syntax error, unexpected 'traverse' on line 1");
    expect(result.hint).toContain("top-level clauses");
  });

  it("returns null hint when no DSL hint rule matches", () => {
    expect(enrichDslError("Bad request")).toEqual({ original_message: "Bad request", hint: null });
  });


  it("returns ordering examples that document the ASC trap", () => {
    const ordering = getDslExamples("ordering");

    expect(ordering.examples).toHaveLength(4);
    expect(ordering.examples[0].query).toBe("SEARCH Host ORDER BY name SHOW name, os");
    expect(ordering.examples[0].explanation).toContain("NO 'ASC' keyword");
    expect(ordering.examples[1].query).toContain("DESC");
  });

  it("enriches ASC syntax errors with the Discovery DSL ordering hint", () => {
    const result = enrichDslError("Syntax error, unexpected identifier at 'asc'");

    expect(result.hint).toContain("no ASC keyword");
  });

  it("rejects ORDER BY ASC locally and explains that ascending is implicit", () => {
    const result = validateDiscoveryQuery("SEARCH Host ORDER BY name asc SHOW name");

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("'ASC' is not valid Discovery DSL.");
    expect(result.hints.join("\n")).toContain("Ascending is the default");
  });

  it("returns curated examples for known topics and available topics for unknown ones", () => {
    const known = getDslExamples("counting");
    expect(known.examples.length).toBeGreaterThanOrEqual(2);
    expect(known.examples[0].query).toContain("NODECOUNT");

    const unknown = getDslExamples("not-a-topic");
    expect(unknown.examples).toEqual([]);
    expect(unknown.availableTopics).toContain("traversal");
  });

  it("validates common local DSL traps without executing Discovery", () => {
    const result = validateDiscoveryQuery("SEARCH SoftwareInstance SHOW name, count(traverse :HostedSoftware::Host) AS x");
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("count(traverse ...)");
    expect(result.hints.join("\n")).toContain("NODECOUNT");
  });


  it("does not reject valid NODECOUNT traversal examples", () => {
    const result = validateDiscoveryQuery('SEARCH Host SHOW name, NODECOUNT(TRAVERSE :HostedSoftware::SoftwareInstance WHERE name HAS SUBSTRING "Tomcat") AS tomcat_count');
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("returns enriched 400 DSL errors from discovery_search_data with submitted query", async () => {
    const query = "search SoftwareInstance show name, count(traverse :ObservedCommunication::SoftwareInstance) as x";
    const client = {
      queryJson: vi.fn().mockRejectedValue(new ApiError("Bad request", {
        status: 400,
        code: "HTTP_ERROR",
        details: { message: "Syntax error, unexpected 'traverse' on line 1" }
      }))
    } as never;
    const tool = queryTools(client).discovery_search_data;

    const result = await tool.handler({ query });

    expect(result).toMatchObject({
      error: true,
      status: 400,
      code: "DSL_SYNTAX_ERROR",
      original_message: "Syntax error, unexpected 'traverse' on line 1",
      submitted_query: query
    });
    expect((result as { hint: string | null }).hint).toContain("NODECOUNT");
    expect(client.queryJson).toHaveBeenCalledWith(query, undefined, { entityLabel: "résultats", appliedFilters: {} });
  });
});
