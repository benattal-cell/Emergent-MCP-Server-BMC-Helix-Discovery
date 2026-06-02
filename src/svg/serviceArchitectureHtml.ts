import fs from "node:fs";
import path from "node:path";

export interface ServiceNode {
  id: string;
  kind: string;
  name: string;
  type?: string;
  port?: string;
  publisher?: string;
}

export interface ServiceEdge {
  from: string;
  to: string;
  kind: string;
}

type TreeNode = ServiceNode & {
  treeId: string;
  duplicateOf?: string;
  via?: string;
  children?: TreeNode[];
};

type PositionedTreeNode = Omit<TreeNode, "children"> & {
  x: number;
  y: number;
  children?: PositionedTreeNode[];
};

interface StaticSvgRender {
  width: number;
  height: number;
  markup: string;
}

function loadD3JsSource(): string | null {
  try {
    const bundlePath = path.resolve(process.cwd(), "node_modules/d3/dist/d3.min.js");
    const raw = fs.readFileSync(bundlePath, "utf8");
    return raw.replace(/<\/script>/gi, "<\\/script>");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ message: "Failed to load local D3 bundle", error: message })}\n`);
    return null;
  }
}

const d3JsSource: string | null = loadD3JsSource();

function htmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function graphColor(kind: string): string {
  let hash = 0;
  for (let i = 0; i < kind.length; i++) hash = (hash * 33 + kind.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360},62%,48%)`;
}

function measureNodeName(name: string): number {
  return Math.max(120, name.length * 7 + 24);
}

function truncateLabel(value: string, max = 34): string {
  return value.length > max ? `${value.slice(0, max - 3)}…` : value;
}

function buildTree(nodes: ServiceNode[], edges: ServiceEdge[], rootId: string): { tree: TreeNode; duplicateCount: number; leafCount: number; maxDepth: number } {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const root = nodeById.get(rootId) ?? { id: rootId, kind: "Root", name: rootId };
  nodeById.set(rootId, root);

  const outgoing = new Map<string, ServiceEdge[]>();
  for (const edge of edges) {
    if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) continue;
    const list = outgoing.get(edge.from) ?? [];
    if (!list.some((existing) => existing.to === edge.to && existing.kind === edge.kind)) list.push(edge);
    outgoing.set(edge.from, list);
  }

  const usedTreeIds = new Set<string>();
  const copyCounts = new Map<string, number>();
  let duplicateCount = 0;
  let leafCount = 0;
  let maxDepth = 0;

  function nextTreeId(id: string): { treeId: string; duplicateOf?: string } {
    if (!usedTreeIds.has(id)) {
      usedTreeIds.add(id);
      return { treeId: id };
    }
    const next = (copyCounts.get(id) ?? 0) + 1;
    copyCounts.set(id, next);
    duplicateCount += 1;
    const treeId = `${id}_copy_${next}`;
    usedTreeIds.add(treeId);
    return { treeId, duplicateOf: id };
  }

  function visit(id: string, depth: number, pathIds: Set<string>, via?: string): TreeNode {
    maxDepth = Math.max(maxDepth, depth);
    const source = nodeById.get(id) ?? { id, kind: "Unknown", name: id };
    const identity = nextTreeId(id);
    const treeNode: TreeNode = { ...source, ...identity, ...(via ? { via } : {}) };

    const candidates = (outgoing.get(id) ?? []).filter((edge) => !pathIds.has(edge.to));
    if (candidates.length === 0) {
      leafCount += 1;
      return treeNode;
    }

    const nextPath = new Set(pathIds);
    nextPath.add(id);
    treeNode.children = candidates.map((edge) => visit(edge.to, depth + 1, nextPath, edge.kind));
    return treeNode;
  }

  return { tree: visit(rootId, 0, new Set<string>()), duplicateCount, leafCount, maxDepth };
}

function tooltipText(node: TreeNode): string {
  const rows = [node.kind, node.name];
  if (node.type) rows.push(`Type : ${node.type}`);
  if (node.port) rows.push(`Port : ${node.port}`);
  if (node.publisher) rows.push(`Vendor : ${node.publisher}`);
  if (node.duplicateOf) rows.push(`Duplicate : duplicated from ${node.duplicateOf}`);
  return rows.join("\n");
}

