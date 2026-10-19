// Tool registry: the ONLY way the model affects data. Every call is validated here, executed with the
// user's RLS-scoped client, and recorded in an undo batch. Mutations that the confirmation policy
// (spec §39) protects return `requires_confirmation` instead of executing.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { FunctionDeclaration } from "./gemini.ts";
import type { Preferences, SemanticDate, SemanticRecurrence, ResolvedItem, PendingAction } from "./types.ts";
import type { UserStructure } from "./context.ts";
import { describeISO, parseDuration, resolveSemanticDate, shiftISO, startOfLocalDay, toRecurrenceRule } from "./dateService.ts";
import { findArea, findOrganisation, findPerson, findProject, norm } from "./matching.ts";

// ---------- undo ----------
export interface UndoEntry {
  table: string;
  op: "insert" | "update" | "delete";
  id: string;
  before?: Record<string, unknown> | null;
}
export class UndoBatch {
  entries: UndoEntry[] = [];
  constructor(public id: string, public description: string) {}
  record(e: UndoEntry) {
    this.entries.push(e);
  }
}

export interface ToolContext {
  supabase: SupabaseClient;
  userId: string;
  prefs: Preferences;
  tz: string;
  now: Date;
  structure: UserStructure;
  batch: UndoBatch;
  confirmed: boolean; // true when the user already confirmed (commit / execute-actions)
  onTaskChanged?: (taskId: string) => void; // used for embeddings refresh
}

export interface ToolOutcome {
  ok: boolean;
  result?: unknown;
  error?: string;
  requires_confirmation?: PendingAction;
}

const semanticDateSchema = {
  type: "object",
  nullable: true,
  properties: {
    day: { type: "string", nullable: true, description: "today|tomorrow|weekday:fri|next_weekday:mon|next_week|end_of_week|end_of_month|in_days:N|in_hours:N|in_minutes:N|date:YYYY-MM-DD" },
    time: { type: "string", nullable: true, description: "morning|day|evening|night|HH:mm" },
  },
};

