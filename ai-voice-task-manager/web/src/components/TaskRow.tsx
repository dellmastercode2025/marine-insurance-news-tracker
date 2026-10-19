import { db } from "../lib/data";
import { isPast, label } from "../lib/dates";
import { useStore } from "../lib/hooks";
import type { Task } from "../lib/types";

const ICON: Record<Task["kind"], string> = { task: "", reminder: "🔔", event: "📅", waiting: "⏳", note: "📝" };

export default function TaskRow({ task, showPath = true }: { task: Task; showPath?: boolean }) {
  const s = useStore();
  const done = !!task.completed_at;
  const overdue = !done && isPast(task.due_at);
  const toggle = async (e: React.MouseEvent) => { e.stopPropagation(); await db.complete(task, s.statuses, !done); await s.refresh(); };
  const waitingFor = s.personOf(task.waiting_for_person_id);
  return (
    <div className="task" onClick={() => s.openTask(task.id)}>
      <button className={`check ${done ? "done" : ""}`} onClick={toggle} title={done ? "Вернуть" : "Выполнено"}>{done ? "✓" : ""}</button>
      <div className="grow">
        <div className={`title ${done ? "done" : ""}`}>{ICON[task.kind]} {task.title}</div>
        <div className="meta">
          <span className={`chip p${task.priority}`}>P{task.priority}</span>
          {showPath && s.path(task) && <span className="muted tiny">{s.path(task)}</span>}
          {task.due_at && <span className={`chip ${overdue ? "overdue" : ""}`}>📅 {label(task.due_at)}</span>}
          {task.reminder_at && !isPast(task.reminder_at) && <span className="chip bell">🔔 {label(task.reminder_at)}</span>}
          {task.is_waiting && <span className="chip wait">⏳ {waitingFor ? `Жду: ${waitingFor.name}` : "Жду ответ"}</span>}
          {task.source_id && <span className="muted tiny" title="Создано из голосовой записи">🎙</span>}
          {task.tags?.length > 0 && <span className="tiny" style={{ color: "var(--accent-2)" }}>{task.tags.map((t) => `#${t}`).join(" ")}</span>}
        </div>
      </div>
    </div>
  );
}
