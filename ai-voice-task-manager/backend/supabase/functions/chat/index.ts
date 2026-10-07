// POST /chat  { message, history?: [{role, content}], conversation_id? }
// Gemini function-calling loop. Read tools run immediately; mutations follow the confirmation policy
// and may come back as pending_actions for the UI to confirm (then /execute-actions).
import { serveWith } from "../_shared/handler.ts";
import { readJson } from "../_shared/auth.ts";
import { HttpError, json } from "../_shared/cors.ts";
import { loadStructure, nowBlock, structureBlock } from "../_shared/context.ts";
import { chatSystem } from "../_shared/prompts.ts";
import { executeTool, saveBatch, TOOL_DECLARATIONS, UndoBatch, type ToolContext } from "../_shared/tools.ts";
import { refreshTaskEmbeddings, semanticTaskIds } from "../_shared/embeddings.ts";
import type { GeminiContent } from "../_shared/gemini.ts";
import type { PendingAction } from "../_shared/types.ts";

interface Body {
  message: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  conversation_id?: string | null;
}

const MAX_ROUNDS = 6;

serveWith(async (req, ctx, gemini) => {
  const body = await readJson<Body>(req);
  const message = (body.message ?? "").trim();
  if (!message) throw new HttpError(400, "message required");

  const structure = await loadStructure(ctx.supabase, ctx.userId);
  const system = chatSystem(structureBlock(structure, ctx.prefs), nowBlock(ctx.now, ctx.tz));
  const changed: string[] = [];
  const tctx: ToolContext = {
    supabase: ctx.supabase, userId: ctx.userId, prefs: ctx.prefs, tz: ctx.tz, now: ctx.now, structure,
    confirmed: false,
    batch: new UndoBatch(crypto.randomUUID(), `Чат: ${message.slice(0, 60)}`),
    onTaskChanged: (id) => changed.push(id),
  };
  const semantic = (q: string, l: number) => semanticTaskIds(ctx.supabase, gemini, ctx.userId, q, l);

  const contents: GeminiContent[] = [];
  for (const h of (body.history ?? []).slice(-20)) {
    if (h?.content) contents.push({ role: h.role === "assistant" ? "model" : "user", parts: [{ text: h.content.slice(0, 4000) }] });
  }
  contents.push({ role: "user", parts: [{ text: message }] });

  const executed: Array<{ name: string; result: unknown }> = [];
  const pending: PendingAction[] = [];
  let reply = "";

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await gemini.generate({ systemInstruction: system, contents, tools: TOOL_DECLARATIONS, temperature: 0.2 });
    if (!res.functionCalls.length) {
      reply = res.text;
      break;
    }
    contents.push({ role: "model", parts: res.parts.filter((p) => p.functionCall || (p.text && !p.thought)) });
    const responses = [];
    for (const call of res.functionCalls) {
      const out = await executeTool(call.name, call.args, tctx, semantic);
      let payload: Record<string, unknown>;
      if (out.requires_confirmation) {
        pending.push(out.requires_confirmation);
        payload = { status: "requires_user_confirmation", description: out.requires_confirmation.description };
      } else if (out.ok) {
        payload = { status: "ok", result: out.result ?? null };
        executed.push({ name: call.name, result: out.result });
      } else {
        payload = { status: "error", error: out.error };
      }
      responses.push({ functionResponse: { name: call.name, response: payload } });
    }
    contents.push({ role: "user", parts: responses });
    if (round === MAX_ROUNDS - 1) {
      const final = await gemini.generate({ systemInstruction: system, contents, toolMode: "NONE", temperature: 0.2 });
      reply = final.text;
    }
  }

  await saveBatch(tctx);
  if (changed.length) {
    const work = refreshTaskEmbeddings(ctx.supabase, gemini, ctx.userId, changed);
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime;
    if (rt?.waitUntil) rt.waitUntil(work); else await work;
  }
  if (!ctx.prefs.private_mode) {
    await ctx.supabase.from("chat_messages").insert([
      { user_id: ctx.userId, conversation_id: body.conversation_id ?? null, role: "user", content: message },
      { user_id: ctx.userId, conversation_id: body.conversation_id ?? null, role: "assistant", content: reply, tool_calls: { executed: executed.map((e) => e.name), pending: pending.map((p) => p.name) } },
    ]);
  }
  return json({
    reply: reply || (pending.length ? "Подтвердите действия ниже." : "Готово."),
    executed,
    pending_actions: pending,
    batch_id: tctx.batch.entries.length ? tctx.batch.id : null,
  });
});
