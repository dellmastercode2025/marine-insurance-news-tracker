import { useEffect, useState } from "react";
import { db } from "../lib/data";
import { absolute, fromLocalInput, toLocalInput } from "../lib/dates";
import { useStore } from "../lib/hooks";
import { KIND_LABEL, PRIORITY_LABEL, type Task, type TaskKind } from "../lib/types";

export default function TaskDrawer({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const s = useStore();
  const task = s.tasks.find((t) => t.id === taskId);
  const [form, setForm] = useState<Task | null>(task ?? null);
  const [newProject, setNewProject] = useState("");
  const [newArea, setNewArea] = useState("");
  const [extraReminder, setExtraReminder] = useState("");
  const [tags, setTags] = useState(task?.tags.join(", ") ?? "");
  useEffect(() => { if (task) { setForm(task); setTags(task.tags.join(", ")); } }, [task]);
  if (!form) return null;
  const set = (patch: Partial<Task>) => setForm({ ...form, ...patch });
  const areas = s.areas.filter((a) => a.project_id === form.project_id);
  const reminders = s.reminders.filter((r) => r.task_id === form.id);

  const save = async () => {
    const patch: Partial<Task> = {
      title: form.title, description: form.description, kind: form.kind, priority: form.priority, due_at: form.due_at, reminder_at: form.reminder_at, start_at: form.start_at, event_end_at: form.event_end_at,
      follow_up_at: form.follow_up_at, is_waiting: form.is_waiting, waiting_for_person_id: form.waiting_for_person_id, waiting_subject: form.waiting_subject, person_id: form.person_id,
      tags: tags.split(",").map((x) => x.trim()).filter(Boolean), status_id: form.status_id,
    };
    if (form.is_waiting && !task?.is_waiting) patch.status_id = s.status("waiting")?.id ?? form.status_id;
    await db.updateTask(form.id, patch);
    if (task && (task.project_id !== form.project_id || task.area_id !== form.area_id)) await db.reclassify(form.id, form.project_id, form.area_id);
    if (extraReminder) await db.addReminder(form.id, new Date(extraReminder).toISOString());
    await s.refresh(); onClose();
  };
  const createProject = async () => {
    const ws = s.workspaces[0]; if (!ws || !newProject.trim()) return;
    const p = await db.createProject(newProject.trim(), ws.id); await s.refresh(); set({ project_id: p.id, area_id: null }); setNewProject("");
  };
  const createArea = async () => { if (!form.project_id || !newArea.trim()) return; await db.createArea(newArea.trim(), form.project_id); await s.refresh(); setNewArea(""); };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="row"><b>{KIND_LABEL[form.kind]}</b><span className="grow" /><button className="ghost" onClick={onClose}>✕</button></div>
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          <label className="field">Название<input value={form.title} onChange={(e) => set({ title: e.target.value })} /></label>
          <label className="field">Описание<textarea value={form.description ?? ""} onChange={(e) => set({ description: e.target.value || null })} /></label>
          <div className="grid2">
            <label className="field">Тип<select value={form.kind} onChange={(e) => set({ kind: e.target.value as TaskKind })}>{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="field">Приоритет<select value={form.priority} onChange={(e) => set({ priority: Number(e.target.value) as Task["priority"] })}>{[1, 2, 3, 4].map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select></label>
            <label className="field">Статус<select value={form.status_id ?? ""} onChange={(e) => set({ status_id: e.target.value || null, completed_at: s.statuses.find((c) => c.id === e.target.value)?.kind === "done" ? new Date().toISOString() : null })}>{s.statuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label className="field">Человек<select value={form.person_id ?? ""} onChange={(e) => set({ person_id: e.target.value || null })}><option value="">—</option>{s.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          </div>
          <div className="card">
            <b className="small">Проект и направление</b>
            <div className="grid2" style={{ marginTop: 6 }}>
              <label className="field">Проект<select value={form.project_id ?? ""} onChange={(e) => set({ project_id: e.target.value || null, area_id: null })}><option value="">— не выбран —</option>{s.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <label className="field">Направление<select value={form.area_id ?? ""} onChange={(e) => set({ area_id: e.target.value || null })} disabled={!form.project_id}><option value="">—</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
              <div className="row"><input placeholder="Новый проект" value={newProject} onChange={(e) => setNewProject(e.target.value)} /><button onClick={createProject}>+</button></div>
              <div className="row"><input placeholder="Новое направление" value={newArea} onChange={(e) => setNewArea(e.target.value)} disabled={!form.project_id} /><button onClick={createArea} disabled={!form.project_id}>+</button></div>
            </div>
            {form.ai_confidence != null && <div className="muted tiny" style={{ marginTop: 6 }}>Уверенность AI {Math.round(form.ai_confidence * 100)}%. Перенос в другую категорию обучает классификатор.</div>}
          </div>
          <div className="grid2">
            <label className="field">Срок<input type="datetime-local" value={toLocalInput(form.due_at)} onChange={(e) => set({ due_at: fromLocalInput(e.target.value) })} /></label>
            <label className="field">Напоминание<input type="datetime-local" value={toLocalInput(form.reminder_at)} onChange={(e) => set({ reminder_at: fromLocalInput(e.target.value) })} /></label>
            {form.kind === "event" && <><label className="field">Начало<input type="datetime-local" value={toLocalInput(form.start_at)} onChange={(e) => set({ start_at: fromLocalInput(e.target.value) })} /></label><label className="field">Конец<input type="datetime-local" value={toLocalInput(form.event_end_at)} onChange={(e) => set({ event_end_at: fromLocalInput(e.target.value) })} /></label></>}
            <label className="field">Ещё напоминание<input type="datetime-local" value={extraReminder} onChange={(e) => setExtraReminder(e.target.value)} /></label>
            <label className="field">Теги<input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="через запятую" /></label>
          </div>
          {reminders.length > 0 && <div className="muted small">Запланировано: {reminders.map((r) => `${r.kind === "follow_up" ? "follow-up " : ""}${absolute(r.fire_at)}${r.repeat_rule ? ` (${r.repeat_rule})` : ""}`).join("; ")}</div>}
          <div className="card">
            <label className="row small"><input type="checkbox" style={{ width: 18 }} checked={form.is_waiting} onChange={(e) => set({ is_waiting: e.target.checked })} /> Жду ответ</label>
            {form.is_waiting && (
              <div className="grid2" style={{ marginTop: 6 }}>
                <label className="field">От кого<select value={form.waiting_for_person_id ?? ""} onChange={(e) => set({ waiting_for_person_id: e.target.value || null })}><option value="">—</option>{s.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                <label className="field">Предмет<input value={form.waiting_subject ?? ""} onChange={(e) => set({ waiting_subject: e.target.value || null })} /></label>
                <label className="field">Контрольная дата (follow-up)<input type="datetime-local" value={toLocalInput(form.follow_up_at)} onChange={(e) => set({ follow_up_at: fromLocalInput(e.target.value) })} /></label>
              </div>
            )}
          </div>
          {(form.original_transcript || form.clean_transcript) && <div className="card"><b className="small">Из голосового сообщения</b><div className="small muted" style={{ marginTop: 4 }}>«{form.original_transcript ?? form.clean_transcript}»</div></div>}
          <div className="row">
            <button className="primary" onClick={save}>Сохранить</button>
            <button onClick={async () => { await db.complete(form, s.statuses, !form.completed_at); await s.refresh(); onClose(); }}>{form.completed_at ? "Вернуть в работу" : "✓ Выполнено"}</button>
            <span className="grow" />
            <button className="danger" onClick={async () => { if (confirm("Удалить задачу?")) { await db.deleteTask(form.id); await s.refresh(); onClose(); } }}>Удалить</button>
          </div>
        </div>
      </div>
    </div>
  );
}
