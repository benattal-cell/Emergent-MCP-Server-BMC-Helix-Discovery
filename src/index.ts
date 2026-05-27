import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig, type AppConfig } from "./config.js";
import { DiscoveryClient } from "./discoveryClient.js";
import { normalizeApiError } from "./utils/errors.js";
import { aboutTools } from "./tools/about.js";
import { queryTools } from "./tools/query.js";
import { hostTools } from "./tools/hosts.js";
import { taxonomyTools } from "./tools/taxonomy.js";
import { cveTools } from "./tools/cve.js";
import { graphTools } from "./tools/graph.js";
import { lifecycleTools } from "./tools/lifecycle.js";
import { assistantGuideTools } from "./tools/assistantGuide.js";
import { createOAuthServer } from "./oauth.js";

const MAX_BODY_BYTES = 1_000_000;

function getBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function decodeBasicAuth(header: string | undefined): { clientId: string; clientSecret: string } | null {
  if (!header) return null;
  const m = header.match(/^Basic\s+(.+)$/i);
  if (!m) return null;
  try {
    const decoded = Buffer.from(m[1], "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    if (idx < 0) return null;
    return { clientId: decoded.slice(0, idx), clientSecret: decoded.slice(idx + 1) };
  } catch {
    return null;
  }
}

function parseFormBody(req: http.IncomingMessage): Promise<Record<string, string>> {
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
        const params = new URLSearchParams(text);
        const out: Record<string, string> = {};
        for (const [k, v] of params.entries()) out[k] = v;
        resolve(out);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
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
  const mcpServer = new McpServer({ name: "bmc-helix-discovery-mcp", version: "0.4.0" });
  const tools = {
    ...aboutTools(client, config.apiVersion),
    ...queryTools(client),
    ...hostTools(client),
    ...taxonomyTools(client),
    ...cveTools(config),
    ...graphTools(client),
    ...lifecycleTools(client),
    ...assistantGuideTools()
  };

  for (const [name, def] of Object.entries(tools)) {
    const toolDef = def as { schema: { parse: (value: unknown) => unknown; shape?: Record<string, unknown> }; handler: (input: never) => Promise<unknown>; description?: string };
    const inputSchemaShape = toolDef.schema && (toolDef.schema as { shape?: unknown }).shape
      ? (toolDef.schema as { shape: Record<string, unknown> }).shape
      : {};
    mcpServer.registerTool(
      name,
      {
        description: toolDef.description ?? `MCP tool: ${name}`,
        inputSchema: inputSchemaShape as Record<string, never>
      },
      async (input: unknown) => {
        try {
          const parsed = toolDef.schema.parse(input ?? {});
          const result = await toolDef.handler(parsed as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return { content: [{ type: "text", text: JSON.stringify(normalizeApiError(error), null, 2) }], isError: true };
        }
      }
    );
  }
  return mcpServer;
}

export async function createHttpServer(config: AppConfig): Promise<http.Server> {
  const client = new DiscoveryClient(config);
  const issuer = (config.publicBaseUrl || `http://localhost:${config.port}`).replace(/\/$/, "");
  const oauth = createOAuthServer({
    issuer,
    clientId: config.oauthClientId || "chatgpt-mcp-client",
    clientSecret: config.oauthClientSecret || config.mcpServerApiKey
  });

  return http.createServer(async (req, res) => {
    try {
      if (!req.url) {
        res.writeHead(400).end("Bad Request");
        return;
      }
      const rawUrl = req.url;
      const pathOnly = rawUrl.split("?")[0];
      const normalizedPath = pathOnly.replace(/^\/api(?=\/|$)/, "") || "/";

      if (req.method === "GET" && normalizedPath === "/.well-known/oauth-authorization-server") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(oauth.metadata()));
        return;
      }

      if (req.method === "GET" && normalizedPath === "/oauth/authorize") {
        const url = new URL(rawUrl, issuer);
        const clientId = url.searchParams.get("client_id") || "";
        const redirectUri = url.searchParams.get("redirect_uri") || "";
        const state = url.searchParams.get("state") || "";
        const codeChallenge = url.searchParams.get("code_challenge") || undefined;
        const codeChallengeMethod = url.searchParams.get("code_challenge_method") || undefined;
        if (!redirectUri) { res.writeHead(400).end("missing redirect_uri"); return; }
        if (clientId && clientId !== oauth.config.clientId) { res.writeHead(400).end("invalid client_id"); return; }
        const code = oauth.createAuthCode(oauth.config.clientId, redirectUri, codeChallenge, codeChallengeMethod || undefined);
        const target = new URL(redirectUri);
        target.searchParams.set("code", code);
        if (state) target.searchParams.set("state", state);
        res.writeHead(302, { location: target.toString() });
        res.end();
        return;
      }

      if (req.method === "POST" && normalizedPath === "/oauth/token") {
        try {
          const contentType = (req.headers["content-type"] || "").toLowerCase();
          const basic = decodeBasicAuth(req.headers.authorization);
          const body = contentType.includes("application/x-www-form-urlencoded")
            ? await parseFormBody(req)
            : (await readJsonBody(req)) as Record<string, unknown>;

          const grantType = String((body as Record<string, unknown>)?.grant_type || "");
          const bodyClientId = String((body as Record<string, unknown>)?.client_id || "");
          const bodyClientSecret = String((body as Record<string, unknown>)?.client_secret || "");

          const clientId = basic?.clientId || bodyClientId || oauth.config.clientId;
          const clientSecret = basic?.clientSecret || bodyClientSecret || "";

          if (!grantType) {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "invalid_request", error_description: "missing grant_type" }));
            return;
          }
          if (clientId !== oauth.config.clientId || clientSecret !== oauth.config.clientSecret) {
            res.writeHead(401, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "invalid_client" }));
            return;
          }

          if (grantType === "authorization_code") {
            const code = String((body as Record<string, unknown>)?.code || "");
            const rec = oauth.codes.get(code);
            if (!rec || Date.now() > rec.expiresAt) {
              res.writeHead(400, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: "invalid_grant" }));
              return;
            }
            oauth.codes.delete(code);
          } else if (grantType !== "client_credentials") {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "unsupported_grant_type" }));
            return;
          }

          const accessToken = oauth.issueToken(clientId);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ access_token: accessToken, token_type: "Bearer", expires_in: 3600 }));
          return;
        } catch {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "invalid_request" }));
          return;
        }
      }

      if (req.method === "GET" && normalizedPath === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok", service: "bmc-helix-discovery-mcp" }));
        return;
      }

      if (
        normalizedPath === "/mcp" &&
        (req.method === "POST" || req.method === "GET" || req.method === "DELETE")
      ) {
        const bearer = getBearerToken(req.headers.authorization);
        const validBearer = Boolean(bearer) && (bearer === config.mcpServerApiKey || (bearer ? oauth.validateAccessToken(bearer) : false));
        if (!validBearer) {
          res.writeHead(401, {
            "content-type": "application/json",
            "www-authenticate": "Bearer"
          });
          res.end(JSON.stringify({ error: true, code: "UNAUTHORIZED", message: "Unauthorized" }));
          return;
        }

        const mcpServer = buildMcpServer(client, config);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

        const cleanup = (): void => {
          try { transport.close(); } catch { /* ignore */ }
          try { mcpServer.close(); } catch { /* ignore */ }
        };
        res.on("close", cleanup);

        await mcpServer.connect(transport);

        req.url = normalizedPath + (rawUrl.includes("?") ? rawUrl.substring(rawUrl.indexOf("?")) : "");

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
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
      }
      try {
        res.end(JSON.stringify(normalizeApiError(error)));
      } catch {
        try { res.end(); } catch { /* ignore */ }
      }
    }
  });
}

async function main(): Promise<void> {
  const requiredVars = ["BMC_DISCOVERY_BASE_URL", "MCP_SERVER_API_KEY"] as const;
  const optionalVars = ["BMC_DISCOVERY_API_VERSION", "BMC_DISCOVERY_TOKEN", "PORT", "OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "NVD_API_KEY", "PUBLIC_BASE_URL"] as const;
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

main().catch((error) => {
  const rawMessage = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[startup-error] ${rawMessage}\n`);
  process.stderr.write(`${JSON.stringify(normalizeApiError(error))}\n`);
  process.exit(1);
});
