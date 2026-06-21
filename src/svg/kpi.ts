import { svgEscape, svgTruncate } from "./renderer.js";

export interface Kpi {
  label: string;
  value: string;
  hint?: string;
  delta?: { text: string; positive: boolean };
  alert?: boolean;
}

export function eur(n: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0
  }).format(n);
}

export function kpiGrid(title: string, kpis: Kpi[], opts: { columns?: number } = {}): string {
  const columns = Math.max(1, Math.min(opts.columns ?? Math.min(3, Math.max(1, kpis.length)), 4));
  const cardWidth = 300;
  const cardHeight = 126;
  const gap = 18;
  const margin = 28;
  const titleHeight = 54;
  const rows = Math.max(1, Math.ceil(kpis.length / columns));
  const width = margin * 2 + columns * cardWidth + (columns - 1) * gap;
  const height = margin * 2 + titleHeight + rows * cardHeight + (rows - 1) * gap;

  const cards = kpis.map((kpi, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = margin + col * (cardWidth + gap);
    const y = margin + titleHeight + row * (cardHeight + gap);
    const delta = kpi.delta
      ? `<text x="${x + cardWidth - 18}" y="${y + 34}" text-anchor="end" font-size="13" font-weight="700" fill="${kpi.delta.positive ? "#14853d" : "#c03221"}">${svgEscape(kpi.delta.text)}</text>`
      : "";
    const border = kpi.alert ? { color: "#c03221", width: 2.6 } : { color: "#dde3ed", width: 1.2 };
    const hint = kpi.hint
      ? `<text x="${x + 18}" y="${y + 104}" font-size="12" fill="#5a6478">${svgEscape(svgTruncate(kpi.hint, 44))}</text>`
      : "";

    return `<g>
      <rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}" rx="14" fill="#ffffff" stroke="${border.color}" stroke-width="${border.width}"/>
      <text x="${x + 18}" y="${y + 30}" font-size="12" font-weight="700" letter-spacing="0.04em" fill="#5a6478">${svgEscape(svgTruncate(kpi.label.toUpperCase(), 32))}</text>
      ${delta}
      <text x="${x + 18}" y="${y + 72}" font-size="30" font-weight="800" fill="#1d2330">${svgEscape(svgTruncate(kpi.value, 18))}</text>
      ${hint}
    </g>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="Arial">
    <rect width="100%" height="100%" fill="#f7f9fc"/>
    <text x="${margin}" y="${margin + 27}" font-size="22" font-weight="800" fill="#1d2330">${svgEscape(svgTruncate(title, 70))}</text>
    ${cards}
  </svg>`;
}

export interface BarDatum {
  label: string;
  value: number;
}

// Dashboard = a row of KPI cards on top + a horizontal bar chart below (distribution).
// Reuses the kpiGrid visual language (same palette/fonts).
// Count rows by the first of `fields` that actually carries data (handles attribute
// casing differences). Returns [] when nothing matches, so kpiDashboard degrades to KPIs.
export function countBy(rows: Array<Record<string, unknown>>, fields: string | string[]): BarDatum[] {
  const candidates = Array.isArray(fields) ? fields : [fields];
  const field = candidates.find((f) => rows.some((row) => typeof row[f] === "string" && (row[f] as string).trim() !== ""));
  if (!field) return [];
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const value = row[field];
    if (typeof value !== "string" || value.trim() === "") continue;
    const key = value.trim();
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.entries(counts).map(([label, value]) => ({ label, value }));
}

export function kpiDashboard(
  title: string,
  kpis: Kpi[],
  bars: BarDatum[],
  opts: { barTitle?: string; maxBars?: number; formatValue?: (value: number) => string } = {}
): string {
  const margin = 28;
  const gap = 18;
  const titleHeight = 54;
  const cardWidth = 300;
  const cardHeight = 126;
  const kpiCount = Math.max(1, kpis.length);
  const kpiColumns = Math.max(1, Math.min(kpiCount, 3));
  const kpiRows = Math.max(1, Math.ceil(kpiCount / kpiColumns));
  const innerWidth = kpiColumns * cardWidth + (kpiColumns - 1) * gap;
  const width = margin * 2 + innerWidth;

  const cards = kpis.map((kpi, index) => {
    const col = index % kpiColumns;
    const row = Math.floor(index / kpiColumns);
    const x = margin + col * (cardWidth + gap);
    const y = margin + titleHeight + row * (cardHeight + gap);
    const border = kpi.alert ? { color: "#c03221", width: 2.6 } : { color: "#dde3ed", width: 1.2 };
    const hint = kpi.hint
      ? `<text x="${x + 18}" y="${y + 104}" font-size="12" fill="#5a6478">${svgEscape(svgTruncate(kpi.hint, 44))}</text>`
      : "";
    return `<g>
      <rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}" rx="14" fill="#ffffff" stroke="${border.color}" stroke-width="${border.width}"/>
      <text x="${x + 18}" y="${y + 30}" font-size="12" font-weight="700" letter-spacing="0.04em" fill="#5a6478">${svgEscape(svgTruncate(kpi.label.toUpperCase(), 32))}</text>
      <text x="${x + 18}" y="${y + 72}" font-size="30" font-weight="800" fill="#1d2330">${svgEscape(svgTruncate(kpi.value, 18))}</text>
      ${hint}
    </g>`;
  }).join("");

  const maxBars = opts.maxBars ?? 12;
  const cleaned = bars.filter((bar) => bar.value > 0).sort((a, b) => b.value - a.value);
  const shown = cleaned.slice(0, maxBars);
  const rest = cleaned.slice(maxBars);
  if (rest.length) shown.push({ label: `+${rest.length} autres`, value: rest.reduce((sum, bar) => sum + bar.value, 0) });
  const maxValue = Math.max(1, ...shown.map((bar) => bar.value));

  const kpiBottom = margin + titleHeight + kpiRows * cardHeight + (kpiRows - 1) * gap;
  const barTitleY = kpiBottom + 34;
  const firstBarY = barTitleY + 22;
  const rowH = 34;
  const labelW = 190;
  const valueW = opts.formatValue ? 88 : 50;
  const trackX = margin + labelW;
  const trackW = Math.max(60, innerWidth - labelW - valueW);

  const barRows = shown.map((bar, index) => {
    const y = firstBarY + index * rowH;
    const w = Math.max(2, Math.round((bar.value / maxValue) * trackW));
    return `<g>
      <text x="${margin}" y="${y + 15}" font-size="13" fill="#1d2330">${svgEscape(svgTruncate(bar.label, 26))}</text>
      <rect x="${trackX}" y="${y}" width="${trackW}" height="20" rx="6" fill="#eef2f8"/>
      <rect x="${trackX}" y="${y}" width="${w}" height="20" rx="6" fill="#2f5fd0"/>
      <text x="${trackX + trackW + valueW - 6}" y="${y + 15}" text-anchor="end" font-size="13" font-weight="700" fill="#1d2330">${svgEscape(svgTruncate(opts.formatValue ? opts.formatValue(bar.value) : String(bar.value), 14))}</text>
    </g>`;
  }).join("");

  const barSection = shown.length
    ? `<text x="${margin}" y="${barTitleY}" font-size="14" font-weight="700" fill="#5a6478">${svgEscape(svgTruncate(opts.barTitle ?? "Répartition", 60))}</text>${barRows}`
    : "";

  const height = (shown.length ? firstBarY + shown.length * rowH : kpiBottom) + margin;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="Arial">
    <rect width="100%" height="100%" fill="#f7f9fc"/>
    <text x="${margin}" y="${margin + 27}" font-size="22" font-weight="800" fill="#1d2330">${svgEscape(svgTruncate(title, 70))}</text>
    ${cards}
    ${barSection}
  </svg>`;
}

export function statusBadge(ok: boolean, label: string, detail?: string): string {
  const width = 760;
  const height = detail ? 118 : 88;
  const color = ok ? "#14853d" : "#c03221";
  const bg = ok ? "#edf8f0" : "#fff1ef";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="Arial">
    <rect width="100%" height="100%" rx="16" fill="${bg}" stroke="${color}" stroke-width="2"/>
    <circle cx="42" cy="44" r="13" fill="${color}"/>
    <text x="68" y="50" font-size="22" font-weight="800" fill="#1d2330">${svgEscape(svgTruncate(label, 58))}</text>
    ${detail ? `<text x="68" y="82" font-size="14" fill="#5a6478">${svgEscape(svgTruncate(detail, 90))}</text>` : ""}
  </svg>`;
}
