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

const MAX_BODY_BYTES = 1_000_000; // 1 MB cap on incoming JSON payloads

function getBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        if (!text || text.trim() === "") return resolve(undefined);
        resolve(JSON.parse(text));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function buildMcpServer(client: DiscoveryClient, config: AppConfig): McpServer {
  const mcpServer = new McpServer({ name: "bmc-helix-discovery-mcp", version: "0.3.0" });
  const tools = {
    ...aboutTools(client, config.apiVersion),
    ...queryTools(client),
    ...hostTools(client),
    ...discoveryRunTools(client)
  };

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
  return mcpServer;
}

export async function createHttpServer(config: AppConfig): Promise<http.Server> {
  const client = new DiscoveryClient(config);

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

      if (
        normalizedPath === "/mcp" &&
        (req.method === "POST" || req.method === "GET" || req.method === "DELETE")
      ) {
        // Auth check — required on every MCP request.
        const bearer = getBearerToken(req.headers.authorization);
        if (!bearer || bearer !== config.mcpServerApiKey) {
          res.writeHead(401, {
            "content-type": "application/json",
            "www-authenticate": "Bearer"
          });
          res.end(JSON.stringify({ error: true, code: "UNAUTHORIZED", message: "Unauthorized" }));
          return;
        }

        // Stateless mode: build a fresh McpServer + transport per request.
        // This is the officially recommended pattern when sessionIdGenerator is undefined.
        // It avoids state leakage between concurrent clients and request-ID collisions.
        const mcpServer = buildMcpServer(client, config);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

        // Ensure cleanup when the client disconnects or the response finishes.
        const cleanup = (): void => {
          try {
            transport.close();
          } catch {
            /* ignore */
          }
          try {
            mcpServer.close();
          } catch {
            /* ignore */
          }
        };
        res.on("close", cleanup);

        await mcpServer.connect(transport);

        // Rewrite req.url so the transport sees /mcp regardless of /api prefix
        req.url = normalizedPath + (rawUrl.includes("?") ? rawUrl.substring(rawUrl.indexOf("?")) : "");

        // For POST, parse JSON body first and pass it to handleRequest.
        // For GET/DELETE there is no body.
        if (req.method === "POST") {
          let body: unknown;
          try {
            body = await readJsonBody(req);
          } catch (parseErr) {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                error: { code: -32700, message: "Parse error" },
                id: null
              })
            );
            return;
          }
          await transport.handleRequest(req, res, body);
        } else {
          await transport.handleRequest(req, res);
        }
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: true, code: "NOT_FOUND", message: "Route not found" }));
    } catch (error) {
      // Last-resort safety net. Never leak details.
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
      }
      try {
        res.end(JSON.stringify(normalizeApiError(error)));
      } catch {
        try {
          res.end();
        } catch {
          /* ignore */
        }
      }
    }
  });
}

async function main(): Promise<void> {
  // Startup diagnostic: list which required env vars are PRESENT (no values logged).
  const requiredVars = ["BMC_DISCOVERY_BASE_URL", "MCP_SERVER_API_KEY"] as const;
  const optionalVars = ["BMC_DISCOVERY_API_VERSION", "BMC_DISCOVERY_TOKEN", "PORT"] as const;
  const presence = {
    required: Object.fromEntries(requiredVars.map((k) => [k, Boolean(process.env[k]?.trim())])),
    optional: Object.fromEntries(optionalVars.map((k) => [k, Boolean(process.env[k]?.trim())]))
  };
  process.stdout.write(JSON.stringify({ message: "Env vars presence check", presence }) + "\n");

  const config = loadConfig();
  const server = await createHttpServer(config);
  const host = "0.0.0.0";
  server.listen(config.port, host, () => {
    process.stdout.write(
      JSON.stringify({ message: "MCP HTTP server started", host, port: config.port }) + "\n"
    );
  });
}

// Always invoke main() when this file is executed (production entrypoint).
main().catch((error) => {
  const rawMessage = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[startup-error] ${rawMessage}\n`);
  process.stderr.write(`${JSON.stringify(normalizeApiError(error))}\n`);
  process.exit(1);
});
