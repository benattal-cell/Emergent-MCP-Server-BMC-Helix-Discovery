type NodeAttrs = Record<string, unknown>;

export default class Graph {
  private nodes = new Map<string, NodeAttrs>();
  private edges: Array<{ from: string; to: string; attrs: Record<string, unknown> }> = [];

  addNode(id: string, attrs: NodeAttrs = {}) { this.nodes.set(id, { ...attrs }); }
  hasNode(id: string) { return this.nodes.has(id); }
  hasEdge(from: string, to: string) { return this.edges.some((edge) => edge.from === from && edge.to === to); }
  addEdge(from: string, to: string, attrs: Record<string, unknown> = {}) { this.edges.push({ from, to, attrs }); }
  degree(id: string) { return this.edges.filter((edge) => edge.from === id || edge.to === id).length; }
  mapNodes<T>(callback: (id: string, attrs: NodeAttrs) => T): T[] {
    return Array.from(this.nodes.entries()).map(([id, attrs]) => callback(id, attrs));
  }
}
