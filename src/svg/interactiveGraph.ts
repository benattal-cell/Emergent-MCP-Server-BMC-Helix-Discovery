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

  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>html, body { margin:0; height:100% } #cy { width:100%; height:100vh } .title{position:fixed;z-index:2;left:10px;top:8px;padding:6px 8px;background:#fff;border:1px solid #ddd;font-family:Arial;font-size:12px}</style></head><body><div class="title">${title}</div><div id="cy"></div><script>${cytoscapeJsSource}</script><script>const payload=${payload};const color=(k)=>{let h=0;for(let i=0;i<k.length;i++)h=(h*33+k.charCodeAt(i))>>>0;return 'hsl('+(h%360)+', 62%, 48%)'};const elements=[...payload.nodes.map(n=>({data:{id:n.id,label:n.name,kind:n.kind,color:color(n.kind)}})),...payload.edges.map((e,i)=>({data:{id:'e'+i,source:e.from,target:e.to,label:e.kind}}))];cytoscape({container:document.getElementById('cy'),elements,style:[{selector:'node',style:{'background-color':'data(color)','label':'data(label)','font-size':10,'text-wrap':'ellipsis','text-max-width':'120px'}},{selector:'edge',style:{'line-color':'#94a3b8','width':1.2,'curve-style':'bezier','opacity':0.7}}],layout:{name:'cose',animate:false}});</script></body></html>`;
}
