# bmc-helix-discovery-mcp

Serveur MCP **distant** (HTTP / Streamable HTTP) pour BMC Helix Discovery, déployable en ligne (ex: Emergent).

## Déploiement et secrets

Le dépôt GitHub ne doit contenir **aucun secret réel**.
Renseignez ces variables uniquement dans votre plateforme de déploiement (Emergent):

- `BMC_DISCOVERY_BASE_URL`
- `BMC_DISCOVERY_API_VERSION` (défaut `v1.18`)
- `BMC_DISCOVERY_TOKEN`
- `PORT` (défaut local `3000`)
- `PUBLIC_BASE_URL` — URL publique du serveur (issuer OAuth, ex. `https://mon-serveur.up.railway.app`)
- `OAUTH_REDIRECT_ALLOWLIST` (optionnel) — préfixes de redirect_uri autorisés, séparés par des virgules (fusionnés avec les défauts ChatGPT/OpenAI/Claude/Mistral + localhost) — voir « Authentification (OAuth 2.1) »
- `OAUTH_LOGIN_PASSWORD` (optionnel) — si défini, `/oauth/authorize` affiche une page de consentement protégée par ce mot de passe
- `MCP_DEFAULT_VISUAL` (défaut `true`) — voir « Sortie visuelle & optimisation »
- `MCP_INCLUDE_SVG` (défaut `true`) — voir « Sortie visuelle & optimisation »
- `MCP_RESULT_LIMIT` (optionnel, défaut: **aucune limite**) — cap serveur du nombre de lignes renvoyées par les recherches (`discovery_find`, lifecycle, etc.). Non défini = tout est renvoyé ; une valeur entière positive borne chaque page. Quand un cap est actif, les recherches **paginent** : le résultat expose `hasMore` / `nextOffset` — rappeler l'outil avec `offset = nextOffset` pour la page suivante.

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
- `GET /.well-known/oauth-authorization-server` et `GET /.well-known/oauth-protected-resource` (découverte OAuth)
- `POST /oauth/register` (Dynamic Client Registration), `GET/POST /oauth/authorize`, `POST /oauth/token`

Toutes les requêtes `/mcp` exigent un **access token OAuth** valide :

```http
Authorization: Bearer <access_token>
```

Sinon réponse `401 Unauthorized` (avec un en-tête `WWW-Authenticate` pointant vers la découverte OAuth).

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

## Sortie visuelle & optimisation

Chaque outil renvoie **toujours** un résumé texte. Les blocs visuels sont configurables par variables d'environnement, à adapter selon le client/LLM cible :

| Variable | Défaut | Effet |
|---|---|---|
| `MCP_DEFAULT_VISUAL` | `true` | Émet une image **PNG** (rendue depuis le SVG). `false` → réponses **texte seules** (économie de tokens, clients texte-seul). |
| `MCP_INCLUDE_SVG` | `true` | Émet **aussi** le SVG brut en `resource`. `false` → n'envoie que le PNG (allège la charge pour les clients qui ne rendent que le PNG). |

Notes de coût :
- Le **PNG** est facturé selon ses **dimensions** (largeur par défaut `1200px`) ; le **SVG** en `resource` est facturé en **tokens texte** (longueur du XML).
- Déploiement **économe** (ex. LLM texte-seul) : `MCP_DEFAULT_VISUAL=false`.
- Garder le visuel mais alléger : `MCP_INCLUDE_SVG=false` (PNG seul).
- Si la rastérisation PNG échoue, le SVG est renvoyé **en secours** quel que soit `MCP_INCLUDE_SVG`.

## Outils MCP exposés

Le serveur expose ~24 outils (préfixe `discovery_`). La liste exacte est découvrable via `tools/list`. Principaux :

- Recherche : `discovery_find` (kind générique + `contains` + relation optionnelle `relatedToKind`/`relatedToName`)
- Requêtes DSL : `discovery_build_query`, `discovery_execute_dsl`, `discovery_validate_query`, `discovery_common_relationships`, `discovery_resolve_kind`
- Modèle : `discovery_taxonomy` (introspection live, en fallback)
- Cycle de vie / conformité : `discovery_lifecycle_report` (param `scope: software|os`), `discovery_patch_compliance_report`, `discovery_windows_license_report`
- CVE : `discovery_cve_executive_summary`, `discovery_get_cve_cpes_from_nvd`, …
- Cartographie : `discovery_dependency_map`, `discovery_dependency_scope`, `discovery_service_architecture`, `discovery_get_node_graph`
- Coûts / Value Review : `discovery_cost_categories`, `discovery_cost_search`, `discovery_cost_estimate`, `discovery_cost_compare`
- Métadonnées : `discovery_about`, `discovery_get_api_status`, `discovery_tool_guide`

Une **resource** MCP est aussi exposée : `mcp://discovery/dsl-cookbook` (référence complète du DSL Discovery).

## Authentification (OAuth 2.1)

Le serveur est son propre **serveur d'autorisation** OAuth 2.1 (auto-hébergé, pas d'IdP externe). Il n'y a **plus de bearer statique**.

- **Flux** : `authorization_code` + **PKCE (S256) obligatoire**, plus `refresh_token` (avec rotation).
- **Dynamic Client Registration** : les connecteurs (ChatGPT, Claude…) s'enregistrent via `POST /oauth/register` en déclarant leurs `redirect_uris`.
- **redirect_uri** : validés contre `OAUTH_REDIRECT_ALLOWLIST` (préfixes). Défauts inclus : `chatgpt.com`, `chat.openai.com`, `claude.ai`, `claude.com`, `chat.mistral.ai`, `localhost`. Ajoute les tiens via l'env.
- **Consentement** : si `OAUTH_LOGIN_PASSWORD` est défini, `/oauth/authorize` affiche une page de login (mot de passe partagé) avant d'émettre un code ; sinon le flux est direct (démo sans friction).
- **Tokens** : opaques, stockés en mémoire (suffisant pour 1 réplica ; perdus au redémarrage).

