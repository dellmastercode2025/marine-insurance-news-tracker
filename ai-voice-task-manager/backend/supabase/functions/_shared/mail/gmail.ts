// Gmail REST API via OAuth (scope gmail.readonly). Tokens are refreshed with the stored refresh_token.
import { htmlToText, parseAddress, parseAddressList, trimQuoted, type MailMessageInput, type MailSource, type OAuthTokens, type StoredCredentials } from "./types.ts";

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/userinfo.email", "openid"];

export function gmailAuthUrl(redirectUri: string, state: string): string {
  const id = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  if (!id) throw new Error("GOOGLE_OAUTH_CLIENT_ID not configured");
  const p = new URLSearchParams({ client_id: id, redirect_uri: redirectUri, response_type: "code", scope: GMAIL_SCOPES.join(" "), access_type: "offline", prompt: "consent", state });
  return `${AUTH}?${p}`;
}

export async function gmailExchange(code: string, redirectUri: string): Promise<{ tokens: OAuthTokens; email: string }> {
  const body = new URLSearchParams({ code, client_id: Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")!, client_secret: Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET")!, redirect_uri: redirectUri, grant_type: "authorization_code" });
  const res = await fetch(TOKEN, { method: "POST", body });
  const j = await res.json();
  if (!res.ok) throw new Error(`Google token error: ${j.error_description ?? j.error}`);
  const tokens: OAuthTokens = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in ?? 3600) * 1000, scope: j.scope };
  const prof = await (await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: `Bearer ${tokens.access_token}` } })).json();
  return { tokens, email: (prof.emailAddress ?? "").toLowerCase() };
}

async function refresh(tokens: OAuthTokens): Promise<OAuthTokens> {
  if (!tokens.refresh_token) throw new Error("Gmail: refresh token missing – reconnect the account");
  const body = new URLSearchParams({ refresh_token: tokens.refresh_token, client_id: Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")!, client_secret: Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET")!, grant_type: "refresh_token" });
  const res = await fetch(TOKEN, { method: "POST", body });
  const j = await res.json();
  if (!res.ok) throw new Error(`Gmail refresh failed: ${j.error_description ?? j.error}`);
  return { ...tokens, access_token: j.access_token, expires_at: Date.now() + (j.expires_in ?? 3600) * 1000 };
}

export class GmailSource implements MailSource {
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
  private async get(path: string): Promise<any> {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { Authorization: `Bearer ${await this.token()}` } });
    if (!res.ok) throw new Error(`Gmail ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  async listSince(since: Date, limit: number): Promise<MailMessageInput[]> {
    const q = `after:${Math.floor(since.getTime() / 1000)} -category:promotions -category:social`;
    const out: MailMessageInput[] = [];
    let pageToken: string | undefined;
    while (out.length < limit) {
      const list = await this.get(`messages?q=${encodeURIComponent(q)}&maxResults=${Math.min(100, limit - out.length)}${pageToken ? `&pageToken=${pageToken}` : ""}`);
      for (const m of list.messages ?? []) {
        const full = await this.get(`messages/${m.id}?format=full`);
        out.push(this.convert(full));
        if (out.length >= limit) break;
      }
      pageToken = list.nextPageToken;
      if (!pageToken) break;
    }
    return out;
  }

  private convert(m: any): MailMessageInput {
    const headers: Record<string, string> = {};
    for (const h of m.payload?.headers ?? []) headers[h.name.toLowerCase()] = h.value;
    const from = parseAddress(headers.from);
    const labels: string[] = m.labelIds ?? [];
    return {
      external_id: m.id,
      thread_id: m.threadId,
      subject: headers.subject ?? null,
      from_name: from.name,
      from_email: from.email,
      to_emails: parseAddressList(headers.to),
      cc_emails: parseAddressList(headers.cc),
      snippet: m.snippet ?? null,
      body_text: trimQuoted(extractBody(m.payload)),
      received_at: new Date(Number(m.internalDate)).toISOString(),
      is_from_me: labels.includes("SENT") || from.email === this.myEmail,
      is_read: !labels.includes("UNREAD"),
      has_attachments: hasAttachment(m.payload),
      web_link: `https://mail.google.com/mail/u/0/#all/${m.threadId}`,
    };
  }
}

function b64url(s: string): string { return new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))); }
function extractBody(p: any): string {
  if (!p) return "";
  if (p.mimeType === "text/plain" && p.body?.data) return b64url(p.body.data);
  if (p.mimeType === "text/html" && p.body?.data) return htmlToText(b64url(p.body.data));
  for (const part of p.parts ?? []) { const t = extractBody(part); if (t) return t; }
  return "";
}
function hasAttachment(p: any): boolean {
  if (!p) return false;
  if (p.filename && p.body?.attachmentId) return true;
  return (p.parts ?? []).some(hasAttachment);
}
