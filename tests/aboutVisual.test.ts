import { describe, expect, it, vi } from "vitest";
import { aboutTools } from "../src/tools/about.js";

describe("about visual tools", () => {
  it("advertises and returns structuredContent for discovery_about", async () => {
    const client = { getAbout: vi.fn().mockResolvedValue({ version: "24.3", product: "BMC Helix Discovery" }) } as never;
    const tool = aboutTools(client, "v1.18").discovery_about;
    expect(tool.outputSchema).toBeTruthy();

    const result = await tool.handler({});
    expect(result.structuredContent).toEqual({ about: { version: "24.3", product: "BMC Helix Discovery" } });
    expect(result.content.some((block) => block.type === "image" || block.resource?.mimeType === "image/svg+xml")).toBe(true);
  });

  it("advertises and returns structuredContent for API status", async () => {
    const client = { getAbout: vi.fn().mockResolvedValue({ supportedApiVersions: ["v1.18"] }) } as never;
    const tool = aboutTools(client, "v1.18").discovery_get_api_status;
    expect(tool.outputSchema).toBeTruthy();

    const result = await tool.handler({});
    expect(result.structuredContent).toMatchObject({ reachable: true, configuredApiVersion: "v1.18", supportedApiVersions: ["v1.18"] });
  });
});
