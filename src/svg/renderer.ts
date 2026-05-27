import { Resvg } from "@resvg/resvg-js";
export interface RenderOptions { name: string; pngWidth?: number; textSummary?: string; }
export interface RenderedVisual { content: Array<{ type: "image"; data: string; mimeType: "image/png" }|{ type: "resource"; resource: { uri: string; mimeType: "image/svg+xml"; text: string } }|{ type: "text"; text: string }>; }
export function renderVisual(svg: string, options: RenderOptions): RenderedVisual {
  const width = options.pngWidth ?? 1200; const resourceUri = `mcp://discovery-visual/${options.name}.svg`; let pngBase64: string | null = null; let rasterError: string | null = null;
  try { const resvg = new Resvg(svg, { fitTo: { mode: "width", value: width }, background: "rgba(255,255,255,1)", font: { loadSystemFonts: false, defaultFontFamily: "Arial" } }); pngBase64 = resvg.render().asPng().toString("base64"); } catch (error) { rasterError = error instanceof Error ? error.message : String(error); }
  const content: RenderedVisual["content"] = []; if (pngBase64) content.push({ type: "image", data: pngBase64, mimeType: "image/png" });
  content.push({ type: "resource", resource: { uri: resourceUri, mimeType: "image/svg+xml", text: svg } });
  if (options.textSummary || rasterError) { const parts: string[] = []; if (options.textSummary) parts.push(options.textSummary); if (rasterError) parts.push(`[PNG rasterization failed: ${rasterError}. SVG resource still available.]`); content.push({ type: "text", text: parts.join("\n\n") }); }
  return { content };
}
export function svgEscape(value: string): string { return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;"); }
export function svgTruncate(value: string, max: number): string { const v = String(value); return v.length <= max ? v : v.slice(0, Math.max(0, max - 1)) + "…"; }
