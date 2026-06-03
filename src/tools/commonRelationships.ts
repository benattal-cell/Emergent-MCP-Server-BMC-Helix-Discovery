import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { structuredOutputSchema } from "./outputSchemas.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const priorityOrder = {
  golden: 0,
  common: 1,
  occasional: 2
} as const;

const sectionSchema = z.enum(["itom", "itam", "discovery"]);

export const commonRelationshipsSchema = z.object({
  keywords: z.string().optional(),
  kind: z.string().optional(),
  section: sectionSchema.optional(),
  limit: z.number().int().positive().default(12)
}).strict();

type Priority = keyof typeof priorityOrder;
type Section = z.infer<typeof sectionSchema>;
type MatchedDirection = "forward" | "reverse" | "either";

interface RelationshipEntry {
  section: string;
  fromKinds: string[];
  toKinds: string[];
  traverseSpec: string;
  traverseReversed: string | null;
  wildcard: boolean;
  priority: string;
  keywords: string[];
  note: string;
  originalIndex: number;
}

export interface RelationshipResult {
  section: string;
  fromKinds: string[];
  toKinds: string[];
  traverseSpec: string;
  traverseReversed: string | null;
  wildcard: boolean;
  priority: string;
  keywords: string[];
  note: string;
  matchedDirection: MatchedDirection;
  matchedKeywords: string[];
}

interface RelationshipDataset {
  entries: RelationshipEntry[];
  antiPatterns: string[];
}

function decodeCsv(buffer: Buffer): string {
  const utf8 = buffer.toString("utf8");
  return utf8.includes("\uFFFD") ? buffer.toString("latin1") : utf8;
}

function resolveCsvPath(): string {
  const candidates = [
    path.resolve(__dirname, "../data/common_relationships.csv"),
    path.resolve(__dirname, "../../src/data/common_relationships.csv")
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`common_relationships.csv not found. Checked: ${candidates.join(", ")}`);
  }
  return found;
}

function deriveTraverseReversed(traverseSpec: string, wildcard: boolean): string | null {
  if (wildcard) return traverseSpec;

  const parts = traverseSpec.split(":");
  const [roleA, relKind, roleB] = parts;
  if (!roleA || !roleB || relKind === undefined) return null;

  return `${roleB}:${relKind}:${roleA}:`;
}

function parseCommonRelationshipsCsv(csvText: string): RelationshipDataset {
  const entries: RelationshipEntry[] = [];
  const antiPatterns: string[] = [];
  let originalIndex = 0;

  for (const rawLine of csvText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("# anti;")) {
      antiPatterns.push(line.slice("# anti;".length).trim());
      continue;
    }
    if (line.startsWith("#")) continue;
    if (line.toLowerCase().startsWith("section;")) continue;

    const columns = line.split(";");
    if (columns.length < 4) continue;

    const [sectionRaw, fromKindRaw, traverseSpecRaw, toKindRaw, priorityRaw = "", keywordsRaw = "", ...noteParts] = columns;
    const section = sectionRaw.trim();
    const fromKinds = fromKindRaw.split("/").map((kind) => kind.trim()).filter(Boolean);
    const toKinds = toKindRaw.split("/").map((kind) => kind.trim()).filter(Boolean);
    const traverseSpec = traverseSpecRaw.trim();
    const priority = priorityRaw.trim();
    const keywords = keywordsRaw.split(",").map((keyword) => keyword.trim().toLowerCase()).filter(Boolean);
    const note = noteParts.join(";").trim();
    const relKind = traverseSpec.split(":")[1] ?? "";
    const wildcard = relKind === "";

    entries.push({
      section,
      fromKinds,
      toKinds,
      traverseSpec,
      traverseReversed: deriveTraverseReversed(traverseSpec, wildcard),
      wildcard,
      priority,
      keywords,
      note,
      originalIndex: originalIndex++
    });
  }

  return { entries, antiPatterns };
}

let commonRelationshipsCache: RelationshipDataset | null = null;

function loadCommonRelationships(): RelationshipDataset {
  if (commonRelationshipsCache) return commonRelationshipsCache;
  const buffer = readFileSync(resolveCsvPath());
  commonRelationshipsCache = parseCommonRelationshipsCsv(decodeCsv(buffer));
  return commonRelationshipsCache;
}

