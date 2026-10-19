import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { configured, supabase } from "./lib/supabase";
import { loadSnapshot, type Snapshot } from "./lib/data";
import { StoreContext, type Store } from "./lib/hooks";
import { isPast } from "./lib/dates";
import Auth from "./components/Auth";
import Today from "./components/Today";
import Plan from "./components/Plan";
import Board from "./components/Board";
import Projects from "./components/Projects";
import People from "./components/People";
import Chat from "./components/Chat";
import Search from "./components/Search";
import Settings from "./components/Settings";
import News from "./components/News";
import Mail from "./components/Mail";
import Voice from "./components/Voice";
import TaskDrawer from "./components/TaskDrawer";
import UndoToast from "./components/UndoToast";

type Tab = "today" | "plan" | "board" | "projects" | "people" | "chat" | "mail" | "news" | "search" | "settings";
const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: "today", label: "Сегодня", icon: "☀️" }, { id: "plan", label: "План", icon: "📅" }, { id: "board", label: "Доска", icon: "🗂️" },
  { id: "projects", label: "Проекты", icon: "📁" }, { id: "people", label: "Люди", icon: "👥" }, { id: "chat", label: "Чат", icon: "💬" },
  { id: "mail", label: "Переписки", icon: "✉️" }, { id: "news", label: "Новости", icon: "📰" },
  { id: "search", label: "Поиск", icon: "🔎" }, { id: "settings", label: "Настройки", icon: "⚙️" },
];

const EMPTY: Snapshot = { workspaces: [], projects: [], areas: [], people: [], organisations: [], statuses: [], tasks: [], reminders: [], prefs: null };

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>(() => (location.hash.replace("#", "").split("?")[0] as Tab) || "today");
  const [unansweredMail, setUnansweredMail] = useState(0);
  const [snap, setSnap] = useState<Snapshot>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [undo, setUndo] = useState<{ summary: string; batchId: string } | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const refresh = useCallback(async () => {
    try { setSnap(await loadSnapshot()); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!session) return;
    void refresh();
    const channel = supabase.channel("db-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "areas" }, () => void refresh())
      .subscribe();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => { supabase.removeChannel(channel); window.removeEventListener("focus", onFocus); };
  }, [session, refresh]);

  useEffect(() => { location.hash = tab; }, [tab]);
  useEffect(() => {
    if (!session) return;
    const load = () => supabase.from("mail_messages").select("id", { count: "exact", head: true }).eq("needs_reply", true).eq("reply_status", "pending").then(({ count }) => setUnansweredMail(count ?? 0));
    void load();
    const ch = supabase.channel("mail-count").on("postgres_changes", { event: "*", schema: "public", table: "mail_messages" }, () => void load()).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session]);

  const store = useMemo<Store>(() => ({
    ...snap, loading, error, refresh, openTask: setOpenId, undo, setUndo,
    projectOf: (t) => snap.projects.find((p) => p.id === t.project_id),
    areaOf: (t) => snap.areas.find((a) => a.id === t.area_id),
    personOf: (id) => snap.people.find((p) => p.id === id),
    status: (kind) => snap.statuses.find((s) => s.kind === kind),
    path: (t) => [snap.projects.find((p) => p.id === t.project_id)?.name, snap.areas.find((a) => a.id === t.area_id)?.name].filter(Boolean).join(" → "),
  }), [snap, loading, error, refresh, undo]);

  if (!configured) return <div className="login"><div className="card"><h1>Нет настроек</h1><p className="muted">Задайте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY (файл .env или переменные хостинга) и пересоберите.</p></div></div>;
  if (session === undefined) return <div className="login"><p className="muted">Загрузка…</p></div>;
  if (!session) return <Auth />;

  const open = snap.tasks.filter((t) => !t.completed_at);
  const inboxId = snap.statuses.find((s) => s.kind === "inbox")?.id;
  const todayCount = open.filter((t) => t.due_at && new Date(t.due_at).toDateString() === new Date().toDateString()).length + open.filter((t) => isPast(t.due_at)).length;
  const inboxCount = open.filter((t) => t.status_id === inboxId || !t.project_id).length;

  return (
    <StoreContext.Provider value={store}>
      <div className="layout">
        <aside className="sidebar">
          <div className="brand">🎙️ Voice Tasks</div>
          <button className="mic" onClick={() => setVoiceOpen(true)}>🎙 Записать</button>
          {TABS.map((t) => (
            <button key={t.id} className={`nav ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
              <span>{t.icon}</span><span>{t.label}</span>
              {t.id === "today" && todayCount > 0 && <span className="badge">{todayCount}</span>}
              {t.id === "projects" && inboxCount > 0 && <span className="badge" title="Без категории">{inboxCount}</span>}
              {t.id === "mail" && unansweredMail > 0 && <span className="badge" title="Писем без ответа">{unansweredMail}</span>}
            </button>
          ))}
          <div className="spacer grow" />
          <div className="tiny muted" style={{ padding: "0 12px" }}>{session.user.email}</div>
        </aside>
        <main className="main">
          <div className="content">
            {error && <div className="card error" style={{ marginBottom: 12 }}>{error} <button className="ghost" onClick={() => void refresh()}>Повторить</button></div>}
            {tab === "today" && <Today onOpenVoice={() => setVoiceOpen(true)} />}
            {tab === "plan" && <Plan />}
            {tab === "board" && <Board />}
            {tab === "projects" && <Projects />}
            {tab === "people" && <People />}
            {tab === "chat" && <Chat />}
            {tab === "mail" && <Mail />}
            {tab === "news" && <News />}
            {tab === "search" && <Search />}
            {tab === "settings" && <Settings />}
          </div>
        </main>
      </div>
      {openId && <TaskDrawer taskId={openId} onClose={() => setOpenId(null)} />}
      {voiceOpen && <Voice onClose={() => setVoiceOpen(false)} />}
      <UndoToast />
    </StoreContext.Provider>
  );
}
