# bmc-helix-discovery-mcp

Serveur MCP **distant** (HTTP / Streamable HTTP) pour BMC Helix Discovery, déployable en ligne (ex: Emergent).

## Déploiement et secrets

Le dépôt GitHub ne doit contenir **aucun secret réel**.
Renseignez ces variables uniquement dans votre plateforme de déploiement (Emergent):

- `BMC_DISCOVERY_BASE_URL`
- `BMC_DISCOVERY_API_VERSION` (défaut `v1.18`)
- `BMC_DISCOVERY_TOKEN`
- `MCP_SERVER_API_KEY`
- `PORT` (défaut local `3000`)

## Installation

```bash
npm install
npm run build
npm start
```

`npm start` lance le serveur HTTP compilé (`node dist/index.js`) et écoute sur `process.env.PORT`.

## Endpoints

- `GET /health` (aussi disponible via `/api/health` pour le routing Emergent Preview)
- `POST /mcp` (aussi disponible via `/api/mcp` pour le routing Emergent Preview)
- `GET /mcp` (Streamable HTTP)

Toutes les requêtes `/mcp` exigent:

```http
Authorization: Bearer <MCP_SERVER_API_KEY>
```

Sinon réponse `401 Unauthorized`.

## Healthcheck

```bash
curl https://your-server.example.com/health
```

Réponse:

```json
{
  "status": "ok",
  "service": "bmc-helix-discovery-mcp"
}
```

## Outils MCP exposés

- `discovery_about`
- `discovery_get_api_status`
- `discovery_query_json`
- `discovery_find_hosts`
- `discovery_find_software_instances`
- `discovery_find_host_software`
- `discovery_start_scan` (exige `confirm=true`)
- `discovery_raw_get` (chemins `/api/...` uniquement)

## Sécurité

- Aucune vraie valeur dans le code ni dans le README.
- Redaction de clés sensibles dans les erreurs/logs: `token`, `secret`, `password`, `authorization`, `cookie`, `api_key`, `apikey`, `key`.
- Le header `Authorization` vers Discovery n’est jamais renvoyé.

## BMC Discovery API

- `discovery_about` appelle: `BMC_DISCOVERY_BASE_URL + /api/about` (sans token).
- Les autres appels utilisent: `BMC_DISCOVERY_BASE_URL + /api/{BMC_DISCOVERY_API_VERSION}/...`.

⚠️ Les endpoints exacts query/scan peuvent dépendre de votre instance. Ils restent volontairement en TODO dans `src/discoveryClient.ts`:
- `DISCOVERY_QUERY_ENDPOINT_TODO`
- `DISCOVERY_SCAN_ENDPOINT_TODO`

Validez-les via le Swagger/API docs de votre instance avant usage production.

## Exemple client MCP distant

Exemple conceptuel (client compatible MCP distant):

```json
{
  "mcpServers": {
    "bmc-helix-discovery": {
      "url": "https://your-server.example.com/mcp",
      "headers": {
        "Authorization": "Bearer replace_me"
      }
    }
  }
}
```