function tokenizeKeywords(input: string | undefined): string[] {
  return (input ?? "")
    .toLowerCase()
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function findMatchedKeywords(entryKeywords: string[], tokens: string[]): string[] {
  if (tokens.length === 0) return [];
  return entryKeywords.filter((keyword) => tokens.some((token) => keyword.includes(token) || token.includes(keyword)));
}

function priorityRank(priority: string): number {
  return priority in priorityOrder ? priorityOrder[priority as Priority] : Number.MAX_SAFE_INTEGER;
}

function matchedDirection(entry: RelationshipEntry, kind: string | undefined): MatchedDirection {
  if (!kind) return "either";
  const normalizedKind = kind.trim().toLowerCase();
  if (entry.fromKinds.some((candidate) => candidate.toLowerCase() === normalizedKind)) return "forward";
  if (entry.toKinds.some((candidate) => candidate.toLowerCase() === normalizedKind)) return "reverse";
  return "either";
}

function formatResultsText(results: RelationshipResult[], antiPatterns: string[], input: z.infer<typeof commonRelationshipsSchema>): string {
  const lines = [
    `discovery_common_relationships: ${results.length} chemin(s) retourné(s).`,
    "Utilise traverseSpec en sens forward, ou traverseReversed lorsque matchedDirection vaut reverse. Les wildcards (::: par exemple) sont volontaires."
  ];

  if (input.keywords) lines.push(`Keywords: ${input.keywords}`);
  if (input.kind) lines.push(`Kind: ${input.kind}`);
  if (input.section) lines.push(`Section: ${input.section}`);

  if (results.length > 0) {
    lines.push("", "## Chemins curés");
    results.forEach((result, index) => {
      const reverse = result.traverseReversed ?? "non dérivable";
      const matched = result.matchedKeywords.length > 0 ? ` | mots-clés: ${result.matchedKeywords.join(", ")}` : "";
      lines.push(
        `${index + 1}. [${result.priority}/${result.section}] ${result.fromKinds.join("/")} -> ${result.toKinds.join("/")} | ${result.traverseSpec} | reverse: ${reverse} | direction: ${result.matchedDirection}${matched}`
      );
      if (result.note) lines.push(`   Note: ${result.note}`);
    });
  }

  if (antiPatterns.length > 0) {
    lines.push("", "## Anti-patterns / garde-fous");
    antiPatterns.forEach((antiPattern) => lines.push(`- ${antiPattern}`));
  }

  return lines.join("\n");
}

function toResult(entry: RelationshipEntry, tokens: string[], kind: string | undefined): RelationshipResult {
  return {
    section: entry.section,
    fromKinds: entry.fromKinds,
    toKinds: entry.toKinds,
    traverseSpec: entry.traverseSpec,
    traverseReversed: entry.traverseReversed,
    wildcard: entry.wildcard,
    priority: entry.priority,
    keywords: entry.keywords,
    note: entry.note,
    matchedDirection: matchedDirection(entry, kind),
    matchedKeywords: findMatchedKeywords(entry.keywords, tokens)
  };
}

export interface CommonRelationshipsMatch {
  results: RelationshipResult[];
  antiPatterns: string[];
}

export function matchCommonRelationships(input: {
  keywords?: string;
  kind?: string;
  section?: "itom" | "itam" | "discovery";
  limit?: number;
}): CommonRelationshipsMatch {
  const dataset = loadCommonRelationships();
  const tokens = tokenizeKeywords(input.keywords);
  const hasKeywords = tokens.length > 0;

  let candidates = dataset.entries;

  if (!hasKeywords && !input.kind) {
    candidates = candidates.filter((entry) => entry.priority === "golden");
  } else if (hasKeywords) {
    candidates = candidates.filter((entry) => findMatchedKeywords(entry.keywords, tokens).length > 0);
  }

  if (input.section) {
    const section: Section = input.section;
    candidates = candidates.filter((entry) => entry.section === section);
  }

  const results = [...candidates]
    .sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority) || left.originalIndex - right.originalIndex)
    .slice(0, input.limit ?? 12)
    .map((entry) => toResult(entry, tokens, input.kind));

  return { results, antiPatterns: dataset.antiPatterns };
}

export function commonRelationshipsTools() {
  return {
    discovery_common_relationships: {
      description:
        "Static curated referential of common BMC Helix Discovery TRAVERSE paths actually used in practice. Call this BEFORE writing any TRAVERSE DSL to get the golden path and direction; fall back to discovery_taxonomy_* only when the path is absent here. No Discovery API call is made.",
      schema: commonRelationshipsSchema,
      outputSchema: structuredOutputSchema,
      visualInstruction: "",
      isVisual: true,
      handler: async (input: z.infer<typeof commonRelationshipsSchema>) => {
        const { results, antiPatterns } = matchCommonRelationships(input);

        const structuredContent = {
          results,
          count: results.length,
          antiPatterns
        };

        return {
          content: [{ type: "text", text: formatResultsText(results, antiPatterns, input) }],
          structuredContent
        };
      }
    }
  };
}
