import http from "node:http";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig, type AppConfig } from "./config.js";
import { DiscoveryClient } from "./discoveryClient.js";
import { normalizeApiError } from "./utils/errors.js";
import { aboutTools } from "./tools/about.js";
import { buildDslCookbook } from "./tools/query.js";
import { executeDslTools } from "./tools/executeDsl.js";
import { findTools } from "./tools/find.js";
import { taxonomyTools } from "./tools/taxonomy.js";
import { commonRelationshipsTools } from "./tools/commonRelationships.js";
import { resolveKindTools } from "./tools/resolveKind.js";
import { buildQueryTools } from "./tools/buildQuery.js";
import { cveTools } from "./tools/cve.js";
import { lifecycleTools } from "./tools/lifecycle.js";
import { patchComplianceTools } from "./tools/patchCompliance.js";
import { windowsLicenseTools } from "./tools/windowsLicense.js";
import { assistantGuideTools, buildServerInstructions } from "./tools/assistantGuide.js";
import { topologyTools } from "./tools/topology.js";
import { orphansTools } from "./tools/orphans.js";
import { itCostTools } from "./tools/itCosts/index.js";
import { createOAuthServer } from "./oauth.js";
import { registerDiscoveryPrompts } from "./prompts.js";
import { kpiGrid, type Kpi } from "./svg/kpi.js";
import { renderVisual, setVisualSettings, visualsEnabled } from "./svg/renderer.js";
import { structuredOutputSchema as emptyOutputSchema } from "./tools/outputSchemas.js";
import { SVG_VISUAL_DESCRIPTION } from "./tools/visualInstructions.js";
import { loadCatalog } from "./discovery/catalog.js";

const MAX_BODY_BYTES = 1_000_000;

function withVisualInstruction(description: string | undefined, instruction: string | undefined): string {
  const base = description ?? "MCP tool";
  const suffix = instruction ?? SVG_VISUAL_DESCRIPTION;
  return base.includes(suffix) ? base : `${base} ${suffix}`;
}

function structuredContentObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (Array.isArray(value)) return { result: value, count: value.length };
  return { result: value ?? null };
}

