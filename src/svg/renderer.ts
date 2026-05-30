import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let resvgConstructor: (new (svg: string, options?: unknown) => { render(): { asPng(): { toString(encoding?: string): string } } }) | null | undefined;

function loadResvg() {
  if (resvgConstructor !== undefined) return resvgConstructor;
  try {
    const mod = require("@resvg/resvg-js") as { Resvg?: new (svg: string, options?: unknown) => { render(): { asPng(): { toString(encoding?: string): string } } } };
    resvgConstructor = mod.Resvg ?? null;
  } catch {
    resvgConstructor = null;
  }
  return resvgConstructor;
}

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
  structuredContent?: unknown;
  interactiveHtml?: { html: string; resourceName: string };
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
    const Resvg = loadResvg();
    if (!Resvg) throw new Error("@resvg/resvg-js is not available; install dependencies to enable PNG rasterization");
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

  if (options.interactiveHtml) {
    content.push({
      type: "resource",
      resource: {
        uri: `mcp://discovery-visual/${options.interactiveHtml.resourceName}.html`,
        mimeType: "text/html",
        text: options.interactiveHtml.html
      }
    });
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
