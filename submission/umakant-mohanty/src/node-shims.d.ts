declare module 'node:crypto' {
  export function createHmac(algo: string, key: string): { update(data: string): any; digest(encoding: string): string };
  export function timingSafeEqual(a: any, b: any): boolean;
}
declare module 'node:http' {
  export class IncomingMessage {
    headers: Record<string,string|string[]|undefined>;
    url?: string;
    method?: string;
    on(event: string, cb: (...args:any[])=>void): void;
  }
  export class ServerResponse {
    statusCode: number;
    setHeader(name:string,value:string):void;
    end(data?:string):void;
  }
  export class Server {
    listen(port:number, host:string, cb:()=>void):void;
    close(cb:()=>void):void;
    address(): any;
  }
  export function createServer(cb: (req:IncomingMessage,res:ServerResponse)=>void): Server;
}
declare module 'node:url' { export class URL { constructor(input:string, base:string); pathname:string; } }
declare module 'node:test' {
  type TestFn = (name:string, fn:()=>any)=>void;
  const test: TestFn & { beforeEach(fn:()=>any):void; after(fn:()=>any):void };
  export default test;
  export const before: (fn:()=>any)=>void;
  export const beforeEach: (fn:()=>any)=>void;
  export const after: (fn:()=>any)=>void;
}
declare module 'node:assert/strict' {
  const assert: any;
  export default assert;
}
declare const Buffer: { from(value:string): any };
