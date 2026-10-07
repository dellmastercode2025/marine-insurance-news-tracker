// DateService: converts model-produced *semantic* dates into absolute timestamps in the
// user's timezone. Pure functions – no I/O – so they are unit-tested in /backend/tests.
import type { Preferences, SemanticDate, SemanticRecurrence } from "./types.ts";

export interface LocalParts {
  y: number;
  m: number; // 1-12
  d: number;
  h: number;
  min: number;
  weekday: number; // 0 = Sunday … 6 = Saturday
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function dtf(tz: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function localParts(date: Date, tz: string): LocalParts {
  const parts: Record<string, string> = {};
  for (const p of dtf(tz).formatToParts(date)) parts[p.type] = p.value;
  const weekdayNames: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    y: +parts.year,
    m: +parts.month,
    d: +parts.day,
    h: +parts.hour === 24 ? 0 : +parts.hour,
    min: +parts.minute,
    weekday: weekdayNames[parts.weekday] ?? 0,
  };
}

/** Offset of `tz` relative to UTC at the given instant, in minutes (e.g. +300 for Almaty). */
export function tzOffsetMinutes(instant: Date, tz: string): number {
  const p = localParts(instant, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, instant.getUTCSeconds());
  const truncated = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((asUtc - truncated) / 60000);
}

/** Build an instant from wall-clock values in `tz`. Handles DST transitions by double-checking the offset. */
export function zonedToUtc(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, min, 0);
  const off1 = tzOffsetMinutes(new Date(guess), tz);
  let utc = guess - off1 * 60000;
  const off2 = tzOffsetMinutes(new Date(utc), tz);
  if (off2 !== off1) utc = guess - off2 * 60000;
  return new Date(utc);
}

/** ISO-8601 with the user's offset, e.g. 2026-10-09T18:00:00+05:00 */
export function formatISOInZone(date: Date, tz: string): string {
  const p = localParts(date, tz);
  const off = tzOffsetMinutes(date, tz);
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.min)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function addDays(y: number, m: number, d: number, n: number): [number, number, number] {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function parseTimeOfDay(time: string | null | undefined, prefs: Preferences): [number, number] | null {
  if (!time) return null;
  const named: Record<string, string> = {
    morning: prefs.morning,
    day: prefs.day,
    afternoon: prefs.day,
    evening: prefs.evening,
    night: prefs.night,
    noon: "12:00",
    midnight: "00:00",
  };
  const value = named[time] ?? time;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const h = +m[1], min = +m[2];
  if (h > 23 || min > 59) return null;
  return [h, min];
}

export type DateRole = "due" | "reminder" | "event" | "follow_up";

export interface ResolveOptions {
  now: Date;
  prefs: Preferences;
  role: DateRole;
}

/**
 * Resolve a semantic date. Returns null when nothing usable was provided.
 * Rules (documented in docs/AI_PIPELINE.md):
 *  - a day without a time → due: end_of_day; reminder/follow_up: morning; event: 09:00
 *  - a time without a day → today, or tomorrow if that time already passed
 *  - in_hours / in_minutes ignore the time field
 */
export function resolveSemanticDate(sd: SemanticDate | null | undefined, opts: ResolveOptions): string | null {
  if (!sd || (!sd.day && !sd.time)) return null;
  const tz = isValidTimeZone(opts.prefs.timezone) ? opts.prefs.timezone : "UTC";
  const now = opts.now;
  const today = localParts(now, tz);
  const day = (sd.day ?? "").trim().toLowerCase();

  // Pure relative offsets from "now".
  let rel = /^in_(hours|minutes):(\d+(?:\.\d+)?)$/.exec(day);
  if (rel) {
    const amount = parseFloat(rel[2]);
    const ms = rel[1] === "hours" ? amount * 3600_000 : amount * 60_000;
    const t = new Date(now.getTime() + ms);
    t.setUTCSeconds(0, 0);
    return formatISOInZone(t, tz);
  }

  let [y, m, d] = [today.y, today.m, today.d];
  let hadDay = true;
  let dayExplicit = true;

  if (!day) {
    hadDay = false;
    dayExplicit = false;
  } else if (day === "today") {
    // keep
  } else if (day === "tomorrow") {
    [y, m, d] = addDays(y, m, d, 1);
  } else if (day === "day_after_tomorrow") {
    [y, m, d] = addDays(y, m, d, 2);
  } else if (day === "yesterday") {
    [y, m, d] = addDays(y, m, d, -1);
  } else if ((rel = /^weekday:(\w{3})/.exec(day))) {
    const target = WEEKDAYS.indexOf(rel[1]);
    if (target < 0) return null;
    const delta = (target - today.weekday + 7) % 7; // today counts as 0
    [y, m, d] = addDays(y, m, d, delta);
  } else if ((rel = /^next_weekday:(\w{3})/.exec(day))) {
    const target = WEEKDAYS.indexOf(rel[1]);
    if (target < 0) return null;
    const toNextMonday = ((1 - today.weekday + 7) % 7) || 7;
    const fromMonday = (target - 1 + 7) % 7;
    [y, m, d] = addDays(y, m, d, toNextMonday + fromMonday);
  } else if (day === "next_week") {
    // Deadline semantics: end of next week (Friday).
    const toNextMonday = ((1 - today.weekday + 7) % 7) || 7;
    [y, m, d] = addDays(y, m, d, toNextMonday + 4);
  } else if (day === "this_week" || day === "end_of_week") {
    // Friday if still ahead, otherwise Sunday.
    const toFriday = (5 - today.weekday + 7) % 7;
    const toSunday = (0 - today.weekday + 7) % 7;
    const delta = today.weekday >= 1 && today.weekday <= 5 ? toFriday : toSunday;
    [y, m, d] = addDays(y, m, d, delta);
  } else if (day === "end_of_month") {
    d = lastDayOfMonth(y, m);
  } else if (day === "next_month") {
    [y, m, d] = addDays(y, m, lastDayOfMonth(y, m), 1);
  } else if ((rel = /^in_days:(\d+)$/.exec(day))) {
    [y, m, d] = addDays(y, m, d, +rel[1]);
  } else if ((rel = /^in_weeks:(\d+)$/.exec(day))) {
    [y, m, d] = addDays(y, m, d, 7 * +rel[1]);
  } else if ((rel = /^date:(\d{4})-(\d{2})-(\d{2})$/.exec(day))) {
    y = +rel[1]; m = +rel[2]; d = +rel[3];
    if (m < 1 || m > 12 || d < 1 || d > lastDayOfMonth(y, m)) return null;
  } else if ((rel = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day))) {
    y = +rel[1]; m = +rel[2]; d = +rel[3];
  } else {
    return null; // unknown token: refuse to guess
  }

  let hm = parseTimeOfDay(sd.time, opts.prefs);
  if (!hm) {
    switch (opts.role) {
      case "due":
        hm = parseTimeOfDay(opts.prefs.end_of_day, opts.prefs) ?? [18, 0];
        break;
      case "event":
        hm = [9, 0];
        break;
      default:
        hm = parseTimeOfDay("morning", opts.prefs) ?? [9, 0];
    }
    // A reminder "today" with no time that would already be in the past → one hour from now.
    if (hadDay && day === "today" && opts.role !== "due") {
      const candidate = zonedToUtc(y, m, d, hm[0], hm[1], tz);
      if (candidate.getTime() < now.getTime()) {
        const t = new Date(now.getTime() + 3600_000);
        t.setUTCSeconds(0, 0);
        return formatISOInZone(t, tz);
      }
    }
  }

  let result = zonedToUtc(y, m, d, hm[0], hm[1], tz);
  if (!dayExplicit && result.getTime() < now.getTime()) {
    // "at 19:00" said after 19:00 → tomorrow 19:00
    const [ny, nm, nd] = addDays(y, m, d, 1);
    result = zonedToUtc(ny, nm, nd, hm[0], hm[1], tz);
  }
  return formatISOInZone(result, tz);
}

