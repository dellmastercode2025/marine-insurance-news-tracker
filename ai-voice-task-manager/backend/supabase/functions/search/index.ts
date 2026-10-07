// POST /search { query, limit?, semantic? }  → merged keyword + semantic results.
import { serveWith } from "../_shared/handler.ts";
import { readJson } from "../_shared/auth.ts";
import { HttpError, json } from "../_shared/cors.ts";
import { semanticTaskIds } from "../_shared/embeddings.ts";

serveWith(async (req, ctx, gemini) => {
  const { query, limit = 20, semantic = true } = await readJson<{ query: string; limit?: number; semantic?: boolean }>(req);
  const q = (query ?? "").trim();
  if (!q) throw new HttpError(400, "query required");
  const n = Math.min(Math.max(1, limit), 50);
  const like = `%${q.replace(/[%_]/g, " ")}%`;
  const base = () => ctx.supabase
    .from("tasks")
    .select("id,kind,title,description,priority,due_at,status_id,is_waiting,tags,created_at,project:projects(name),area:areas(name),person:people!tasks_person_id_fkey(name)")
    .eq("user_id", ctx.userId)
    .is("deleted_at", null);
  const keyword = await base().or(`title.ilike.${like},description.ilike.${like},clean_transcript.ilike.${like},original_transcript.ilike.${like},waiting_subject.ilike.${like}`).limit(n);
  const results = new Map<string, Record<string, unknown>>();
  for (const t of keyword.data ?? []) results.set(t.id, { ...t, match: "keyword" });
  if (semantic) {
    try {
      const ids = await semanticTaskIds(ctx.supabase, gemini, ctx.userId, q, n);
      if (ids.length) {
        const sem = await base().in("id", ids);
        for (const id of ids) {
          const t = (sem.data ?? []).find((x: any) => x.id === id);
          if (t && !results.has(id)) results.set(id, { ...t, match: "semantic" });
        }
      }
    } catch (e) {
      console.warn("semantic search unavailable", e instanceof Error ? e.message : e);
    }
  }
  // people / projects by name too
  const people = ctx.supabase.from("people").select("id,name,role").eq("user_id", ctx.userId).ilike("name", like).limit(5);
  const projects = ctx.supabase.from("projects").select("id,name").eq("user_id", ctx.userId).ilike("name", like).limit(5);
  const [pe, pr] = await Promise.all([people, projects]);
  return json({ tasks: [...results.values()].slice(0, n), people: pe.data ?? [], projects: pr.data ?? [] });
});
