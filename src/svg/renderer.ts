import { Resvg } from "@resvg/resvg-js";

export interface VisualResourceBlock {
  type: "resource";
  resource: { uri: string; mimeType: string; text: string };
}
export interface VisualImageBlock { type: "image"; data: string; mimeType: "image/png" }
export interface VisualTextBlock { type: "text"; text: string }
export type VisualContentBlock = VisualImageBlock | VisualResourceBlock | VisualTextBlock;

export interface RenderOptions {
  name: string;
  pngWidth?: number;
  textSummary?: string;
  extraResources?: Array<{ uri: string; mimeType: string; text: string }>;
  structuredContent?: unknown;
}

export interface RenderedVisual {
  content: VisualContentBlock[];
  structuredContent?: unknown;
}

export function renderVisual(svg: string, options: RenderOptions): RenderedVisual {
  const width = options.pngWidth ?? 1200;
  const resourceUri = `mcp://discovery-visual/${options.name}.svg`;
  let pngBase64: string | null = null;
  let rasterError: string | null = null;

  try {
    const resvg = new Resvg(svg, {
      fitTo: { mode: "width", value: width },
      background: "rgba(255,255,255,1)",
      font: { loadSystemFonts: false, defaultFontFamily: "Arial" }
    });
    pngBase64 = resvg.render().asPng().toString("base64");
  } catch (error) {
    rasterError = error instanceof Error ? error.message : String(error);
  }

  const content: VisualContentBlock[] = [];
  if (pngBase64) content.push({ type: "image", data: pngBase64, mimeType: "image/png" });
  content.push({ type: "resource", resource: { uri: resourceUri, mimeType: "image/svg+xml", text: svg } });
  for (const resource of options.extraResources ?? []) {
    content.push({ type: "resource", resource });
  }

  if (options.textSummary || rasterError) {
    const parts: string[] = [];
    if (options.textSummary) parts.push(options.textSummary);
    if (rasterError) parts.push(`[PNG rasterization failed: ${rasterError}. SVG resource still available.]`);
    content.push({ type: "text", text: parts.join("\n\n") });
  }

  return options.structuredContent ? { content, structuredContent: options.structuredContent } : { content };
}

export function svgEscape(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function svgTruncate(value: string, max: number): string {
  const v = String(value);
  return v.length <= max ? v : `${v.slice(0, Math.max(0, max - 1))}…`;
}
