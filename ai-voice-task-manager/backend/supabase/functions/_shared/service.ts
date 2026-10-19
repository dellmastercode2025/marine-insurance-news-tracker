import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

/** Service-role client: bypasses RLS. Used ONLY for shared news tables, encrypted mail credentials and cron jobs. */
export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** True when a request carries the cron secret or the service role key (scheduled jobs). */
export function isCronRequest(req: Request): boolean {
  const secret = Deno.env.get("CRON_SECRET");
  const header = req.headers.get("x-cron-secret");
  if (secret && header && header === secret) return true;
  const auth = req.headers.get("Authorization") ?? "";
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return !!svc && auth === `Bearer ${svc}`;
}
