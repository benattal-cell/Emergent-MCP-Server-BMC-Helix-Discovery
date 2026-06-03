import { describe, expect, it } from "vitest";
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

  it("does not expose discovery_search_data as an MCP query tool", () => {
    const tools = queryTools({} as never);

    expect(tools).not.toHaveProperty("discovery_search_data");
    expect(tools).not.toHaveProperty("discovery_search_tree_data");
    expect(tools).toHaveProperty("discovery_dsl_examples");
    expect(tools).toHaveProperty("discovery_validate_query");
    expect(tools).not.toHaveProperty("discovery_topology_services");
  });
});