function scalarKpis(value: Record<string, unknown>): Kpi[] {
  return Object.entries(value)
    .filter(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")
    .slice(0, 4)
    .map(([key, v]) => ({ label: key, value: String(v) }));
}

function fallbackVisualForObject(toolName: string, result: Record<string, unknown>) {
  const scalar = scalarKpis(result);
  const kpis = scalar.length > 0
    ? scalar
    : [{ label: "Champs", value: String(Object.keys(result).length), hint: "Résumé automatique" }];
  return renderVisual(kpiGrid(`MCP · ${toolName}`, kpis), {
    name: `mcp_${toolName.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase()}`,
    textSummary: `Résumé visuel automatique pour ${toolName}.`,
    structuredContent: result
  });
}

function fallbackVisualForResult(toolName: string, result: unknown) {
  if (Array.isArray(result)) {
    return renderVisual(kpiGrid(`MCP · ${toolName}`, [{ label: "Résultats", value: String(result.length) }]), {
      name: `mcp_${toolName.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase()}`,
      textSummary: `Résumé visuel automatique pour ${toolName}.`,
      structuredContent: { result, count: result.length }
    });
  }
  if (result && typeof result === "object") return fallbackVisualForObject(toolName, result as Record<string, unknown>);
  if (typeof result === "string" || typeof result === "number" || typeof result === "boolean") {
    return renderVisual(kpiGrid(`MCP · ${toolName}`, [{ label: "Réponse", value: String(result) }]), {
      name: `mcp_${toolName.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase()}`,
      textSummary: `Résumé visuel automatique pour ${toolName}.`,
      structuredContent: { result }
    });
  }
  return null;
}

function getBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
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

function htmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface AuthorizeParams { clientId: string; redirectUri: string; state: string; codeChallenge: string; codeChallengeMethod: string; responseType: string }

function consentPage(p: AuthorizeParams, errorNote: string): string {
  const h = htmlEscape;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Autorisation MCP</title>
<style>body{font-family:system-ui,sans-serif;max-width:420px;margin:10vh auto;padding:0 1rem;color:#111}code{background:#f2f2f2;padding:.1rem .3rem;border-radius:4px}input[type=password]{width:100%;padding:.6rem;font-size:1rem;box-sizing:border-box;margin:.5rem 0}button{padding:.6rem 1.2rem;font-size:1rem;cursor:pointer}</style>
</head><body>
<h1>Autoriser l'accès MCP</h1>
<p>Le client <code>${h(p.clientId || "(inconnu)")}</code> demande l'accès au serveur BMC Helix Discovery MCP.</p>
${errorNote}
<form method="post" action="/oauth/authorize">
<input type="hidden" name="client_id" value="${h(p.clientId)}">
<input type="hidden" name="redirect_uri" value="${h(p.redirectUri)}">
<input type="hidden" name="state" value="${h(p.state)}">
<input type="hidden" name="response_type" value="${h(p.responseType)}">
<input type="hidden" name="code_challenge" value="${h(p.codeChallenge)}">
<input type="hidden" name="code_challenge_method" value="${h(p.codeChallengeMethod)}">
<label>Mot de passe d'accès<input type="password" name="password" autofocus required></label>
<button type="submit">Autoriser</button>
</form>
</body></html>`;
}

function buildMcpServer(client: DiscoveryClient, config: AppConfig): McpServer {
  const mcpServer = new McpServer(
    { name: "bmc-helix-discovery-mcp", version: "0.4.0" },
    { instructions: buildServerInstructions() }
  );
  const tools = {
    ...aboutTools(client, config.apiVersion),
    ...executeDslTools(client),
    ...findTools(client),
    ...taxonomyTools(client),
    ...commonRelationshipsTools(),
    ...resolveKindTools(),
    ...buildQueryTools(client),
    ...cveTools(client, config),
    ...lifecycleTools(client),
    ...patchComplianceTools(client),
    ...windowsLicenseTools(client),
    ...assistantGuideTools(),
    ...topologyTools(client),
    ...orphansTools(client),
    ...itCostTools()
  };

  const DEFAULT_ANNOTATIONS = { readOnlyHint: true, openWorldHint: true };
  for (const [name, def] of Object.entries(tools)) {
    const toolDef = def as { schema: { parse: (value: unknown) => unknown; shape?: Record<string, unknown> }; outputSchema?: unknown; handler: (input: never) => Promise<unknown>; description?: string; visualInstruction?: string; isVisual?: boolean; annotations?: Record<string, unknown> };
    const inputSchemaShape = toolDef.schema && (toolDef.schema as { shape?: unknown }).shape
      ? (toolDef.schema as { shape: Record<string, unknown> }).shape
      : {};
    const registration: Record<string, unknown> = {
      description: withVisualInstruction(toolDef.description ?? `MCP tool: ${name}`, toolDef.visualInstruction),
      inputSchema: inputSchemaShape as Record<string, never>,
      annotations: { ...DEFAULT_ANNOTATIONS, ...(toolDef.annotations ?? {}) }
    };
    // Only advertise an outputSchema when the tool declares a meaningful one.
    // The shared empty passthrough is a sentinel meaning "no output contract".
    if (toolDef.outputSchema && toolDef.outputSchema !== emptyOutputSchema) {
      registration.outputSchema = toolDef.outputSchema;
    }
    mcpServer.registerTool(
      name,
      registration as never,
      async (input: unknown) => {
        try {
          const parsed = toolDef.schema.parse(input ?? {});
          const result = await toolDef.handler(parsed as never);

          // Visual tools already return { content: [...] } in MCP shape.
          if (toolDef.isVisual && result && typeof result === "object" && Array.isArray((result as { content?: unknown }).content)) {
            const visualResult = result as { content: unknown[]; structuredContent?: unknown };
            return { ...visualResult, structuredContent: structuredContentObject(visualResult.structuredContent) } as never;
          }

          const visual = visualsEnabled() ? fallbackVisualForResult(name, result) : null;
          if (visual) return { ...visual, structuredContent: structuredContentObject(visual.structuredContent), content: [...visual.content, { type: "text", text: JSON.stringify(result, null, 2) }] } as never;

          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: structuredContentObject(result) };
        } catch (error) {
          return { content: [{ type: "text", text: JSON.stringify(normalizeApiError(error), null, 2) }], isError: true };
        }
      }
    );
  }
  mcpServer.registerResource(
    "discovery-dsl-cookbook",
    "mcp://discovery/dsl-cookbook",
    {
      title: "BMC Discovery DSL Cookbook",
      description: "Full BMC Helix Discovery DSL reference (grammar, traversals, key expressions, NODECOUNT, named traversals) plus curated examples by topic. Same content embedded in discovery_execute_dsl's description, exposed as a fetchable resource for clients that read MCP resources.",
      mimeType: "text/markdown"
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: buildDslCookbook() }]
    })
  );

  registerDiscoveryPrompts(mcpServer);

  return mcpServer;
}

export async function createHttpServer(config: AppConfig): Promise<http.Server> {
  const client = new DiscoveryClient(config);
  setVisualSettings({ enabled: config.defaultVisual, includeSvg: config.includeSvgResource });
  if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
    void loadCatalog(client).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${JSON.stringify({ message: "Discovery catalog preload failed", error: message })}\n`);
    });
  }
  const issuer = (config.publicBaseUrl || `http://localhost:${config.port}`).replace(/\/$/, "");
  const oauth = createOAuthServer({
    issuer,
    redirectAllowlist: config.oauthRedirectAllowlist,
    loginPassword: config.oauthLoginPassword
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

      if (req.method === "GET" && normalizedPath === "/.well-known/oauth-protected-resource") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ resource: issuer, authorization_servers: [issuer] }));
        return;
      }

      // Dynamic Client Registration (RFC 7591) — connectors self-register their redirect_uris.
      if (req.method === "POST" && normalizedPath === "/oauth/register") {
        const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
        const result = oauth.registerClient(body?.redirect_uris);
        if ("error" in result) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "invalid_redirect_uri", error_description: result.error }));
          return;
        }
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({
          client_id: result.clientId,
          redirect_uris: result.redirectUris,
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"]
        }));
        return;
      }

      if (normalizedPath === "/oauth/authorize" && (req.method === "GET" || req.method === "POST")) {
        const url = new URL(rawUrl, issuer);
        const form: Record<string, string> = req.method === "POST" ? await parseFormBody(req) : {};
        const param = (key: string): string => (req.method === "POST" ? (form[key] ?? "") : (url.searchParams.get(key) ?? ""));

        const clientId = param("client_id");
        const redirectUri = param("redirect_uri");
        const state = param("state");
        const responseType = param("response_type") || "code";
        const codeChallenge = param("code_challenge");
        const codeChallengeMethod: "S256" | "plain" = param("code_challenge_method").toLowerCase() === "plain" ? "plain" : "S256";

        if (!redirectUri || !oauth.isRedirectAcceptable(clientId, redirectUri)) {
          res.writeHead(400, { "content-type": "text/plain" });
          res.end("invalid or unregistered redirect_uri");
          return;
        }

        const redirectWithError = (error: string): void => {
          const target = new URL(redirectUri);
          target.searchParams.set("error", error);
          if (state) target.searchParams.set("state", state);
          res.writeHead(302, { location: target.toString() });
          res.end();
        };

        if (responseType !== "code") { redirectWithError("unsupported_response_type"); return; }
        if (!codeChallenge) { redirectWithError("invalid_request"); return; } // PKCE mandatory

        if (oauth.requiresConsent()) {
          const password = req.method === "POST" ? form.password : undefined;
          if (req.method === "GET" || !oauth.checkConsentPassword(password)) {
            const errorNote = req.method === "POST" ? '<p style="color:#c00">Mot de passe incorrect.</p>' : "";
            res.writeHead(req.method === "POST" ? 401 : 200, { "content-type": "text/html; charset=utf-8" });
            res.end(consentPage({ clientId, redirectUri, state, codeChallenge, codeChallengeMethod, responseType }, errorNote));
            return;
          }
        }

        const code = oauth.createAuthCode(clientId, redirectUri, codeChallenge, codeChallengeMethod);
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
          const body = contentType.includes("application/x-www-form-urlencoded")
            ? await parseFormBody(req)
            : ((await readJsonBody(req)) as Record<string, unknown>) ?? {};
          const field = (key: string): string => String((body as Record<string, unknown>)?.[key] ?? "");

          const grantType = field("grant_type");
          if (!grantType) {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "invalid_request", error_description: "missing grant_type" }));
            return;
          }

          let result;
          if (grantType === "authorization_code") {
            result = oauth.exchangeCode({
              code: field("code"),
              codeVerifier: field("code_verifier"),
              redirectUri: field("redirect_uri"),
              clientId: field("client_id") || undefined
            });
          } else if (grantType === "refresh_token") {
            result = oauth.refresh(field("refresh_token"));
          } else {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "unsupported_grant_type" }));
            return;
          }

          if (!result.ok) {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: result.error }));
            return;
          }

          res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
          res.end(JSON.stringify({
            access_token: result.tokens.accessToken,
            token_type: "Bearer",
            expires_in: result.tokens.expiresIn,
            refresh_token: result.tokens.refreshToken
          }));
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
        const validBearer = bearer ? oauth.validateAccessToken(bearer) : false;
        if (!validBearer) {
          res.writeHead(401, {
            "content-type": "application/json",
            "www-authenticate": `Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource"`
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
  const requiredVars = ["BMC_DISCOVERY_BASE_URL"] as const;
  const optionalVars = ["BMC_DISCOVERY_API_VERSION", "BMC_DISCOVERY_TOKEN", "PORT", "PUBLIC_BASE_URL", "OAUTH_REDIRECT_ALLOWLIST", "OAUTH_LOGIN_PASSWORD", "NVD_API_KEY", "MCP_DEFAULT_VISUAL", "MCP_INCLUDE_SVG", "MCP_RESULT_LIMIT"] as const;
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const rawMessage = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[startup-error] ${rawMessage}\n`);
    process.stderr.write(`${JSON.stringify(normalizeApiError(error))}\n`);
    process.exit(1);
  });
}
