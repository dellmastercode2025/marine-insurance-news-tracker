import { useState } from "react";
import { db } from "../lib/data";
import { useStore } from "../lib/hooks";
import type { Project } from "../lib/types";
import TaskRow from "./TaskRow";

export default function Projects() {
  const s = useStore();
  const [selected, setSelected] = useState<Project | null>(null);
  const [newName, setNewName] = useState<Record<string, string>>({});
  const open = s.tasks.filter((t) => !t.completed_at);
  if (selected) return <ProjectDetail project={selected} onBack={() => setSelected(null)} />;
  const inboxId = s.status("inbox")?.id;
  const unfiled = open.filter((t) => t.status_id === inboxId || !t.project_id);
  return (
    <div>
      <h1>Проекты</h1>
      {unfiled.length > 0 && (
        <div className="card" style={{ margin: "10px 0" }}>
          <b>Smart Inbox · без категории: {unfiled.length}</b>
          <div className="muted small">Откройте задачу и выберите проект — приложение запомнит ваш выбор для похожих формулировок.</div>
          {unfiled.slice(0, 10).map((t) => <TaskRow key={t.id} task={t} />)}
        </div>
      )}
      <div className="tree">
        {s.workspaces.map((w) => (
          <div key={w.id} className="card" style={{ marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>{w.name}</h3>
            {s.projects.filter((p) => p.workspace_id === w.id && !p.is_archived).map((p) => (
              <div key={p.id} className="task" onClick={() => setSelected(p)}>
                <div className="grow">
                  <div className="title">{p.name} <span className="chip">{open.filter((t) => t.project_id === p.id).length}</span></div>
                  <div className="muted tiny">{s.areas.filter((a) => a.project_id === p.id && !a.parent_area_id).map((a) => `→ ${a.name}`).join("   ")}</div>
                </div>
              </div>
            ))}
            <div className="row" style={{ marginTop: 8 }}>
              <input placeholder="Новый проект" value={newName[w.id] ?? ""} onChange={(e) => setNewName({ ...newName, [w.id]: e.target.value })} style={{ width: 260 }} />
              <button onClick={async () => { const n = newName[w.id]?.trim(); if (n) { await db.createProject(n, w.id); setNewName({ ...newName, [w.id]: "" }); await s.refresh(); } }}>Добавить</button>
            </div>
          </div>
        ))}
        <div className="row"><input placeholder="Новое рабочее пространство (например, «Личное»)" value={newName.ws ?? ""} onChange={(e) => setNewName({ ...newName, ws: e.target.value })} style={{ width: 340 }} /><button onClick={async () => { if (newName.ws) { await db.createWorkspace(newName.ws); setNewName({ ...newName, ws: "" }); await s.refresh(); } }}>Добавить</button></div>
      </div>
    </div>
  );
}

function ProjectDetail({ project, onBack }: { project: Project; onBack: () => void }) {
  const s = useStore();
  const [area, setArea] = useState("");
  const [aliases, setAliases] = useState(project.aliases?.join(", ") ?? "");
  const [showDone, setShowDone] = useState(false);
  const tasks = s.tasks.filter((t) => t.project_id === project.id && (showDone || !t.completed_at));
  const areas = s.areas.filter((a) => a.project_id === project.id && !a.parent_area_id);
  return (
    <div>
      <button className="ghost" onClick={onBack}>← Проекты</button>
      <h1>{project.name}</h1>
      <div className="row" style={{ margin: "8px 0" }}>
        <input value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="Синонимы через запятую: КМТФ, KMTF" style={{ width: 360 }} onBlur={async () => { await db.updateProject(project.id, { aliases: aliases.split(",").map((x) => x.trim()).filter(Boolean) }); await s.refresh(); }} />
        <label className="row small"><input type="checkbox" style={{ width: 18 }} checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> показывать завершённые</label>
      </div>
      {tasks.filter((t) => !t.area_id).length > 0 && <><h3>Без направления</h3>{tasks.filter((t) => !t.area_id).map((t) => <TaskRow key={t.id} task={t} showPath={false} />)}</>}
      {areas.map((a) => {
        const subs = new Set(s.areas.filter((x) => x.parent_area_id === a.id).map((x) => x.id));
        const items = tasks.filter((t) => t.area_id === a.id || (t.area_id && subs.has(t.area_id)));
        return <div key={a.id}><h3>{a.name} <span className="chip">{items.length}</span></h3>{items.map((t) => <TaskRow key={t.id} task={t} showPath={false} />)}</div>;
      })}
      <div className="row" style={{ marginTop: 16 }}><input placeholder="Новое направление, например War Risk" value={area} onChange={(e) => setArea(e.target.value)} style={{ width: 300 }} /><button onClick={async () => { if (area) { await db.createArea(area, project.id); setArea(""); await s.refresh(); } }}>Добавить</button></div>
    </div>
  );
}
