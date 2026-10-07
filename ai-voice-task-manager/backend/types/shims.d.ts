// Type shims so the shared modules can be type-checked with plain tsc (outside Deno).
declare module "npm:@supabase/supabase-js@2" {
  export type SupabaseClient = any;
  export function createClient(url: string, key: string, opts?: unknown): SupabaseClient;
}
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (req: Request) => Promise<Response> | Response): void };
