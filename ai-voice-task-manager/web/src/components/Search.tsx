import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useStore } from "../lib/hooks";
import type { SearchResponse } from "../lib/types";
import TaskRow from "./TaskRow";

export default function Search() {
  const s = useStore();
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<SearchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const ql = q.toLowerCase();
  const local = ql.length >= 2 ? s.tasks.filter((t) => [t.title, t.description, t.clean_transcript, t.original_transcript, s.path(t), s.personOf(t.person_id)?.name, ...(t.tags ?? [])].some((x) => x?.toLowerCase().includes(ql))) : [];

  useEffect(() => {
    if (ql.length < 4) { setRemote(null); return; }
    const h = setTimeout(async () => { setBusy(true); try { setRemote(await api.search(q)); } catch { setRemote(null); } finally { setBusy(false); } }, 700);
    return () => clearTimeout(h);
  }, [q, ql.length]);

  const semantic = remote?.tasks.filter((h) => !local.some((l) => l.id === h.id)) ?? [];
  return (
    <div>
      <h1>Поиск</h1>
      <input autoFocus placeholder="Например: то письмо про страховку, где мы были недовольны брокером" value={q} onChange={(e) => setQ(e.target.value)} />
      {local.length > 0 && <><h3>Совпадения</h3>{local.slice(0, 30).map((t) => <TaskRow key={t.id} task={t} />)}</>}
      {busy && <div className="muted small" style={{ marginTop: 8 }}>Семантический поиск…</div>}
      {semantic.length > 0 && <><h3>По смыслу (AI)</h3>{semantic.map((h) => { const t = s.tasks.find((x) => x.id === h.id); return t ? <TaskRow key={h.id} task={t} /> : <div key={h.id} className="task" onClick={() => s.openTask(h.id)}>{h.title}</div>; })}</>}
      {remote && remote.people.length > 0 && <><h3>Люди</h3>{remote.people.map((p) => <div key={p.id}>{p.name}</div>)}</>}
      {ql.length >= 2 && !busy && local.length === 0 && semantic.length === 0 && <div className="muted" style={{ marginTop: 10 }}>Ничего не найдено</div>}
    </div>
  );
}
