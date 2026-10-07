import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveItems, sanitizePriority } from "../supabase/functions/_shared/resolve.ts";
import { resolveCategory, findPerson, nameMatches } from "../supabase/functions/_shared/matching.ts";
import { DEFAULT_PREFERENCES, type ParseModelOutput } from "../supabase/functions/_shared/types.ts";
import type { UserStructure } from "../supabase/functions/_shared/context.ts";

const now = new Date("2026-10-07T05:30:00Z"); // Wed
const prefs = { ...DEFAULT_PREFERENCES, timezone: "Asia/Almaty", aliases: { KMTF: "Казмортрансфлот", КМТФ: "Казмортрансфлот" }, routing_rules: { "риски": "Казмортрансфлот/Управление рисками" } };

const structure: UserStructure = {
  workspaces: [{ id: "w1", name: "Работа" }, { id: "w2", name: "Личное" }],
  projects: [
    { id: "p1", workspace_id: "w1", name: "Казмортрансфлот", aliases: ["КМТФ", "KMTF"] },
    { id: "p2", workspace_id: "w2", name: "ОСИ", aliases: [] },
  ],
  areas: [
    { id: "a1", project_id: "p1", parent_area_id: null, name: "Управление рисками", aliases: ["Риски"] },
    { id: "a2", project_id: "p1", parent_area_id: null, name: "Страхование", aliases: [] },
    { id: "a3", project_id: "p1", parent_area_id: null, name: "Санкции", aliases: [] },
    { id: "a4", project_id: "p2", parent_area_id: null, name: "Лифты", aliases: [] },
    { id: "a5", project_id: "p2", parent_area_id: null, name: "Двери", aliases: [] },
    { id: "a6", project_id: "p2", parent_area_id: null, name: "Ремонт", aliases: [] },
  ],
  people: [
    { id: "h1", name: "Денис", aliases: [], organisation_id: "o1", role: "Broker" },
    { id: "h2", name: "Берик", aliases: [], organisation_id: null, role: null },
  ],
  organisations: [{ id: "o1", name: "WTW", aliases: ["Willis"] }],
  statuses: [],
  corrections: [{ pattern: "проверить контрагента", project_id: "p1", area_id: "a3", count: 3 }],
};

test("alias and inflection matching", () => {
  assert.equal(nameMatches({ name: "Казмортрансфлот", aliases: ["КМТФ"] }, "кмтф", prefs), 1);
  assert.equal(nameMatches({ name: "Казмортрансфлот", aliases: [] }, "KMTF", prefs), 1); // user alias → canonical
  assert.ok(nameMatches({ name: "Управление рисками", aliases: [] }, "рисков") > 0.6);
});

test("existing area is preferred over inventing a new one", () => {
  const cat = resolveCategory(structure, prefs, { type: "task", title: "Проверить страховое покрытие судна", project: "Казмортрансфлот", area: "Страховое покрытие", confidence: 0.8 });
  assert.equal(cat.project_id, "p1");
  // "Страховое покрытие" shares the stem "страхов" with "Страхование"
  assert.equal(cat.area_id, "a2");
});

test("routing rule overrides the model's placement", () => {
  const cat = resolveCategory(structure, prefs, { type: "task", title: "По рискам проверить реестр", project: "Казмортрансфлот", area: "Качество", confidence: 0.9, source_quote: "по рискам завтра проверить реестр" });
  assert.equal(cat.area_id, "a1");
});

test("learned corrections (≥3) route the item", () => {
  const cat = resolveCategory(structure, prefs, { type: "task", title: "Проверить контрагента Иванов", project: null, area: null, confidence: 0.5 });
  assert.equal(cat.project_id, "p1");
  assert.equal(cat.area_id, "a3");
});

test("person lookup is unambiguous by first name", () => {
  assert.equal(findPerson(structure, "Денису").person, null); // inflected form not matched → stays null, no guessing
  assert.equal(findPerson(structure, "Денис").person?.id, "h1");
});

test("priority: P1 requires textual evidence", () => {
  assert.equal(sanitizePriority({ type: "task", title: "Письмо", priority: 1, confidence: 1 }, prefs), 2);
  assert.equal(sanitizePriority({ type: "task", title: "Срочно письмо WTW", priority: 3, confidence: 1 }, prefs), 1);
  assert.equal(sanitizePriority({ type: "task", title: "Когда-нибудь почитать", priority: 3, confidence: 1 }, prefs), 4);
});

test("acceptance scenario (§46) resolves into four correctly placed items", () => {
  const output: ParseModelOutput = {
    language: "ru",
    summary: "4 действия",
    items: [
      { type: "task", title: "Проверить реестр рисков", project: "КМТФ", area: "Риски", due: { day: "tomorrow" }, confidence: 0.95, source_quote: "по рискам завтра проверить реестр" },
      { type: "waiting", title: "Получить ответ Дениса по WTW", project: "КМТФ", area: "Страхование", waiting_for: "Денис", waiting_subject: "ответ по WTW", due: { day: "weekday:fri" }, follow_up: { day: "weekday:fri" }, confidence: 0.93, organisation: "WTW" },
      { type: "reminder", title: "Написать Берику насчёт двери", project: "ОСИ", area: "Двери", person: "Берик", reminder: { day: "today", time: "evening" }, confidence: 0.9 },
      { type: "reminder", title: "Спросить Артура по подоконнику", project: "ОСИ", area: "Ремонт", person: "Артур", reminder: { day: "tomorrow" }, confidence: 0.7, alternatives: [{ project: "ОСИ", area: "Двери" }] },
      { type: "reminder", title: "Спросить Артура по подоконнику", project: "ОСИ", area: "Ремонт", person: "Артур", reminder: { day: "tomorrow" }, confidence: 0.7 }, // duplicate
    ],
  };
  const items = resolveItems({ output, structure, prefs, now });
  assert.equal(items.length, 4);
  const [risk, wait, door, sill] = items;
  assert.equal(risk.project_id, "p1");
  assert.equal(risk.area_id, "a1");
  assert.equal(risk.due_at, "2026-10-08T18:00:00+05:00");
  assert.equal(risk.auto_file, true);

  assert.equal(wait.area_id, "a2");
  assert.equal(wait.waiting_for_person_id, "h1");
  assert.equal(wait.organisation_id, "o1");
  assert.equal(wait.due_at, "2026-10-09T18:00:00+05:00");
  assert.equal(wait.follow_up_at, "2026-10-09T09:00:00+05:00");

  assert.equal(door.project_id, "p2");
  assert.equal(door.area_id, "a5");
  assert.equal(door.person_id, "h2");
  assert.equal(door.reminder_at, "2026-10-07T19:00:00+05:00");
  assert.equal(door.due_at, null);

  assert.equal(sill.area_id, "a6");
  assert.equal(sill.reminder_at, "2026-10-08T09:00:00+05:00");
  assert.equal(sill.auto_file, false);
  assert.equal(sill.needs_disambiguation, true);
  assert.equal(sill.disambiguation_options?.length, 2);
  assert.equal(sill.person_id, null); // Артур is unknown → will be created on commit
});
