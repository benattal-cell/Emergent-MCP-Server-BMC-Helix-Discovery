import fs from "node:fs";
import path from "node:path";

function loadCytoscapeJsSource(): string | null {
  try {
    const bundlePath = path.resolve(process.cwd(), "node_modules/cytoscape/dist/cytoscape.min.js");
    const raw = fs.readFileSync(bundlePath, "utf8");
    return raw.replace(/<\/script>/gi, "<\\/script>");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ message: "Failed to load local Cytoscape bundle", error: message })}\n`);
    return null;
  }
}

export const cytoscapeJsSource: string | null = loadCytoscapeJsSource();
