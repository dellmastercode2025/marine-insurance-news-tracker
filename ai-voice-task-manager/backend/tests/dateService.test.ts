import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSemanticDate, toRecurrenceRule, parseDuration, formatISOInZone, zonedToUtc } from "../supabase/functions/_shared/dateService.ts";
import { DEFAULT_PREFERENCES } from "../supabase/functions/_shared/types.ts";

// Wednesday 7 October 2026, 10:30 Almaty (UTC+5)
const now = new Date("2026-10-07T05:30:00Z");
const prefs = { ...DEFAULT_PREFERENCES, timezone: "Asia/Almaty" };
const due = (day?: string | null, time?: string | null) => resolveSemanticDate({ day, time }, { now, prefs, role: "due" });
const rem = (day?: string | null, time?: string | null) => resolveSemanticDate({ day, time }, { now, prefs, role: "reminder" });

test("tomorrow without time → end of day (deadline)", () => {
  assert.equal(due("tomorrow"), "2026-10-08T18:00:00+05:00");
});
test("tomorrow morning as reminder uses preference", () => {
  assert.equal(rem("tomorrow", "morning"), "2026-10-08T09:00:00+05:00");
});
test("until Friday → this Friday", () => {
  assert.equal(due("weekday:fri"), "2026-10-09T18:00:00+05:00");
});
test("weekday that already passed this week rolls to next week", () => {
  assert.equal(due("weekday:mon"), "2026-10-12T18:00:00+05:00");
});
test("next_weekday:fri is in the next calendar week", () => {
  assert.equal(due("next_weekday:fri"), "2026-10-16T18:00:00+05:00");
});
test("next_week → end of next week", () => {
  assert.equal(due("next_week"), "2026-10-16T18:00:00+05:00");
});
test("today evening reminder", () => {
  assert.equal(rem("today", "evening"), "2026-10-07T19:00:00+05:00");
});
test("in_hours:2 is relative to now", () => {
  assert.equal(rem("in_hours:2"), "2026-10-07T12:30:00+05:00");
});
test("time only in the past → tomorrow", () => {
  assert.equal(rem(null, "09:00"), "2026-10-08T09:00:00+05:00");
});
test("time only in the future → today", () => {
  assert.equal(rem(null, "15:00"), "2026-10-07T15:00:00+05:00");
});
test("explicit date", () => {
  assert.equal(due("date:2026-12-24", "12:00"), "2026-12-24T12:00:00+05:00");
});
test("invalid tokens are refused, never guessed", () => {
  assert.equal(due("sometime"), null);
  assert.equal(due("date:2026-02-30"), null);
});
test("end_of_month", () => {
  assert.equal(due("end_of_month"), "2026-10-31T18:00:00+05:00");
});
test("recurrence rule", () => {
  assert.equal(toRecurrenceRule({ freq: "weekly", by_weekday: ["mon"] }), "FREQ=WEEKLY;BYDAY=MO");
  assert.equal(toRecurrenceRule({ freq: "hourly", until_done: true }), "FREQ=HOURLY;UNTILDONE=1");
});
test("durations", () => {
  assert.equal(parseDuration("1d"), 86_400_000);
  assert.equal(parseDuration("2h"), 7_200_000);
  assert.equal(parseDuration("x"), null);
});
test("DST-aware zone conversion (Europe/London)", () => {
  const summer = zonedToUtc(2026, 7, 1, 9, 0, "Europe/London");
  assert.equal(summer.toISOString(), "2026-07-01T08:00:00.000Z");
  const winter = zonedToUtc(2026, 1, 1, 9, 0, "Europe/London");
  assert.equal(winter.toISOString(), "2026-01-01T09:00:00.000Z");
  assert.equal(formatISOInZone(summer, "Europe/London"), "2026-07-01T09:00:00+01:00");
});
