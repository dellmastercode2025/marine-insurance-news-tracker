// Microsoft 365 / Outlook via Microsoft Graph (delegated Mail.Read). Works for corporate Exchange Online
// mailboxes when the tenant allows user consent for the app (see docs/MAIL_AND_NEWS.md).
import { htmlToText, trimQuoted, type MailMessageInput, type MailSource, type OAuthTokens, type StoredCredentials } from "./types.ts";

const TENANT = () => Deno.env.get("MS_OAUTH_TENANT") ?? "common";
const AUTH = () => `https://login.microsoftonline.com/${TENANT()}/oauth2/v2.0/authorize`;
const TOKEN = () => `https://login.microsoftonline.com/${TENANT()}/oauth2/v2.0/token`;
export const MS_SCOPES = ["openid", "email", "offline_access", "https://graph.microsoft.com/Mail.Read", "https://graph.microsoft.com/User.Read"];

export function microsoftAuthUrl(redirectUri: string, state: string): string {
  const id = Deno.env.get("MS_OAUTH_CLIENT_ID");
  if (!id) throw new Error("MS_OAUTH_CLIENT_ID not configured");
  const p = new URLSearchParams({ client_id: id, redirect_uri: redirectUri, response_type: "code", response_mode: "query", scope: MS_SCOPES.join(" "), state, prompt: "select_account" });
  return `${AUTH()}?${p}`;
}

export async function microsoftExchange(code: string, redirectUri: string): Promise<{ tokens: OAuthTokens; email: string; name: string | null }> {
  const body = new URLSearchParams({ code, client_id: Deno.env.get("MS_OAUTH_CLIENT_ID")!, client_secret: Deno.env.get("MS_OAUTH_CLIENT_SECRET")!, redirect_uri: redirectUri, grant_type: "authorization_code", scope: MS_SCOPES.join(" ") });
  const res = await fetch(TOKEN(), { method: "POST", body });
  const j = await res.json();
  if (!res.ok) throw new Error(`Microsoft token error: ${j.error_description ?? j.error}`);
  const tokens: OAuthTokens = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in ?? 3600) * 1000, scope: j.scope };
  const me = await (await fetch("https://graph.microsoft.com/v1.0/me", { headers: { Authorization: `Bearer ${tokens.access_token}` } })).json();
  return { tokens, email: (me.mail ?? me.userPrincipalName ?? "").toLowerCase(), name: me.displayName ?? null };
}

async function refresh(tokens: OAuthTokens): Promise<OAuthTokens> {
  if (!tokens.refresh_token) throw new Error("Microsoft: refresh token missing – reconnect the account");
  const body = new URLSearchParams({ refresh_token: tokens.refresh_token, client_id: Deno.env.get("MS_OAUTH_CLIENT_ID")!, client_secret: Deno.env.get("MS_OAUTH_CLIENT_SECRET")!, grant_type: "refresh_token", scope: MS_SCOPES.join(" ") });
  const res = await fetch(TOKEN(), { method: "POST", body });
  const j = await res.json();
  if (!res.ok) throw new Error(`Microsoft refresh failed: ${j.error_description ?? j.error}`);
  return { access_token: j.access_token, refresh_token: j.refresh_token ?? tokens.refresh_token, expires_at: Date.now() + (j.expires_in ?? 3600) * 1000, scope: j.scope };
}

export class MicrosoftSource implements MailSource {
  private changed: StoredCredentials | null = null;
  constructor(private tokens: OAuthTokens, private myEmail: string) {}
  updatedCredentials() { return this.changed; }

  private async token(): Promise<string> {
    if (!this.tokens.expires_at || this.tokens.expires_at < Date.now() + 60_000) {
      this.tokens = await refresh(this.tokens);
      this.changed = { kind: "oauth", tokens: this.tokens };
    }
    return this.tokens.access_token;
  }
  private async get(url: string): Promise<any> {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${await this.token()}`, Prefer: 'outlook.body-content-type="text"' } });
    if (!res.ok) throw new Error(`Graph ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  async listSince(since: Date, limit: number): Promise<MailMessageInput[]> {
    const select = "id,conversationId,subject,from,toRecipients,ccRecipients,bodyPreview,body,receivedDateTime,sentDateTime,isRead,hasAttachments,webLink,isDraft";
    const filter = `receivedDateTime ge ${since.toISOString()}`;
    const out: MailMessageInput[] = [];
    for (const folder of ["inbox", "sentitems"]) {
      let url: string | undefined = `https://graph.microsoft.com/v1.0/me/mailFolders/${folder}/messages?$filter=${encodeURIComponent(filter)}&$orderby=receivedDateTime desc&$top=50&$select=${select}`;
      while (url && out.length < limit) {
        const page: any = await this.get(url);
        for (const m of page.value ?? []) { if (!m.isDraft) out.push(this.convert(m, folder === "sentitems")); }
        url = page["@odata.nextLink"];
      }
    }
    return out.slice(0, limit);
  }

  private convert(m: any, sent: boolean): MailMessageInput {
    const fromEmail = (m.from?.emailAddress?.address ?? "").toLowerCase() || null;
    const body = m.body?.contentType === "html" ? htmlToText(m.body.content ?? "") : (m.body?.content ?? "");
    return {
      external_id: m.id,
      thread_id: m.conversationId ?? m.id,
      subject: m.subject ?? null,
      from_name: m.from?.emailAddress?.name ?? null,
      from_email: fromEmail,
      to_emails: (m.toRecipients ?? []).map((r: any) => (r.emailAddress?.address ?? "").toLowerCase()).filter(Boolean),
      cc_emails: (m.ccRecipients ?? []).map((r: any) => (r.emailAddress?.address ?? "").toLowerCase()).filter(Boolean),
      snippet: m.bodyPreview ?? null,
      body_text: trimQuoted(body),
      received_at: new Date(m.receivedDateTime ?? m.sentDateTime).toISOString(),
      is_from_me: sent || fromEmail === this.myEmail,
      is_read: m.isRead ?? null,
      has_attachments: !!m.hasAttachments,
      web_link: m.webLink ?? null,
    };
  }
}
