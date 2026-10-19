import { useState } from "react";
import { db } from "../lib/data";
import { addDays, dayTitle, isPast, isToday, isTomorrow, startOfDay } from "../lib/dates";
import { useStore } from "../lib/hooks";
import type { Task } from "../lib/types";
import TaskRow from "./TaskRow";

const MODES = [["today", "Сегодня"], ["tomorrow", "Завтра"], ["week", "Неделя"], ["month", "Месяц"], ["overdue", "Просрочено"], ["nodate", "Без срока"]] as const;
type Mode = (typeof MODES)[number][0];

export default function Plan() {
  const s = useStore();
  const [mode, setMode] = useState<Mode>("today");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [when, setWhen] = useState("");
  const open = s.tasks.filter((t) => !t.completed_at);
  const start = startOfDay();
  const filtered: Task[] = open.filter((t) => {
    const d = t.due_at ? new Date(t.due_at) : null;
    switch (mode) {
      case "today": return isToday(t.due_at);
      case "tomorrow": return isTomorrow(t.due_at);
      case "week": return !!d && d >= start && d < addDays(start, 7);
      case "month": return !!d && d >= start && d < addDays(start, 31);
      case "overdue": return isPast(t.due_at);
      case "nodate": return !t.due_at;
    }
  });
  const groups = new Map<string, Task[]>();
  for (const t of filtered) { const k = t.due_at ? dayTitle(t.due_at) : "Без срока"; groups.set(k, [...(groups.get(k) ?? []), t]); }

  const reschedule = async () => {
    if (!when || sel.size === 0) return;
    const iso = new Date(when).toISOString();
    await Promise.all([...sel].map((id) => db.updateTask(id, { due_at: iso })));
    setSel(new Set()); await s.refresh();
  };

  return (
    <div>
      <h1>План</h1>
      <div className="row" style={{ margin: "10px 0" }}>
        <div className="seg">{MODES.map(([id, l]) => <button key={id} className={mode === id ? "active" : ""} onClick={() => setMode(id)}>{l}</button>)}</div>
        <span className="grow" />
        <button className="ghost small" onClick={() => setSel(new Set(filtered.map((t) => t.id)))}>Выбрать все</button>
        {sel.size > 0 && <><input type="datetime-local" style={{ width: 220 }} value={when} onChange={(e) => setWhen(e.target.value)} /><button className="primary" onClick={reschedule}>Перенести {sel.size}</button><button className="ghost" onClick={() => setSel(new Set())}>✕</button></>}
      </div>
      {filtered.length === 0 && <div className="muted">Ничего нет</div>}
      {[...groups.entries()].map(([title, items]) => (
        <div key={title}>
          <h3>{title}</h3>
          {items.map((t) => (
            <div key={t.id} className="row" style={{ gap: 4 }}>
              <input type="checkbox" style={{ width: 18 }} checked={sel.has(t.id)} onChange={(e) => { const n = new Set(sel); e.target.checked ? n.add(t.id) : n.delete(t.id); setSel(n); }} />
              <div className="grow"><TaskRow task={t} /></div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
