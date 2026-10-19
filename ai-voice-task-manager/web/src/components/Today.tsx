import { useState } from "react";
import { api } from "../lib/api";
import { greeting, isPast, isToday, plural } from "../lib/dates";
import { useStore } from "../lib/hooks";
import type { BriefingResponse, Task } from "../lib/types";
import TaskRow from "./TaskRow";

export default function Today({ onOpenVoice }: { onOpenVoice: () => void }) {
  const s = useStore();
  const [briefing, setBriefing] = useState<BriefingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const open = s.tasks.filter((t) => !t.completed_at);
  const today = open.filter((t) => isToday(t.due_at) || isToday(t.reminder_at) || isToday(t.start_at));
  const overdue = open.filter((t) => isPast(t.due_at) && !isToday(t.due_at));
  const waiting = open.filter((t) => t.is_waiting);
  const critical = today.filter((t) => t.priority === 1);
  const timeOf = (t: Task) => (isToday(t.start_at) ? t.start_at : isToday(t.reminder_at) ? t.reminder_at : isToday(t.due_at) ? t.due_at : null);
  const hours = Array.from({ length: 16 }, (_, i) => i + 7);

  const loadBriefing = async () => { setLoading(true); try { setBriefing(await api.briefing()); } catch (e) { alert(e instanceof Error ? e.message : e); } finally { setLoading(false); } };

  return (
    <div>
      <h1>{greeting()}</h1>
      <div className="muted">Сегодня: {today.length} {plural(today.length, "задача", "задачи", "задач")}</div>
      <div className="stats">
        <div className="stat"><b style={{ color: "var(--p1)" }}>{critical.length}</b><span className="muted small">Критические</span></div>
        <div className="stat"><b style={{ color: "var(--p2)" }}>{overdue.length}</b><span className="muted small">Просроченные</span></div>
        <div className="stat"><b style={{ color: "var(--purple)" }}>{waiting.length}</b><span className="muted small">Жду ответа</span></div>
        <button className="stat" style={{ textAlign: "left" }} onClick={onOpenVoice}><b>🎙</b><span className="muted small">Надиктовать поручения</span></button>
      </div>

      <div className="card">
        <div className="row"><b>✨ AI-сводка дня</b><span className="grow" /><button onClick={loadBriefing} disabled={loading}>{loading ? "…" : briefing ? "Обновить" : "Сформировать"}</button></div>
        {briefing && (
          <div style={{ marginTop: 8 }}>
            <div><b>{briefing.headline}</b></div>
            <div className="muted small">{briefing.urgent} срочных · {briefing.normal} обычных · {briefing.overdue} просроченных · {briefing.waiting} ожидают ответа</div>
            <p>{briefing.narrative}</p>
            {briefing.critical.length > 0 && <div><b className="small">Критично:</b>{briefing.critical.map((c, i) => <div key={c.task_id} className="small" style={{ cursor: "pointer" }} onClick={() => s.openTask(c.task_id)}>{i + 1}. {c.line}</div>)}</div>}
          </div>
        )}
      </div>

      {overdue.length > 0 && <><h2>Просрочено</h2>{overdue.map((t) => <TaskRow key={t.id} task={t} />)}</>}

      <h2>Agenda</h2>
      {today.filter((t) => !timeOf(t)).map((t) => <TaskRow key={t.id} task={t} />)}
      <div className="agenda" style={{ marginTop: 8 }}>
        {hours.map((h) => {
          const items = today.filter((t) => { const x = timeOf(t); return x && new Date(x).getHours() === h; });
          return (
            <div key={h} style={{ display: "contents" }}>
              <div className="hour">{String(h).padStart(2, "0")}:00</div>
              <div className="slot">{items.map((t) => <TaskRow key={t.id} task={t} />)}</div>
            </div>
          );
        })}
      </div>
      {waiting.length > 0 && <><h2>Жду ответа</h2>{waiting.map((t) => <TaskRow key={t.id} task={t} />)}</>}
    </div>
  );
}
