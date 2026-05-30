import fs from "node:fs";
import path from "node:path";

interface HostRoleMapping {
  software_type_contains: string;
  role: string;
  priority: number;
}

let cachedMappings: HostRoleMapping[] | null = null;

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') { quoted = !quoted; continue; }
    if (ch === "," && !quoted) { cells.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function loadMappings(): HostRoleMapping[] {
  if (cachedMappings) return cachedMappings;
  const file = path.resolve(process.cwd(), "data/host_role_mapping.csv");
  const [header, ...lines] = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
  const headers = parseCsvLine(header);
  cachedMappings = lines.flatMap((line) => {
    if (!line.trim()) return [];
    const cells = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]));
    const priority = Number(row.priority);
    if (!row.software_type_contains || !row.role || !Number.isFinite(priority)) return [];
    return [{ software_type_contains: row.software_type_contains, role: row.role, priority }];
  });
  return cachedMappings;
}

export function deriveHostRole(softwareTypes: string[]): { role: string; matched: string[] } {
  const mappings = loadMappings();
  const matches = mappings.flatMap((mapping) => {
    const needle = mapping.software_type_contains.toLowerCase();
    const matchedTypes = softwareTypes.filter((type) => type.toLowerCase().includes(needle));
    return matchedTypes.length > 0 ? [{ mapping, matchedTypes }] : [];
  }).sort((a, b) => b.mapping.priority - a.mapping.priority);

  if (matches.length === 0) return { role: "Generic Host", matched: [] };
  const top = matches[0];
  return { role: top.mapping.role, matched: [...new Set(top.matchedTypes)] };
}
