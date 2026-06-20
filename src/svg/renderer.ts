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

interface VisualSettings {
  /** Emit visual blocks (PNG / SVG / interactive HTML). When false, only the text summary is returned. */
  enabled: boolean;
  /** Also emit the raw SVG as a resource block. Opt-out: on by default; disable to slim payloads for PNG-only clients. */
  includeSvg: boolean;
  /** Default rasterized PNG width. Smaller = cheaper for vision models. */
  pngWidth: number;
}

// Process-wide visual policy. Configured once at startup from env (see config.ts),
// so individual tools never need a per-call visual flag. The text summary is ALWAYS
// returned; the PNG/SVG/HTML blocks are gated by this policy.
let visualSettings: VisualSettings = { enabled: true, includeSvg: true, pngWidth: 1200 };

export function setVisualSettings(partial: Partial<VisualSettings>): void {
  visualSettings = { ...visualSettings, ...partial };
}

export function visualsEnabled(): boolean {
  return visualSettings.enabled;
}

export function renderVisual(svg: string, options: RenderOptions): RenderedVisual {
  const width = options.pngWidth ?? visualSettings.pngWidth;
  const resourceUri = `mcp://discovery-visual/${options.name}.svg`;
  const content: VisualContentBlock[] = [];
  let rasterError: string | null = null;

  if (visualSettings.enabled) {
    let pngBase64: string | null = null;
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

    if (pngBase64) content.push({ type: "image", data: pngBase64, mimeType: "image/png" });
    // Emit the SVG resource by default (opt-out), or always as a fallback when PNG rasterization failed.
    if (visualSettings.includeSvg || !pngBase64) {
      content.push({ type: "resource", resource: { uri: resourceUri, mimeType: "image/svg+xml", text: svg } });
    }

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
  }

  const summaryParts: string[] = [];
  if (options.textSummary) summaryParts.push(options.textSummary);
  if (rasterError) summaryParts.push(`[PNG rasterization failed: ${rasterError}. SVG resource provided as fallback.]`);
  if (summaryParts.length > 0) {
    content.push({ type: "text", text: summaryParts.join("\n\n") });
  }
  // MCP requires a non-empty content array; guarantee at least a text block.
  if (content.length === 0) {
    content.push({ type: "text", text: options.textSummary ?? "" });
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
