// POST /embed { task_ids?: string[], all_missing?: boolean }
import { serveWith } from "../_shared/handler.ts";
import { readJson } from "../_shared/auth.ts";
import { json } from "../_shared/cors.ts";
import { refreshTaskEmbeddings } from "../_shared/embeddings.ts";

serveWith(async (req, ctx, gemini) => {
  const body = await readJson<{ task_ids?: string[]; all_missing?: boolean }>(req);
  let ids = (body.task_ids ?? []).filter((x) => typeof x === "string").slice(0, 100);
  if (body.all_missing) {
    const { data } = await ctx.supabase.from("tasks").select("id").eq("user_id", ctx.userId).is("deleted_at", null).is("embedding", null).limit(100);
    ids = [...ids, ...(data ?? []).map((r: { id: string }) => r.id)];
  }
  const done = await refreshTaskEmbeddings(ctx.supabase, gemini, ctx.userId, ids);
  return json({ embedded: done });
});
