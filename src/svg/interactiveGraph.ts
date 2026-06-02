import { cytoscapeJsSource } from "./cytoscapeBundle.js";

export interface InteractiveNode {
  id: string;
  kind: string;
  name: string;
  type?: string;
  port?: string;
  publisher?: string;
}

export interface InteractiveEdge {
  from: string;
  to: string;
  kind: string;
}

export type InteractiveLayout = "concentric" | "hierarchical" | "cose";

export interface BuildInteractiveOptions {
  title: string;
  focusId?: string;
  layout?: InteractiveLayout;
}

/**
 * Self-contained interactive Cytoscape HTML for dependency maps.
 * No external CDN. Embeds:
 *   - CI-style icons per kind (inline SVG data-URIs)
 *   - selectable layout (concentric / hierarchical / cose)
 *   - light / dark NOC mode toggle
 *   - mini-map (custom SVG)
 *   - search box
 *   - hover tooltip
 *   - click a node to spotlight its neighbors
 *   - clickable legend (mute/un-mute a kind)
 */
export function buildInteractiveHtml(
  nodes: InteractiveNode[],
  edges: InteractiveEdge[],
  options: BuildInteractiveOptions
): string | null {
  if (!cytoscapeJsSource) return null;

  const layout: InteractiveLayout = options.layout ?? "concentric";
  const payloadStr = JSON.stringify({
    nodes,
    edges,
    focusId: options.focusId ?? null,
    layout
  }).replace(/<\//g, "<\\/");

  const title = options.title.replace(/</g, "&lt;").replace(/>/g, "&gt;");

  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
:root{
  --bg:#ffffff; --panel:#ffffff; --panel-head:#f7f9fc; --border:#dde3ed;
  --text:#1d2330; --text-muted:#5a6478; --accent:#1f6feb; --edge:#94a3b8;
  --shadow:0 1px 3px rgba(0,0,0,.06);
  --node-stroke:#1d2330;
}
:root.dark{
  --bg:#0b1220; --panel:#101a2e; --panel-head:#13213b; --border:#22324f;
  --text:#e6edf6; --text-muted:#8b97ad; --accent:#5aa1ff; --edge:#3a4a66;
  --shadow:0 1px 0 rgba(255,255,255,.04);
  --node-stroke:#e6edf6;
}
html,body{margin:0;height:100%;font-family:Arial,Helvetica,sans-serif;background:var(--bg);color:var(--text)}
#cy{position:absolute;inset:0;width:100%;height:100%}
.panel{position:fixed;z-index:3;background:var(--panel);border:1px solid var(--border);box-shadow:var(--shadow);border-radius:6px;font-size:12px;color:var(--text)}
.panel-head{padding:6px 8px;background:var(--panel-head);border-bottom:1px solid var(--border);font-weight:600;display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:pointer;user-select:none;border-radius:6px 6px 0 0}
.panel-head .caret{font-size:10px;color:var(--text-muted)}
.panel.collapsed .panel-body{display:none}
.panel.collapsed .panel-head{border-bottom:0;border-radius:6px}

#topbar{top:8px;left:8px;right:8px;display:flex;gap:8px;align-items:center;padding:6px 8px}
#topbar .title{font-weight:600;flex:0 1 auto;max-width:38%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#topbar input,#topbar select,#topbar button{font:inherit;color:var(--text);background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:4px 6px}
#topbar input{min-width:140px;flex:1}
#topbar button{cursor:pointer}

#legend{left:10px;bottom:10px;max-width:240px;max-height:50vh;overflow:auto}
.legend-body{padding:4px 4px}
.legend-row{display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:4px;cursor:pointer}
.legend-row:hover{background:var(--panel-head)}
.legend-row.muted{opacity:0.35}
.legend-swatch{width:18px;height:18px;border-radius:4px;flex:0 0 18px;display:inline-flex;align-items:center;justify-content:center;background:var(--accent)}
.legend-swatch svg{width:13px;height:13px;display:block}
.legend-name{flex:1;color:var(--text);word-break:break-word}
.legend-count{color:var(--text-muted);font-variant-numeric:tabular-nums}

#minimap{right:10px;bottom:10px;width:220px;padding:0}
#minimap .panel-body{padding:4px}
#minimap svg{display:block;width:100%;height:140px;background:var(--bg);border-radius:0 0 6px 6px}
#minimap .vp{fill:rgba(31,111,235,0.10);stroke:var(--accent);stroke-width:1;cursor:grab}
:root.dark #minimap .vp{fill:rgba(90,161,255,0.12)}

#tip{position:fixed;z-index:4;pointer-events:none;background:var(--panel);color:var(--text);border:1px solid var(--border);padding:6px 8px;border-radius:4px;font-size:11px;box-shadow:var(--shadow);max-width:280px;display:none}
#tip .tip-kind{color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:.04em}
#tip .tip-name{font-weight:600;word-break:break-word}
#tip .tip-row{margin-top:3px;word-break:break-word}
#tip .tip-label{color:var(--text-muted);display:inline-block;min-width:42px}
</style></head><body>
<div id="cy"></div>

<div id="topbar" class="panel">
  <div class="title">${title}</div>
  <input id="q" type="search" placeholder="Rechercher (nom, kind)…" autocomplete="off"/>
  <select id="layout-select" title="Layout">
    <option value="concentric">Concentric (blast radius)</option>
    <option value="hierarchical">Hierarchical (n-tier)</option>
    <option value="cose">Force (cose)</option>
  </select>
  <button id="fit" title="Recentrer">Fit</button>
  <button id="theme" title="Mode sombre / clair">🌙</button>
</div>

<div id="legend" class="panel">
  <div class="panel-head"><span>Légende</span><span class="caret">▾</span></div>
  <div class="panel-body" id="legend-body"></div>
</div>

<div id="minimap" class="panel">
  <div class="panel-head"><span>Mini-map</span><span class="caret">▾</span></div>
  <div class="panel-body"><svg id="mm-svg" viewBox="0 0 220 140" preserveAspectRatio="none"></svg></div>
</div>

<div id="tip"><div class="tip-kind"></div><div class="tip-name"></div><div class="tip-extra"></div></div>

<script>${cytoscapeJsSource}</script>
<script>
const PAYLOAD = ${payloadStr};

const ICONS = {
  server: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linejoin='round'><rect x='3' y='4' width='18' height='6' rx='1'/><rect x='3' y='14' width='18' height='6' rx='1'/><circle cx='7' cy='7' r='1' fill='white'/><circle cx='7' cy='17' r='1' fill='white'/></svg>",
  database: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2'><ellipse cx='12' cy='5' rx='8' ry='3'/><path d='M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5'/><path d='M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6'/></svg>",
  gear: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linejoin='round'><circle cx='12' cy='12' r='3'/><path d='M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1'/></svg>",
  cloud: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linejoin='round'><path d='M7 18a5 5 0 1 1 1.1-9.9 7 7 0 0 1 13.4 2.5A4 4 0 0 1 19 18H7z'/></svg>",
  stack: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linejoin='round'><polygon points='12 2 22 7 12 12 2 7 12 2'/><polyline points='2 12 12 17 22 12'/><polyline points='2 17 12 22 22 17'/></svg>",
  network: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2'><circle cx='12' cy='12' r='2.5'/><circle cx='4' cy='5' r='2'/><circle cx='20' cy='5' r='2'/><circle cx='4' cy='19' r='2'/><circle cx='20' cy='19' r='2'/><line x1='5.5' y1='6.5' x2='10.5' y2='10.5'/><line x1='18.5' y1='6.5' x2='13.5' y2='10.5'/><line x1='5.5' y1='17.5' x2='10.5' y2='13.5'/><line x1='18.5' y1='17.5' x2='13.5' y2='13.5'/></svg>",
  person: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linejoin='round'><circle cx='12' cy='8' r='4'/><path d='M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1'/></svg>",
  default: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2'><circle cx='12' cy='12' r='6'/></svg>"
};
const toDataUri = (svg) => "data:image/svg+xml;utf8," + encodeURIComponent(svg);
const ICON_URIS = {};
Object.keys(ICONS).forEach(k => { ICON_URIS[k] = toDataUri(ICONS[k]); });

function mapKindToIcon(kind){
  const k = String(kind).toLowerCase();
  if (k.includes("host") || k.includes("server") || k.includes("vm") || k.includes("device") || k.includes("machine")) return "server";
  if (k.includes("database") || k.includes("dbms") || k.includes("storage") || k.includes("volume") || k.includes("disk")) return "database";
  if (k.includes("service") || k.includes("businessapp") || k.includes("businessservice") || k.includes("application")) return "cloud";
  if (k.includes("cluster") || k.includes("pool") || k.includes("group")) return "stack";
  if (k.includes("network") || k.includes("interface") || k.includes("subnet") || k.includes("ip") || k.includes("vlan")) return "network";
  if (k.includes("person") || k.includes("owner") || k.includes("user") || k.includes("contact")) return "person";
  if (k.includes("software") || k.includes("process") || k.includes("instance") || k.includes("package")) return "gear";
  return "default";
}

function color(k){let h=0;for(let i=0;i<k.length;i++)h=(h*33+k.charCodeAt(i))>>>0;return "hsl("+(h%360)+",62%,48%)"}

const focusId = PAYLOAD.focusId;
const elements = [
  ...PAYLOAD.nodes.map(n => ({
    data: {
      id: n.id,
      label: n.name,
      kind: n.kind,
      type: n.type,
      port: n.port,
      publisher: n.publisher,
      color: color(n.kind),
      icon: ICON_URIS[mapKindToIcon(n.kind)],
      isFocus: focusId && n.id === focusId
    }
  })),
  ...PAYLOAD.edges.map((e,i) => ({
    data: { id: "e"+i, source: e.from, target: e.to, label: e.kind }
  }))
];

const cy = cytoscape({
  container: document.getElementById("cy"),
  elements,
  style: [
    { selector: "node", style: {
      "background-color": "data(color)",
      "background-image": "data(icon)",
      "background-fit": "none",
      "background-width": "58%",
      "background-height": "58%",
      "background-position-x": "50%",
      "background-position-y": "50%",
      "background-repeat": "no-repeat",
      "background-clip": "node",
      "background-image-opacity": 1,
      "width": 38, "height": 38,
      "border-width": 1.4,
      "label": "data(label)", "font-size": 10,
      "text-valign": "bottom", "text-margin-y": 4,
      "text-wrap": "ellipsis", "text-max-width": "140px"
    }},
    { selector: "node[?isFocus]", style: { "width": 54, "height": 54, "border-width": 3 }},
    { selector: "node.muted", style: { "opacity": 0.12, "text-opacity": 0.12 }},
    { selector: "node.dim", style: { "opacity": 0.25, "text-opacity": 0.25 }},
    { selector: "node.hit", style: { "border-width": 3 }},
    { selector: "edge", style: {
      "width": 1.4, "curve-style": "bezier", "opacity": 0.75,
      "target-arrow-shape": "triangle", "arrow-scale": 0.8
    }},
    { selector: "edge.muted", style: { "opacity": 0.05 }},
    { selector: "edge.dim", style: { "opacity": 0.12 }},
    { selector: "edge.hit", style: { "width": 2.2, "opacity": 1 }}
  ]
});

/* Cytoscape can't read CSS vars in stylesheet — resolve them at runtime and re-apply on theme switch */
function applyThemeColors(){
  const cs = getComputedStyle(document.documentElement);
  const stroke = cs.getPropertyValue("--node-stroke").trim() || "#1d2330";
  const text = cs.getPropertyValue("--text").trim() || "#1d2330";
  const edge = cs.getPropertyValue("--edge").trim() || "#94a3b8";
  const accent = cs.getPropertyValue("--accent").trim() || "#1f6feb";
  cy.style()
    .selector("node").style({ "border-color": stroke, "color": text })
    .selector("node[?isFocus]").style({ "border-color": accent })
    .selector("node.hit").style({ "border-color": accent })
    .selector("edge").style({ "line-color": edge, "target-arrow-color": edge })
    .selector("edge.hit").style({ "line-color": accent, "target-arrow-color": accent })
    .update();
}
applyThemeColors();

function cssEscape(s){ return String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => "\\\\" + c); }

function bfsDistances(rootId){
  const dist = {};
  if (!rootId || !cy.$("#"+cssEscape(rootId)).length) return dist;
  dist[rootId] = 0;
  const q = [rootId];
  while (q.length) {
    const u = q.shift();
    cy.$("#"+cssEscape(u)).neighborhood("node").forEach(n => {
      const id = n.id();
      if (dist[id] === undefined) { dist[id] = dist[u] + 1; q.push(id); }
    });
  }
  return dist;
}

function runLayout(name){
  let opts;
  if (name === "hierarchical") {
    opts = {
      name: "breadthfirst", directed: true, padding: 30,
      spacingFactor: 1.25, avoidOverlap: true, animate: false,
      roots: focusId ? "#" + cssEscape(focusId) : undefined
    };
  } else if (name === "cose") {
    opts = { name: "cose", animate: false, padding: 30, nodeRepulsion: 8000, idealEdgeLength: 90 };
  } else {
    const dist = bfsDistances(focusId);
    const maxDist = Math.max(1, ...Object.values(dist));
    opts = {
      name: "concentric", animate: false, padding: 30,
      minNodeSpacing: 28, avoidOverlap: true,
      concentric: (node) => {
        if (focusId && node.id() === focusId) return maxDist + 1;
        const d = dist[node.id()];
        return d === undefined ? 0 : (maxDist - d);
      },
      levelWidth: () => 1
    };
  }
  cy.layout(opts).run();
  setTimeout(updateMinimap, 50);
}

const sel = document.getElementById("layout-select");
sel.value = PAYLOAD.layout || "concentric";
sel.addEventListener("change", () => runLayout(sel.value));
runLayout(sel.value);

/* LEGEND */
const kindCounts = {};
for (const n of PAYLOAD.nodes) kindCounts[n.kind] = (kindCounts[n.kind] || 0) + 1;
const kindsSorted = Object.entries(kindCounts).sort((a,b) => b[1]-a[1]);
const body = document.getElementById("legend-body");
const hiddenKinds = new Set();

function applyKindFilter(){
  cy.batch(() => {
    cy.nodes().forEach(n => n.toggleClass("muted", hiddenKinds.has(n.data("kind"))));
    cy.edges().forEach(e => {
      const s = e.source().data("kind"), t = e.target().data("kind");
      e.toggleClass("muted", hiddenKinds.has(s) || hiddenKinds.has(t));
    });
  });
  updateMinimap();
}

kindsSorted.forEach(([kind, count]) => {
  const row = document.createElement("div");
  row.className = "legend-row";
  row.title = "Cliquer pour masquer/afficher ce type";
  const iconKey = mapKindToIcon(kind);
  row.innerHTML =
    '<span class="legend-swatch" style="background:' + color(kind) + '">' + ICONS[iconKey] + '</span>' +
    '<span class="legend-name"></span>' +
    '<span class="legend-count">' + count + '</span>';
  row.querySelector(".legend-name").textContent = kind;
  row.addEventListener("click", () => {
    if (hiddenKinds.has(kind)) { hiddenKinds.delete(kind); row.classList.remove("muted"); }
    else { hiddenKinds.add(kind); row.classList.add("muted"); }
    applyKindFilter();
  });
  body.appendChild(row);
});

/* COLLAPSE PANELS */
document.querySelectorAll(".panel").forEach(p => {
  const head = p.querySelector(".panel-head"); if (!head) return;
  const caret = head.querySelector(".caret");
  head.addEventListener("click", (ev) => {
    if (ev.target.closest(".legend-row")) return;
    if (ev.target.closest("input, select, button")) return;
    p.classList.toggle("collapsed");
    if (caret) caret.textContent = p.classList.contains("collapsed") ? "▸" : "▾";
    setTimeout(updateMinimap, 50);
  });
});

/* THEME */
const themeBtn = document.getElementById("theme");
themeBtn.addEventListener("click", () => {
  document.documentElement.classList.toggle("dark");
  themeBtn.textContent = document.documentElement.classList.contains("dark") ? "☀" : "🌙";
  applyThemeColors();
  updateMinimap();
});

/* FIT */
document.getElementById("fit").addEventListener("click", () => { cy.fit(undefined, 30); updateMinimap(); });

/* SEARCH */
const q = document.getElementById("q");
q.addEventListener("input", () => {
  const v = q.value.trim().toLowerCase();
  cy.batch(() => {
    if (!v) { cy.nodes().removeClass("dim hit"); cy.edges().removeClass("dim hit"); return; }
    cy.nodes().forEach(n => {
      const match = String(n.data("label")||"").toLowerCase().includes(v) || String(n.data("kind")||"").toLowerCase().includes(v);
      n.toggleClass("hit", match);
      n.toggleClass("dim", !match);
    });
    cy.edges().forEach(e => {
      const m = e.source().hasClass("hit") && e.target().hasClass("hit");
      e.toggleClass("dim", !m);
      e.toggleClass("hit", m);
    });
  });
});

/* TOOLTIP */
const tip = document.getElementById("tip");
const tipKind = tip.querySelector(".tip-kind");
const tipName = tip.querySelector(".tip-name");
const tipExtra = tip.querySelector(".tip-extra");
function setTipRows(node){
  const rows = [
    ["Type", node.data("type")],
    ["Port", node.data("port")],
    ["Vendor", node.data("publisher")]
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "");
  tipExtra.innerHTML = "";
  rows.forEach(([label, value]) => {
    const row = document.createElement("div");
    row.className = "tip-row";
    const labelEl = document.createElement("span");
    labelEl.className = "tip-label";
    labelEl.textContent = label + " :";
    const valueEl = document.createElement("span");
    valueEl.textContent = String(value);
    row.appendChild(labelEl);
    row.appendChild(valueEl);
    tipExtra.appendChild(row);
  });
}
cy.on("mouseover", "node", (ev) => {
  tipKind.textContent = ev.target.data("kind");
  tipName.textContent = ev.target.data("label");
  setTipRows(ev.target);
  tip.style.display = "block";
});
cy.on("mouseout", "node", () => { tip.style.display = "none"; });
document.addEventListener("mousemove", (e) => {
  if (tip.style.display === "block") {
    tip.style.left = (e.clientX + 12) + "px";
    tip.style.top  = (e.clientY + 12) + "px";
  }
});

/* CLICK NODE → SPOTLIGHT NEIGHBORS */
let pinned = null;
cy.on("tap", "node", (ev) => {
  const n = ev.target;
  if (pinned && pinned.id() === n.id()) { clearSpotlight(); pinned = null; return; }
  pinned = n;
  cy.batch(() => {
    cy.elements().addClass("dim");
    cy.elements().removeClass("hit");
    const close = n.closedNeighborhood();
    close.removeClass("dim");
    n.addClass("hit");
    close.edgesWith(close).addClass("hit");
  });
});
cy.on("tap", (ev) => { if (ev.target === cy) { clearSpotlight(); pinned = null; } });
function clearSpotlight(){ cy.batch(() => { cy.elements().removeClass("dim hit"); }); }

/* MINI-MAP */
const mmSvg = document.getElementById("mm-svg");
const MM_W = 220, MM_H = 140;
function updateMinimap(){
  if (document.getElementById("minimap").classList.contains("collapsed")) return;
  const bb = cy.elements().boundingBox({ includeLabels: false });
  if (!isFinite(bb.x1) || bb.w === 0 || bb.h === 0) { mmSvg.innerHTML = ""; return; }
  const pad = 4;
  const s = Math.min((MM_W - 2*pad) / bb.w, (MM_H - 2*pad) / bb.h);
  const ox = pad + ((MM_W - 2*pad) - bb.w*s)/2 - bb.x1*s;
  const oy = pad + ((MM_H - 2*pad) - bb.h*s)/2 - bb.y1*s;
  const proj = (x,y) => [x*s + ox, y*s + oy];
  const edgeColor = getComputedStyle(document.documentElement).getPropertyValue("--edge").trim() || "#94a3b8";

  let svg = "";
  cy.edges().forEach(e => {
    if (e.hasClass("muted")) return;
    const a = proj(e.source().position("x"), e.source().position("y"));
    const b = proj(e.target().position("x"), e.target().position("y"));
    svg += '<line x1="'+a[0]+'" y1="'+a[1]+'" x2="'+b[0]+'" y2="'+b[1]+'" stroke="'+edgeColor+'" stroke-width="0.5" opacity="0.7"/>';
  });
  cy.nodes().forEach(n => {
    if (n.hasClass("muted")) return;
    const p = proj(n.position("x"), n.position("y"));
    const r = n.data("isFocus") ? 2.4 : 1.6;
    svg += '<circle cx="'+p[0]+'" cy="'+p[1]+'" r="'+r+'" fill="'+n.data("color")+'"/>';
  });
  const ext = cy.extent();
  const a = proj(ext.x1, ext.y1), b = proj(ext.x2, ext.y2);
  svg += '<rect class="vp" x="'+a[0]+'" y="'+a[1]+'" width="'+(b[0]-a[0])+'" height="'+(b[1]-a[1])+'"/>';
  mmSvg.innerHTML = svg;
}
cy.on("pan zoom render", () => requestAnimationFrame(updateMinimap));

mmSvg.addEventListener("click", (ev) => {
  const r = mmSvg.getBoundingClientRect();
  const mx = (ev.clientX - r.left) * (MM_W / r.width);
  const my = (ev.clientY - r.top)  * (MM_H / r.height);
  const bb = cy.elements().boundingBox({ includeLabels: false });
  if (!isFinite(bb.x1) || bb.w === 0 || bb.h === 0) return;
  const pad = 4;
  const s = Math.min((MM_W - 2*pad) / bb.w, (MM_H - 2*pad) / bb.h);
  const ox = pad + ((MM_W - 2*pad) - bb.w*s)/2 - bb.x1*s;
  const oy = pad + ((MM_H - 2*pad) - bb.h*s)/2 - bb.y1*s;
  const wx = (mx - ox) / s;
  const wy = (my - oy) / s;
  cy.pan({ x: cy.width()/2 - wx*cy.zoom(), y: cy.height()/2 - wy*cy.zoom() });
  updateMinimap();
});

setTimeout(updateMinimap, 100);
</script></body></html>`;
}
