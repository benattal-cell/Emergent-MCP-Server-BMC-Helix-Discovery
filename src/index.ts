import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig, type AppConfig } from "./config.js";
import { DiscoveryClient } from "./discoveryClient.js";
import { normalizeApiError } from "./utils/errors.js";
import { aboutTools } from "./tools/about.js";
import { queryTools } from "./tools/query.js";
import { hostTools } from "./tools/hosts.js";
import { discoveryRunTools } from "./tools/discoveryRuns.js";

function getBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

export async function createHttpServer(config: AppConfig): Promise<http.Server> {
  const client = new DiscoveryClient(config);
  const mcpServer = new McpServer({ name: "bmc-helix-discovery-mcp", version: "0.2.0" });
  const tools = { ...aboutTools(client, config.apiVersion), ...queryTools(client), ...hostTools(client), ...discoveryRunTools(client) };

  for (const [name, def] of Object.entries(tools)) {
    mcpServer.tool(name, def.schema.shape ? def.schema.shape : {}, async (input: unknown) => {
      try {
        const parsed = def.schema.parse(input ?? {});
        const result = await def.handler(parsed as never);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: JSON.stringify(normalizeApiError(error), null, 2) }], isError: true };
      }
    });
  }

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await mcpServer.connect(transport);

  return http.createServer(async (req, res) => {
    try {
      if (!req.url) {
        res.writeHead(400).end("Bad Request");
        return;
      }
      // Normalize path: strip optional /api prefix (used by Emergent preview routing)
      // so /health and /api/health both work; /mcp and /api/mcp both work.
      const rawUrl = req.url;
      const pathOnly = rawUrl.split("?")[0];
      const normalizedPath = pathOnly.replace(/^\/api(?=\/|$)/, "") || "/";

      if (req.method === "GET" && normalizedPath === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok", service: "bmc-helix-discovery-mcp" }));
        return;
      }

      if (normalizedPath === "/mcp" && (req.method === "POST" || req.method === "GET")) {
        const bearer = getBearerToken(req.headers.authorization);
        if (!bearer || bearer !== config.mcpServerApiKey) {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: true, code: "UNAUTHORIZED", message: "Unauthorized" }));
          return;
        }

        // Rewrite req.url so the transport sees /mcp regardless of /api prefix
        req.url = normalizedPath + (rawUrl.includes("?") ? rawUrl.substring(rawUrl.indexOf("?")) : "");
        await transport.handleRequest(req, res);
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: true, code: "NOT_FOUND", message: "Route not found" }));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify(normalizeApiError(error)));
    }
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const server = await createHttpServer(config);
  const host = "0.0.0.0";
  server.listen(config.port, host, () => {
    process.stdout.write(JSON.stringify({ message: "MCP HTTP server started", host, port: config.port }) + "\n");
  });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify(normalizeApiError(error))}\n`);
    process.exit(1);
  });
}
