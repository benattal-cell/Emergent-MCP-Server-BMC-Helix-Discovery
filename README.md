# bmc-helix-discovery-mcp

Serveur MCP local TypeScript/Node.js pour interagir avec les API REST de **BMC Helix Discovery** via transport **stdio** (Cursor, Claude Desktop, environnements agentiques locaux).

## 1) Présentation

Ce serveur expose des tools MCP robustes et extensibles :
- `discovery_about`
- `discovery_get_api_status`
- `discovery_query_json`
- `discovery_find_hosts`
- `discovery_find_software_instances`
- `discovery_find_host_software`
- `discovery_start_scan` (action explicite)
- `discovery_raw_get` (diagnostic limité)

## 2) Pré-requis

- Node.js LTS (>= 20)
- npm

## 3) Installation

```bash
npm install
```

## 4) Configuration

```bash
cp .env.example .env
```

## 5) Variables d’environnement

- `BMC_DISCOVERY_BASE_URL` (obligatoire) ex: `https://my-instance.example.com`
- `BMC_DISCOVERY_API_VERSION` (défaut: `v1.18`)
- `BMC_DISCOVERY_TOKEN` (Bearer token, requis pour endpoints authentifiés)
- `BMC_DISCOVERY_VERIFY_TLS` (défaut: `true`; `false` labo/local)
- `BMC_DISCOVERY_TIMEOUT_MS` (défaut: `30000`)

## 6) Build

```bash
npm run build
```

## 7) Lancement local

```bash
npm run dev
npm start
```

## 8) Exemple de configuration MCP (Cursor/Claude Desktop)

```json
{
  "mcpServers": {
    "bmc-helix-discovery": {
      "command": "node",
      "args": ["/chemin/vers/bmc-helix-discovery-mcp/dist/index.js"],
      "env": {
        "BMC_DISCOVERY_BASE_URL": "https://my-instance.example.com",
        "BMC_DISCOVERY_API_VERSION": "v1.18",
        "BMC_DISCOVERY_TOKEN": "REPLACE_WITH_TOKEN"
      }
    }
  }
}
```

## 9) Exemples de prompts utilisateur

- « Liste les hosts Linux connus dans Discovery. »
- « Trouve les Software Instances PostgreSQL. »
- « Montre-moi les applications hébergées sur le serveur X. »
- « Teste la connectivité avec BMC Helix Discovery. »

## 10) Notes sécurité

- Utiliser un utilisateur API Access dédié.
- Appliquer le principe du moindre privilège.
- Ne pas commiter `.env`.
- Ne pas utiliser un token admin personnel.
- Ne pas exposer ce serveur MCP sur Internet pour cette première version.

## Endpoints à valider (IMPORTANT)

Deux endpoints peuvent varier selon version/tenant Discovery. Ils sont volontairement marqués TODO dans `src/discoveryClient.ts` :
- `DISCOVERY_QUERY_ENDPOINT_TODO`
- `DISCOVERY_SCAN_ENDPOINT_TODO`

Validez ces chemins/payloads dans le Swagger/API docs de votre instance avant production.

## Architecture

- `src/config.ts` : chargement/validation de config.
- `src/discoveryClient.ts` : client API centralisé + construction des requêtes Discovery.
- `src/tools/*` : définition des tools MCP et validation Zod.
- `src/utils/errors.ts` : normalisation d’erreurs API.
- `src/utils/sanitize.ts` : masquage de champs sensibles.
- `tests/*` : tests unitaires (client + validation input).

## Sécurité applicative intégrée

- Aucune journalisation du token.
- Aucun affichage du header Authorization.
- `discovery_raw_get` n’accepte que des chemins relatifs commençant par `/api/`.
- Limites par défaut/max sur les tools de recherche pour éviter les réponses massives.
