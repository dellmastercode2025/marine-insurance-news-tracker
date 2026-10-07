// Post-processing of the model output: validates every field programmatically, resolves semantic
// dates against the user's timezone and preferences, maps names to ids, decides auto-filing.
import type { ExtractedItem, ParseModelOutput, Preferences, ResolvedItem } from "./types.ts";
import type { UserStructure } from "./context.ts";
import { parseDuration, resolveSemanticDate, shiftISO, toRecurrenceRule } from "./dateService.ts";
import { decideAutoFile, findOrganisation, findPerson, resolveCategory } from "./matching.ts";

const URGENT_WORDS = /срочно|критично|обязательно сегодня|до заседания|asap|urgent|critical|немедленно|шұғыл/i;
const HIGH_WORDS = /важно|не забыть|обязательно|important|don't forget|маңызды/i;
const LOW_WORDS = /когда-нибудь|если будет время|не срочно|someday|low priority/i;

export function sanitizePriority(item: ExtractedItem, prefs: Preferences): 1 | 2 | 3 | 4 {
  const text = `${item.title} ${item.source_quote ?? ""} ${item.description ?? ""}`;
  let p = item.priority && item.priority >= 1 && item.priority <= 4 ? item.priority : prefs.default_priority;
  // P1 only with textual evidence (rule 10 of the spec: never baseless P1).
  if (p === 1 && !URGENT_WORDS.test(text) && !(item.priority_reason && item.priority_reason.length > 3)) p = 2;
  if (p >= 3 && URGENT_WORDS.test(text)) p = 1;
  else if (p > 2 && HIGH_WORDS.test(text)) p = 2;
  if (LOW_WORDS.test(text) && p > 2) p = 4;
  return p as 1 | 2 | 3 | 4;
}

function uid(): string {
  return crypto.randomUUID();
}

export interface ResolveInput {
  output: ParseModelOutput;
  structure: UserStructure;
  prefs: Preferences;
  now: Date;
}

export function resolveItems({ output, structure, prefs, now }: ResolveInput): ResolvedItem[] {
  const seen = new Set<string>();
  const result: ResolvedItem[] = [];
  for (const raw of output.items ?? []) {
    if (!raw || typeof raw.title !== "string" || !raw.title.trim()) continue;
    const item: ExtractedItem = {
      ...raw,
      title: raw.title.trim().slice(0, 140),
      type: (["task", "reminder", "event", "waiting", "note"] as const).includes(raw.type) ? raw.type : "task",
      confidence: typeof raw.confidence === "number" ? Math.max(0, Math.min(1, raw.confidence)) : 0.5,
      tags: Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === "string").slice(0, 10) : [],
    };
    const warnings: string[] = [];
    const dedupeKey = `${item.type}|${item.title.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue; // duplicates inside one message
    seen.add(dedupeKey);

    const cat = resolveCategory(structure, prefs, item);
    const person = findPerson(structure, item.person);
    const waiting = findPerson(structure, item.waiting_for);
    const org = findOrganisation(structure, item.organisation);
    if (person.ambiguous.length) warnings.push(`Несколько контактов с именем «${item.person}»: ${person.ambiguous.map((p) => p.name).join(", ")}`);
    if (waiting.ambiguous.length) warnings.push(`Несколько контактов с именем «${item.waiting_for}»`);

    const tz = prefs.timezone;
    let due_at = resolveSemanticDate(item.due, { now, prefs, role: "due" });
    let reminder_at = resolveSemanticDate(item.reminder, { now, prefs, role: "reminder" });
    const follow_up_at = resolveSemanticDate(item.follow_up, { now, prefs, role: "follow_up" }) ?? (item.type === "waiting" ? due_at : null);
    let event_start_at = resolveSemanticDate(item.event_start, { now, prefs, role: "event" });
    let event_end_at = resolveSemanticDate(item.event_end, { now, prefs, role: "event" });
    if (item.type === "event" && !event_start_at && due_at) event_start_at = due_at;
    if (event_start_at && !event_end_at) event_end_at = shiftISO(event_start_at, 3600_000, tz);
    if (event_start_at && event_end_at && new Date(event_end_at) <= new Date(event_start_at)) event_end_at = shiftISO(event_start_at, 3600_000, tz);
    if (item.type === "event" && !due_at && event_start_at) due_at = event_start_at;
    if (item.type === "reminder" && !reminder_at && due_at) {
      reminder_at = due_at;
      due_at = null;
    }
    const before = parseDuration(item.reminder_before_due);
    if (!reminder_at && before && due_at) reminder_at = shiftISO(due_at, -before, tz);
    if (item.due && !due_at) warnings.push(`Не удалось распознать срок «${item.due.text ?? item.due.day ?? ""}»`);
    if (item.reminder && !reminder_at) warnings.push(`Не удалось распознать время напоминания «${item.reminder.text ?? ""}»`);
    if (reminder_at && new Date(reminder_at) < now) warnings.push("Напоминание в прошлом");

    const auto = decideAutoFile(item, cat, prefs, structure);
    if (!cat.matched && item.type !== "note") warnings.push(`Новый проект «${cat.project_name ?? "?"}» будет создан`);

    result.push({
      ...item,
      client_id: uid(),
      priority: sanitizePriority(item, prefs),
      workspace: cat.workspace_name,
      project: cat.project_name,
      area: cat.area_name,
      subarea: cat.subarea_name,
      workspace_id: cat.workspace_id,
      project_id: cat.project_id,
      area_id: cat.area_id,
      subarea_id: cat.subarea_id,
      person_id: person.person?.id ?? null,
      waiting_for_person_id: waiting.person?.id ?? null,
      organisation_id: org?.id ?? null,
      due_at,
      reminder_at,
      follow_up_at,
      event_start_at,
      event_end_at,
      recurrence_rule: toRecurrenceRule(item.recurrence),
      ...auto,
      warnings,
    });
  }
  return result;
}
