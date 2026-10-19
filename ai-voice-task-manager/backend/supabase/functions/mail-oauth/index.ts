// OAuth connection of a mailbox.
//   POST /mail-oauth { provider: "gmail"|"microsoft", return_url }   (user JWT)  → { url }  – open it in a browser
//   GET  /mail-oauth?code=…&state=…                                  (provider callback, no JWT) → redirect to return_url
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { encryptJSON, signState, verifyState } from "../_shared/crypto.ts";
import { serviceClient } from "../_shared/service.ts";
import { gmailAuthUrl, gmailExchange } from "../_shared/mail/gmail.ts";
import { microsoftAuthUrl, microsoftExchange } from "../_shared/mail/microsoft.ts";

interface State { u: string; p: "gmail" | "microsoft"; r: string }

function redirectUri(): string {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/mail-oauth`;
}

function allowedReturn(url: string): boolean {
  const allow = (Deno.env.get("APP_URLS") ?? "http://localhost:5173,aivoicetasks://mail-connected").split(",").map((s) => s.trim()).filter(Boolean);
  return allow.some((a) => url.startsWith(a));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);

  if (req.method === "GET") {
    const code = url.searchParams.get("code");
    const stateRaw = url.searchParams.get("state");
    const err = url.searchParams.get("error_description") ?? url.searchParams.get("error");
    const state = stateRaw ? await verifyState<State>(stateRaw) : null;
    if (!state) return json({ error: "invalid or expired state" }, 400);
    const back = (q: string) => Response.redirect(`${state.r}${state.r.includes("?") ? "&" : "?"}${q}`, 302);
    if (err || !code) return back(`mail=error&message=${encodeURIComponent(err ?? "no code")}`);
    try {
      const service = serviceClient();
      let email: string, name: string | null = null, tokens;
      if (state.p === "gmail") ({ tokens, email } = await gmailExchange(code, redirectUri()));
      else ({ tokens, email, name } = await microsoftExchange(code, redirectUri()));
      if (!email) throw new Error("provider did not return an email address");
      const { data: acc, error } = await service.from("mail_accounts").upsert({ user_id: state.u, provider: state.p, email, display_name: name, status: "connected", last_error: null }, { onConflict: "user_id,email" }).select("id").single();
      if (error) throw new Error(error.message);
      await service.from("mail_credentials").upsert({ account_id: acc.id, user_id: state.u, ciphertext: await encryptJSON({ kind: "oauth", tokens }), updated_at: new Date().toISOString() });
      return back(`mail=connected&email=${encodeURIComponent(email)}`);
    } catch (e) {
      return back(`mail=error&message=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
    }
  }

  if (req.method !== "POST") return json({ error: "method" }, 405);
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: u } = await supabase.auth.getUser(authHeader.replace(/^Bearer /i, ""));
  if (!u.user) return json({ error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  const provider = body.provider as State["p"];
  const returnUrl = String(body.return_url ?? "");
  if (!["gmail", "microsoft"].includes(provider)) return json({ error: "provider must be gmail or microsoft" }, 400);
  if (!allowedReturn(returnUrl)) return json({ error: "return_url not allowed; add it to APP_URLS" }, 400);
  const state = await signState({ u: u.user.id, p: provider, r: returnUrl });
  try {
    const authUrl = provider === "gmail" ? gmailAuthUrl(redirectUri(), state) : microsoftAuthUrl(redirectUri(), state);
    return json({ url: authUrl });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
