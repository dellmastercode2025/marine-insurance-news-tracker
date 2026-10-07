// POST /commit  { voice_entry_id?, items: ResolvedItem[], original_transcript?, clean_transcript? }
// Creates the confirmed items through the tool layer, inside one undo batch.
import { serveWith } from "../_shared/handler.ts";
import { readJson } from "../_shared/auth.ts";
import { HttpError, json } from "../_shared/cors.ts";
import { loadStructure } from "../_shared/context.ts";
import { applyResolvedItems, saveBatch, UndoBatch, type ToolContext } from "../_shared/tools.ts";
import { refreshTaskEmbeddings } from "../_shared/embeddings.ts";
import type { ResolvedItem } from "../_shared/types.ts";

interface Body {
  voice_entry_id?: string | null;
  items: ResolvedItem[];
  original_transcript?: string | null;
  clean_transcript?: string | null;
}

serveWith(async (req, ctx, gemini) => {
  const body = await readJson<Body>(req);
  if (!Array.isArray(body.items) || !body.items.length) throw new HttpError(400, "items required");
  if (body.items.length > 50) throw new HttpError(413, "too many items");
  for (const it of body.items) {
    if (!it || typeof it.title !== "string" || !it.title.trim()) throw new HttpError(400, "every item needs a title");
    for (const f of ["due_at", "reminder_at", "follow_up_at", "event_start_at", "event_end_at"] as const) {
      const v = it[f];
      if (v && Number.isNaN(new Date(v).getTime())) throw new HttpError(400, `invalid ${f}`);
    }
  }

  const structure = await loadStructure(ctx.supabase, ctx.userId);
  const changed: string[] = [];
  const tctx: ToolContext = {
    supabase: ctx.supabase,
    userId: ctx.userId,
    prefs: ctx.prefs,
    tz: ctx.tz,
    now: ctx.now,
    structure,
    confirmed: true,
    batch: new UndoBatch(crypto.randomUUID(), `Добавлено ${body.items.length} элемент(ов) из голосовой записи`),
    onTaskChanged: (id) => changed.push(id),
  };
  const created = await applyResolvedItems(tctx, body.items, body);
  await saveBatch(tctx);

  if (body.voice_entry_id) {
    await ctx.supabase.from("voice_entries").update({ processing_status: "committed", updated_at: new Date().toISOString() }).eq("id", body.voice_entry_id).eq("user_id", ctx.userId);
  }
  // Embeddings are refreshed after the response is sent (EdgeRuntime.waitUntil when available).
  const work = refreshTaskEmbeddings(ctx.supabase, gemini, ctx.userId, changed);
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(work); else await work;

  return json({ batch_id: tctx.batch.id, tasks: created });
});