function buildStaticSvg(tree: TreeNode, leafCount: number, maxDepth: number): StaticSvgRender {
  const xStep = 220;
  const yStep = 130;
  const left = 80;
  const top = 110;
  const width = Math.max(1000, Math.max(1, leafCount) * xStep);
  const height = Math.max(620, (maxDepth + 1) * yStep + 160);
  let leafIndex = 0;

  function position(node: TreeNode, depth: number): PositionedTreeNode {
    const children = node.children?.map((child) => position(child, depth + 1)) ?? [];
    const { children: _rawChildren, ...rest } = node;
    const x = children.length > 0
      ? children.reduce((sum, child) => sum + child.x, 0) / children.length
      : left + (leafIndex += 1) * xStep - xStep;
    return {
      ...rest,
      x,
      y: top + depth * yStep,
      ...(children.length > 0 ? { children } : {})
    };
  }

  const positioned = position(tree, 0);
  const links: string[] = [];
  const nodes: string[] = [];

  function visit(node: PositionedTreeNode): void {
    for (const child of node.children ?? []) {
      const midY = (node.y + child.y) / 2;
      links.push(`<path class="link" d="M${node.x},${node.y}C${node.x},${midY} ${child.x},${midY} ${child.x},${child.y}"/>`);
      visit(child);
    }

    const width = measureNodeName(node.name);
    nodes.push(`<g class="node" transform="translate(${node.x},${node.y})"><title>${htmlEscape(tooltipText(node))}</title><rect x="${-width / 2}" y="-22" width="${width}" height="44" rx="6" fill="${graphColor(node.kind)}"/><text class="name" text-anchor="middle" y="-3">${htmlEscape(truncateLabel(node.name || node.id))}</text><text class="kind" text-anchor="middle" y="15">${htmlEscape(node.kind)}</text></g>`);
  }

  visit(positioned);
  return { width, height, markup: `<g id="static-graph">${links.join("")}${nodes.join("")}</g>` };
}


