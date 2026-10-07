// POST /briefing  { date? }  → daily briefing with precomputed statistics + Gemini narrative.
import { serveWith } from "../_shared/handler.ts";
import { readJson } from "../_shared/auth.ts";
import { json } from "../_shared/cors.ts";
import { BRIEFING_SYSTEM } from "../_shared/prompts.ts";
import { BRIEFING_SCHEMA } from "../_shared/schemas.ts";
import { describeISO, startOfLocalDay } from "../_shared/dateService.ts";
import { nowBlock } from "../_shared/context.ts";

serveWith(async (req, ctx, gemini) => {
  await readJson<Record<string, unknown>>(req).catch(() => ({}));
  const today0 = startOfLocalDay(ctx.now, ctx.tz);
  const tomorrow0 = startOfLocalDay(ctx.now, ctx.tz, 1);
  const { data: tasks, error } = await ctx.supabase
    .from("tasks")
    .select("id,kind,title,priority,due_at,reminder_at,follow_up_at,start_at,is_waiting,waiting_subject,project:projects(name),area:areas(name),status:status_columns(kind),waiting_for:people!tasks_waiting_for_person_id_fkey(name)")
    .eq("user_id", ctx.userId)
    .is("deleted_at", null)
    .order("priority")
    .limit(300);
  if (error) throw new Error(error.message);
  const open = (tasks ?? []).filter((t: any) => t.status?.kind !== "done");
  const dueToday = open.filter((t: any) => t.due_at && new Date(t.due_at) >= today0 && new Date(t.due_at) < tomorrow0);
  const overdue = open.filter((t: any) => t.due_at && new Date(t.due_at) < ctx.now && new Date(t.due_at) < today0);
  const waiting = open.filter((t: any) => t.is_waiting);
  const followUpDue = waiting.filter((t: any) => t.follow_up_at && new Date(t.follow_up_at) <= tomorrow0);
  const events = open.filter((t: any) => t.kind === "event" && t.start_at && new Date(t.start_at) >= today0 && new Date(t.start_at) < tomorrow0);
  const critical = open.filter((t: any) => t.priority === 1 || overdue.includes(t) || followUpDue.includes(t));
  const stats = {
    date_human: new Intl.DateTimeFormat("ru-RU", { timeZone: ctx.tz, weekday: "long", day: "numeric", month: "long" }).format(ctx.now),
    today_total: dueToday.length + events.length,
    urgent: dueToday.filter((t: any) => t.priority <= 2).length,
    normal: dueToday.filter((t: any) => t.priority > 2).length,
    overdue: overdue.length,
    waiting: waiting.length,
    follow_ups_due: followUpDue.length,
    events: events.length,
  };
  const slim = (t: any) => ({ id: t.id, title: t.title, priority: t.priority, due: describeISO(t.due_at, ctx.tz), start: describeISO(t.start_at, ctx.tz), project: t.project?.name, area: t.area?.name, waiting_for: t.waiting_for?.name, follow_up: describeISO(t.follow_up_at, ctx.tz) });
  const payload = { stats, due_today: dueToday.map(slim), events: events.map(slim), overdue: overdue.map(slim), waiting: waiting.map(slim) };

  let narrative = { headline: `Сегодня, ${stats.date_human}`, narrative: "", critical: critical.slice(0, 5).map((t: any) => ({ task_id: t.id, line: t.title })), suggested_order: [...critical, ...dueToday].map((t: any) => t.id).filter((v, i, a) => a.indexOf(v) === i).slice(0, 10) };
  if (open.length) {
    try {
      narrative = await gemini.generateJSON({
        systemInstruction: BRIEFING_SYSTEM + "\n" + nowBlock(ctx.now, ctx.tz),
        responseSchema: BRIEFING_SCHEMA,
        temperature: 0.3,
        contents: [{ role: "user", parts: [{ text: JSON.stringify(payload) }] }],
      });
    } catch (e) {
      console.warn("briefing narrative failed", e instanceof Error ? e.message : e);
    }
  }
  return json({ ...stats, ...narrative, due_today_list: payload.due_today, events_list: payload.events, overdue_list: payload.overdue, waiting_list: payload.waiting });
});