const taskFilterProps = {
  query: { type: "string", nullable: true, description: "free text, matched against title/description/transcript" },
  semantic: { type: "boolean", nullable: true, description: "use semantic (embedding) search for vague descriptions" },
  project: { type: "string", nullable: true },
  area: { type: "string", nullable: true },
  person: { type: "string", nullable: true, description: "tasks linked to or waiting for this person" },
  tag: { type: "string", nullable: true },
  status: { type: "string", nullable: true, description: "inbox|todo|in_progress|waiting|done|open (open = everything except done)" },
  due: { type: "string", nullable: true, description: "today|tomorrow|this_week|overdue|no_date|next_week" },
  priority_max: { type: "integer", nullable: true, description: "1 → only P1, 2 → P1+P2 …" },
  limit: { type: "integer", nullable: true },
};

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  { name: "list_tasks", description: "List the user's tasks with filters. Use for 'what do I have today', 'what is overdue for project X', 'what am I waiting for from Y'.", parameters: { type: "object", properties: taskFilterProps } },
  { name: "search_tasks", description: "Search tasks by text or meaning (semantic=true). Use for vague descriptions like 'that letter about the broker we were unhappy with'.", parameters: { type: "object", properties: taskFilterProps, required: ["query"] } },
  { name: "get_task", description: "Get full details of one task including transcript fragments.", parameters: { type: "object", properties: { task_id: { type: "string" } }, required: ["task_id"] } },
  {
    name: "create_task",
    description: "Create a task, reminder, waiting item or calendar event.",
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["task", "reminder", "event", "waiting", "note"] },
        title: { type: "string" },
        description: { type: "string", nullable: true },
        project: { type: "string", nullable: true },
        area: { type: "string", nullable: true },
        workspace: { type: "string", nullable: true },
        priority: { type: "integer", nullable: true },
        due: semanticDateSchema,
        reminder: semanticDateSchema,
        event_start: semanticDateSchema,
        event_end: semanticDateSchema,
        follow_up: semanticDateSchema,
        waiting_for: { type: "string", nullable: true },
        waiting_subject: { type: "string", nullable: true },
        person: { type: "string", nullable: true },
        organisation: { type: "string", nullable: true },
        tags: { type: "array", nullable: true, items: { type: "string" } },
        recurrence: { type: "object", nullable: true, properties: { freq: { type: "string" }, interval: { type: "integer", nullable: true }, by_weekday: { type: "array", nullable: true, items: { type: "string" } }, until_done: { type: "boolean", nullable: true } } },
      },
      required: ["title"],
    },
  },
  {
    name: "update_task",
    description: "Update fields of one task (title, description, priority, due, reminder, project/area, tags, waiting info).",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        title: { type: "string", nullable: true },
        description: { type: "string", nullable: true },
        priority: { type: "integer", nullable: true },
        due: semanticDateSchema,
        reminder: semanticDateSchema,
        project: { type: "string", nullable: true },
        area: { type: "string", nullable: true },
        tags: { type: "array", nullable: true, items: { type: "string" } },
        clear_due: { type: "boolean", nullable: true },
      },
      required: ["task_id"],
    },
  },
  { name: "complete_task", description: "Mark a task as done (also closes a waiting item when the answer arrived).", parameters: { type: "object", properties: { task_id: { type: "string" } }, required: ["task_id"] } },
  { name: "move_task", description: "Move a task to another status column and/or project/area.", parameters: { type: "object", properties: { task_id: { type: "string" }, status: { type: "string", nullable: true }, project: { type: "string", nullable: true }, area: { type: "string", nullable: true } }, required: ["task_id"] } },
  { name: "delete_task", description: "Delete a task. Always requires user confirmation.", parameters: { type: "object", properties: { task_id: { type: "string" } }, required: ["task_id"] } },
  {
    name: "reschedule_tasks",
    description: "Bulk move due dates of several tasks (e.g. 'move everything non-urgent from today to Friday'). Requires confirmation.",
    parameters: {
      type: "object",
      properties: {
        task_ids: { type: "array", items: { type: "string" } },
        new_due: semanticDateSchema,
        keep_time: { type: "boolean", nullable: true, description: "keep each task's original time of day" },
      },
      required: ["task_ids", "new_due"],
    },
  },
  { name: "create_reminder", description: "Add an (additional) notification to an existing task at a semantic time.", parameters: { type: "object", properties: { task_id: { type: "string" }, at: semanticDateSchema, before_due: { type: "string", nullable: true, description: "e.g. 1d, 2h – relative to the task's due date" }, recurrence: { type: "object", nullable: true, properties: { freq: { type: "string" }, interval: { type: "integer", nullable: true }, by_weekday: { type: "array", nullable: true, items: { type: "string" } }, until_done: { type: "boolean", nullable: true } } } }, required: ["task_id"] } },
  { name: "create_project", description: "Create a project inside a workspace.", parameters: { type: "object", properties: { name: { type: "string" }, workspace: { type: "string", nullable: true }, aliases: { type: "array", nullable: true, items: { type: "string" } } }, required: ["name"] } },
  { name: "create_area", description: "Create an area (direction) inside a project.", parameters: { type: "object", properties: { project: { type: "string" }, name: { type: "string" }, parent_area: { type: "string", nullable: true } }, required: ["project", "name"] } },
  { name: "create_person", description: "Create a contact.", parameters: { type: "object", properties: { name: { type: "string" }, organisation: { type: "string", nullable: true }, role: { type: "string", nullable: true } }, required: ["name"] } },
  { name: "create_calendar_event", description: "Create a calendar event (synced to Apple Calendar on the device). Requires confirmation.", parameters: { type: "object", properties: { title: { type: "string" }, start: semanticDateSchema, end: semanticDateSchema, project: { type: "string", nullable: true }, area: { type: "string", nullable: true }, person: { type: "string", nullable: true } }, required: ["title", "start"] } },
  { name: "list_unanswered_emails", description: "Emails in the connected mailbox that still wait for the user's reply (AI-triaged). Use for 'what emails are unanswered', 'what does Denis wait from me by email'.", parameters: { type: "object", properties: { from: { type: "string", nullable: true, description: "filter by sender name/email" }, days: { type: "integer", nullable: true }, limit: { type: "integer", nullable: true } } } },
  { name: "search_emails", description: "Full-text search over synced emails (subject, sender, snippet). Use for 'find the letter from WTW about …'.", parameters: { type: "object", properties: { query: { type: "string" }, days: { type: "integer", nullable: true }, limit: { type: "integer", nullable: true } }, required: ["query"] } },
  { name: "mark_email_handled", description: "Mark an unanswered email as replied/dismissed, or create a follow-up task from it.", parameters: { type: "object", properties: { email_id: { type: "string" }, status: { type: "string", enum: ["replied", "dismissed", "task_created"] }, task_title: { type: "string", nullable: true }, due: semanticDateSchema }, required: ["email_id", "status"] } },
];

export const READ_ONLY_TOOLS = new Set(["list_tasks", "search_tasks", "get_task", "list_unanswered_emails", "search_emails"]);

// ---------- helpers ----------
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function int(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : typeof v === "string" && /^\d+$/.test(v) ? +v : null;
}
function sdate(v: unknown): SemanticDate | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const day = str(o.day), time = str(o.time);
  return day || time ? { day, time, text: str(o.text) } : null;
}
function recur(v: unknown): SemanticRecurrence | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const freq = str(o.freq)?.toLowerCase();
  if (!freq || !["hourly", "daily", "weekly", "monthly", "yearly"].includes(freq)) return null;
  return {
    freq: freq as SemanticRecurrence["freq"],
    interval: int(o.interval) ?? undefined,
    by_weekday: Array.isArray(o.by_weekday) ? (o.by_weekday.filter((w) => typeof w === "string").map((w) => (w as string).slice(0, 3).toLowerCase()) as SemanticRecurrence["by_weekday"]) : undefined,
    until_done: o.until_done === true,
  };
}

