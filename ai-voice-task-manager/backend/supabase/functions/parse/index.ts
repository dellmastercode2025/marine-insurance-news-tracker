// POST /parse  { transcript, voice_entry_id?, original_transcript? }
// → ParseResponse  (a PROPOSAL – nothing is written until /commit)
import { serveWith } from "../_shared/handler.ts";
import { readJson } from "../_shared/auth.ts";
import { HttpError, json } from "../_shared/cors.ts";
import { loadStructure, nowBlock, structureBlock } from "../_shared/context.ts";
import { parseSystem } from "../_shared/prompts.ts";
import { PARSE_SCHEMA } from "../_shared/schemas.ts";
import { resolveItems } from "../_shared/resolve.ts";
import type { ParseModelOutput, ParseResponse } from "../_shared/types.ts";

interface Body {
  transcript: string;
  voice_entry_id?: string | null;
  original_transcript?: string | null;
}

serveWith(async (req, ctx, gemini) => {
  const body = await readJson<Body>(req);
  const transcript = (body.transcript ?? "").trim();
  if (!transcript) throw new HttpError(400, "transcript is required");
  if (transcript.length > 30_000) throw new HttpError(413, "transcript too long");

  const structure = await loadStructure(ctx.supabase, ctx.userId);
  const system = parseSystem(structureBlock(structure, ctx.prefs), nowBlock(ctx.now, ctx.tz));

  const output = await gemini.generateJSON<ParseModelOutput>({
    systemInstruction: system,
    responseSchema: PARSE_SCHEMA,
    temperature: 0.1,
    contents: [{ role: "user", parts: [{ text: `Transcript:\n"""\n${transcript}\n"""` }] }],
  });

  const items = resolveItems({ output, structure, prefs: ctx.prefs, now: ctx.now });
  const response: ParseResponse = {
    voice_entry_id: body.voice_entry_id ?? null,
    language: output.language ?? "ru",
    summary: output.summary ?? "",
    items,
    needs_review: items.some((i) => !i.auto_file || (i.warnings?.length ?? 0) > 0),
  };

  if (body.voice_entry_id && !ctx.prefs.private_mode) {
    await ctx.supabase.from("voice_entries").update({
      ai_summary: response.summary,
      extraction: response,
      processing_status: "parsed",
      updated_at: new Date().toISOString(),
    }).eq("id", body.voice_entry_id).eq("user_id", ctx.userId);
  }
  return json(response);
});
