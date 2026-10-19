import { useState } from "react";
import { db } from "../lib/data";
import { isPast, label } from "../lib/dates";
import { useStore } from "../lib/hooks";
import type { StatusColumn, Task } from "../lib/types";

export default function Board() {
  const s = useStore();
  const [project, setProject] = useState<string>("");
  const [over, setOver] = useState<string | null>(null);
  const [newCol, setNewCol] = useState("");
  const [manage, setManage] = useState(false);
  const tasks = s.tasks.filter((t) => !project || t.project_id === project);

  const drop = async (col: StatusColumn, e: React.DragEvent) => {
    e.preventDefault(); setOver(null);
    const id = e.dataTransfer.getData("text/task");
    const t = s.tasks.find((x) => x.id === id);
    if (t && t.status_id !== col.id) { await db.move(t, col); await s.refresh(); }
  };

  return (
    <div>
      <div className="row"><h1 style={{ margin: 0 }}>Доска</h1><span className="grow" />
        <select style={{ width: 220 }} value={project} onChange={(e) => setProject(e.target.value)}><option value="">Все проекты</option>{s.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <button onClick={() => setManage(!manage)}>Статусы</button>
      </div>
      {manage && (
        <div className="card" style={{ margin: "10px 0" }}>
          {s.statuses.map((c) => (
            <div key={c.id} className="row" style={{ marginBottom: 6 }}>
              <input defaultValue={c.name} style={{ width: 260 }} onBlur={async (e) => { if (e.target.value !== c.name) { await db.renameStatus(c.id, e.target.value); await s.refresh(); } }} />
              <span className="muted tiny">{c.kind}</span>
              {c.kind === "custom" && <button className="danger ghost" onClick={async () => { await db.deleteStatus(c, s.statuses); await s.refresh(); }}>Удалить</button>}
            </div>
          ))}
          <div className="row"><input placeholder="Новый статус, например «На согласовании»" value={newCol} onChange={(e) => setNewCol(e.target.value)} style={{ width: 320 }} /><button onClick={async () => { if (newCol) { await db.createStatus(newCol, s.statuses); setNewCol(""); await s.refresh(); } }}>Добавить</button></div>
        </div>
      )}
      <div className="board" style={{ marginTop: 12 }}>
        {s.statuses.map((col) => {
          const items = tasks.filter((t) => t.status_id === col.id && (!t.completed_at || col.kind === "done"));
          return (
            <div key={col.id} className={`column ${over === col.id ? "over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(col.id); }} onDragLeave={() => setOver(null)} onDrop={(e) => drop(col, e)}>
              <div className="row"><b>{col.name}</b><span className="chip">{items.length}</span></div>
              <div className="cards">{items.map((t) => <Card key={t.id} task={t} />)}</div>
              {(col.kind === "todo" || col.kind === "inbox") && <QuickAdd col={col} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Card({ task }: { task: Task }) {
  const s = useStore();
  return (
    <div className="kcard" draggable onDragStart={(e) => e.dataTransfer.setData("text/task", task.id)} onClick={() => s.openTask(task.id)}>
      <div className="row" style={{ justifyContent: "space-between" }}><span className={`chip p${task.priority}`}>P{task.priority}</span>{task.source_id && <span className="muted tiny">🎙</span>}</div>
      <div style={{ margin: "6px 0 4px", fontWeight: 500 }}>{task.title}</div>
      {s.path(task) && <div className="muted tiny">{s.path(task)}</div>}
      <div className="meta row" style={{ gap: 6, marginTop: 4 }}>
        {task.due_at && <span className={`chip ${!task.completed_at && isPast(task.due_at) ? "overdue" : ""}`}>📅 {label(task.due_at)}</span>}
        {task.reminder_at && !isPast(task.reminder_at) && <span className="chip bell">🔔</span>}
        {task.is_waiting && <span className="chip wait">⏳</span>}
      </div>
    </div>
  );
}

function QuickAdd({ col }: { col: StatusColumn }) {
  const s = useStore();
  const [v, setV] = useState("");
  return (
    <input placeholder="Новая задача…" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={async (e) => {
      if (e.key === "Enter" && v.trim()) { await db.createTask({ title: v.trim(), status_id: col.id, priority: (s.prefs?.default_priority as 1 | 2 | 3 | 4) ?? 3 }); setV(""); await s.refresh(); }
    }} />
  );
}