/** "1d", "2h", "30m", "1w" → milliseconds. */
export function parseDuration(spec: string | null | undefined): number | null {
  if (!spec) return null;
  const m = /^(\d+(?:\.\d+)?)\s*(m|min|h|d|w)$/i.exec(spec.trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  switch (m[2].toLowerCase()) {
    case "m":
    case "min":
      return n * 60_000;
    case "h":
      return n * 3600_000;
    case "d":
      return n * 86_400_000;
    case "w":
      return n * 7 * 86_400_000;
  }
  return null;
}

export function shiftISO(iso: string, deltaMs: number, tz: string): string {
  return formatISOInZone(new Date(new Date(iso).getTime() + deltaMs), tz);
}

/** Convert a semantic recurrence to a compact RRULE-like string stored on the task. */
export function toRecurrenceRule(r: SemanticRecurrence | null | undefined): string | null {
  if (!r || !r.freq) return null;
  const parts = [`FREQ=${r.freq.toUpperCase()}`];
  if (r.interval && r.interval > 1) parts.push(`INTERVAL=${Math.floor(r.interval)}`);
  if (r.by_weekday?.length) parts.push(`BYDAY=${r.by_weekday.map((w) => w.slice(0, 2).toUpperCase()).join(",")}`);
  if (r.until_done) parts.push("UNTILDONE=1");
  return parts.join(";");
}

/** Human readable absolute date for confirmations, always absolute (never "tomorrow"). */
export function describeISO(iso: string | null | undefined, tz: string, locale = "ru-RU"): string {
  if (!iso) return "";
  const d = new Date(iso);
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function startOfLocalDay(now: Date, tz: string, offsetDays = 0): Date {
  const p = localParts(now, tz);
  const [y, m, d] = addDays(p.y, p.m, p.d, offsetDays);
  return zonedToUtc(y, m, d, 0, 0, tz);
}