function statusId(ctx: ToolContext, kindOrName: string | null | undefined, fallbackKind = "todo"): string | null {
  const q = norm(kindOrName);
  const byKind = ctx.structure.statuses.find((s) => s.kind === q);
  if (byKind) return byKind.id;
  const byName = ctx.structure.statuses.find((s) => norm(s.name) === q);
  if (byName) return byName.id;
  return ctx.structure.statuses.find((s) => s.kind === fallbackKind)?.id ?? ctx.structure.statuses[0]?.id ?? null;
}

async function insert<T extends Record<string, unknown>>(ctx: ToolContext, table: string, row: T): Promise<T & { id: string }> {
  const { data, error } = await ctx.supabase.from(table).insert({ ...row, user_id: ctx.userId }).select().single();
  if (error) throw new Error(`${table} insert failed: ${error.message}`);
  ctx.batch.record({ table, op: "insert", id: data.id });
  return data;
}

async function update(ctx: ToolContext, table: string, id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data: before, error: e1 } = await ctx.supabase.from(table).select("*").eq("id", id).eq("user_id", ctx.userId).single();
  if (e1 || !before) throw new Error(`${table} ${id} not found`);
  const { data, error } = await ctx.supabase.from(table).update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select().single();
  if (error) throw new Error(`${table} update failed: ${error.message}`);
  const snapshot: Record<string, unknown> = {};
  for (const k of Object.keys(patch)) snapshot[k] = before[k];
  ctx.batch.record({ table, op: "update", id, before: snapshot });
  ctx.onTaskChanged?.(id);
  return data;
}

export async function ensureWorkspace(ctx: ToolContext, name: string | null | undefined): Promise<string> {
  const s = ctx.structure;
  const q = norm(name);
  const found = s.workspaces.find((w) => norm(w.name) === q) ?? (q ? null : s.workspaces[0]);
  if (found) return found.id;
  if (!q) {
    const row = await insert(ctx, "workspaces", { name: "Работа", sort_order: 0 });
    s.workspaces.push({ id: row.id, name: row.name as string });
    return row.id;
  }
  const row = await insert(ctx, "workspaces", { name: name!.trim(), sort_order: s.workspaces.length });
  s.workspaces.push({ id: row.id, name: row.name as string });
  return row.id;
}

export async function ensureProject(ctx: ToolContext, name: string | null | undefined, workspace?: string | null, aliases: string[] = []): Promise<string | null> {
  if (!name) return null;
  const existing = findProject(ctx.structure, name, ctx.prefs);
  if (existing) return existing.id;
  const wsId = await ensureWorkspace(ctx, workspace);
  const row = await insert(ctx, "projects", { name: name.trim(), workspace_id: wsId, aliases, sort_order: ctx.structure.projects.length });
  ctx.structure.projects.push({ id: row.id, workspace_id: wsId, name: row.name as string, aliases });
  return row.id;
}

export async function ensureArea(ctx: ToolContext, projectId: string | null, name: string | null | undefined, parentId: string | null = null): Promise<string | null> {
  if (!projectId || !name) return null;
  const existing = findArea(ctx.structure, projectId, name, ctx.prefs, parentId);
  if (existing) return existing.id;
  const row = await insert(ctx, "areas", { name: name.trim(), project_id: projectId, parent_area_id: parentId, aliases: [], sort_order: ctx.structure.areas.length });
  ctx.structure.areas.push({ id: row.id, project_id: projectId, parent_area_id: parentId, name: row.name as string, aliases: [] });
  return row.id;
}

export async function ensureOrganisation(ctx: ToolContext, name: string | null | undefined): Promise<string | null> {
  if (!name) return null;
  const existing = findOrganisation(ctx.structure, name);
  if (existing) return existing.id;
  const row = await insert(ctx, "organisations", { name: name.trim(), aliases: [] });
  ctx.structure.organisations.push({ id: row.id, name: row.name as string, aliases: [] });
  return row.id;
}

export async function ensurePerson(ctx: ToolContext, name: string | null | undefined, organisation?: string | null, role?: string | null): Promise<{ id: string | null; ambiguous: string[] }> {
  if (!name) return { id: null, ambiguous: [] };
  const found = findPerson(ctx.structure, name);
  if (found.person) return { id: found.person.id, ambiguous: [] };
  if (found.ambiguous.length) return { id: null, ambiguous: found.ambiguous.map((p) => p.name) };
  const orgId = await ensureOrganisation(ctx, organisation);
  const row = await insert(ctx, "people", { name: name.trim(), organisation_id: orgId, role: role ?? null, aliases: [] });
  ctx.structure.people.push({ id: row.id, name: row.name as string, aliases: [], organisation_id: orgId, role: role ?? null });
  return { id: row.id, ambiguous: [] };
}

