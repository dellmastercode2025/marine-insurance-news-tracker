// Shared domain types used by the Edge Functions and (mirrored) by the iOS client DTOs.
// Keep this file free of Deno/Node specific APIs so it can be unit-tested anywhere.

export type ItemType = "task" | "reminder" | "event" | "waiting" | "note";
export type Priority = 1 | 2 | 3 | 4; // P1 critical … P4 low
export type TimeOfDay = "morning" | "day" | "evening" | "night";

/**
 * A *semantic* date as returned by the language model. The model never produces an absolute
 * timestamp on its own – the DateService turns this into a concrete ISO date in the user's timezone.
 *
 *  day:
 *    "today" | "tomorrow" | "day_after_tomorrow" | "yesterday"
 *    "weekday:mon".."weekday:sun"          nearest occurrence (today included)
 *    "next_weekday:mon".."next_weekday:sun" occurrence in the *next* calendar week
 *    "this_week" | "end_of_week" | "next_week" | "end_of_month" | "next_month"
 *    "in_days:N" | "in_weeks:N" | "in_hours:N" | "in_minutes:N"
 *    "date:YYYY-MM-DD"
 *  time:
 *    "morning" | "day" | "evening" | "night" | "HH:mm"
 */
export interface SemanticDate {
  day?: string | null;
  time?: string | null;
  text?: string | null; // the original phrase, for display/debugging
}

export interface SemanticRecurrence {
  freq: "hourly" | "daily" | "weekly" | "monthly" | "yearly";
  interval?: number;
  by_weekday?: Array<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun">;
  until_done?: boolean; // "every hour until I mark it done"
  text?: string | null;
}

/** Raw model output for a single actionable item. */
export interface ExtractedItem {
  type: ItemType;
  title: string;
  description?: string | null;
  workspace?: string | null;
  project?: string | null;
  area?: string | null;
  subarea?: string | null;
  priority?: Priority | null;
  priority_reason?: string | null;
  due?: SemanticDate | null;
  reminder?: SemanticDate | null;
  reminder_before_due?: string | null; // e.g. "1d", "2h"
  recurrence?: SemanticRecurrence | null;
  event_start?: SemanticDate | null;
  event_end?: SemanticDate | null;
  person?: string | null;
  organisation?: string | null;
  waiting_for?: string | null;
  waiting_subject?: string | null;
  follow_up?: SemanticDate | null;
  tags?: string[] | null;
  confidence: number;
  alternatives?: Array<{ project?: string | null; area?: string | null; reason?: string | null }> | null;
  source_quote?: string | null;
}

export interface ParseModelOutput {
  language: string;
  summary: string;
  items: ExtractedItem[];
}

/** Item after programmatic validation: absolute dates, resolved IDs, auto-file decision. */
export interface ResolvedItem extends ExtractedItem {
  client_id: string; // stable id for the review screen
  due_at?: string | null;
  reminder_at?: string | null;
  follow_up_at?: string | null;
  event_start_at?: string | null;
  event_end_at?: string | null;
  recurrence_rule?: string | null;
  workspace_id?: string | null;
  project_id?: string | null;
  area_id?: string | null;
  subarea_id?: string | null;
  person_id?: string | null;
  organisation_id?: string | null;
  waiting_for_person_id?: string | null;
  auto_file: boolean; // confidence ≥ threshold and unambiguous
  needs_disambiguation: boolean;
  disambiguation_options?: Array<{ project?: string | null; project_id?: string | null; area?: string | null; area_id?: string | null }>;
  warnings?: string[];
}

export interface ParseResponse {
  voice_entry_id?: string | null;
  language: string;
  summary: string;
  items: ResolvedItem[];
  needs_review: boolean;
}

export interface Preferences {
  timezone: string;
  morning: string; // "09:00"
  day: string; // "14:00"
  evening: string; // "19:00"
  night: string; // "22:00"
  end_of_day: string; // default due time when only a day is given, "18:00"
  default_priority: Priority;
  auto_file_threshold: number; // 0..1
  aliases: Record<string, string>; // "KMTF" -> "Казмортрансфлот"
  routing_rules: Record<string, string>; // "риски" -> "Казмортрансфлот/Управление рисками"
  delete_audio_after_transcription: boolean;
  private_mode: boolean;
  apple_reminders_sync: "off" | "important" | "with_reminder" | "all";
  language: string; // "ru"
}

export const DEFAULT_PREFERENCES: Preferences = {
  timezone: "Asia/Almaty",
  morning: "09:00",
  day: "14:00",
  evening: "19:00",
  night: "22:00",
  end_of_day: "18:00",
  default_priority: 3,
  auto_file_threshold: 0.85,
  aliases: {},
  routing_rules: {},
  delete_audio_after_transcription: true,
  private_mode: false,
  apple_reminders_sync: "off",
  language: "ru",
};

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface PendingAction extends ToolCall {
  id: string;
  description: string; // human readable, in the user's language
  reason: "bulk" | "delete" | "calendar" | "ambiguous" | "project_delete";
}
