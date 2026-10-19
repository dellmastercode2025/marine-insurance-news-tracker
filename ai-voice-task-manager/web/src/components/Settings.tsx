import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { db } from "../lib/data";
import { supabase } from "../lib/supabase";
import { useStore } from "../lib/hooks";
import type { Preferences } from "../lib/types";

const DEFAULTS: Preferences = { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, language: "ru", morning_time: "09:00", day_time: "14:00", evening_time: "19:00", night_time: "22:00", end_of_day_time: "18:00", default_priority: 3, auto_file_threshold: 0.85, aliases: {}, routing_rules: {}, delete_audio_after_transcription: true, private_mode: false, apple_reminders_sync: "off", briefing_time: "08:00" };

export default function Settings() {
  const s = useStore();
  const [p, setP] = useState<Preferences>(s.prefs ?? DEFAULTS);
  const [ak, setAk] = useState(""); const [av, setAv] = useState(""); const [rk, setRk] = useState(""); const [rv, setRv] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => { if (s.prefs) setP({ ...DEFAULTS, ...s.prefs }); }, [s.prefs]);
  const set = (patch: Partial<Preferences>) => setP({ ...p, ...patch });
  const save = async () => { try { const { user_id: _u, ...rest } = p as Preferences & { user_id?: string; updated_at?: string }; delete (rest as { updated_at?: string }).updated_at; await db.savePrefs(rest as Preferences); await s.refresh(); setMsg("Сохранено"); } catch (e) { setMsg(String(e)); } };
  const time = (k: keyof Preferences, label: string) => <label className="field">{label}<input type="time" value={p[k] as string} onChange={(e) => set({ [k]: e.target.value } as Partial<Preferences>)} /></label>;
  return (
    <div>
      <h1>Настройки</h1>
      <div className="card" style={{ marginBottom: 12 }}>
        <b>Время суток</b>
        <div className="grid2" style={{ marginTop: 8 }}>{time("morning_time", "Утро")}{time("day_time", "День")}{time("evening_time", "Вечер")}{time("night_time", "Ночь")}{time("end_of_day_time", "Срок без времени")}{time("briefing_time", "Утренняя сводка (iPhone)")}</div>
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <b>AI</b>
        <div className="grid2" style={{ marginTop: 8 }}>
          <label className="field">Приоритет по умолчанию<select value={p.default_priority} onChange={(e) => set({ default_priority: Number(e.target.value) })}>{[1, 2, 3, 4].map((x) => <option key={x} value={x}>P{x}</option>)}</select></label>
          <label className="field">Порог авто-распределения: {Math.round(p.auto_file_threshold * 100)}%<input type="range" min={0.5} max={0.99} step={0.01} value={p.auto_file_threshold} onChange={(e) => set({ auto_file_threshold: Number(e.target.value) })} /></label>
        </div>
        <h3>Синонимы (как вы говорите → как называется)</h3>
        {Object.entries(p.aliases).map(([k, v]) => <div key={k} className="row small">{k} → {v} <button className="ghost tiny" onClick={() => { const a = { ...p.aliases }; delete a[k]; set({ aliases: a }); }}>✕</button></div>)}
        <div className="row"><input placeholder="KMTF" value={ak} onChange={(e) => setAk(e.target.value)} /><input placeholder="Казмортрансфлот" value={av} onChange={(e) => setAv(e.target.value)} /><button onClick={() => { if (ak && av) { set({ aliases: { ...p.aliases, [ak]: av } }); setAk(""); setAv(""); } }}>+</button></div>
        <h3>Правила: фраза → Проект/Направление</h3>
        {Object.entries(p.routing_rules).map(([k, v]) => <div key={k} className="row small">{k} → {v} <button className="ghost tiny" onClick={() => { const a = { ...p.routing_rules }; delete a[k]; set({ routing_rules: a }); }}>✕</button></div>)}
        <div className="row"><input placeholder="риски" value={rk} onChange={(e) => setRk(e.target.value)} /><input placeholder="Казмортрансфлот/Управление рисками" value={rv} onChange={(e) => setRv(e.target.value)} /><button onClick={() => { if (rk && rv) { set({ routing_rules: { ...p.routing_rules, [rk]: rv } }); setRk(""); setRv(""); } }}>+</button></div>
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <b>Приватность</b>
        <label className="row small" style={{ marginTop: 8 }}><input type="checkbox" style={{ width: 18 }} checked={p.delete_audio_after_transcription} onChange={(e) => set({ delete_audio_after_transcription: e.target.checked })} /> Удалять аудио после расшифровки</label>
        <label className="row small"><input type="checkbox" style={{ width: 18 }} checked={p.private_mode} onChange={(e) => set({ private_mode: e.target.checked })} /> Private processing mode (расшифровки и история чата не хранятся на сервере)</label>
      </div>
      <div className="row" style={{ marginBottom: 20 }}><button className="primary" onClick={save}>Сохранить</button><span className="muted small">{msg}</span></div>
      <div className="card">
        <b>Данные и аккаунт</b>
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={async () => { const d = await db.export(); const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "voice-tasks-export.json"; a.click(); }}>Экспорт данных (JSON)</button>
          <button onClick={async () => { await api.embedMissing(); setMsg("Индекс обновлён"); }}>Пересчитать семантический индекс</button>
          <button className="danger" onClick={async () => { if (confirm("Удалить историю AI-чата на сервере?")) { await db.deleteChatHistory(); localStorage.removeItem("chat.messages"); } }}>Удалить историю чата</button>
          <button onClick={() => supabase.auth.signOut()}>Выйти</button>
          <button className="danger" onClick={async () => { if (confirm("Удалить аккаунт и ВСЕ данные? Это необратимо.")) { await db.deleteAccount(); await supabase.auth.signOut(); } }}>Удалить аккаунт</button>
        </div>
      </div>
    </div>
  );
}
