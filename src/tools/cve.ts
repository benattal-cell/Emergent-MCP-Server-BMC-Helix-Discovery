import { z } from "zod";

const cpeSchema = z.string().min(1).refine((v) => v.startsWith("cpe:2.3:"), {
  message: "CPE must start with cpe:2.3:"
});

const cveIdSchema = z.string().regex(/^CVE-\d{4}-\d{4,}$/i, "Invalid CVE format");

function esc(value: string): string {
  return value.replace(/'/g, "\\'");
}

function buildDiscoveryDsl(cpes: string[]): string {
  const where = cpes.map((cpe) => `cpe_string_23 matches '${esc(cpe)}'`).join(" or ");
  return `search SoftwareInstance where ${where} show type, version, #:::Host.name, #:::BusinessService.name processwith show type as 'Type', version as 'Full Version', #:::Host.name as 'Host Name', #:::BusinessService.name as 'Service Name', #RunningSoftware:HostedSoftware:Host:Host.#OwnedItem:Ownership:BusinessOwner:Person.name as 'Business Owner'`;
}

async function fetchNvdCpes(cveId: string): Promise<string[]> {
  const res = await fetch(`https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${encodeURIComponent(cveId)}`);
  if (!res.ok) {
    throw new Error(`NVD request failed: HTTP ${res.status}`);
  }
  const data = await res.json() as { vulnerabilities?: Array<{ cve?: { configurations?: unknown[] } }> };
  const out = new Set<string>();

  function walk(node: unknown): void {
    if (!node || typeof node !== "object") return;
    const anyNode = node as { criteria?: unknown; nodes?: unknown[]; cpeMatch?: unknown[]; cpe_match?: unknown[] };
    if (typeof anyNode.criteria === "string" && anyNode.criteria.startsWith("cpe:2.3:")) out.add(anyNode.criteria);
    const matches = Array.isArray(anyNode.cpeMatch) ? anyNode.cpeMatch : Array.isArray(anyNode.cpe_match) ? anyNode.cpe_match : [];
    for (const m of matches) {
      if (m && typeof m === "object" && typeof (m as { criteria?: unknown }).criteria === "string") {
        const c = (m as { criteria: string }).criteria;
        if (c.startsWith("cpe:2.3:")) out.add(c);
      }
    }
    if (Array.isArray(anyNode.nodes)) {
      for (const child of anyNode.nodes) walk(child);
    }
  }

  for (const v of data.vulnerabilities ?? []) {
    for (const conf of v.cve?.configurations ?? []) walk(conf);
  }
  return Array.from(out);
}

export function cveTools() {
  return {
    discovery_build_cve_software_query: {
      schema: z.object({ cpeStrings: z.array(cpeSchema).min(1), includeUrlEncoded: z.boolean().default(false) }).strict(),
      handler: async (input: { cpeStrings: string[]; includeUrlEncoded: boolean }) => {
        const dsl = buildDiscoveryDsl(input.cpeStrings);
        return {
          cpeCount: input.cpeStrings.length,
          dslQuery: dsl,
          ...(input.includeUrlEncoded ? { urlEncodedQuery: encodeURIComponent(dsl) } : {})
        };
      }
    },
    discovery_get_cve_cpes_from_nvd: {
      schema: z.object({ cveId: cveIdSchema }).strict(),
      handler: async (input: { cveId: string }) => {
        const cpes = await fetchNvdCpes(input.cveId.toUpperCase());
        return { cveId: input.cveId.toUpperCase(), cpeCount: cpes.length, cpeStrings: cpes };
      }
    }
  };
}
