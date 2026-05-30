declare module "@resvg/resvg-js" {
  export class Resvg {
    constructor(svg: string, options?: unknown);
    render(): { asPng(): { toString(encoding?: string): string } };
  }
}

declare module "graphology" {
  export default class Graph {
    addNode(id: string, attributes: Record<string, unknown>): void;
    addEdge(source: string, target: string, attributes?: Record<string, unknown>): void;
    hasNode(id: string): boolean;
    hasEdge(source: string, target: string): boolean;
    degree(id: string): number;
    mapNodes<T>(cb: (id: string, attrs: Record<string, unknown>) => T): T[];
  }
}

declare module "graphology-layout-forceatlas2" {
  const forceAtlas2: {
    assign(graph: unknown, options: { iterations: number; settings: Record<string, unknown> }): void;
  };
  export default forceAtlas2;
}