function pending(name: string, args: Record<string, unknown>, description: string, reason: PendingAction["reason"]): ToolOutcome {
  return { ok: true, requires_confirmation: { id: crypto.randomUUID(), name, args, description, reason } };
}

// ---------- task creation shared by parse/commit and chat ----------
export interface CreateTaskInput {
  type?: string | null;
  title: string;
  description?: string | null;
  workspace?: string | null;
  project?: string | null;
  area?: string | null;
  subarea?: string | null;
  workspace_id?: string | null;
  project_id?: string | null;
  area_id?: string | null;
  subarea_id?: string | null;
  priority?: number | null;
  due_at?: string | null;
  reminder_at?: string | null;
  follow_up_at?: string | null;
  event_start_at?: string | null;
  event_end_at?: string | null;
  recurrence_rule?: string | null;
  person?: string | null;
  person_id?: string | null;
  organisation?: string | null;
  organisation_id?: string | null;
  waiting_for?: string | null;
  waiting_for_person_id?: string | null;
  waiting_subject?: string | null;
  tags?: string[] | null;
  source_id?: string | null;
  original_transcript?: string | null;
  clean_transcript?: string | null;
  ai_confidence?: number | null;
  status?: string | null;
}

export async function createTaskRecord(ctx: ToolContext, input: CreateTaskInput): Promise<Record<string, unknown>> {
  const type = input.type && ["task", "reminder", "event", "waiting", "note"].includes(input.type) ? input.type : "task";
  const projectId = input.project_id ?? (await ensureProject(ctx, input.project, input.workspace));
  const workspaceId = input.workspace_id ?? (projectId ? ctx.structure.projects.find((p) => p.id === projectId)?.workspace_id ?? null : await ensureWorkspace(ctx, input.workspace));
  const areaId = input.area_id ?? (await ensureArea(ctx, projectId, input.area));
  const subareaId = input.subarea_id ?? (await ensureArea(ctx, projectId, input.subarea, areaId));
  const orgId = input.organisation_id ?? (await ensureOrganisation(ctx, input.organisation));
  const person = input.person_id ? { id: input.person_id, ambiguous: [] as string[] } : await ensurePerson(ctx, input.person, input.organisation);
  const waiting = input.waiting_for_person_id ? { id: input.waiting_for_person_id, ambiguous: [] as string[] } : await ensurePerson(ctx, input.waiting_for, input.organisation);
  const isWaiting = type === "waiting" || !!input.waiting_for || !!input.waiting_for_person_id;
  const status = statusId(ctx, input.status ?? (isWaiting ? "waiting" : type === "note" ? "inbox" : "todo"));
  const priority = input.priority && input.priority >= 1 && input.priority <= 4 ? input.priority : ctx.prefs.default_priority;

  const row = await insert(ctx, "tasks", {
    kind: type,
    title: input.title.trim().slice(0, 200),
    description: input.description ?? null,
    status_id: status,
    priority,
    start_at: input.event_start_at ?? null,
    due_at: input.due_at ?? null,
    reminder_at: input.reminder_at ?? null,
    follow_up_at: input.follow_up_at ?? null,
    event_end_at: input.event_end_at ?? null,
    recurrence_rule: input.recurrence_rule ?? null,
    workspace_id: workspaceId,
    project_id: projectId,
    area_id: subareaId ?? areaId,
    source_id: input.source_id ?? null,
    original_transcript: input.original_transcript ?? null,
    clean_transcript: input.clean_transcript ?? null,
    ai_confidence: input.ai_confidence ?? null,
    is_waiting: isWaiting,
    waiting_for_person_id: waiting.id,
    waiting_subject: input.waiting_subject ?? null,
    person_id: person.id,
    organisation_id: orgId,
    tags: input.tags ?? [],
  });
  if (input.reminder_at) {
    await insert(ctx, "reminders", { task_id: row.id, fire_at: input.reminder_at, repeat_rule: input.recurrence_rule, kind: "reminder" });
  }
  if (input.follow_up_at) {
    await insert(ctx, "reminders", { task_id: row.id, fire_at: input.follow_up_at, repeat_rule: null, kind: "follow_up" });
  }
  ctx.onTaskChanged?.(row.id as string);
  return { ...row, person_ambiguous: person.ambiguous, waiting_ambiguous: waiting.ambiguous };
}

export async function applyResolvedItems(ctx: ToolContext, items: ResolvedItem[], source: { voice_entry_id?: string | null; original_transcript?: string | null; clean_transcript?: string | null }): Promise<Record<string, unknown>[]> {
  const created: Record<string, unknown>[] = [];
  for (const item of items) {
    if (item.type === "note" && !item.title) continue;
    const task = await createTaskRecord(ctx, {
      ...item,
      // if the user left a low-confidence item unresolved it goes to Inbox
      status: item.needs_disambiguation && !item.project_id ? "inbox" : item.type === "waiting" ? "waiting" : item.type === "note" ? "inbox" : "todo",
      source_id: source.voice_entry_id ?? null,
      original_transcript: item.source_quote ?? source.original_transcript ?? null,
      clean_transcript: source.clean_transcript ?? null,
      ai_confidence: item.confidence,
    });
    created.push(task);
  }
  return created;
}

