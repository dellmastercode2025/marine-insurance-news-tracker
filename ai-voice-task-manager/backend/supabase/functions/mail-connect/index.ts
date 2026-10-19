// POST /mail-connect
//   { action: "imap", email, host, port, secure, username, password }  – test + store encrypted
//   { action: "remove", account_id }                                   – disconnect and delete messages
import { serveWith } from "../_shared/handler.ts";
import { readJson } from "../_shared/auth.ts";
import { HttpError, json } from "../_shared/cors.ts";
import { encryptJSON } from "../_shared/crypto.ts";
import { serviceClient } from "../_shared/service.ts";
import { ImapSource } from "../_shared/mail/imap.ts";

serveWith(async (req, ctx) => {
  const body = await readJson<Record<string, unknown>>(req);
  const service = serviceClient();
  if (body.action === "remove") {
    const id = String(body.account_id ?? "");
    const { error } = await ctx.supabase.from("mail_accounts").delete().eq("id", id).eq("user_id", ctx.userId);
    if (error) throw new HttpError(400, error.message);
    return json({ ok: true });
  }
  if (body.action === "imap") {
    const creds = { host: String(body.host ?? ""), port: Number(body.port ?? 993), secure: body.secure !== false, username: String(body.username ?? body.email ?? ""), password: String(body.password ?? "") };
    const email = String(body.email ?? "").toLowerCase();
    if (!creds.host || !creds.username || !creds.password || !email.includes("@")) throw new HttpError(400, "email, host, username and password are required");
    try { await new ImapSource(creds, email).test(); } catch (e) { throw new HttpError(400, `IMAP connection failed: ${e instanceof Error ? e.message : e}`); }
    const { data: acc, error } = await ctx.supabase.from("mail_accounts").upsert({ user_id: ctx.userId, provider: "imap", email, status: "connected", last_error: null }, { onConflict: "user_id,email" }).select("id").single();
    if (error) throw new HttpError(400, error.message);
    await service.from("mail_credentials").upsert({ account_id: acc.id, user_id: ctx.userId, ciphertext: await encryptJSON({ kind: "imap", imap: creds }), updated_at: new Date().toISOString() });
    return json({ ok: true, account_id: acc.id });
  }
  throw new HttpError(400, "unknown action");
});
