import { z } from "zod";
import { DiscoveryClient } from "../discoveryClient.js";
import { structuredOutputSchema } from "./outputSchemas.js";
import { ApiError } from "../utils/errors.js";

export const queryJsonSchema = z.object({
  query: z.string().min(1)
}).strict();


export const dslExamplesSchema = z.object({
  topic: z.string().min(1)
}).strict();

export const validateQuerySchema = z.object({
  query: z.string().min(1)
}).strict();

export const rawGetSchema = z.object({
  path: z.string().min(1).refine((value) => value.startsWith("/api/"), "path must start with /api/")
}).strict();


export const EXECUTE_DSL_DESCRIPTION = [
  "Execute a raw BMC Discovery DSL query and return flattened results.",
  "",
  "Prefer specialized tools (discovery_find_hosts, discovery_find_software_instances,",
  "discovery_lifecycle_report, discovery_find_orphans, etc.) when they cover ",
  "your question. Use this only when no specialized tool fits, or when you ",
  "need a combination of clauses they don't expose.",
  "",
  "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
  "QUERY GRAMMAR (from BMC docs)",
  "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
  "",
  "  SEARCH [in <partition>] <kinds> [WHERE ...] [TRAVERSE ...] [ORDER BY ...]",
  "         [SHOW ...] [PROCESS ...]",
  "",
  "Clauses MUST appear in this order. WHERE filters the current set; ",
  "TRAVERSE moves to a new set of related nodes; SHOW selects output columns.",
  "ORDER BY <attr-or-key-expr> [DESC] [, ...]  — ascending is DEFAULT, NO 'ASC' keyword (it errors). Only DESC reverses.",
  "",
  "  LOOKUP \"<node_id>\" [, \"<node_id>\", ...] [TRAVERSE ...] SHOW ...",
  "",
  "LOOKUP retrieves nodes by id. It CANNOT have a WHERE clause and is usually ",
  "followed by traversals.",
  "",
  "Keywords are case-INSENSITIVE (`search` == `SEARCH`). Everything else ",
  "(node kinds, attribute names, relationship names, role names) is ",
  "case-SENSITIVE. To use an identifier that clashes with a keyword, prefix ",
  "it with `$` (e.g. `WHERE $search = 123`).",
  "",
  "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
  "KIND SELECTION & FILTERING",
  "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
  "",
  "  SEARCH Host WHERE os_type = 'Windows' SHOW name, ram",
  "  SEARCH SoftwareInstance WHERE type MATCHES \"(?i)Database Server$\"",
  "  SEARCH Host WHERE name HAS SUBSTRING \"prod\"",
  "  SEARCH Host WHERE os_type HAS SUBWORD \"Linux\"   // word-boundary aware",
  "  SEARCH * WHERE * HAS SUBWORD \"microsoft\"        // every node, every attr",
  "",
  "Conditions: =, !=, <, >, MATCHES (regex), HAS SUBSTRING, HAS SUBWORD,",
  "            IS DEFINED, IN [...], NOT, AND, OR.",
  "",
  "No artificial row limit is applied by this tool. Scope broad queries with WHERE,",
  "LOOKUP, TRAVERSE or explicit kinds. Avoid unconstrained `SEARCH * SHOW *` \u2014",
  "that is the one pattern likely to create very large responses.",
  "",
  "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
  "TRAVERSALS \u2014 the core feature",
  "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
  "",
  "A SEARCH/LOOKUP produces a set of nodes. TRAVERSE replaces that set with ",
  "the related nodes reached via a relationship. Original nodes are discarded.",
  "",
  "  TRAVERSE <role_from>:<RelationKind>:<role_to>:<TargetKind> [WHERE ...]",
  "",
  "Any of the four components can be omitted (acts as wildcard):",
  "",
  "  TRAVERSE :::SoftwareInstance                    // any rel \u2192 SoftwareInstance",
  "  TRAVERSE :HostedSoftware::SoftwareInstance      // via HostedSoftware",
  "  TRAVERSE Host:HostedSoftware:RunningSoftware:SoftwareInstance   // full form",
  "",
  "The WHERE after TRAVERSE filters the NEW set (the targets).",
  "",
  "Chaining traversals:",
  "",
  "  SEARCH Host WHERE os_type HAS SUBWORD \"Linux\"",
  "  TRAVERSE :HostedSoftware::SoftwareInstance WHERE name HAS SUBSTRING \"oracle\"",
  "  TRAVERSE ContainedSoftware:SoftwareContainment:SoftwareContainer:BusinessApplicationInstance",
  "  SHOW name",
  "",
  "EXPAND repeats a traversal until no new nodes are found, and KEEPS the ",
  "original set. Useful for dependency closures:",
  "",
  "  SEARCH BusinessApplicationInstance WHERE <condition>",
  "  EXPAND DependedUpon:Dependency:Dependant:BusinessApplicationInstance",
  "",
  "To traverse-then-expand WITHOUT the originals, do both:",
  "",
  "  SEARCH ... TRAVERSE ... EXPAND ...",
  "",
  "STEP IN / STEP OUT move between nodes and relationships, allowing access ",
  "to attributes ON the relationship itself:",
  "",
  "  SEARCH BusinessApplicationInstance WHERE <cond>",
  "  STEP IN DependedUpon:Dependency WHERE critical",
  "  STEP OUT Dependant:BusinessApplicationInstance",
  "",
  "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
  "KEY EXPRESSIONS \u2014 the `#` syntax in SHOW",
  "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
  "",
  "To pull attributes from related nodes WITHOUT discarding the current set, ",
  "use a key expression in SHOW:",
  "",
  "  SEARCH Host",
  "  SHOW name, #Host:HostedSoftware:RunningSoftware:SoftwareInstance.type",
  "",
  "Same role-wildcard rules as TRAVERSE. Returns a list when multiple ",
  "neighbors match. Returns null/None when nothing matches.",
  "",
  "WHEN A KEY EXPRESSION RETURNS NULL where you expected results: try the ",
  "role-agnostic form `#:RelationKind::TargetKind.attr` which matches without ",
  "constraining the role. The exact behavior depends on how the relation ",
  "was stored in your instance \u2014 when in doubt, default to the wildcard form.",
  "",
  "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
  "COUNTING \u2014 NODECOUNT",
  "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
  "",
  "NODECOUNT counts the number of nodes reachable via a traversal, without ",
  "materializing the list. Cheaper than pulling names then counting in code.",
  "",
  "  NODECOUNT(<traversal-spec> [WHERE ...])",
  "",
  "Examples:",
  "",
  "  // Count software per host",
  "  SEARCH Host ",
  "  SHOW name, NODECOUNT(TRAVERSE :HostedSoftware::SoftwareInstance) AS sw_count",
  "",
  "  // Count only application clients (excluding agents)",
  "  SEARCH SoftwareInstance WHERE type = \"Microsoft SQL Server\"",
  "  SHOW name,",
  "       NODECOUNT(TRAVERSE :ObservedCommunication::SoftwareInstance",
  "                 WHERE type NOT MATCHES \"(?i)(Agent|Cluster|Listener)\")",
  "         AS app_clients",
  "",
  "NODES returns the list instead of the count:",
  "",
  "  NODES(<traversal-spec> [WHERE ...])",
  "",
  "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
  "NAMED TRAVERSALS \u2014 for filtering AND keeping the original set",
  "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
  "",
  "  SEARCH Host",
  "  WITH (TRAVERSE Host:HostedSoftware:RunningSoftware:SoftwareInstance AS si",
  "        WHERE type HAS SUBWORD \"server\")",
  "  SHOW name, #si.type",
  "",
  "Useful when you want to filter on traversed attributes (which is not ",
  "possible from the outer WHERE) while keeping the original set.",
  "",
  "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
  "STRING LITERALS",
  "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
  "",
  "  'simple', \"simple\"             // no newlines, C-style escapes",
  "  '''multi-line''', \"\"\"multi\"\"\"  // newlines OK",
  "  raw \"C:\\path\"                  // backslashes literal",
  "  regex \"(?i)foo\\d+\"             // backslashes literal, MATCHES-friendly",
  "",
  "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
  "KEYWORDS (full list, case-insensitive)",
  "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
  "",
  "AND, AS, BY, DEFINED, DESC, EXPAND, EXPLODE, FLAGS, HAS, IN, IS,",
  "LIKE (deprecated), LOCALE, LOOKUP, MATCHES, NODECOUNT, NODES, NOT, OR,",
  "ORDER, OUT, PROCESS, PROCESSWITH, SEARCH, SHOW, STEP, SUBSTRING,",
  "SUBWORD, SUMMARY, TAXONOMY, TRAVERSE, WHERE, WITH",
  "",
  "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
  "CANONICAL EXAMPLES",
  "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
  "",
  "# Hosts running a given software, with count",
  "SEARCH Host",
  "SHOW name, NODECOUNT(TRAVERSE :HostedSoftware::SoftwareInstance ",
  "                     WHERE name HAS SUBSTRING \"Tomcat\") AS tomcat_count",
  "",
  "# Software peers communicating with a given SI (any direction)",
  "SEARCH SoftwareInstance WHERE name HAS SUBSTRING \"MSSQLSERVER on mcr-sqldb-38\"",
  "SHOW name, #:ObservedCommunication::SoftwareInstance.name AS peers",
  "",
  "# All software on Linux hosts that runs Oracle, with their BusinessApplications",
  "SEARCH Host WHERE os_type HAS SUBWORD \"Linux\"",
  "TRAVERSE :HostedSoftware::SoftwareInstance WHERE name HAS SUBSTRING \"oracle\"",
  "TRAVERSE ContainedSoftware:SoftwareContainment:SoftwareContainer:BusinessApplicationInstance",
  "SHOW name",
  "",
  "# Database engines and the databases they manage",
  "SEARCH SoftwareInstance WHERE type MATCHES \"(?i)Database Server$\"",
  "SHOW name AS engine, #:Detail::Database.name AS databases",
  "",
  "# Look up specific nodes by id",
  "LOOKUP \"04a38562c00502d70b9f86766e486f7374\"",
  "SHOW name, hostname, os, ram",
  "",
  "# Cluster: find SoftwareInstances and their ACTIVE host",
  "SEARCH Cluster WHERE failover",
  "TRAVERSE Host:HostedSoftware:RunningSoftware:SoftwareInstance",
  "WITH (TRAVERSE ClusteredSoftware:HostedSoftware:Host:Host AS rel, host ",
  "      WHERE #rel.active)",
  "SHOW name, #host.name AS active_host",
  "",
  "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
  "COMMON ERRORS \u2014 what to do",
  "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
  "",
  "\"Syntax error, unexpected 'X'\"",
  "  - Most often: clauses in wrong order (e.g. SHOW before TRAVERSE).",
  "  - Or: traversal used inside a function (e.g. `count(traverse ...)`). ",
  "    TRAVERSE is a top-level clause. Use `NODECOUNT(<spec>)` to count ",
  "    inside a SHOW clause.",
  "",
  "All-null traversal results in SHOW",
  "  - The role specification might not match the data's directionality.",
  "  - Try the role-agnostic form `#:RelationKind::TargetKind.attr`.",
  "  - Verify the relation kind exists via discovery_taxonomy_relkind_details.",
  "",
  "LOOKUP with WHERE",
  "  - Not allowed. Use SEARCH with a WHERE on id or name instead.",
  "",
  "Need examples for a specific topic?",
  "  \u2192 Call `discovery_dsl_examples(topic=\"...\")` for curated snippets.",
  "",
  "For the official BMC reference, see \"Using the Query Language\" in the ",
  "BMC Discovery documentation (DISCO241 or later)."
].join("\n");

