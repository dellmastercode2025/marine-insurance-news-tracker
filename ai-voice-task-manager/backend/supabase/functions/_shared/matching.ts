// Programmatic category / person matching. The model proposes names; this module maps them to ids,
// applies user aliases, routing rules and learned corrections, and decides whether to auto-file.
import type { UserStructure, ProjectRow, AreaRow, PersonRow, OrganisationRow } from "./context.ts";
import type { ExtractedItem, Preferences, ResolvedItem } from "./types.ts";

export function norm(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Very small stemmer for Russian/English to make "риски"/"рисков"/"рискам" match. */
export function stem(word: string): string {
  const w = norm(word);
  if (w.length <= 4) return w;
  return w.replace(/(иями|ями|ами|ием|ему|ому|ого|его|ств|ция|ции|цию|ние|ния|ний|ях|ах|ям|ам|ов|ев|ей|ой|ый|ий|ая|яя|ое|ее|ые|ие|ую|юю|ом|ем|ах|ях|ы|и|а|я|у|ю|е|о|ь|s|es|ing|ed)$/u, "");
}

/** Two stems match when equal or when one is a prefix of the other (≥5 chars), e.g. "страхов" ~ "страхова". */
function tokenEq(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 5 && long.startsWith(short);
}

function tokens(s: string): string[] {
  return norm(s).split(" ").filter(Boolean).map(stem);
}

export function nameMatches(candidate: { name: string; aliases: string[] }, query: string | null | undefined, prefs?: Preferences): number {
  if (!query) return 0;
  let q = norm(query);
  if (prefs) {
    for (const [alias, target] of Object.entries(prefs.aliases)) {
      if (norm(alias) === q) q = norm(target);
    }
  }
  const names = [candidate.name, ...candidate.aliases].map(norm);
  if (names.includes(q)) return 1;
  if (names.some((n) => n.startsWith(q) || q.startsWith(n))) return 0.9;
  const qt = tokens(q);
  for (const n of names) {
    const nt = tokens(n);
    if (!nt.length || !qt.length) continue;
    const overlap = nt.filter((t) => qt.some((x) => tokenEq(t, x))).length;
    const score = overlap / Math.max(nt.length, qt.length);
    if (score >= 0.5) return 0.6 + 0.3 * score;
  }
  return 0;
}

export function best<T extends { name: string; aliases: string[] }>(items: T[], query: string | null | undefined, prefs?: Preferences): { item: T; score: number } | null {
  let top: { item: T; score: number } | null = null;
  for (const item of items) {
    const score = nameMatches(item, query, prefs);
    if (score > 0 && (!top || score > top.score)) top = { item, score };
  }
  return top;
}

export function findProject(s: UserStructure, name: string | null | undefined, prefs: Preferences): ProjectRow | null {
  const b = best(s.projects, name, prefs);
  return b && b.score >= 0.6 ? b.item : null;
}

export function findArea(s: UserStructure, projectId: string | null, name: string | null | undefined, prefs: Preferences, parentId: string | null = null): AreaRow | null {
  const pool = s.areas.filter((a) => (!projectId || a.project_id === projectId) && (parentId ? a.parent_area_id === parentId : true));
  const b = best(pool, name, prefs);
  return b && b.score >= 0.6 ? b.item : null;
}

export function findPerson(s: UserStructure, name: string | null | undefined): { person: PersonRow | null; ambiguous: PersonRow[] } {
  if (!name) return { person: null, ambiguous: [] };
  const q = norm(name);
  const first = q.split(" ")[0];
  const hits = s.people.filter((p) => {
    const names = [p.name, ...p.aliases].map(norm);
    return names.includes(q) || names.some((n) => n.split(" ")[0] === first);
  });
  if (hits.length === 1) return { person: hits[0], ambiguous: [] };
  if (hits.length > 1) {
    const exact = hits.filter((p) => norm(p.name) === q);
    if (exact.length === 1) return { person: exact[0], ambiguous: [] };
    return { person: null, ambiguous: hits };
  }
  return { person: null, ambiguous: [] };
}

export function findOrganisation(s: UserStructure, name: string | null | undefined): OrganisationRow | null {
  const b = best(s.organisations, name);
  return b && b.score >= 0.6 ? b.item : null;
}

/** Apply routing rules ("риски" → "Казмортрансфлот/Управление рисками") and learned corrections to the raw text. */
export function routingOverride(
  s: UserStructure,
  prefs: Preferences,
  text: string,
): { project: ProjectRow; area: AreaRow | null } | null {
  const t = tokens(text);
  for (const [phrase, target] of Object.entries(prefs.routing_rules)) {
    const pt = tokens(phrase);
    if (pt.length && pt.every((x) => t.includes(x))) {
      const [pName, aName] = target.split("/").map((x) => x.trim());
      const project = findProject(s, pName, prefs);
      if (project) return { project, area: aName ? findArea(s, project.id, aName, prefs) : null };
    }
  }
  // Learned corrections: the user moved items with this pattern ≥ 3 times.
  for (const c of s.corrections) {
    if (c.count < 3) continue;
    const pt = tokens(c.pattern);
    if (pt.length && pt.every((x) => t.includes(x))) {
      const project = s.projects.find((p) => p.id === c.project_id);
      if (project) return { project, area: s.areas.find((a) => a.id === c.area_id) ?? null };
    }
  }
  return null;
}

export interface ResolvedCategory {
  workspace_id: string | null;
  project_id: string | null;
  area_id: string | null;
  subarea_id: string | null;
  project_name: string | null;
  area_name: string | null;
  subarea_name: string | null;
  workspace_name: string | null;
  matched: boolean; // true when an existing project was found
}

export function resolveCategory(s: UserStructure, prefs: Preferences, item: ExtractedItem): ResolvedCategory {
  const override = routingOverride(s, prefs, `${item.title} ${item.source_quote ?? ""} ${item.area ?? ""} ${item.project ?? ""}`);
  let project = override?.project ?? findProject(s, item.project, prefs);
  let area = override?.area ?? (project ? findArea(s, project.id, item.area, prefs) : null);
  // The model sometimes puts the project name into "area" or the area name into "project".
  if (!project && item.area) project = findProject(s, item.area, prefs);
  if (project && !area && item.project && norm(item.project) !== norm(project.name)) area = findArea(s, project.id, item.project, prefs);
  const subarea = area ? findArea(s, project?.id ?? null, item.subarea, prefs, area.id) : null;
  const workspace = project ? s.workspaces.find((w) => w.id === project!.workspace_id) ?? null : best(s.workspaces.map((w) => ({ ...w, aliases: [] })), item.workspace)?.item ?? null;
  return {
    workspace_id: workspace?.id ?? null,
    project_id: project?.id ?? null,
    area_id: area?.id ?? null,
    subarea_id: subarea?.id ?? null,
    workspace_name: workspace?.name ?? item.workspace ?? null,
    project_name: project?.name ?? item.project ?? null,
    area_name: area?.name ?? item.area ?? null,
    subarea_name: subarea?.name ?? item.subarea ?? null,
    matched: !!project,
  };
}

/** Decide whether an item can be filed without asking. */
export function decideAutoFile(item: ExtractedItem, cat: ResolvedCategory, prefs: Preferences, s: UserStructure): Pick<ResolvedItem, "auto_file" | "needs_disambiguation" | "disambiguation_options"> {
  const alternatives = (item.alternatives ?? [])
    .map((alt) => {
      const p = findProject(s, alt.project, prefs);
      const a = p ? findArea(s, p.id, alt.area, prefs) : null;
      return { project: p?.name ?? alt.project ?? null, project_id: p?.id ?? null, area: a?.name ?? alt.area ?? null, area_id: a?.id ?? null };
    })
    .filter((alt) => alt.project_id && (alt.project_id !== cat.project_id || alt.area_id !== cat.area_id));
  const confident = item.confidence >= prefs.auto_file_threshold;
  const needsDisambiguation = !confident && alternatives.length > 0 && cat.matched;
  const options = needsDisambiguation
    ? [{ project: cat.project_name, project_id: cat.project_id, area: cat.area_name, area_id: cat.area_id }, ...alternatives]
    : undefined;
  return {
    auto_file: confident && !needsDisambiguation,
    needs_disambiguation: needsDisambiguation,
    disambiguation_options: options,
  };
}