export function buildServiceArchitectureSvg(
  nodes: ServiceNode[],
  edges: ServiceEdge[],
  rootId: string,
  title: string
): string {
  const { tree, leafCount, maxDepth } = buildTree(nodes, edges, rootId);
  const staticSvg = buildStaticSvg(tree, leafCount, maxDepth);
  const safeTitle = htmlEscape(title);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${staticSvg.width} ${staticSvg.height}" width="${staticSvg.width}" height="${staticSvg.height}" font-family="Arial,Helvetica,sans-serif">
  <style>
    .node rect{stroke:#1d2330;stroke-width:1.2px}
    .node text.name{font-size:13px;font-weight:700;fill:#fff;pointer-events:none}
    .node text.kind{font-size:11px;fill:rgba(255,255,255,.78);pointer-events:none}
    .link{fill:none;stroke:#94a3b8;stroke-width:1.4px;opacity:.82}
  </style>
  <rect width="100%" height="100%" fill="#ffffff"/>
  <text x="20" y="34" font-size="18" font-weight="700" fill="#1d2330">${safeTitle}</text>
  ${staticSvg.markup}
</svg>`;
}

/**
 * Build a self-contained D3 hierarchy document for service architecture reviews.
 * D3 is embedded from node_modules/d3/dist/d3.min.js when available; no CDN is used.
 */
export function buildServiceArchitectureHtml(
  nodes: ServiceNode[],
  edges: ServiceEdge[],
  rootId: string,
  title: string
): string {
  const { tree, duplicateCount, leafCount, maxDepth } = buildTree(nodes, edges, rootId);
  const staticSvg = buildStaticSvg(tree, leafCount, maxDepth);
  const payload = JSON.stringify({ tree, duplicateCount, leafCount, maxDepth }).replace(/<\//g, "<\\/");
  const safeTitle = htmlEscape(title);
  const d3Script = d3JsSource ?? "window.__D3_BUNDLE_MISSING__=true;";

  return `<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title><style>
:root{--bg:#ffffff;--panel:#ffffff;--panel-head:#f7f9fc;--border:#dde3ed;--text:#1d2330;--text-muted:#5a6478;--edge:#94a3b8;--node-stroke:#1d2330;--shadow:0 1px 3px rgba(0,0,0,.06)}
:root.dark{--bg:#0b1220;--panel:#101a2e;--panel-head:#13213b;--border:#22324f;--text:#e6edf6;--text-muted:#8b97ad;--edge:#3a4a66;--node-stroke:#e6edf6;--shadow:0 1px 0 rgba(255,255,255,.04)}
html,body{margin:0;height:100%;font-family:Arial,Helvetica,sans-serif;background:var(--bg);color:var(--text);overflow:hidden}
#chart{position:absolute;inset:0;width:100%;height:100%}
#topbar{position:fixed;z-index:2;top:8px;left:8px;right:8px;display:flex;gap:8px;align-items:center;padding:6px 8px;background:var(--panel);border:1px solid var(--border);box-shadow:var(--shadow);border-radius:6px;font-size:12px;color:var(--text)}
#topbar .title{font-weight:700;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#topbar button{font:inherit;color:var(--text);background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:4px 8px;cursor:pointer}
.node rect{stroke:var(--node-stroke);stroke-width:1.2px;filter:drop-shadow(0 1px 1px rgba(0,0,0,.10))}
.node text.name{font-size:13px;font-weight:700;fill:#fff;pointer-events:none}
.node text.kind{font-size:11px;fill:rgba(255,255,255,.78);pointer-events:none}
.link{fill:none;stroke:var(--edge);stroke-width:1.4px;opacity:.82}
#tip{position:fixed;z-index:4;pointer-events:none;background:var(--panel);color:var(--text);border:1px solid var(--border);padding:6px 8px;border-radius:4px;font-size:11px;box-shadow:var(--shadow);max-width:320px;display:none}
#tip .tip-kind{color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:.04em}
#tip .tip-name{font-weight:700;word-break:break-word}.tip-row{margin-top:3px;word-break:break-word}.tip-label{color:var(--text-muted);display:inline-block;min-width:68px}
#missing{position:fixed;z-index:5;left:10px;bottom:10px;background:var(--panel);border:1px solid var(--border);padding:8px 10px;border-radius:6px;display:none;max-width:520px;font-size:12px;color:var(--text-muted)}
</style></head><body>
<div id="topbar"><div class="title">${safeTitle}</div><button id="fit">Fit</button><button id="theme">🌙</button></div>
<svg id="chart" viewBox="0 0 ${staticSvg.width} ${staticSvg.height}">${staticSvg.markup}</svg><div id="tip"><div class="tip-kind"></div><div class="tip-name"></div><div class="tip-extra"></div></div><div id="missing">D3 bundle unavailable or scripts disabled; showing the server-rendered static architecture diagram.</div>
<script>${d3Script}</script><script>
const PAYLOAD=${payload};
function color(kind){let h=0;for(let i=0;i<kind.length;i++)h=(h*33+kind.charCodeAt(i))>>>0;return 'hsl('+(h%360)+',62%,48%)'}
function measure(name){return Math.max(120, String(name||'').length*7+24)}
function setTipRows(d){const rows=[["Type",d.data.type],["Port",d.data.port],["Vendor",d.data.publisher],["Duplicate",d.data.duplicateOf?'duplicated from '+d.data.duplicateOf:null]].filter(([,v])=>v!==undefined&&v!==null&&String(v).trim()!==''); const extra=document.querySelector('#tip .tip-extra'); extra.innerHTML=''; rows.forEach(([label,value])=>{const row=document.createElement('div');row.className='tip-row';const l=document.createElement('span');l.className='tip-label';l.textContent=label+' :';const v=document.createElement('span');v.textContent=String(value);row.appendChild(l);row.appendChild(v);extra.appendChild(row);});}
if(window.__D3_BUNDLE_MISSING__||typeof d3==='undefined'){document.getElementById('missing').style.display='block'}else{
const root=d3.hierarchy(PAYLOAD.tree);const width=Math.max(1000,(PAYLOAD.leafCount||1)*220);const height=Math.max(620,(PAYLOAD.maxDepth+1)*130+160);const svg=d3.select('#chart').attr('viewBox',[0,0,width,height]);svg.select('#static-graph').remove();const g=svg.append('g');
const zoom=d3.zoom().scaleExtent([0.05,12]).on('zoom',(ev)=>g.attr('transform',ev.transform));svg.call(zoom);
d3.tree().size([width-160,height-180])(root);root.each(d=>{d.x+=80;d.y+=110});
g.selectAll('path.link').data(root.links()).join('path').attr('class','link').attr('d',d3.linkVertical().x(d=>d.x).y(d=>d.y));
const node=g.selectAll('g.node').data(root.descendants()).join('g').attr('class','node').attr('transform',d=>'translate('+d.x+','+d.y+')');
node.append('rect').attr('x',d=>-measure(d.data.name)/2).attr('y',-22).attr('width',d=>measure(d.data.name)).attr('height',44).attr('rx',6).attr('fill',d=>color(d.data.kind));
node.append('text').attr('class','name').attr('text-anchor','middle').attr('y',-3).text(d=>String(d.data.name||d.data.id).length>34?String(d.data.name||d.data.id).slice(0,31)+'…':d.data.name||d.data.id);
node.append('text').attr('class','kind').attr('text-anchor','middle').attr('y',15).text(d=>d.data.kind);
const tip=document.getElementById('tip');node.on('mouseover',(ev,d)=>{tip.querySelector('.tip-kind').textContent=d.data.kind;tip.querySelector('.tip-name').textContent=d.data.name||d.data.id;setTipRows(d);tip.style.display='block';}).on('mouseout',()=>{tip.style.display='none'});
document.addEventListener('mousemove',(ev)=>{if(tip.style.display==='block'){tip.style.left=(ev.clientX+12)+'px';tip.style.top=(ev.clientY+12)+'px';}});
document.getElementById('fit').addEventListener('click',()=>svg.transition().duration(250).call(zoom.transform,d3.zoomIdentity));
}
document.getElementById('theme').addEventListener('click',()=>{document.documentElement.classList.toggle('dark');document.getElementById('theme').textContent=document.documentElement.classList.contains('dark')?'☀':'🌙';});
</script></body></html>`;
}
