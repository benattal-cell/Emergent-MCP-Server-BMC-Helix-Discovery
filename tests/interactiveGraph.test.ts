import { describe, expect, it, vi } from "vitest";

vi.mock("../src/svg/cytoscapeBundle.js", () => ({
  cytoscapeJsSource: "function cytoscape(){}"
}));

import { buildInteractiveHtml } from "../src/svg/interactiveGraph.js";

describe("buildInteractiveHtml", () => {
  it("embeds optional node metadata and tooltip rows", () => {
    const html = buildInteractiveHtml(
      [{ id: "n1", kind: "SoftwareInstance", name: "SQL Server", type: "Database", port: "1433", publisher: "Microsoft" }],
      [],
      { title: "Dependency map", focusId: "n1" }
    );

    expect(html).not.toBeNull();
    expect(html).toContain('"type":"Database"');
    expect(html).toContain('"port":"1433"');
    expect(html).toContain('"publisher":"Microsoft"');
    expect(html).toContain('["Type", node.data("type")]');
    expect(html).toContain('["Port", node.data("port")]');
    expect(html).toContain('["Vendor", node.data("publisher")]');
    expect(html?.toLowerCase()).not.toContain("unpkg.com");
    expect(html?.toLowerCase()).not.toContain("jsdelivr");
    expect(html?.toLowerCase()).not.toContain("cdnjs");
    expect(html?.toLowerCase()).not.toContain("googleapis");
  });
});
