import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { db } from "../lib/data";
import { absolute, label } from "../lib/dates";
import { useStore } from "../lib/hooks";
import { supabase } from "../lib/supabase";
import type { MailAccount, MailMessage } from "../lib/types";

export default function Mail() {
  const s = useStore();
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [view, setView] = useState<"pending" | "all" | "handled">("pending");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<MailMessage | null>(null);
  const [showImap, setShowImap] = useState(false);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const [a, m] = await Promise.all([
      supabase.from("mail_accounts").select("id,provider,email,display_name,status,last_sync_at,last_error").order("created_at"),
      supabase.from("mail_messages").select("id,account_id,thread_id,subject,from_name,from_email,to_emails,cc_emails,snippet,body_text,received_at,is_from_me,has_attachments,web_link,needs_reply,reply_status,ai_reason,ai_priority,ai_suggested_action,linked_task_id").order("received_at", { ascending: false }).limit(500),
    ]);
    setAccounts((a.data ?? []) as MailAccount[]);
    setMessages((m.data ?? []) as MailMessage[]);
    if (a.error) setError(a.error.message);
  }, []);

  useEffect(() => {
    void load();
    const params = new URLSearchParams(location.hash.split("?")[1] ?? "");
    if (params.get("mail") === "connected") { history.replaceState(null, "", "#mail"); void sync(); }
    if (params.get("mail") === "error") { setError(params.get("message")); history.replaceState(null, "", "#mail"); }
    const ch = supabase.channel("mail-view").on("postgres_changes", { event: "*", schema: "public", table: "mail_messages" }, () => void load()).subscribe();
    const h = setInterval(() => void sync(true), 15 * 60 * 1000);
    return () => { supabase.removeChannel(ch); clearInterval(h); };
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const sync = async (silent = false) => {
    if (!silent) { setBusy(true); setError(null); }
    try { const r = await api.mailSync(); if (!silent && r.accounts.some((a) => a.errors.length)) setError(r.accounts.flatMap((a) => a.errors).join("; ")); await load(); }
    catch (e) { if (!silent) setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const connect = async (provider: "gmail" | "microsoft") => {
    setError(null);
    try { const { url } = await api.mailOAuthUrl(provider); window.location.href = url; } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const setStatus = async (m: MailMessage, status: MailMessage["reply_status"]) => {
    await supabase.from("mail_messages").update({ reply_status: status, needs_reply: false }).eq("id", m.id);
    setOpen(null); await load();
  };
  const createTask = async (m: MailMessage) => {
    const t = await db.createTask({
      title: `Ответить: ${m.subject ?? m.from_name ?? m.from_email ?? "письмо"}`.slice(0, 180),
      description: [`Письмо от ${m.from_name ?? ""} <${m.from_email ?? ""}>`, m.ai_suggested_action, m.web_link].filter(Boolean).join("\n"),
      priority: (m.ai_priority as 1 | 2 | 3 | 4) ?? 2, status_id: s.status("todo")?.id ?? null, tags: ["email"],
      due_at: new Date(Date.now() + 86400_000).toISOString(),
    });
    await supabase.from("mail_messages").update({ reply_status: "task_created", needs_reply: false, linked_task_id: t.id }).eq("id", m.id);
    setOpen(null); await Promise.all([load(), s.refresh()]);
    s.openTask(t.id);
  };

  const pending = messages.filter((m) => m.needs_reply && m.reply_status === "pending");
  const handled = messages.filter((m) => ["replied", "dismissed", "task_created"].includes(m.reply_status));
  const list = (view === "pending" ? pending : view === "handled" ? handled : messages).filter((m) => !q || `${m.subject} ${m.from_name} ${m.from_email} ${m.snippet}`.toLowerCase().includes(q.toLowerCase()));
  const waitingDays = (m: MailMessage) => Math.floor((Date.now() - new Date(m.received_at).getTime()) / 86400_000);

  return (
    <div>
      <div className="row"><h1 style={{ margin: 0 }}>Переписки</h1><span className="grow" />
        {accounts.length > 0 && <button onClick={() => sync()} disabled={busy}>{busy ? "Синхронизирую…" : "Проверить почту"}</button>}
      </div>
      {error && <div className="error small" style={{ margin: "8px 0" }}>{error}</div>}

      <div className="card" style={{ margin: "10px 0" }}>
        <b>Почтовые ящики</b>
        {accounts.length === 0 && <div className="muted small" style={{ margin: "6px 0" }}>Подключите ящик — приложение будет читать входящие и отправленные за последние 14 дней, находить письма, на которые вы ещё не ответили, и показывать их здесь и в чате. Доступ только на чтение.</div>}
        {accounts.map((a) => (
          <div key={a.id} className="row small" style={{ margin: "6px 0" }}>
            <span className="chip">{a.provider === "gmail" ? "Gmail" : a.provider === "microsoft" ? "Microsoft 365" : "IMAP"}</span>
            <b>{a.email}</b>
            <span className={`muted tiny ${a.status === "error" ? "error" : ""}`}>{a.status === "error" ? `ошибка: ${a.last_error}` : a.last_sync_at ? `синхронизировано ${label(a.last_sync_at)}` : "ещё не синхронизировано"}</span>
            <span className="grow" />
            <button className="ghost tiny danger" onClick={async () => { if (confirm(`Отключить ${a.email}? Загруженные письма будут удалены из приложения.`)) { await api.mailRemove(a.id); await load(); } }}>Отключить</button>
          </div>
        ))}
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={() => connect("gmail")}>+ Gmail / Google Workspace</button>
          <button onClick={() => connect("microsoft")}>+ Microsoft 365 / Outlook</button>
          <button onClick={() => setShowImap(!showImap)}>+ IMAP (другой сервер)</button>
        </div>
        {showImap && <ImapForm onDone={async () => { setShowImap(false); await load(); await sync(); }} onError={setError} />}
      </div>

      <div className="row" style={{ margin: "12px 0" }}>
        <div className="seg">
          <button className={view === "pending" ? "active" : ""} onClick={() => setView("pending")}>Без ответа ({pending.length})</button>
          <button className={view === "all" ? "active" : ""} onClick={() => setView("all")}>Все письма</button>
          <button className={view === "handled" ? "active" : ""} onClick={() => setView("handled")}>Обработанные</button>
        </div>
        <input placeholder="Поиск по письмам…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
      </div>

      {list.length === 0 && <div className="muted">{view === "pending" ? (accounts.length ? "Писем без ответа нет 🎉" : "Подключите почту, чтобы увидеть письма без ответа") : "Пусто"}</div>}
      {list.map((m) => (
        <div key={m.id} className="task" onClick={() => setOpen(m)}>
          <div style={{ width: 22, textAlign: "center", marginTop: 2 }}>{m.is_from_me ? "↗" : m.needs_reply && m.reply_status === "pending" ? "✉️" : "✓"}</div>
          <div className="grow">
            <div className="row" style={{ gap: 6 }}>
              <b className="small">{m.is_from_me ? `Я → ${m.to_emails[0] ?? ""}` : m.from_name ?? m.from_email}</b>
              {m.ai_priority && m.reply_status === "pending" && <span className={`chip p${m.ai_priority}`}>P{m.ai_priority}</span>}
              {m.reply_status === "pending" && <span className="chip overdue">ждёт {waitingDays(m)} дн.</span>}
              {m.reply_status === "task_created" && <span className="chip ok">задача создана</span>}
              {m.has_attachments && <span className="muted tiny">📎</span>}
              <span className="grow" /><span className="muted tiny">{absolute(m.received_at)}</span>
            </div>
            <div className="title">{m.subject ?? "(без темы)"}</div>
            {m.ai_suggested_action && m.reply_status === "pending" ? <div className="small" style={{ color: "var(--warn)" }}>→ {m.ai_suggested_action}</div> : <div className="muted small">{m.snippet?.slice(0, 160)}</div>}
          </div>
        </div>
      ))}

      {open && (
        <div className="drawer-backdrop" onClick={() => setOpen(null)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="row"><b>{open.subject ?? "(без темы)"}</b><span className="grow" /><button className="ghost" onClick={() => setOpen(null)}>✕</button></div>
            <div className="muted small" style={{ marginTop: 6 }}>От: {open.from_name} &lt;{open.from_email}&gt; · {absolute(open.received_at)}</div>
            <div className="muted tiny">Кому: {open.to_emails.join(", ")}{open.cc_emails.length ? ` · Копия: ${open.cc_emails.join(", ")}` : ""}</div>
            {open.ai_reason && <div className="card small" style={{ margin: "10px 0" }}><b>AI:</b> {open.ai_reason}{open.ai_suggested_action && <div style={{ marginTop: 4 }}>→ {open.ai_suggested_action}</div>}</div>}
            <pre style={{ whiteSpace: "pre-wrap", font: "inherit", marginTop: 10 }}>{open.body_text ?? open.snippet}</pre>
            <div className="row" style={{ marginTop: 14 }}>
              {open.web_link && <a href={open.web_link} target="_blank" rel="noreferrer"><button className="primary">Открыть в почте</button></a>}
              <button onClick={() => createTask(open)}>Создать задачу</button>
              <button onClick={() => setStatus(open, "replied")}>Я ответил</button>
              <button onClick={() => setStatus(open, "dismissed")}>Ответ не нужен</button>
            </div>
            <ThreadView thread={messages.filter((m) => m.thread_id === open.thread_id && m.id !== open.id)} />
          </div>
        </div>
      )}
    </div>
  );
}

function ThreadView({ thread }: { thread: MailMessage[] }) {
  if (!thread.length) return null;
  return (
    <div style={{ marginTop: 16 }}>
      <b className="small">Вся переписка ({thread.length})</b>
      {thread.map((m) => <div key={m.id} className="small" style={{ borderTop: "1px solid var(--line)", padding: "6px 0" }}><span className="muted">{m.is_from_me ? "Я" : m.from_name ?? m.from_email} · {absolute(m.received_at)}</span><div>{m.snippet}</div></div>)}
    </div>
  );
}

function ImapForm({ onDone, onError }: { onDone: () => void; onError: (e: string) => void }) {
  const [f, setF] = useState({ email: "", host: "", port: 993, secure: true, username: "", password: "" });
  const [busy, setBusy] = useState(false);
  return (
    <div className="card" style={{ marginTop: 10 }}>
      <div className="muted small">Для корпоративной почты на Exchange/Zimbra/др. с включённым IMAP. Пароль хранится в зашифрованном виде на сервере. Для Microsoft 365 используйте кнопку выше (пароль IMAP там не работает).</div>
      <div className="grid2" style={{ marginTop: 8 }}>
        <label className="field">Email<input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value, username: f.username || e.target.value })} placeholder="a.umarov@kmtf.kmg.kz" /></label>
        <label className="field">IMAP-сервер<input value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })} placeholder="mail.kmg.kz" /></label>
        <label className="field">Порт<input type="number" value={f.port} onChange={(e) => setF({ ...f, port: Number(e.target.value) })} /></label>
        <label className="field">Логин<input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></label>
        <label className="field">Пароль / пароль приложения<input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
        <label className="row small" style={{ alignSelf: "end" }}><input type="checkbox" style={{ width: 18 }} checked={f.secure} onChange={(e) => setF({ ...f, secure: e.target.checked })} /> SSL/TLS</label>
      </div>
      <button className="primary" style={{ marginTop: 8 }} disabled={busy} onClick={async () => { setBusy(true); try { await api.mailConnectImap(f); onDone(); } catch (e) { onError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }}>{busy ? "Проверяю подключение…" : "Подключить"}</button>
    </div>
  );
}
