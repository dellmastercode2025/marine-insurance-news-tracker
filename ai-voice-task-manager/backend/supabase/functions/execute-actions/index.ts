// POST /execute-actions  { actions: [{name, args}], description? }
// Executes tool calls the user has CONFIRMED in the UI (bulk reschedule, delete, calendar event …).
import { serveWith } from "../_shared/handler.ts";
import { readJson } from "../_shared/auth.ts";
import { HttpError, json } from "../_shared/cors.ts";
import { loadStructure } from "../_shared/context.ts";
import { executeTool, READ_ONLY_TOOLS, saveBatch, TOOL_DECLARATIONS, UndoBatch, type ToolContext } from "../_shared/tools.ts";
import { refreshTaskEmbeddings, semanticTaskIds } from "../_shared/embeddings.ts";
import type { ToolCall } from "../_shared/types.ts";

interface Body {
  actions: ToolCall[];
  description?: string;
}

serveWith(async (req, ctx, gemini) => {
  const body = await readJson<Body>(req);
  if (!Array.isArray(body.actions) || !body.actions.length) throw new HttpError(400, "actions required");
  const known = new Set(TOOL_DECLARATIONS.map((t) => t.name));
  for (const a of body.actions) {
    if (!a || !known.has(a.name) || READ_ONLY_TOOLS.has(a.name)) throw new HttpError(400, `invalid action ${a?.name}`);
  }
  const structure = await loadStructure(ctx.supabase, ctx.userId);
  const changed: string[] = [];
  const tctx: ToolContext = {
    supabase: ctx.supabase, userId: ctx.userId, prefs: ctx.prefs, tz: ctx.tz, now: ctx.now, structure,
    confirmed: true,
    batch: new UndoBatch(crypto.randomUUID(), body.description ?? `Выполнено действий: ${body.actions.length}`),
    onTaskChanged: (id) => changed.push(id),
  };
  const results = [];
  for (const a of body.actions) {
    results.push({ name: a.name, ...(await executeTool(a.name, a.args ?? {}, tctx, (q, l) => semanticTaskIds(ctx.supabase, gemini, ctx.userId, q, l))) });
  }
  await saveBatch(tctx);
  const work = refreshTaskEmbeddings(ctx.supabase, gemini, ctx.userId, changed);
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(work); else await work;
  return json({ batch_id: tctx.batch.id, results });
});
