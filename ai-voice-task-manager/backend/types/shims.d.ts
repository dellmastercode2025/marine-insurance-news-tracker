// Type shims so the shared modules can be type-checked with plain tsc (outside Deno).
declare module "npm:@supabase/supabase-js@2" {
  export type SupabaseClient = any;
  export function createClient(url: string, key: string, opts?: unknown): SupabaseClient;
}
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (req: Request) => Promise<Response> | Response): void };
declare module "npm:imapflow@1" { export class ImapFlow { constructor(opts: any); connect(): Promise<void>; logout(): Promise<void>; getMailboxLock(name: string): Promise<{ release(): void }>; search(q: any, o?: any): Promise<number[]>; fetch(range: any, q: any, o?: any): AsyncIterable<any>; } }
declare module "npm:mailparser@3" { export function simpleParser(src: any): Promise<any>; }
