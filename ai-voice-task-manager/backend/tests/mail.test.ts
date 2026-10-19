import { test } from "node:test";
import assert from "node:assert/strict";
import { detectUnanswered, type ThreadMsg } from "../supabase/functions/_shared/mail/classify.ts";
import { parseAddress, parseAddressList, trimQuoted, htmlToText } from "../supabase/functions/_shared/mail/types.ts";

const me = "a.umarov@kmtf.kmg.kz";
const msg = (o: Partial<ThreadMsg> & { id: string; thread_id: string; received_at: string }): ThreadMsg => ({
  from_email: "denis@wtw.com", from_name: "Denis", subject: "WTW quote", snippet: "please confirm", body_text: null, is_from_me: false,
  to_emails: [me], cc_emails: [], reply_status: "none", ...o,
});

test("latest inbound message in a thread without my reply is a candidate", () => {
  const { candidates } = detectUnanswered([msg({ id: "1", thread_id: "t1", received_at: "2026-10-18T09:00:00Z" })], [me]);
  assert.deepEqual(candidates.map((c) => c.id), ["1"]);
});

test("my later reply closes the thread and marks the pending message as replied", () => {
  const { candidates, answered } = detectUnanswered([
    msg({ id: "1", thread_id: "t1", received_at: "2026-10-18T09:00:00Z", reply_status: "pending" }),
    msg({ id: "2", thread_id: "t1", received_at: "2026-10-18T10:00:00Z", is_from_me: true, from_email: me }),
  ], [me]);
  assert.equal(candidates.length, 0);
  assert.deepEqual(answered, ["1"]);
});

test("a new inbound message after my reply re-opens the thread", () => {
  const { candidates } = detectUnanswered([
    msg({ id: "1", thread_id: "t1", received_at: "2026-10-18T09:00:00Z" }),
    msg({ id: "2", thread_id: "t1", received_at: "2026-10-18T10:00:00Z", is_from_me: true, from_email: me }),
    msg({ id: "3", thread_id: "t1", received_at: "2026-10-18T11:00:00Z" }),
  ], [me]);
  assert.deepEqual(candidates.map((c) => c.id), ["3"]);
});

test("automated senders and messages not addressed to me are ignored", () => {
  const { candidates } = detectUnanswered([
    msg({ id: "1", thread_id: "t1", received_at: "2026-10-18T09:00:00Z", from_email: "noreply@bank.kz" }),
    msg({ id: "2", thread_id: "t2", received_at: "2026-10-18T09:00:00Z", to_emails: ["someone@else.kz"] }),
    msg({ id: "3", thread_id: "t3", received_at: "2026-10-18T09:00:00Z", to_emails: ["boss@kmtf.kmg.kz"], cc_emails: [me] }),
  ], [me]);
  assert.deepEqual(candidates.map((c) => c.id), ["3"]); // cc-only still goes to AI triage
});

test("user decisions are respected", () => {
  const { candidates } = detectUnanswered([msg({ id: "1", thread_id: "t1", received_at: "2026-10-18T09:00:00Z", reply_status: "dismissed" })], [me]);
  assert.equal(candidates.length, 0);
});

test("address parsing and quote trimming", () => {
  assert.deepEqual(parseAddress('"Денис Иванов" <Denis@WTW.com>'), { name: "Денис Иванов", email: "denis@wtw.com" });
  assert.deepEqual(parseAddressList("a@x.kz, B <b@y.kz>"), ["a@x.kz", "b@y.kz"]);
  const body = "Добрый день, подтвердите, пожалуйста, котировку.\n\n".padEnd(260, "x") + "\nOn Mon, Denis wrote:\n> old text";
  assert.ok(!trimQuoted(body).includes("old text"));
  assert.equal(htmlToText("<p>Hello&nbsp;<b>world</b></p><br>bye"), "Hello world\nbye");
});
