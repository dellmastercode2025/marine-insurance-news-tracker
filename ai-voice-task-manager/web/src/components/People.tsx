import { useState } from "react";
import { db } from "../lib/data";
import { useStore } from "../lib/hooks";
import TaskRow from "./TaskRow";

export default function People() {
  const s = useStore();
  const [name, setName] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const open = s.tasks.filter((t) => !t.completed_at);
  const person = s.people.find((p) => p.id === sel);
  return (
    <div>
      <h1>Люди и организации</h1>
      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="card">
          {s.people.map((p) => (
            <div key={p.id} className="task" onClick={() => setSel(p.id)}>
              <div className="grow"><div className="title">{p.name}</div><div className="muted tiny">{[p.role, s.organisations.find((o) => o.id === p.organisation_id)?.name].filter(Boolean).join(" · ")}</div></div>
              {open.filter((t) => t.waiting_for_person_id === p.id).length > 0 && <span className="chip wait">жду {open.filter((t) => t.waiting_for_person_id === p.id).length}</span>}
            </div>
          ))}
          <div className="row" style={{ marginTop: 8 }}><input placeholder="Новый контакт" value={name} onChange={(e) => setName(e.target.value)} /><button onClick={async () => { if (name) { await db.createPerson(name, null, null); setName(""); await s.refresh(); } }}>Добавить</button></div>
          <h3>Организации</h3>
          {s.organisations.map((o) => <div key={o.id} className="small">{o.name}</div>)}
        </div>
        <div className="card">
          {!person && <div className="muted">Выберите человека</div>}
          {person && (<>
            <h3 style={{ marginTop: 0 }}>{person.name}</h3>
            <b className="small">Жду от {person.name}</b>
            {open.filter((t) => t.waiting_for_person_id === person.id).map((t) => <TaskRow key={t.id} task={t} />)}
            <b className="small" style={{ display: "block", marginTop: 10 }}>Связанные задачи</b>
            {open.filter((t) => t.person_id === person.id).map((t) => <TaskRow key={t.id} task={t} />)}
          </>)}
        </div>
      </div>
    </div>
  );
}
