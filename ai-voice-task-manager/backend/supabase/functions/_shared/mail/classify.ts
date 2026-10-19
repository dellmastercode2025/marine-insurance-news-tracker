// Decides which inbound messages still need an answer: deterministic thread logic first, then Gemini
// for the ambiguous "does this actually require a reply from me?" question.
import type { GeminiClient } from "../gemini.ts";
import { NOREPLY_RE } from "./types.ts";

export interface ThreadMsg {
  id: string;
  thread_id: string;
  from_email: string | null;
  from_name: string | null;
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  received_at: string;
  is_from_me: boolean;
  to_emails: string[];
  cc_emails: string[];
  reply_status: string;
}

export interface Candidate { id: string; reason: string }

/**
 * For each thread: the newest message decides. If it is inbound (not from me), addressed to me (To or no
 * recipients known), not an automated sender, and no later message from me exists → candidate.
 * Returns candidates plus ids that are now answered (a reply from me came after them).
 */
export function detectUnanswered(messages: ThreadMsg[], myEmails: string[], minAgeMinutes = 0): { candidates: ThreadMsg[]; answered: string[] } {
  const mine = new Set(myEmails.map((e) => e.toLowerCase()));
  const threads = new Map<string, ThreadMsg[]>();
  for (const m of messages) threads.set(m.thread_id, [...(threads.get(m.thread_id) ?? []), m]);
  const candidates: ThreadMsg[] = [];
  const answered: string[] = [];
  const now = Date.now();
  for (const list of threads.values()) {
    list.sort((a, b) => a.received_at.localeCompare(b.received_at));
    const lastMine = [...list].reverse().find((m) => m.is_from_me);
    for (const m of list) {
      if (m.is_from_me) continue;
      if (lastMine && lastMine.received_at > m.received_at) { if (m.reply_status === "pending") answered.push(m.id); continue; }
    }
    const last = list[list.length - 1];
    if (last.is_from_me) continue;
    if (!last.from_email || NOREPLY_RE.test(last.from_email) || NOREPLY_RE.test(last.from_name ?? "")) continue;
    if (mine.has(last.from_email)) continue;
    const toMe = last.to_emails.length === 0 || last.to_emails.some((e) => mine.has(e));
    const ccOnly = !toMe && last.cc_emails.some((e) => mine.has(e));
    if (!toMe && !ccOnly) continue;
    if (now - new Date(last.received_at).getTime() < minAgeMinutes * 60_000) continue;
    if (last.reply_status === "replied" || last.reply_status === "dismissed" || last.reply_status === "task_created") continue;
    candidates.push(last);
  }
  return { candidates, answered };
}

export interface Verdict { id: string; needs_reply: boolean; reason: string; priority: 1 | 2 | 3 | 4; suggested_action: string }

const SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          needs_reply: { type: "boolean" },
          reason: { type: "string", description: "short reason in Russian" },
          priority: { type: "integer", description: "1 urgent … 4 low" },
          suggested_action: { type: "string", description: "one line in Russian: what to answer / do" },
        },
        required: ["id", "needs_reply", "reason", "priority", "suggested_action"],
      },
    },
  },
  required: ["verdicts"],
};

export async function classifyWithAI(gemini: GeminiClient, me: { email: string; name?: string | null }, candidates: ThreadMsg[]): Promise<Verdict[]> {
  if (!candidates.length) return [];
  const out: Verdict[] = [];
  for (let i = 0; i < candidates.length; i += 15) {
    const batch = candidates.slice(i, i + 15).map((m) => ({
      id: m.id, from: `${m.from_name ?? ""} <${m.from_email}>`, subject: m.subject, received_at: m.received_at,
      cc_only: !m.to_emails.includes(me.email), text: (m.body_text ?? m.snippet ?? "").slice(0, 1200),
    }));
    try {
      const res = await gemini.generateJSON<{ verdicts: Verdict[] }>({
        systemInstruction: `You triage the inbox of ${me.name ?? me.email} (${me.email}), head of insurance/risk at a shipping company (Russian/English/Kazakh correspondence).
For each email decide whether the recipient personally still owes a reply or action. needs_reply=true when: a direct question, a request for a document/approval/decision/opinion, a meeting proposal, a broker or counterparty waiting for feedback, a deadline addressed to the recipient.
needs_reply=false when: FYI / cc-only information, newsletters, automatic notifications, confirmations ("thanks, received"), mass mailings, invitations already answered, internal broadcasts.
priority: 1 urgent (deadline within 24h, regulator, top management, claims), 2 important business partner / broker / insurer, 3 normal, 4 low. Reason and suggested_action in Russian, concise.`,
        responseSchema: SCHEMA,
        temperature: 0.1,
        contents: [{ role: "user", parts: [{ text: JSON.stringify(batch) }] }],
      });
      for (const v of res.verdicts ?? []) if (batch.some((b) => b.id === v.id)) out.push({ ...v, priority: ([1, 2, 3, 4].includes(v.priority) ? v.priority : 3) as Verdict["priority"] });
    } catch (e) {
      // AI unavailable: keep deterministic candidates as pending with a generic reason.
      for (const b of batch) out.push({ id: b.id, needs_reply: true, reason: "Последнее письмо в переписке адресовано вам и осталось без ответа", priority: 3, suggested_action: "Проверить и ответить" });
      console.warn("mail classify failed", e instanceof Error ? e.message : e);
    }
  }
  return out;
}
