# PRD — bmc-helix-discovery-mcp

## Problème d'origine
Déployer en ligne via Emergent un serveur MCP (Model Context Protocol) Node.js / TypeScript
pour BMC Helix Discovery, depuis le repository GitHub connecté.

## Architecture
- **Stack** : Node.js 20 + TypeScript pur (FastAPI/React supprimés)
- **Runtime** : `node dist/index.js` géré par supervisor en tant que `program:backend`
- **Port** : `process.env.PORT` (fallback 8001) — listen sur `0.0.0.0`
- **Routing Emergent** : préfixe `/api` requis côté preview → endpoints exposés sur
  `/health` ET `/api/health`, `/mcp` ET `/api/mcp`
- **Sécurité** : `/mcp` exige `Authorization: Bearer <MCP_SERVER_API_KEY>` (sinon 401)
- **Aucune valeur secrète n'est commitée** dans le code ; tout vient de `process.env`

## Variables d'environnement (à configurer côté Emergent)
- `BMC_DISCOVERY_BASE_URL` (requise)
- `BMC_DISCOVERY_API_VERSION` (défaut `v1.18`)
- `BMC_DISCOVERY_TOKEN` (token serveur, sert uniquement à appeler BMC Discovery)
- `MCP_SERVER_API_KEY` (requise — protège l'accès à `/mcp`)
- `PORT` (fourni par Emergent)

Les valeurs présentes dans `/app/.env` sont des **placeholders preview** (sans valeur sensible).

## Endpoints
- `GET /health` → `{"status":"ok","service":"bmc-helix-discovery-mcp"}`
- `POST /mcp` (Streamable HTTP MCP) — protégé Bearer
- `GET /mcp` (Streamable HTTP MCP) — protégé Bearer

## Implémenté (Jan 2026)
- Build TypeScript fixé (tests exclus du rootDir)
- `loadConfig()` : `PORT` fallback `8001`
- `server.listen()` : bind explicite sur `0.0.0.0`
- Réécriture du routeur HTTP pour accepter le préfixe `/api` (preview Emergent)
- Supervisor reconfiguré : `program:backend` lance `node dist/index.js` depuis `/app`
- Frontend (React) et backend (FastAPI) supprimés du supervisor
- Remplacement de Graphviz par ForceAtlas2 (graphology) dans discovery_dependency_map, ajout de structuredContent et d'une UI resource Cytoscape.

## Tests effectués (via curl)
- ✅ `GET /api/health` (URL publique) → 200 + JSON attendu
- ✅ `POST /api/mcp` sans Authorization → 401
- ✅ `POST /api/mcp` avec mauvais token → 401
- ✅ `POST /api/mcp` avec bon token + JSON-RPC `initialize` → 200, serverInfo retourné

## URL publique
`https://c675450d-b890-47f7-bb9a-589f81dda2dc.preview.emergentagent.com`

## Backlog / Next actions
- P1 : configurer les vraies variables d'environnement via l'interface Emergent
  (Settings → Environment Variables) avant le déploiement production
- P1 : lancer un déploiement natif Emergent (bouton Deploy)
- P2 : compléter `DISCOVERY_QUERY_ENDPOINT_TODO` et `DISCOVERY_SCAN_ENDPOINT_TODO`
  dans `src/discoveryClient.ts` avec les vrais chemins Swagger BMC Discovery
- P2 : ajouter logs structurés (pino) avec redaction stricte
- P3 : ajouter rate-limit / IP allowlist sur `/mcp`
