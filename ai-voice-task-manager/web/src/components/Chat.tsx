import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useStore } from "../lib/hooks";
import type { PendingAction } from "../lib/types";

interface Msg { id: string; role: "user" | "assistant"; content: string; pending?: PendingAction[]; }
const KEY = "chat.messages";
const SUGGESTIONS = ["Что у меня сегодня?", "Что просрочено по Казмортрансфлоту?", "Что я жду от Дениса?", "Какие письма у меня без ответа?", "Что самое срочное на этой неделе?", "Перенеси всё несрочное с сегодня на пятницу"];

export default function Chat() {
  const s = useStore();
  const [msgs, setMsgs] = useState<Msg[]>(() => { try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; } });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conv] = useState(() => localStorage.getItem("chat.conv") ?? (() => { const id = crypto.randomUUID(); localStorage.setItem("chat.conv", id); return id; })());
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { localStorage.setItem(KEY, JSON.stringify(msgs.slice(-100))); endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  const send = async (text = input) => {
    const t = text.trim(); if (!t || busy) return;
    setInput(""); setBusy(true);
    const history = msgs.slice(-12).map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { id: crypto.randomUUID(), role: "user", content: t }]);
    try {
      const r = await api.chat(t, history, conv);
      setMsgs((m) => [...m, { id: crypto.randomUUID(), role: "assistant", content: r.reply, pending: r.pending_actions.length ? r.pending_actions : undefined }]);
      if (r.batch_id && r.executed.length) s.setUndo({ summary: `Выполнено: ${r.executed.map((e) => e.name).join(", ")}`, batchId: r.batch_id });
      if (r.executed.length) await s.refresh();
    } catch (e) { setMsgs((m) => [...m, { id: crypto.randomUUID(), role: "assistant", content: `Ошибка: ${e instanceof Error ? e.message : e}` }]); }
    finally { setBusy(false); }
  };

  const confirm = async (msg: Msg) => {
    if (!msg.pending) return;
    setBusy(true);
    try {
      const r = await api.executeActions(msg.pending, msg.pending.map((p) => p.description).join("; "));
      const ok = r.results.filter((x) => x.ok).length;
      setMsgs((m) => m.map((x) => (x.id === msg.id ? { ...x, pending: undefined } : x)).concat({ id: crypto.randomUUID(), role: "assistant", content: ok === msg.pending!.length ? `Готово: ${msg.pending!.map((p) => p.description).join("; ")}` : `Выполнено ${ok} из ${msg.pending!.length}. ${r.results.map((x) => x.error).filter(Boolean).join("; ")}` }));
      s.setUndo({ summary: msg.pending[0].description, batchId: r.batch_id });
      await s.refresh();
    } catch (e) { alert(e instanceof Error ? e.message : e); } finally { setBusy(false); }
  };

  return (
    <div className="chat">
      <div className="row"><h1 style={{ margin: 0 }}>Чат</h1><span className="grow" /><button className="ghost small" onClick={() => { setMsgs([]); localStorage.removeItem(KEY); }}>Новый диалог</button></div>
      <div className="messages" style={{ marginTop: 10 }}>
        {msgs.length === 0 && <div className="row">{SUGGESTIONS.map((x) => <button key={x} className="small" onClick={() => send(x)}>{x}</button>)}</div>}
        {msgs.map((m) => (
          <div key={m.id} style={{ display: "contents" }}>
            <div className={`bubble ${m.role}`}>{m.content}</div>
            {m.pending && (
              <div className="pending">
                <b className="small">✋ Требуется подтверждение</b>
                {m.pending.map((p) => <div key={p.id} className="small">• {p.description}</div>)}
                <div className="row" style={{ marginTop: 8 }}><button className="primary" disabled={busy} onClick={() => confirm(m)}>Подтвердить</button><button onClick={() => setMsgs((x) => x.map((y) => (y.id === m.id ? { ...y, pending: undefined } : y)))}>Отклонить</button></div>
              </div>
            )}
          </div>
        ))}
        {busy && <div className="muted small">Думаю…</div>}
        <div ref={endRef} />
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <textarea rows={2} style={{ minHeight: 44 }} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Спросите о задачах, письмах или попросите что-то изменить…" onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <button className="primary" onClick={() => send()} disabled={busy || !input.trim()}>↑</button>
      </div>
    </div>
  );
}