const DSL_ERROR_HINTS: Array<{ match: RegExp; hint: string }> = [
  {
    match: /unexpected (identifier )?.*'asc'/i,
    hint: "There is no ASC keyword in Discovery DSL. Ascending is the default: write 'ORDER BY attr' (not 'ORDER BY attr asc'). Use DESC only for descending."
  },
  {
    match: /unexpected '(traverse|expand|step)'/i,
    hint: "TRAVERSE, EXPAND and STEP are top-level clauses, not functions. They appear at the same level as WHERE and SHOW, in the order: WHERE → TRAVERSE → ORDER BY → SHOW. If you want to count or list related nodes inside a SHOW clause, use NODECOUNT() or NODES() instead."
  },
  {
    match: /unexpected 'where'/i,
    hint: "Clause ordering is fixed: WHERE must come before TRAVERSE, TRAVERSE before SHOW. If you need to filter the result of a traversal, place the WHERE inside the TRAVERSE clause, or use a named traversal: WITH (TRAVERSE ... AS x WHERE ...)."
  },
  {
    match: /unexpected '(order|by)'/i,
    hint: "ORDER BY must come AFTER any TRAVERSE and BEFORE SHOW."
  },
  {
    match: /lookup.*where|where.*lookup/i,
    hint: "LOOKUP cannot have a WHERE clause. Use SEARCH if you need filtering, or chain LOOKUP with a TRAVERSE."
  },
  {
    match: /unexpected.*\bcount\b.*traverse|\bcount\s*\(\s*traverse/i,
    hint: "To count nodes via a traversal, use NODECOUNT() inside SHOW. Do not wrap TRAVERSE in count()."
  }
];

export interface EnrichedDslError {
  original_message: string;
  hint: string | null;
}

export function enrichDslError(errorMessage: string): EnrichedDslError {
  const matched = DSL_ERROR_HINTS.find((entry) => entry.match.test(errorMessage));
  return { original_message: errorMessage, hint: matched?.hint ?? null };
}

export function extractDiscoveryErrorMessage(error: ApiError): string {
  const details = error.details;
  if (details && typeof details === "object" && "message" in details) {
    const message = (details as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  if (details && typeof details === "object" && "error" in details) {
    const message = (details as { error?: unknown }).error;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return error.message;
}

export interface DslExample {
  title: string;
  query: string;
  explanation: string;
}

const DSL_EXAMPLES: Record<string, DslExample[]> = {
  "traversal": [
    {
      "title": "Traverse from hosts to hosted software",
      "query": "SEARCH Host WHERE os_type HAS SUBWORD \"Linux\" TRAVERSE :HostedSoftware::SoftwareInstance SHOW name, type",
      "explanation": "TRAVERSE replaces the current Host set with related SoftwareInstance nodes reached through HostedSoftware."
    },
    {
      "title": "Role-agnostic traversal to software",
      "query": "SEARCH Host TRAVERSE :::SoftwareInstance SHOW name, type",
      "explanation": "Omitting role and relationship components acts as a wildcard. Use this for exploration, then tighten the traversal once taxonomy is confirmed."
    },
    {
      "title": "Chain two traversals",
      "query": "SEARCH Host WHERE name HAS SUBSTRING \"prod\" TRAVERSE :HostedSoftware::SoftwareInstance TRAVERSE ContainedSoftware:SoftwareContainment:SoftwareContainer:BusinessApplicationInstance SHOW name",
      "explanation": "Each TRAVERSE moves to a new node set, so the final SHOW displays BusinessApplicationInstance nodes."
    }
  ],
  "communication": [
    {
      "title": "Software communication peers",
      "query": "SEARCH SoftwareInstance WHERE name HAS SUBSTRING \"MSSQLSERVER\" SHOW name, #:ObservedCommunication::SoftwareInstance.name AS peers",
      "explanation": "The role-agnostic key expression pulls peer SoftwareInstance names without discarding the original SoftwareInstance rows."
    },
    {
      "title": "Count communicating software peers",
      "query": "SEARCH SoftwareInstance WHERE type MATCHES \"(?i)Database Server$\" SHOW name, NODECOUNT(TRAVERSE :ObservedCommunication::SoftwareInstance) AS peer_count",
      "explanation": "NODECOUNT counts peers reached via ObservedCommunication without returning a potentially large peer list."
    }
  ],
  "ordering": [
    {
      "title": "Sort ascending (default — no ASC keyword)",
      "query": "SEARCH Host ORDER BY name SHOW name, os",
      "explanation": "Ascending is the DEFAULT. There is NO 'ASC' keyword in Discovery DSL — writing 'ORDER BY name asc' is a SYNTAX ERROR. Just omit it for ascending."
    },
    {
      "title": "Sort descending with DESC",
      "query": "SEARCH Host ORDER BY ram DESC SHOW name, ram",
      "explanation": "DESC is the ONLY sort modifier. It follows the attribute. Ascending requires no keyword."
    },
    {
      "title": "Multi-key sort",
      "query": "SEARCH Person ORDER BY surname DESC, name SHOW name, surname",
      "explanation": "Comma-separated keys. Each key may have its own DESC; ascending keys carry no keyword. Sorting is by the first key, ties broken by the next."
    },
    {
      "title": "Sort by a traversed/bound attribute (oldest EOS first)",
      "query": "SEARCH SoftwareInstance WHERE (#ElementWithDetail:SupportDetail:SoftwareDetail:SupportDetail.end_support_date is defined) ORDER BY #ElementWithDetail:SupportDetail:SoftwareDetail:SupportDetail.end_support_date SHOW name, type",
      "explanation": "ORDER BY accepts key expressions (traversed attributes), not just direct attributes. Placed AFTER WHERE/TRAVERSE and BEFORE SHOW. No ASC for ascending."
    }
  ],
  "lifecycle": [
    {
      "title": "Software with support dates",
      "query": "SEARCH SoftwareInstance WITH value(#ElementWithDetail:SupportDetail:SoftwareDetail:SupportDetail.end_support_date) AS eos WHERE @eos SHOW type, product_version, formatTime(@eos, '%Y-%m-%d') AS 'End of Support'",
      "explanation": "Name binding stores a related support-detail date so the query can filter and display it."
    },
    {
      "title": "Software past end of support",
      "query": "SEARCH SoftwareInstance WITH value(#ElementWithDetail:SupportDetail:SoftwareDetail:SupportDetail.end_support_date) AS eos WHERE @eos AND @eos < currentTime() SHOW type, product_version, formatTime(@eos, '%Y-%m-%d') AS 'End of Support'",
      "explanation": "currentTime() lets the DSL compare lifecycle dates directly in Discovery."
    }
  ],
  "containment": [
    {
      "title": "Software contained in applications",
      "query": "SEARCH SoftwareInstance TRAVERSE ContainedSoftware:SoftwareContainment:SoftwareContainer:BusinessApplicationInstance SHOW name",
      "explanation": "This follows SoftwareContainment from software toward containing BusinessApplicationInstance nodes."
    },
    {
      "title": "Applications and contained software names",
      "query": "SEARCH BusinessApplicationInstance SHOW name, #:SoftwareContainment:ContainedSoftware:SoftwareInstance.name AS software",
      "explanation": "A key expression keeps the application rows and pulls related software names into a list column."
    }
  ],
  "cluster": [
    {
      "title": "Failover clusters to software",
      "query": "SEARCH Cluster WHERE failover TRAVERSE Host:HostedSoftware:RunningSoftware:SoftwareInstance SHOW name, type",
      "explanation": "The first set is failover clusters; the traversal moves to related running SoftwareInstance nodes."
    },
    {
      "title": "Cluster active host via named traversal",
      "query": "SEARCH Cluster WHERE failover TRAVERSE Host:HostedSoftware:RunningSoftware:SoftwareInstance WITH (TRAVERSE ClusteredSoftware:HostedSoftware:Host:Host AS host WHERE #host.active) SHOW name, #host.name AS active_host",
      "explanation": "A named traversal can bind related hosts for use in SHOW while filtering the traversed set."
    }
  ],
  "host_software": [
    {
      "title": "Hosts running a given software with count",
      "query": "SEARCH Host SHOW name, NODECOUNT(TRAVERSE :HostedSoftware::SoftwareInstance WHERE name HAS SUBSTRING \"Tomcat\") AS tomcat_count",
      "explanation": "NODECOUNT inside SHOW counts hosted software matching the traversal WHERE without materializing the list."
    },
    {
      "title": "List hosted software per host",
      "query": "SEARCH Host SHOW name, #:HostedSoftware::SoftwareInstance.name AS software",
      "explanation": "The key expression keeps one row per host and returns hosted software names as a list."
    }
  ],
  "database": [
    {
      "title": "Database engines and managed databases",
      "query": "SEARCH SoftwareInstance WHERE type MATCHES \"(?i)Database Server$\" SHOW name AS engine, #:Detail::Database.name AS databases",
      "explanation": "The Detail relationship exposes related Database nodes while the current set remains SoftwareInstance."
    },
    {
      "title": "Database engines with app client counts",
      "query": "SEARCH SoftwareInstance WHERE type MATCHES \"(?i)Database Server$\" SHOW name, NODECOUNT(TRAVERSE :ObservedCommunication::SoftwareInstance WHERE type NOT MATCHES \"(?i)(Agent|Cluster|Listener)\") AS app_clients",
      "explanation": "Use explicit noise patterns only when the caller has decided those source types should be excluded from the count."
    }
  ],
  "counting": [
    {
      "title": "Count software per host",
      "query": "SEARCH Host SHOW name, NODECOUNT(TRAVERSE :HostedSoftware::SoftwareInstance) AS sw_count",
      "explanation": "NODECOUNT is the canonical way to count related nodes inside SHOW."
    },
    {
      "title": "Return related nodes as a list",
      "query": "SEARCH Host SHOW name, NODES(TRAVERSE :HostedSoftware::SoftwareInstance WHERE type HAS SUBWORD \"server\") AS server_software",
      "explanation": "NODES returns the related node list; use it when details are needed rather than just a count."
    }
  ],
  "named_traversal": [
    {
      "title": "Filter traversed software and keep hosts",
      "query": "SEARCH Host WITH (TRAVERSE Host:HostedSoftware:RunningSoftware:SoftwareInstance AS si WHERE type HAS SUBWORD \"server\") SHOW name, #si.type AS server_types",
      "explanation": "WITH binds a traversal as si, allowing SHOW to pull attributes from the bound set while keeping Host rows."
    },
    {
      "title": "Named traversal for related software names",
      "query": "SEARCH Host WITH (TRAVERSE :HostedSoftware::SoftwareInstance AS si WHERE name HAS SUBSTRING \"oracle\") SHOW name, #si.name AS oracle_software",
      "explanation": "The traversal WHERE filters the related SoftwareInstance set, not the original Host set."
    }
  ],
  "lookup": [
    {
      "title": "Look up one node by id",
      "query": "LOOKUP \"04a38562c00502d70b9f86766e486f7374\" SHOW name, key",
      "explanation": "LOOKUP retrieves exact node ids and cannot include a WHERE clause."
    },
    {
      "title": "Look up then traverse",
      "query": "LOOKUP \"04a38562c00502d70b9f86766e486f7374\" TRAVERSE :HostedSoftware::SoftwareInstance SHOW name, type",
      "explanation": "LOOKUP can be followed by TRAVERSE to inspect related nodes from a known id."
    }
  ]
};

export function getDslExamples(topic: string): { topic: string; examples: DslExample[]; availableTopics?: string[]; message?: string } {
  const normalized = topic.trim().toLowerCase();
  const examples = DSL_EXAMPLES[normalized];
  if (!examples) {
    return {
      topic,
      examples: [],
      availableTopics: Object.keys(DSL_EXAMPLES).sort(),
      message: "Unknown topic. Choose one of the availableTopics values, then pass it back to discovery_dsl_examples."
    };
  }
  return { topic: normalized, examples };
}

export interface QueryValidationResult {
  valid: boolean;
  errors: string[];
  hints: string[];
}

function keywordIndex(query: string, keyword: string): number {
  const match = new RegExp(`\\b${keyword}\\b`, "i").exec(query);
  return match?.index ?? -1;
}

export function validateDiscoveryQuery(query: string): QueryValidationResult {
  const errors: string[] = [];
  const hints: string[] = [];

  if (/\bcount\s*\(\s*traverse/i.test(query)) {
    errors.push("count(traverse ...) is not valid Discovery DSL.");
    hints.push("Use NODECOUNT(TRAVERSE ...) inside SHOW instead of wrapping TRAVERSE in count().");
  }

  if (/order\s+by\b[^]*\basc\b/i.test(query)) {
    errors.push("'ASC' is not valid Discovery DSL.");
    hints.push("Ascending is the default — remove 'asc'. Only 'DESC' is a valid sort modifier.");
  }

  const lookupIndex = keywordIndex(query, "LOOKUP");
  const whereIndex = keywordIndex(query, "WHERE");
  if (lookupIndex >= 0 && whereIndex >= 0) {
    errors.push("LOOKUP cannot be combined with WHERE.");
    hints.push("Use SEARCH when you need filtering, or LOOKUP followed by TRAVERSE when you already know node ids.");
  }

  const showIndex = keywordIndex(query, "SHOW");
  const traverseIndex = keywordIndex(query, "TRAVERSE");
  const orderIndex = keywordIndex(query, "ORDER");
  const hasShowTraversalFunction = /(?:nodecount|nodes)\s*\(\s*traverse/i.test(query);
  if (showIndex >= 0 && whereIndex > showIndex && !hasShowTraversalFunction) {
    errors.push("WHERE appears after SHOW.");
    hints.push("Clause ordering is SEARCH/LOOKUP → WHERE → TRAVERSE/EXPAND/STEP → ORDER BY → SHOW → PROCESS.");
  }
  if (showIndex >= 0 && traverseIndex > showIndex && !hasShowTraversalFunction) {
    errors.push("TRAVERSE appears after SHOW.");
    hints.push("TRAVERSE is a top-level clause that must appear before SHOW, unless used inside NODECOUNT() or NODES().");
  }
  if (orderIndex >= 0 && showIndex >= 0 && orderIndex > showIndex) {
    errors.push("ORDER BY appears after SHOW.");
    hints.push("ORDER BY must come after traversals and before SHOW.");
  }

  return { valid: errors.length === 0, errors, hints };
}

export function queryTools(client: DiscoveryClient) {
  return {
    discovery_dsl_examples: {
      description: "Return curated, static BMC Discovery DSL examples for a topic. Use this as an optional drafting reference before calling discovery_execute_dsl. No Discovery API call is made.",
      schema: dslExamplesSchema,
      outputSchema: structuredOutputSchema,
      handler: async (input: z.infer<typeof dslExamplesSchema>) => getDslExamples(input.topic)
    },
    discovery_validate_query: {
      description: "Validate common BMC Discovery DSL mistakes locally without executing the query. Optional pre-flight helper before discovery_execute_dsl; catches clause-ordering traps, LOOKUP+WHERE, and count(traverse ...) patterns.",
      schema: validateQuerySchema,
      outputSchema: structuredOutputSchema,
      handler: async (input: z.infer<typeof validateQuerySchema>) => validateDiscoveryQuery(input.query)
    }
  };
}