// ---------- queries ----------
async function queryTasks(ctx: ToolContext, args: Record<string, unknown>, semanticSearch?: (q: string, limit: number) => Promise<string[]>): Promise<Record<string, unknown>[]> {
  const limit = Math.min(int(args.limit) ?? 50, 200);
  let q = ctx.supabase
    .from("tasks")
    .select("id,kind,title,description,priority,due_at,reminder_at,follow_up_at,start_at,is_waiting,waiting_subject,tags,created_at,completed_at,project:projects(name),area:areas(name),status:status_columns(name,kind),waiting_for:people!tasks_waiting_for_person_id_fkey(name),person:people!tasks_person_id_fkey(name)")
    .eq("user_id", ctx.userId)
    .is("deleted_at", null)
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("priority", { ascending: true })
    .limit(limit);

  const status = str(args.status);
  const doneId = ctx.structure.statuses.find((s) => s.kind === "done")?.id;
  if (status && status !== "open") {
    const id = statusId(ctx, status, "");
    if (id) q = q.eq("status_id", id);
  } else if (doneId) q = q.neq("status_id", doneId);

  const project = findProject(ctx.structure, str(args.project), ctx.prefs);
  if (project) q = q.eq("project_id", project.id);
  const area = project ? findArea(ctx.structure, project.id, str(args.area), ctx.prefs) : null;
  if (area) q = q.eq("area_id", area.id);
  const person = findPerson(ctx.structure, str(args.person)).person;
  if (person) q = q.or(`person_id.eq.${person.id},waiting_for_person_id.eq.${person.id}`);
  const tag = str(args.tag);
  if (tag) q = q.contains("tags", [tag]);
  const pmax = int(args.priority_max);
  if (pmax) q = q.lte("priority", pmax);

  const due = str(args.due);
  const today0 = startOfLocalDay(ctx.now, ctx.tz).toISOString();
  const tomorrow0 = startOfLocalDay(ctx.now, ctx.tz, 1).toISOString();
  const dayAfter0 = startOfLocalDay(ctx.now, ctx.tz, 2).toISOString();
  if (due === "today") q = q.gte("due_at", today0).lt("due_at", tomorrow0);
  else if (due === "tomorrow") q = q.gte("due_at", tomorrow0).lt("due_at", dayAfter0);
  else if (due === "this_week") q = q.gte("due_at", today0).lt("due_at", startOfLocalDay(ctx.now, ctx.tz, 7).toISOString());
  else if (due === "next_week") q = q.gte("due_at", startOfLocalDay(ctx.now, ctx.tz, 7).toISOString()).lt("due_at", startOfLocalDay(ctx.now, ctx.tz, 14).toISOString());
  else if (due === "overdue") q = q.lt("due_at", ctx.now.toISOString());
  else if (due === "no_date") q = q.is("due_at", null);

  const text = str(args.query);
  if (text && args.semantic === true && semanticSearch) {
    const ids = await semanticSearch(text, limit);
    if (!ids.length) return [];
    q = q.in("id", ids);
  } else if (text) {
    const like = `%${text.replace(/[%_]/g, " ")}%`;
    q = q.or(`title.ilike.${like},description.ilike.${like},clean_transcript.ilike.${like},original_transcript.ilike.${like}`);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((t: Record<string, any>) => ({
    id: t.id,
    kind: t.kind,
    title: t.title,
    priority: t.priority,
    due_at: t.due_at,
    due_human: describeISO(t.due_at, ctx.tz),
    reminder_at: t.reminder_at,
    follow_up_at: t.follow_up_at,
    status: t.status?.name,
    status_kind: t.status?.kind,
    project: t.project?.name,
    area: t.area?.name,
    is_waiting: t.is_waiting,
    waiting_for: t.waiting_for?.name,
    waiting_subject: t.waiting_subject,
    person: t.person?.name,
    tags: t.tags,
    created_at: t.created_at,
  }));
}

// ---------- executor ----------
export async function executeTool(
  name: string,
  rawArgs: Record<string, unknown>,
  ctx: ToolContext,
  semanticSearch?: (q: string, limit: number) => Promise<string[]>,
): Promise<ToolOutcome> {
  const args = rawArgs ?? {};
  try {
    switch (name) {
      case "list_tasks":
      case "search_tasks": {
        const tasks = await queryTasks(ctx, args, semanticSearch);
        return { ok: true, result: { count: tasks.length, tasks } };
      }
      case "get_task": {
        const id = str(args.task_id);
        if (!id) return { ok: false, error: "task_id required" };
        const { data, error } = await ctx.supabase.from("tasks").select("*,project:projects(name),area:areas(name),status:status_columns(name,kind)").eq("id", id).eq("user_id", ctx.userId).maybeSingle();
        if (error || !data) return { ok: false, error: "not found" };
        return { ok: true, result: data };
      }
      case "create_task":
      case "create_calendar_event": {
        const title = str(args.title);
        if (!title) return { ok: false, error: "title required" };
        const type = name === "create_calendar_event" ? "event" : str(args.type) ?? "task";
        const opts = { now: ctx.now, prefs: ctx.prefs };
        const due_at = resolveSemanticDate(sdate(args.due), { ...opts, role: "due" });
        const reminder_at = resolveSemanticDate(sdate(args.reminder), { ...opts, role: "reminder" });
        let event_start_at = resolveSemanticDate(sdate(args.event_start ?? args.start), { ...opts, role: "event" });
        let event_end_at = resolveSemanticDate(sdate(args.event_end ?? args.end), { ...opts, role: "event" });
        if (type === "event" && !event_start_at) return { ok: false, error: "event_start required for events" };
        if (event_start_at && !event_end_at) event_end_at = shiftISO(event_start_at, 3600_000, ctx.tz);
        const follow_up_at = resolveSemanticDate(sdate(args.follow_up), { ...opts, role: "follow_up" });
        const waiting_for = str(args.waiting_for);
        const description = `${type === "event" ? "Событие" : type === "waiting" ? "Ожидание" : "Задача"} «${title}»${due_at ? `, срок ${describeISO(due_at, ctx.tz)}` : ""}${event_start_at ? `, ${describeISO(event_start_at, ctx.tz)}` : ""}`;
        if (type === "event" && !ctx.confirmed) return pending(name, args, description, "calendar");
        const task = await createTaskRecord(ctx, {
          type,
          title,
          description: str(args.description),
          project: str(args.project),
          area: str(args.area),
          workspace: str(args.workspace),
          priority: int(args.priority),
          due_at: due_at ?? (type === "event" ? event_start_at : null),
          reminder_at,
          follow_up_at: follow_up_at ?? (waiting_for ? due_at : null),
          event_start_at,
          event_end_at,
          recurrence_rule: toRecurrenceRule(recur(args.recurrence)),
          person: str(args.person),
          organisation: str(args.organisation),
          waiting_for,
          waiting_subject: str(args.waiting_subject),
          tags: Array.isArray(args.tags) ? (args.tags.filter((t) => typeof t === "string") as string[]) : [],
        });
        return { ok: true, result: { task_id: task.id, title: task.title, due_at: task.due_at, due_human: describeISO(task.due_at as string, ctx.tz), reminder_at: task.reminder_at, status: "created", person_ambiguous: task.person_ambiguous, waiting_ambiguous: task.waiting_ambiguous } };
      }
      case "update_task": {
        const id = str(args.task_id);
        if (!id) return { ok: false, error: "task_id required" };
        const patch: Record<string, unknown> = {};
        if (str(args.title)) patch.title = str(args.title);
        if (args.description !== undefined && args.description !== null) patch.description = String(args.description);
        const pr = int(args.priority);
        if (pr && pr >= 1 && pr <= 4) patch.priority = pr;
        const due = sdate(args.due);
        if (due) patch.due_at = resolveSemanticDate(due, { now: ctx.now, prefs: ctx.prefs, role: "due" });
        if (args.clear_due === true) patch.due_at = null;
        const rem = sdate(args.reminder);
        if (rem) patch.reminder_at = resolveSemanticDate(rem, { now: ctx.now, prefs: ctx.prefs, role: "reminder" });
        if (str(args.project)) {
          const pid = await ensureProject(ctx, str(args.project));
          patch.project_id = pid;
          patch.area_id = await ensureArea(ctx, pid, str(args.area));
        } else if (str(args.area)) {
          const { data: cur } = await ctx.supabase.from("tasks").select("project_id").eq("id", id).single();
          patch.area_id = await ensureArea(ctx, cur?.project_id ?? null, str(args.area));
        }
        if (Array.isArray(args.tags)) patch.tags = args.tags.filter((t) => typeof t === "string");
        if (!Object.keys(patch).length) return { ok: false, error: "nothing to update" };
        const task = await update(ctx, "tasks", id, patch);
        if (patch.reminder_at) await insert(ctx, "reminders", { task_id: id, fire_at: patch.reminder_at, kind: "reminder" });
        return { ok: true, result: { task_id: id, title: task.title, due_at: task.due_at, due_human: describeISO(task.due_at as string, ctx.tz), updated_fields: Object.keys(patch) } };
      }
      case "complete_task": {
        const id = str(args.task_id);
        if (!id) return { ok: false, error: "task_id required" };
        const doneId = statusId(ctx, "done");
        const task = await update(ctx, "tasks", id, { status_id: doneId, completed_at: new Date().toISOString(), is_waiting: false });
        return { ok: true, result: { task_id: id, title: task.title, status: "done" } };
      }
      case "move_task": {
        const id = str(args.task_id);
        if (!id) return { ok: false, error: "task_id required" };
        const patch: Record<string, unknown> = {};
        if (str(args.status)) {
          const sid = statusId(ctx, str(args.status), "");
          if (!sid) return { ok: false, error: `unknown status ${args.status}` };
          patch.status_id = sid;
          const kind = ctx.structure.statuses.find((s) => s.id === sid)?.kind;
          if (kind === "done") patch.completed_at = new Date().toISOString();
          if (kind === "waiting") patch.is_waiting = true;
        }
        if (str(args.project)) {
          const pid = await ensureProject(ctx, str(args.project));
          patch.project_id = pid;
          patch.area_id = await ensureArea(ctx, pid, str(args.area));
        }
        if (!Object.keys(patch).length) return { ok: false, error: "nothing to move" };
        const task = await update(ctx, "tasks", id, patch);
        return { ok: true, result: { task_id: id, title: task.title, moved: Object.keys(patch) } };
      }
      case "delete_task": {
        const id = str(args.task_id);
        if (!id) return { ok: false, error: "task_id required" };
        const { data } = await ctx.supabase.from("tasks").select("title").eq("id", id).eq("user_id", ctx.userId).maybeSingle();
        if (!data) return { ok: false, error: "not found" };
        if (!ctx.confirmed) return pending(name, args, `Удалить задачу «${data.title}»`, "delete");
        await update(ctx, "tasks", id, { deleted_at: new Date().toISOString() });
        return { ok: true, result: { task_id: id, deleted: true } };
      }
      case "reschedule_tasks": {
        const ids = Array.isArray(args.task_ids) ? (args.task_ids.filter((x) => typeof x === "string") as string[]) : [];
        const newDue = sdate(args.new_due);
        if (!ids.length || !newDue) return { ok: false, error: "task_ids and new_due required" };
        const target = resolveSemanticDate(newDue, { now: ctx.now, prefs: ctx.prefs, role: "due" });
        if (!target) return { ok: false, error: "cannot resolve new_due" };
        if (!ctx.confirmed) return pending(name, args, `Перенести ${ids.length} задач(и) на ${describeISO(target, ctx.tz)}`, "bulk");
        const moved: string[] = [];
        for (const id of ids) {
          let due = target;
          if (args.keep_time === true) {
            const { data: cur } = await ctx.supabase.from("tasks").select("due_at").eq("id", id).single();
            if (cur?.due_at) {
              const old = new Date(cur.due_at), n = new Date(target);
              const dayStart = startOfLocalDay(n, ctx.tz);
              const oldDayStart = startOfLocalDay(old, ctx.tz);
              due = shiftISO(dayStart.toISOString(), old.getTime() - oldDayStart.getTime(), ctx.tz);
            }
          }
          await update(ctx, "tasks", id, { due_at: due });
          moved.push(id);
        }
        return { ok: true, result: { moved_count: moved.length, new_due: target, new_due_human: describeISO(target, ctx.tz), batch_id: ctx.batch.id } };
      }
      case "create_reminder": {
        const id = str(args.task_id);
        if (!id) return { ok: false, error: "task_id required" };
        let at = resolveSemanticDate(sdate(args.at), { now: ctx.now, prefs: ctx.prefs, role: "reminder" });
        const before = parseDuration(str(args.before_due));
        if (!at && before) {
          const { data: cur } = await ctx.supabase.from("tasks").select("due_at").eq("id", id).single();
          if (cur?.due_at) at = shiftISO(cur.due_at, -before, ctx.tz);
        }
        if (!at) return { ok: false, error: "cannot resolve reminder time" };
        const rule = toRecurrenceRule(recur(args.recurrence));
        await insert(ctx, "reminders", { task_id: id, fire_at: at, repeat_rule: rule, kind: "reminder" });
        await update(ctx, "tasks", id, { reminder_at: at, ...(rule ? { recurrence_rule: rule } : {}) });
        return { ok: true, result: { task_id: id, reminder_at: at, reminder_human: describeISO(at, ctx.tz), recurrence_rule: rule } };
      }
      case "create_project": {
        const n = str(args.name);
        if (!n) return { ok: false, error: "name required" };
        const id = await ensureProject(ctx, n, str(args.workspace), Array.isArray(args.aliases) ? (args.aliases as string[]) : []);
        return { ok: true, result: { project_id: id, name: n } };
      }
      case "create_area": {
        const pid = await ensureProject(ctx, str(args.project));
        const parent = str(args.parent_area) ? await ensureArea(ctx, pid, str(args.parent_area)) : null;
        const id = await ensureArea(ctx, pid, str(args.name), parent);
        return { ok: true, result: { area_id: id, project_id: pid } };
      }
      case "create_person": {
        const p = await ensurePerson(ctx, str(args.name), str(args.organisation), str(args.role));
        return { ok: true, result: { person_id: p.id, ambiguous: p.ambiguous } };
      }
      case "list_unanswered_emails": {
        const days = int(args.days) ?? 30;
        let q = ctx.supabase.from("mail_messages").select("id,subject,from_name,from_email,received_at,snippet,ai_reason,ai_priority,ai_suggested_action,web_link,account:mail_accounts(email)")
          .eq("user_id", ctx.userId).eq("needs_reply", true).eq("reply_status", "pending").gte("received_at", new Date(ctx.now.getTime() - days * 86400_000).toISOString())
          .order("ai_priority", { ascending: true }).order("received_at", { ascending: false }).limit(Math.min(int(args.limit) ?? 30, 100));
        const from = str(args.from);
        if (from) q = q.or(`from_name.ilike.%${from}%,from_email.ilike.%${from}%`);
        const { data, error } = await q;
        if (error) return { ok: false, error: error.message };
        return { ok: true, result: { count: data?.length ?? 0, emails: (data ?? []).map((m: Record<string, any>) => ({ ...m, received_human: describeISO(m.received_at, ctx.tz), waiting_days: Math.floor((ctx.now.getTime() - new Date(m.received_at).getTime()) / 86400_000) })) } };
      }
      case "search_emails": {
        const text = str(args.query);
        if (!text) return { ok: false, error: "query required" };
        const days = int(args.days) ?? 90;
        const like = `%${text.replace(/[%_]/g, " ")}%`;
        const { data, error } = await ctx.supabase.from("mail_messages").select("id,subject,from_name,from_email,received_at,snippet,is_from_me,needs_reply,reply_status,web_link")
          .eq("user_id", ctx.userId).gte("received_at", new Date(ctx.now.getTime() - days * 86400_000).toISOString())
          .or(`subject.ilike.${like},snippet.ilike.${like},from_name.ilike.${like},from_email.ilike.${like},body_text.ilike.${like}`)
          .order("received_at", { ascending: false }).limit(Math.min(int(args.limit) ?? 20, 50));
        if (error) return { ok: false, error: error.message };
        return { ok: true, result: { count: data?.length ?? 0, emails: (data ?? []).map((m: Record<string, any>) => ({ ...m, received_human: describeISO(m.received_at, ctx.tz) })) } };
      }
      case "mark_email_handled": {
        const id = str(args.email_id);
        const status = str(args.status);
        if (!id || !status || !["replied", "dismissed", "task_created"].includes(status)) return { ok: false, error: "email_id and valid status required" };
        const { data: mail } = await ctx.supabase.from("mail_messages").select("id,subject,from_name,from_email,web_link,ai_suggested_action").eq("id", id).eq("user_id", ctx.userId).maybeSingle();
        if (!mail) return { ok: false, error: "email not found" };
        let taskId: string | null = null;
        if (status === "task_created") {
          const task = await createTaskRecord(ctx, {
            title: str(args.task_title) ?? `Ответить: ${mail.subject ?? mail.from_name ?? mail.from_email}`,
            description: [`Письмо от ${mail.from_name ?? ""} <${mail.from_email}>`, mail.ai_suggested_action, mail.web_link].filter(Boolean).join("\n"),
            due_at: resolveSemanticDate(sdate(args.due), { now: ctx.now, prefs: ctx.prefs, role: "due" }),
            person: mail.from_name,
            tags: ["email"],
          });
          taskId = task.id as string;
        }
        await update(ctx, "mail_messages", id, { reply_status: status, needs_reply: false, linked_task_id: taskId });
        return { ok: true, result: { email_id: id, status, task_id: taskId } };
      }
      default:
        return { ok: false, error: `unknown tool ${name}` };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------- undo persistence ----------
export async function saveBatch(ctx: ToolContext): Promise<void> {
  if (!ctx.batch.entries.length) return;
  await ctx.supabase.from("action_batches").insert({
    id: ctx.batch.id,
    user_id: ctx.userId,
    description: ctx.batch.description,
    undo_payload: ctx.batch.entries,
  });
}

export async function undoBatch(supabase: SupabaseClient, userId: string, batchId: string): Promise<{ undone: number }> {
  const { data, error } = await supabase.from("action_batches").select("*").eq("id", batchId).eq("user_id", userId).maybeSingle();
  if (error || !data) throw new Error("batch not found");
  if (data.undone_at) return { undone: 0 };
  const entries = (data.undo_payload ?? []) as UndoEntry[];
  let undone = 0;
  for (const e of [...entries].reverse()) {
    if (e.op === "insert") {
      // Soft delete tasks (keeps history), hard delete auxiliary rows.
      if (e.table === "tasks") await supabase.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("id", e.id);
      else await supabase.from(e.table).delete().eq("id", e.id);
      undone++;
    } else if (e.op === "update" && e.before) {
      await supabase.from(e.table).update({ ...e.before, updated_at: new Date().toISOString() }).eq("id", e.id);
      undone++;
    }
  }
  await supabase.from("action_batches").update({ undone_at: new Date().toISOString() }).eq("id", batchId);
  return { undone };
}
