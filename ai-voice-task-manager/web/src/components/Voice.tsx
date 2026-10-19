import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { db } from "../lib/data";
import { absolute } from "../lib/dates";
import { useStore } from "../lib/hooks";
import { KIND_LABEL, type ParseResponse, type ResolvedItem, type TaskKind } from "../lib/types";

type Stage = "idle" | "recording" | "transcribing" | "parsing" | "review" | "committing";

export default function Voice({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [stage, setStage] = useState<Stage>("idle");
  const [levels, setLevels] = useState<number[]>(Array(40).fill(0.05));
  const [live, setLive] = useState("");
  const [typed, setTyped] = useState("");
  const [textMode, setTextMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ParseResponse | null>(null);
  const [items, setItems] = useState<ResolvedItem[]>([]);
  const [editing, setEditing] = useState<ResolvedItem | null>(null);
  const [transcript, setTranscript] = useState<{ original: string; clean: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const media = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const raf = useRef<number>(0);
  const recog = useRef<any>(null);
  const startedAt = useRef(0);

  useEffect(() => () => { cancelAnimationFrame(raf.current); recog.current?.stop?.(); media.current?.stream.getTracks().forEach((t) => t.stop()); }, []);

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      rec.onstop = () => void process(new Blob(chunks.current, { type: rec.mimeType || "audio/webm" }));
      rec.start(250);
      media.current = rec;
      startedAt.current = Date.now();
      // waveform
      const ctx = new AudioContext(); const src = ctx.createMediaStreamSource(stream); const an = ctx.createAnalyser(); an.fftSize = 256; src.connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      const tick = () => { an.getByteTimeDomainData(buf); let sum = 0; for (const v of buf) { const x = (v - 128) / 128; sum += x * x; } const rms = Math.sqrt(sum / buf.length); setLevels((l) => [...l.slice(1), Math.min(1, Math.max(0.05, rms * 4))]); setElapsed((Date.now() - startedAt.current) / 1000); raf.current = requestAnimationFrame(tick); };
      tick();
      // live transcript (Chrome)
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SR) { const r = new SR(); r.lang = s.prefs?.language === "en" ? "en-US" : s.prefs?.language === "kk" ? "kk-KZ" : "ru-RU"; r.continuous = true; r.interimResults = true; r.onresult = (e: any) => { let t = ""; for (const res of e.results) t += res[0].transcript + " "; setLive(t.trim()); }; r.onerror = () => {}; try { r.start(); recog.current = r; } catch { /* unsupported */ } }
      setStage("recording");
    } catch (e) { setError("Нет доступа к микрофону: " + (e instanceof Error ? e.message : e)); }
  };

  const stop = () => { cancelAnimationFrame(raf.current); recog.current?.stop?.(); media.current?.stop(); media.current?.stream.getTracks().forEach((t) => t.stop()); };

  const process = async (blob: Blob) => {
    try {
      const duration = (Date.now() - startedAt.current) / 1000;
      if (duration < 0.7) { setStage("idle"); return; }
      setStage("transcribing");
      const voiceEntryId = await db.createVoiceEntry(duration).catch(() => null);
      const b64 = await toBase64(blob);
      const mime = blob.type.split(";")[0] || "audio/webm";
      const tr = await api.transcribe(b64, mime, voiceEntryId, live || undefined);
      setTranscript({ original: tr.original_transcript, clean: tr.clean_transcript });
      await runParse(tr.clean_transcript, voiceEntryId, tr.original_transcript);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setStage("idle"); }
  };

  const runParse = async (text: string, voiceEntryId: string | null, original?: string) => {
    setStage("parsing");
    const p = await api.parse(text, voiceEntryId, original);
    setProposal(p); setItems(p.items); setStage("review");
  };

  const parseText = async () => {
    if (!typed.trim()) return;
    setError(null);
    try { setTranscript({ original: typed, clean: typed }); const id = await db.createVoiceEntry(0).catch(() => null); await runParse(typed, id); } catch (e) { setError(e instanceof Error ? e.message : String(e)); setStage("idle"); }
  };

  const commit = async () => {
    if (!proposal) return;
    setStage("committing");
    try {
      const r = await api.commit(items, proposal.voice_entry_id ?? null, transcript?.original, transcript?.clean);
      s.setUndo({ summary: `Добавлено ${r.tasks.length} элементов`, batchId: r.batch_id });
      await s.refresh(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setStage("review"); }
  };

  const choose = (it: ResolvedItem, opt: NonNullable<ResolvedItem["disambiguation_options"]>[number]) =>
    setItems((xs) => xs.map((x) => (x.client_id === it.client_id ? { ...x, project: opt.project ?? null, project_id: opt.project_id ?? null, area: opt.area ?? null, area_id: opt.area_id ?? null, needs_disambiguation: false, auto_file: true } : x)));

  return (
    <div className="modal-backdrop" onClick={() => stage !== "recording" && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row"><b>Голосовое поручение</b><span className="grow" />{stage === "idle" && <button className="ghost" onClick={() => setTextMode(!textMode)}>{textMode ? "🎙 Голос" : "⌨️ Текст"}</button>}<button className="ghost" onClick={onClose}>✕</button></div>
        {error && <div className="error small" style={{ margin: "8px 0" }}>{error}</div>}

        {(stage === "idle" || stage === "recording") && !textMode && (
          <div style={{ textAlign: "center" }}>
            <div className="wave">{levels.map((l, i) => <i key={i} style={{ height: `${l * 100}%` }} />)}</div>
            <div className="muted small">{stage === "recording" ? `${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, "0")}` : "Нажмите и говорите свободно: несколько тем, сроки, имена — всё будет разложено автоматически."}</div>
            <div style={{ minHeight: 60, padding: 10, textAlign: "left" }}>{live}</div>
            <button className={`rec ${stage === "recording" ? "on" : ""}`} onClick={stage === "recording" ? stop : start}>{stage === "recording" ? "■" : "🎙"}</button>
          </div>
        )}
        {stage === "idle" && textMode && (<div style={{ display: "grid", gap: 8 }}><textarea rows={6} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Вставьте или напишите текст поручений…" /><button className="primary" onClick={parseText}>Разобрать</button></div>)}
        {(stage === "transcribing" || stage === "parsing" || stage === "committing") && <div className="muted" style={{ padding: 30, textAlign: "center" }}>{stage === "transcribing" ? "Расшифровываю запись…" : stage === "parsing" ? "Выделяю задачи, сроки и проекты…" : "Сохраняю…"}</div>}

        {stage === "review" && proposal && (
          <div>
            <h2 style={{ marginTop: 10 }}>{items.length === 0 ? "Действий не найдено" : `Я нашёл ${items.length} ${items.length === 1 ? "действие" : items.length < 5 ? "действия" : "действий"}`}</h2>
            <div className="muted small">{proposal.summary}</div>
            {transcript && <details className="small" style={{ margin: "6px 0" }}><summary>Расшифровка</summary><div className="muted">{transcript.clean}</div></details>}
            {items.map((it, i) => (
              <div key={it.client_id} className="item">
                <div className="row"><span className="muted tiny">{i + 1}. {KIND_LABEL[it.type]}</span><span className="grow" /><span className={`chip p${it.priority ?? 3}`}>P{it.priority ?? 3}</span>{it.confidence < 0.85 && <span className="chip bell">{Math.round(it.confidence * 100)}%</span>}<button className="ghost tiny" onClick={() => setEditing(it)}>Изменить</button><button className="ghost tiny" onClick={() => setItems(items.filter((x) => x.client_id !== it.client_id))}>Убрать</button></div>
                {(it.project || it.area) && <div className="tiny" style={{ color: "var(--accent-2)" }}>{[it.project, it.area, it.subarea].filter(Boolean).join(" → ")}</div>}
                <div style={{ fontWeight: 500 }}>{it.title}</div>
                <div className="row" style={{ gap: 6, marginTop: 4 }}>
                  {it.due_at && <span className="chip">📅 Срок: {absolute(it.due_at)}</span>}
                  {it.reminder_at && <span className="chip bell">🔔 {absolute(it.reminder_at)}</span>}
                  {it.event_start_at && <span className="chip ok">📆 {absolute(it.event_start_at)}</span>}
                  {it.waiting_for && <span className="chip wait">⏳ Жду: {it.waiting_for}{it.waiting_subject ? ` · ${it.waiting_subject}` : ""}</span>}
                  {!it.waiting_for && it.person && <span className="chip">👤 {it.person}</span>}
                </div>
                {it.source_quote && <div className="muted tiny" style={{ marginTop: 4 }}>«{it.source_quote}»</div>}
                {it.needs_disambiguation && it.disambiguation_options && (
                  <div style={{ marginTop: 6 }}><div className="tiny" style={{ color: "var(--warn)" }}>Я не уверен, куда отнести. Выберите:</div>
                    <div className="row">{it.disambiguation_options.map((o, j) => <button key={j} className="small" onClick={() => choose(it, o)}>{[o.project, o.area].filter(Boolean).join(" → ")}</button>)}</div></div>
                )}
                {it.warnings?.map((w) => <div key={w} className="muted tiny">⚠ {w}</div>)}
              </div>
            ))}
            <div className="row" style={{ marginTop: 10 }}>
              <button className="danger" onClick={onClose}>Отменить</button><span className="grow" />
              <button className="primary" onClick={commit} disabled={items.length === 0}>Добавить всё</button>
            </div>
          </div>
        )}
        {editing && <ItemEditor item={editing} onClose={() => setEditing(null)} onSave={(u) => { setItems(items.map((x) => (x.client_id === u.client_id ? u : x))); setEditing(null); }} />}
      </div>
    </div>
  );
}

function ItemEditor({ item, onSave, onClose }: { item: ResolvedItem; onSave: (i: ResolvedItem) => void; onClose: () => void }) {
  const s = useStore();
  const [f, setF] = useState<ResolvedItem>(item);
  const set = (p: Partial<ResolvedItem>) => setF({ ...f, ...p });
  const toLocal = (iso?: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
  const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);
  const areas = s.areas.filter((a) => a.project_id === f.project_id);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <b>Изменить</b>
        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
          <label className="field">Название<input value={f.title} onChange={(e) => set({ title: e.target.value })} /></label>
          <div className="grid2">
            <label className="field">Тип<select value={f.type} onChange={(e) => set({ type: e.target.value as TaskKind })}>{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="field">Приоритет<select value={f.priority ?? 3} onChange={(e) => set({ priority: Number(e.target.value) })}>{[1, 2, 3, 4].map((p) => <option key={p} value={p}>P{p}</option>)}</select></label>
            <label className="field">Проект<select value={f.project_id ?? ""} onChange={(e) => { const p = s.projects.find((x) => x.id === e.target.value); set({ project_id: p?.id ?? null, project: p?.name ?? f.project, area_id: null, area: null }); }}><option value="">{f.project_id ? "—" : `новый: ${f.project ?? "—"}`}</option>{s.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label className="field">Направление<select value={f.area_id ?? ""} onChange={(e) => { const a = areas.find((x) => x.id === e.target.value); set({ area_id: a?.id ?? null, area: a?.name ?? null }); }}><option value="">{f.area_id ? "—" : `новое: ${f.area ?? "—"}`}</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
            <label className="field">Срок<input type="datetime-local" value={toLocal(f.due_at)} onChange={(e) => set({ due_at: fromLocal(e.target.value) })} /></label>
            <label className="field">Напоминание<input type="datetime-local" value={toLocal(f.reminder_at)} onChange={(e) => set({ reminder_at: fromLocal(e.target.value) })} /></label>
          </div>
          <div className="row"><button className="primary" onClick={() => onSave({ ...f, needs_disambiguation: false, auto_file: true })}>Сохранить</button><button onClick={onClose}>Отмена</button></div>
        </div>
      </div>
    </div>
  );
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res((r.result as string).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });
}
