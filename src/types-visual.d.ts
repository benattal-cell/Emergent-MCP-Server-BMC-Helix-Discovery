declare module "@resvg/resvg-js" {
  export class Resvg {
    constructor(svg: string, options?: unknown);
    render(): { asPng(): { toString(encoding?: string): string } };
  }
}

declare module "@hpcc-js/wasm-graphviz" {
  export class Graphviz {
    static load(): Promise<{ dot(dot: string, format: string, options?: { engine?: string }): string }>;
  }
}
