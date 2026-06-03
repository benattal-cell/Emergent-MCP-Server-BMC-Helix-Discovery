import { z } from "zod";

export const structuredOutputSchema = z.object({}).passthrough();
export const rowSchema = z.record(z.unknown());

export const flatRowsOutputSchema = z.object({
  summary: z.string().optional(),
  totalCount: z.number().optional(),
  returnedCount: z.number().optional(),
  rows: z.array(rowSchema).optional()
}).passthrough();

export const arrayResultOutputSchema = z.object({
  result: z.array(z.unknown()),
  count: z.number()
}).passthrough();

export const scalarResultOutputSchema = z.object({
  result: z.unknown()
}).passthrough();

export const dslQueryOutputSchema = z.object({
  dslQuery: z.string(),
  provenance: z.enum(["curated", "exploratory"]).optional(),
  riskWindowDays: z.number().optional(),
  urlEncodedQuery: z.string().optional()
}).passthrough();

export const graphOutputSchema = z.object({
  nodes: z.array(rowSchema).optional(),
  links: z.array(rowSchema).optional(),
  edges: z.array(rowSchema).optional()
}).passthrough();

export const graphSummaryOutputSchema = z.object({
  counts: z.object({ nodes: z.number(), relations: z.number() }).passthrough(),
  nodeKinds: z.record(z.number()),
  relationKinds: z.record(z.number()),
  cmdbView: z.object({}).passthrough()
}).passthrough();

export const dependencyScopeOutputSchema = z.object({
  resolved: z.object({ type: z.enum(["node_id", "host_name"]), id: z.string().optional(), name: z.string().optional() }).passthrough(),
  counts: z.object({ nodes: z.number(), relations: z.number(), inbound: z.number(), outbound: z.number() }).passthrough(),
  nodeKinds: z.record(z.number()),
  relationKinds: z.record(z.number()),
  suggestion: z.string(),
  rawGraph: z.unknown().optional()
}).passthrough();

export const dependencyMapOutputSchema = z.object({
  focus: z.object({ id: z.string(), name: z.string() }).passthrough(),
  layout: z.object({ algorithm: z.string(), iterations: z.number(), settings: z.record(z.unknown()) }).passthrough(),
  interactiveLayout: z.enum(["concentric", "hierarchical", "cose"]).optional(),
  nodes: z.array(rowSchema),
  edges: z.array(rowSchema),
  truncated: z.boolean(),
  counts: z.object({ nodes: z.number(), edges: z.number(), kinds: z.record(z.number()) }).passthrough()
}).passthrough();

export const hostSoftwareOutputSchema = flatRowsOutputSchema.extend({
  rawRows: z.array(rowSchema),
  deduplicatedCount: z.number(),
  hostRole: z.object({ role: z.string(), matched: z.array(z.string()) }).passthrough(),
  lifecycleRiskDetected: z.boolean()
}).passthrough();


export const orphanOutputSchema = z.object({
  summary: z.object({
    total_candidates: z.number(),
    total_matching_in_discovery: z.number(),
    returned_candidates: z.number(),
    by_category: z.record(z.number()),
    generated_dsl_query: z.string(),
    warnings: z.array(z.string())
  }).passthrough(),
  rows: z.array(rowSchema),
  generated_dsl_query: z.string()
}).passthrough();

const serviceNodeSchema = z.object({ id: z.string(), kind: z.string(), name: z.string() }).passthrough();
const serviceEdgeSchema = z.object({ from: z.string(), to: z.string(), kind: z.string() }).passthrough();

const serviceArchitectureResultSchema = z.object({
  root: z.object({ id: z.string(), name: z.string() }).passthrough(),
  summary: z.string(),
  nodes: z.array(serviceNodeSchema),
  edges: z.array(serviceEdgeSchema),
  levels: z.number(),
  truncated: z.boolean()
}).passthrough();

export const serviceArchitectureOutputSchema = z.object({
  summary: z.string().optional(),
  diagrams: z.array(serviceArchitectureResultSchema).optional(),
  count: z.number().optional(),
  error: z.string().optional()
}).passthrough();

export const itCostCompareOutputSchema = z.object({
  workload_type: z.string().optional(),
  quantity: z.number().optional(),
  alternatives: z.array(rowSchema).optional(),
  savings_vs_current: z.array(rowSchema).optional(),
  kpi: z.object({}).passthrough().nullable().optional()
}).passthrough();
