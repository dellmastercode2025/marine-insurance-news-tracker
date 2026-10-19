// Generic IMAP (on-prem Exchange with IMAP enabled, Yandex, Mail.ru, corporate servers with app passwords).
// Uses imapflow + mailparser from npm; Exchange Online no longer accepts password IMAP – use the Microsoft provider there.
import { ImapFlow } from "npm:imapflow@1";
import { simpleParser } from "npm:mailparser@3";
import { htmlToText, trimQuoted, type ImapCredentials, type MailMessageInput, type MailSource, type StoredCredentials } from "./types.ts";

export class ImapSource implements MailSource {
  constructor(private creds: ImapCredentials, private myEmail: string) {}
  updatedCredentials(): StoredCredentials | null { return null; }

  private client(): ImapFlow {
    return new ImapFlow({ host: this.creds.host, port: this.creds.port, secure: this.creds.secure, auth: { user: this.creds.username, pass: this.creds.password }, logger: false, tls: { rejectUnauthorized: true } });
  }

  async test(): Promise<void> {
    const c = this.client();
    await c.connect();
    await c.logout();
  }

  async listSince(since: Date, limit: number): Promise<MailMessageInput[]> {
    const c = this.client();
    await c.connect();
    const out: MailMessageInput[] = [];
    try {
      for (const [mailbox, sent] of [["INBOX", false], ["Sent", true], ["Sent Items", true], ["Отправленные", true]] as const) {
        let lock;
        try { lock = await c.getMailboxLock(mailbox); } catch { continue; }
        try {
          const uids = await c.search({ since }, { uid: true });
          const latest = (uids ?? []).slice(-Math.max(1, limit - out.length));
          if (!latest.length) continue;
          for await (const msg of c.fetch(latest, { uid: true, envelope: true, flags: true, source: { maxLength: 300_000 }, bodyStructure: true }, { uid: true })) {
            const parsed = await simpleParser(msg.source);
            const from = parsed.from?.value?.[0];
            const fromEmail = from?.address?.toLowerCase() ?? null;
            const text = parsed.text ?? (parsed.html ? htmlToText(String(parsed.html)) : "");
            const refs = (parsed.references ? (Array.isArray(parsed.references) ? parsed.references : [parsed.references]) : []) as string[];
            out.push({
              external_id: `${mailbox}:${msg.uid}`,
              thread_id: (refs[0] ?? parsed.inReplyTo ?? parsed.messageId ?? `${mailbox}:${msg.uid}`).toString(),
              subject: parsed.subject ?? null,
              from_name: from?.name ?? null,
              from_email: fromEmail,
              to_emails: addresses(parsed.to),
              cc_emails: addresses(parsed.cc),
              snippet: text.slice(0, 200) || null,
              body_text: trimQuoted(text),
              received_at: (parsed.date ?? new Date()).toISOString(),
              is_from_me: sent || fromEmail === this.myEmail,
              is_read: msg.flags?.has("\\Seen") ?? null,
              has_attachments: (parsed.attachments?.length ?? 0) > 0,
              web_link: null,
            });
          }
        } finally { lock.release(); }
      }
    } finally { await c.logout().catch(() => {}); }
    return out.sort((a, b) => b.received_at.localeCompare(a.received_at)).slice(0, limit);
  }
}

function addresses(v: any): string[] {
  const list = Array.isArray(v) ? v : v ? [v] : [];
  return list.flatMap((x: any) => (x.value ?? []).map((a: any) => (a.address ?? "").toLowerCase())).filter(Boolean);
}
