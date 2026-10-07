// Builds the "user structure" context given to the model, and loads the entities needed for
// programmatic matching. Only names/aliases/ids are sent to Gemini – never transcripts of other tasks.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Preferences } from "./types.ts";
import { localParts } from "./dateService.ts";

export interface WorkspaceRow { id: string; name: string }
export interface ProjectRow { id: string; workspace_id: string; name: string; aliases: string[] }
export interface AreaRow { id: string; project_id: string; parent_area_id: string | null; name: string; aliases: string[] }
export interface PersonRow { id: string; name: string; aliases: string[]; organisation_id: string | null; role: string | null }
export interface OrganisationRow { id: string; name: string; aliases: string[] }
export interface StatusRow { id: string; name: string; kind: string; sort_order: number }
export interface CorrectionHint { pattern: string; project_id: string; area_id: string | null; count: number }

export interface UserStructure {
  workspaces: WorkspaceRow[];
  projects: ProjectRow[];
  areas: AreaRow[];
  people: PersonRow[];
  organisations: OrganisationRow[];
  statuses: StatusRow[];
  corrections: CorrectionHint[];
}

export async function loadStructure(supabase: SupabaseClient, userId: string): Promise<UserStructure> {
  const [ws, pr, ar, pe, org, st, corr] = await Promise.all([
    supabase.from("workspaces").select("id,name").eq("user_id", userId).order("sort_order"),
    supabase.from("projects").select("id,workspace_id,name,aliases").eq("user_id", userId).eq("is_archived", false).order("sort_order"),
    supabase.from("areas").select("id,project_id,parent_area_id,name,aliases").eq("user_id", userId).order("sort_order"),
    supabase.from("people").select("id,name,aliases,organisation_id,role").eq("user_id", userId),
    supabase.from("organisations").select("id,name,aliases").eq("user_id", userId),
    supabase.from("status_columns").select("id,name,kind,sort_order").eq("user_id", userId).order("sort_order"),
    supabase.rpc("routing_hints", { p_user_id: userId }),
  ]);
  return {
    workspaces: ws.data ?? [],
    projects: (pr.data ?? []).map((p: ProjectRow) => ({ ...p, aliases: p.aliases ?? [] })),
    areas: (ar.data ?? []).map((a: AreaRow) => ({ ...a, aliases: a.aliases ?? [] })),
    people: (pe.data ?? []).map((p: PersonRow) => ({ ...p, aliases: p.aliases ?? [] })),
    organisations: (org.data ?? []).map((o: OrganisationRow) => ({ ...o, aliases: o.aliases ?? [] })),
    statuses: st.data ?? [],
    corrections: (corr.data ?? []) as CorrectionHint[],
  };
}

/** Text block describing the structure for the system prompt. */
export function structureBlock(s: UserStructure, prefs: Preferences): string {
  const lines: string[] = [];
  for (const w of s.workspaces) {
    lines.push(`Workspace: ${w.name}`);
    for (const p of s.projects.filter((p) => p.workspace_id === w.id)) {
      const al = p.aliases.length ? ` (aliases: ${p.aliases.join(", ")})` : "";
      lines.push(`  Project: ${p.name}${al}`);
      const top = s.areas.filter((a) => a.project_id === p.id && !a.parent_area_id);
      for (const a of top) {
        const aal = a.aliases.length ? ` (aliases: ${a.aliases.join(", ")})` : "";
        const subs = s.areas.filter((x) => x.parent_area_id === a.id).map((x) => x.name);
        lines.push(`    Area: ${a.name}${aal}${subs.length ? ` → subareas: ${subs.join(", ")}` : ""}`);
      }
    }
  }
  if (!lines.length) lines.push("(empty – the user has no projects yet; propose sensible workspace/project/area names)");

  if (s.people.length) {
    lines.push("", "People:");
    for (const p of s.people) {
      const org = s.organisations.find((o) => o.id === p.organisation_id)?.name;
      lines.push(`  ${p.name}${p.role ? `, ${p.role}` : ""}${org ? ` @ ${org}` : ""}${p.aliases.length ? ` (aka ${p.aliases.join(", ")})` : ""}`);
    }
  }
  if (s.organisations.length) lines.push("", `Organisations: ${s.organisations.map((o) => o.name).join(", ")}`);
  lines.push("", `Status columns: ${s.statuses.map((c) => c.name).join(" → ")}`);

  const aliasEntries = Object.entries(prefs.aliases);
  if (aliasEntries.length) lines.push("", "User aliases: " + aliasEntries.map(([k, v]) => `"${k}" = "${v}"`).join("; "));
  const routing = Object.entries(prefs.routing_rules);
  if (routing.length) lines.push("Routing rules: " + routing.map(([k, v]) => `"${k}" → ${v}`).join("; "));
  if (s.corrections.length) {
    lines.push("", "Learned from the user's corrections (phrases → where they were moved):");
    for (const c of s.corrections.slice(0, 30)) {
      const p = s.projects.find((x) => x.id === c.project_id)?.name ?? "?";
      const a = s.areas.find((x) => x.id === c.area_id)?.name;
      lines.push(`  "${c.pattern}" → ${p}${a ? ` / ${a}` : ""} (${c.count}×)`);
    }
  }
  lines.push("", `Time words: утро/morning=${prefs.morning}, день/day=${prefs.day}, вечер/evening=${prefs.evening}, ночь/night=${prefs.night}; default deadline time ${prefs.end_of_day}.`);
  return lines.join("\n");
}

export function nowBlock(now: Date, tz: string): string {
  const p = localParts(now, tz);
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][p.weekday];
  const pad = (n: number) => String(n).padStart(2, "0");
  return `## Now\nLocal date/time: ${weekday}, ${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.h)}:${pad(p.min)} (${tz}). Weeks start on Monday.`;
}
