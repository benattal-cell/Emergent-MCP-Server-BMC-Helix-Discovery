import { cytoscapeJsSource } from "./cytoscapeBundle.js";

export interface InteractiveNode {
  id: string;
  kind: string;
  name: string;
}

export interface InteractiveEdge {
  from: string;
  to: string;
  kind: string;
}

export function buildInteractiveHtml(
  nodes: InteractiveNode[],
  edges: InteractiveEdge[],
  options: { title: string }
): string | null {
  if (!cytoscapeJsSource) return null;

  const payload = JSON.stringify({ nodes, edges }).replace(/<\//g, "<\\/");
  const title = options.title.replace(/</g, "&lt;").replace(/>/g, "&gt;");

  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>html, body { margin:0; height:100%; font-family:Arial, Helvetica, sans-serif } #cy { width:100%; height:100vh } .title{position:fixed;z-index:2;left:10px;top:8px;padding:6px 8px;background:#fff;border:1px solid #ddd;font-size:12px} .legend{position:fixed;z-index:2;left:10px;bottom:10px;background:#fff;border:1px solid #ddd;font-size:11px;max-width:240px;max-height:60vh;overflow:auto} .legend-head{padding:6px 8px;background:#f7f9fc;border-bottom:1px solid #ddd;font-weight:600;cursor:pointer;user-select:none;display:flex;justify-content:space-between;align-items:center;gap:8px} .legend-head .caret{font-size:10px;color:#5a6478} .legend-body{padding:4px 4px} .legend-row{display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:4px;cursor:pointer} .legend-row:hover{background:#f0f4fb} .legend-row.muted{opacity:0.35} .legend-swatch{width:10px;height:10px;border-radius:50%;flex:0 0 10px} .legend-name{flex:1;color:#1d2330;word-break:break-word} .legend-count{color:#5a6478;font-variant-numeric:tabular-nums} .legend.collapsed .legend-body{display:none}</style></head><body><div class="title">${title}</div><div id="cy"></div><div id="legend" class="legend"><div class="legend-head" id="legend-head"><span>Légende</span><span class="caret" id="legend-caret">▾</span></div><div class="legend-body" id="legend-body"></div></div><script>${cytoscapeJsSource}</script><script>
const payload=${payload};
const color=(k)=>{let h=0;for(let i=0;i<k.length;i++)h=(h*33+k.charCodeAt(i))>>>0;return 'hsl('+(h%360)+', 62%, 48%)'};
const elements=[...payload.nodes.map(n=>({data:{id:n.id,label:n.name,kind:n.kind,color:color(n.kind)}})),...payload.edges.map((e,i)=>({data:{id:'e'+i,source:e.from,target:e.to,label:e.kind}}))];
const cy=cytoscape({container:document.getElementById('cy'),elements,style:[{selector:'node',style:{'background-color':'data(color)','label':'data(label)','font-size':10,'text-wrap':'ellipsis','text-max-width':'120px'}},{selector:'node.muted',style:{'opacity':0.15,'text-opacity':0.15}},{selector:'edge',style:{'line-color':'#94a3b8','width':1.2,'curve-style':'bezier','opacity':0.7}},{selector:'edge.muted',style:{'opacity':0.05}}],layout:{name:'cose',animate:false}});
const kindCounts={};
for(const n of payload.nodes){kindCounts[n.kind]=(kindCounts[n.kind]||0)+1}
const kindsSorted=Object.entries(kindCounts).sort((a,b)=>b[1]-a[1]);
const body=document.getElementById('legend-body');
const hiddenKinds=new Set();
function applyFilter(){
  cy.batch(()=>{
    cy.nodes().forEach(n=>{n.toggleClass('muted',hiddenKinds.has(n.data('kind')))});
    cy.edges().forEach(e=>{
      const s=e.source().data('kind'),t=e.target().data('kind');
      e.toggleClass('muted',hiddenKinds.has(s)||hiddenKinds.has(t));
    });
  });
}
kindsSorted.forEach(([kind,count])=>{
  const row=document.createElement('div');
  row.className='legend-row';
  row.title='Cliquer pour masquer/afficher';
  row.innerHTML='<span class="legend-swatch" style="background:'+color(kind)+'"></span><span class="legend-name"></span><span class="legend-count">'+count+'</span>';
  row.querySelector('.legend-name').textContent=kind;
  row.addEventListener('click',()=>{
    if(hiddenKinds.has(kind)){hiddenKinds.delete(kind);row.classList.remove('muted')}
    else{hiddenKinds.add(kind);row.classList.add('muted')}
    applyFilter();
  });
  body.appendChild(row);
});
const legendEl=document.getElementById('legend');
document.getElementById('legend-head').addEventListener('click',(ev)=>{
  if(ev.target.closest('.legend-row'))return;
  legendEl.classList.toggle('collapsed');
  document.getElementById('legend-caret').textContent=legendEl.classList.contains('collapsed')?'▸':'▾';
});
</script></body></html>`;
}
