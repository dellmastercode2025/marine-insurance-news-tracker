// POST /mail-sync { account_id? }            (user JWT)        → sync the user's mailbox(es)
// POST /mail-sync  header x-cron-secret      (scheduled)       → sync every connected account
import { createClient } from "npm:@supabase/supabase-js@2";
import { authenticate } from "../_shared/auth.ts";
import { corsHeaders, HttpError, json } from "../_shared/cors.ts";
import { decryptJSON, encryptJSON } from "../_shared/crypto.ts";
import { GeminiClient, geminiConfigFromEnv } from "../_shared/gemini.ts";
import { isCronRequest, serviceClient } from "../_shared/service.ts";
import { classifyWithAI, detectUnanswered, type ThreadMsg } from "../_shared/mail/classify.ts";
import { GmailSource } from "../_shared/mail/gmail.ts";
import { ImapSource } from "../_shared/mail/imap.ts";
import { MicrosoftSource } from "../_shared/mail/microsoft.ts";
import type { MailSource, StoredCredentials } from "../_shared/mail/types.ts";

interface Account { id: string; user_id: string; provider: "gmail" | "microsoft" | "imap"; email: string; display_name: string | null; last_sync_at: string | null; sync_days: number }

async function syncAccount(acc: Account, gemini: GeminiClient): Promise<{ fetched: number; pending: number; errors: string[] }> {
  const service = serviceClient();
  const { data: cred } = await service.from("mail_credentials").select("ciphertext").eq("account_id", acc.id).maybeSingle();
  if (!cred) throw new Error("credentials missing – reconnect the mailbox");
  const stored = await decryptJSON<StoredCredentials>(cred.ciphertext);
  let source: MailSource;
  if (acc.provider === "gmail" && stored.kind === "oauth") source = new GmailSource(stored.tokens, acc.email);
  else if (acc.provider === "microsoft" && stored.kind === "oauth") source = new MicrosoftSource(stored.tokens, acc.email);
  else if (acc.provider === "imap" && stored.kind === "imap") source = new ImapSource(stored.imap, acc.email);
  else throw new Error("credential/provider mismatch");

  const overlap = 2 * 86400_000; // re-read the last two days so replies are not missed
  const since = acc.last_sync_at ? new Date(new Date(acc.last_sync_at).getTime() - overlap) : new Date(Date.now() - acc.sync_days * 86400_000);
  const messages = await source.listSince(since, 300);
  const updated = source.updatedCredentials();
  if (updated) await service.from("mail_credentials").update({ ciphertext: await encryptJSON(updated), updated_at: new Date().toISOString() }).eq("account_id", acc.id);

  if (messages.length) {
    const rows = messages.map((m) => ({ ...m, user_id: acc.user_id, account_id: acc.id, body_text: m.body_text?.slice(0, 4000) ?? null, snippet: m.snippet?.slice(0, 300) ?? null }));
    // upsert without clobbering user decisions (reply_status etc. are not in the row)
    const { error } = await service.from("mail_messages").upsert(rows, { onConflict: "account_id,external_id" });
    if (error) throw new Error(error.message);
  }

  // Re-evaluate threads touched in the window.
  const threadIds = [...new Set(messages.map((m) => m.thread_id))];
  let pending = 0;
  if (threadIds.length) {
    const { data: all } = await service.from("mail_messages").select("id,thread_id,from_email,from_name,subject,snippet,body_text,received_at,is_from_me,to_emails,cc_emails,reply_status").eq("account_id", acc.id).in("thread_id", threadIds.slice(0, 500));
    const { candidates, answered } = detectUnanswered((all ?? []) as ThreadMsg[], [acc.email]);
    if (answered.length) await service.from("mail_messages").update({ reply_status: "replied", needs_reply: false }).in("id", answered);
    const fresh = candidates.filter((c) => c.reply_status === "none");
    const verdicts = await classifyWithAI(gemini, { email: acc.email, name: acc.display_name }, fresh);
    for (const v of verdicts) {
      await service.from("mail_messages").update({
        needs_reply: v.needs_reply, reply_status: v.needs_reply ? "pending" : "dismissed", ai_reason: v.reason, ai_priority: v.priority, ai_suggested_action: v.suggested_action, ai_checked_at: new Date().toISOString(),
      }).eq("id", v.id);
    }
    pending = verdicts.filter((v) => v.needs_reply).length;
  }
  await service.from("mail_accounts").update({ last_sync_at: new Date().toISOString(), status: "connected", last_error: null }).eq("id", acc.id);
  return { fetched: messages.length, pending, errors: [] };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const gemini = new GeminiClient(geminiConfigFromEnv((k) => Deno.env.get(k)));
  const service = serviceClient();
  let accounts: Account[] = [];
  try {
    if (isCronRequest(req)) {
      const { data } = await service.from("mail_accounts").select("*").neq("status", "disconnected");
      accounts = (data ?? []) as Account[];
    } else {
      const ctx = await authenticate(req);
      const body = await req.json().catch(() => ({}));
      let q = ctx.supabase.from("mail_accounts").select("*").eq("user_id", ctx.userId);
      if (body.account_id) q = q.eq("id", body.account_id);
      const { data } = await q;
      accounts = (data ?? []) as Account[];
      if (!accounts.length) return json({ accounts: [], message: "Почта не подключена" });
    }
    const report = [];
    for (const acc of accounts) {
      try { report.push({ account_id: acc.id, email: acc.email, ...(await syncAccount(acc, gemini)) }); }
      catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await service.from("mail_accounts").update({ status: "error", last_error: msg }).eq("id", acc.id);
        report.push({ account_id: acc.id, email: acc.email, fetched: 0, pending: 0, errors: [msg] });
      }
    }
    return json({ accounts: report });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error("mail-sync", e instanceof Error ? e.message : e);
    return json({ error: "Internal error" }, 500);
  }
});

// keep the unused import linter quiet when bundling
void createClient;
