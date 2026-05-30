import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type CostFrequency = "Mensuel" | "Annuel" | "One-shot" | "Inclus";

export interface ItCostRow {
  "Catégorie": string;
  "Sous-catégorie": string;
  "Composant": string;
  "Unité de mesure": string;
  "Coût unitaire min (€)": number;
  "Coût unitaire médian (€)": number;
  "Coût unitaire max (€)": number;
  "Devise": "EUR";
  "Fréquence": CostFrequency;
  "Notes / Hypothèses": string;
  "Source / Référence": string;
  "Date de mise à jour": string;
}

type CsvRecord = Record<string, string>;

const DATA_PATH = resolve(process.cwd(), "data", "it_cost_knowledge_base.csv");
let cachedRows: ItCostRow[] | null = null;

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

function parseCsv(csv: string): CsvRecord[] {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const record: CsvRecord = {};
    headers.forEach((header, index) => { record[header] = values[index] ?? ""; });
    return record;
  });
}

function parseNumber(value: string, field: string): number {
  const trimmed = value.trim();
  const isPercent = trimmed.endsWith("%");
  const normalized = trimmed.replace(/%$/, "").replace(/\s+/g, "").replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric value for ${field}: ${value}`);
  return isPercent ? parsed / 100 : parsed;
}

function parseFrequency(value: string): CostFrequency {
  if (value === "Mensuel" || value === "Annuel" || value === "Inclus") return value;
  if (value.startsWith("One-shot")) return "One-shot";
  throw new Error(`Invalid Fréquence value: ${value}`);
}

function mapRecord(record: CsvRecord): ItCostRow {
  const currency = record["Devise"]?.trim();
  if (currency !== "EUR") throw new Error(`Unsupported currency in IT cost catalog: ${currency}`);
  return {
    "Catégorie": record["Catégorie"]?.trim() ?? "",
    "Sous-catégorie": record["Sous-catégorie"]?.trim() ?? "",
    "Composant": record["Composant"]?.trim() ?? "",
    "Unité de mesure": record["Unité de mesure"]?.trim() ?? "",
    "Coût unitaire min (€)": parseNumber(record["Coût unitaire min (€)"] ?? "", "Coût unitaire min (€)"),
    "Coût unitaire médian (€)": parseNumber(record["Coût unitaire médian (€)"] ?? "", "Coût unitaire médian (€)"),
    "Coût unitaire max (€)": parseNumber(record["Coût unitaire max (€)"] ?? "", "Coût unitaire max (€)"),
    "Devise": "EUR",
    "Fréquence": parseFrequency(record["Fréquence"]?.trim() ?? ""),
    "Notes / Hypothèses": record["Notes / Hypothèses"]?.trim() ?? "",
    "Source / Référence": record["Source / Référence"]?.trim() ?? "",
    "Date de mise à jour": record["Date de mise à jour"]?.trim() ?? ""
  };
}

export function loadItCostRows(): ItCostRow[] {
  if (cachedRows) return cachedRows;
  const csv = readFileSync(DATA_PATH, "utf8");
  cachedRows = parseCsv(csv).map(mapRecord);
  return cachedRows;
}

export function reloadItCostRows(): ItCostRow[] {
  cachedRows = null;
  return loadItCostRows();
}
