import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { DiscoveryClient } from "./discoveryClient.js";
import { normalizeApiError } from "./utils/errors.js";
import { aboutTools } from "./tools/about.js";
import { queryTools } from "./tools/query.js";
import { hostTools } from "./tools/hosts.js";
import { discoveryRunTools } from "./tools/discoveryRuns.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new DiscoveryClient(config);

  const server = new McpServer({ name: "bmc-helix-discovery-mcp", version: "0.1.0" });

  const tools = {
    ...aboutTools(client, config.apiVersion),
    ...queryTools(client),
    ...hostTools(client),
    ...discoveryRunTools(client)
  };

  for (const [name, def] of Object.entries(tools)) {
    server.tool(name, def.schema.shape ? def.schema.shape : {}, async (input: unknown) => {
      try {
        const parsed = def.schema.parse(input ?? {});
        const result = await def.handler(parsed as never);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const normalized = normalizeApiError(error);
        return { content: [{ type: "text", text: JSON.stringify(normalized, null, 2) }], isError: true };
      }
    });
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  const normalized = normalizeApiError(error);
  process.stderr.write(`${JSON.stringify(normalized)}\n`);
  process.exit(1);
});