## Sécurité

- Aucune vraie valeur dans le code ni dans le README.
- Redaction de clés sensibles dans les erreurs/logs: `token`, `secret`, `password`, `authorization`, `cookie`, `api_key`, `apikey`, `key`.
- Le header `Authorization` vers Discovery n’est jamais renvoyé.

## BMC Discovery API

- `discovery_about` appelle: `BMC_DISCOVERY_BASE_URL + /api/about` (sans token).
- Les autres appels utilisent: `BMC_DISCOVERY_BASE_URL + /api/{BMC_DISCOVERY_API_VERSION}/...`.

Les requêtes passent par `POST /api/{version}/data/search`. Validez le comportement via le Swagger/API docs de votre instance avant usage production.

## Exemple client MCP distant

Avec l'authentification OAuth, un client MCP compatible (ChatGPT, Claude…) n'a besoin que de l'URL : il découvre le serveur d'autorisation, s'enregistre (DCR) et lance le flux OAuth (authorization_code + PKCE) automatiquement.

```json
{
  "mcpServers": {
    "bmc-helix-discovery": {
      "url": "https://your-server.example.com/mcp"
    }
  }
}
```

## IT cost / Value Review tools

The server includes a lightweight IT cost knowledge base loaded from `data/it_cost_knowledge_base.csv` at startup. These tools are intended for Value Reviews: combine Discovery inventory outputs with reference market costs to estimate annual or 5-year cost ranges and potential savings.

- `discovery_cost_categories`: enumerate cost categories/subcategories before searching.
- `discovery_cost_search`: search the reference catalog by free text, category, and subcategory.
- `discovery_cost_estimate`: estimate min/median/max cost for a component and quantity over monthly, annual, or 5-year horizons.
- `discovery_cost_compare`: compare annualized alternatives for a workload and calculate median savings versus a current solution.

Example:

```json
{
  "workload_type": "VM 4vCPU 16Go",
  "quantity": 100,
  "current_solution": "VMware vSphere"
}
```

The CSV is the source of truth; no live cloud pricing or currency conversion is performed.

## Discovery DSL authoring helpers

`discovery_execute_dsl` is the guarded DSL execution tool for exploratory raw BMC Discovery DSL: it requires no user confirmation, validates the candidate query locally, then verifies referenced kinds against the live taxonomy before executing. Its description includes the DSL reference for clause ordering, traversal syntax, key expressions, `NODECOUNT`, named traversals, string literals, canonical examples, and recovery hints.

Use these companion tools before executing raw DSL through `discovery_execute_dsl`:

- `discovery_dsl_examples`: returns static curated query snippets for topics such as `traversal`, `communication`, `lifecycle`, `containment`, `cluster`, `host_software`, `database`, `counting`, `named_traversal`, and `lookup`.
- `discovery_validate_query`: performs a local pre-flight check for common mistakes (`count(traverse ...)`, `LOOKUP` with `WHERE`, and clause ordering issues) without calling Discovery.
- `discovery_common_relationships`: returns curated real `TRAVERSE` paths from `src/data/common_relationships.csv` so callers can use `traverseSpec` (or `traverseReversed` when `matchedDirection` is `reverse`) instead of inventing relationships.

When `discovery_execute_dsl` fails validation or taxonomy checks, its response keeps the existing `stage` / `executed` / `errors` / `hints` fields and additively includes `relationshipHints` plus `antiPatterns` from `common_relationships.csv`. When Discovery still returns a 400 DSL syntax error at execution time, the guarded response includes the original message, a contextual hint when a known pattern matches, the submitted query, and the same curated relationship hints.

## `discovery_find_orphans` examples

`discovery_find_orphans` is a neutral governance tool: it builds and runs a Discovery DSL query using the filters you provide. It does **not** apply hidden noise presets.

### Rationalization scan — databases with no application client

Use explicit noise filters only after reviewing them for your environment:

```json
{
  "target_kind": "SoftwareInstance",
  "target_filter": { "type_matches": "(?i)Database Server$" },
  "inbound_relation": {
    "kind": "ObservedCommunication",
    "source_kind": "SoftwareInstance"
  },
  "noise_filters": {
    "exclude_source_type_patterns": [
      "(?i)Management Agent",
      "(?i)Cluster Server",
      "(?i)NetWorker"
    ],
    "exclude_self_kind": true
  }
}
```

### Audit scan — show all inbound relationships

Leave `noise_filters` empty and include active rows:

```json
{
  "target_kind": "SoftwareInstance",
  "target_filter": { "type_matches": "(?i)Database Server$" },
  "inbound_relation": {
    "kind": "ObservedCommunication",
    "source_kind": "SoftwareInstance"
  },
  "include_active": true
}
```

### Hosts hosting no software (orphan hardware)

```json
{
  "target_kind": "Host",
  "inbound_relation": {
    "kind": "HostedSoftware",
    "source_kind": "SoftwareInstance",
    "direction": "out"
  }
}
```

### LoadBalancerPool with no backend

Pick the backend relationship and source kind from your Discovery taxonomy first:

```json
{
  "target_kind": "LoadBalancerPool",
  "inbound_relation": {
    "kind": "BackendPool",
    "source_kind": "SoftwareInstance"
  }
}
```
