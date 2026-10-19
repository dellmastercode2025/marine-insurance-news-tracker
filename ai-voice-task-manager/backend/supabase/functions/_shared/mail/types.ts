export type MailProvider = "gmail" | "microsoft" | "imap";

export interface MailMessageInput {
  external_id: string;
  thread_id: string;
  subject: string | null;
  from_name: string | null;
  from_email: string | null;
  to_emails: string[];
  cc_emails: string[];
  snippet: string | null;
  body_text: string | null;
  received_at: string;
  is_from_me: boolean;
  is_read: boolean | null;
  has_attachments: boolean;
  web_link: string | null;
}

export interface OAuthTokens { access_token: string; refresh_token?: string; expires_at?: number; scope?: string }
export interface ImapCredentials { host: string; port: number; secure: boolean; username: string; password: string }
export type StoredCredentials = { kind: "oauth"; tokens: OAuthTokens } | { kind: "imap"; imap: ImapCredentials };

export interface MailSource {
  /** Messages received or sent since `since` (inclusive), newest first, bounded by `limit`. */
  listSince(since: Date, limit: number): Promise<MailMessageInput[]>;
  /** Returns refreshed credentials when they changed (token refresh) so the caller can persist them. */
  updatedCredentials(): StoredCredentials | null;
}

export const NOREPLY_RE = /no-?reply|do-?not-?reply|notification|newsletter|mailer-daemon|postmaster|bounce|alerts?@|digest@|info@|news@|marketing|unsubscribe|noreply/i;

export function parseAddress(raw: string | null | undefined): { name: string | null; email: string | null } {
  if (!raw) return { name: null, email: null };
  const m = /^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/.exec(raw);
  if (m) return { name: m[1].trim() || null, email: m[2].trim().toLowerCase() };
  const e = /[\w.+-]+@[\w.-]+\.\w+/.exec(raw);
  return { name: null, email: e ? e[0].toLowerCase() : null };
}

export function parseAddressList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw.split(",").map((x) => parseAddress(x).email).filter((x): x is string => !!x);
}

export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n\n+/g, "\n").trim();
}

/** Keep the newest part of a reply, drop quoted history. */
export function trimQuoted(text: string, max = 4000): string {
  const cut = text.search(/\n(On .+wrote:|-----Original Message-----|From: .+\nSent: |От: .+\nОтправлено: |\d{1,2}\.\d{1,2}\.\d{4}.+написал\(а\):)/);
  return (cut > 200 ? text.slice(0, cut) : text).slice(0, max).trim();
}
