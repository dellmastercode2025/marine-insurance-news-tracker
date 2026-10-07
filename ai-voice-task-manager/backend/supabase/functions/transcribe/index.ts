// POST /transcribe  { audio_base64, mime_type, voice_entry_id?, language_hint?, live_transcript? }
// → { language, original_transcript, clean_transcript }
// Audio is sent inline to Gemini (multimodal). Nothing is stored server-side unless the client
// uploaded it to Storage itself; in private mode the transcript is not persisted on voice_entries.
import { serveWith } from "../_shared/handler.ts";
import { readJson } from "../_shared/auth.ts";
import { HttpError, json } from "../_shared/cors.ts";
import { TRANSCRIBE_SYSTEM } from "../_shared/prompts.ts";
import { TRANSCRIPT_SCHEMA } from "../_shared/schemas.ts";

interface Body {
  audio_base64: string;
  mime_type: string;
  voice_entry_id?: string | null;
  language_hint?: string | null;
  live_transcript?: string | null; // on-device realtime transcript, used as a hint for names
}

const ALLOWED = new Set(["audio/m4a", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg", "audio/flac", "audio/webm"]);
const MAX_BYTES = 19 * 1024 * 1024; // inline limit of generateContent is 20 MB per request

serveWith(async (req, ctx, gemini) => {
  const body = await readJson<Body>(req);
  if (!body.audio_base64 || !body.mime_type) throw new HttpError(400, "audio_base64 and mime_type are required");
  const mime = body.mime_type.toLowerCase();
  if (!ALLOWED.has(mime)) throw new HttpError(415, `unsupported mime type ${mime}`);
  if (body.audio_base64.length * 0.75 > MAX_BYTES) throw new HttpError(413, "audio too large; split the recording");

  const hints: string[] = [];
  if (body.language_hint) hints.push(`Expected dominant language: ${body.language_hint}.`);
  if (body.live_transcript) hints.push(`On-device draft transcript (may contain errors, use only as a hint for proper names):\n"""${body.live_transcript.slice(0, 4000)}"""`);
  const known = ctx.prefs.aliases;
  if (Object.keys(known).length) hints.push("Known abbreviations: " + Object.entries(known).map(([k, v]) => `${k} = ${v}`).join("; "));

  const result = await gemini.generateJSON<{ language: string; original_transcript: string; clean_transcript: string }>({
    systemInstruction: TRANSCRIBE_SYSTEM,
    responseSchema: TRANSCRIPT_SCHEMA,
    temperature: 0.1,
    contents: [{
      role: "user",
      parts: [
        { inlineData: { mimeType: mime === "audio/x-m4a" ? "audio/mp4" : mime, data: body.audio_base64 } },
        { text: `Transcribe this recording. ${hints.join("\n")}` },
      ],
    }],
  });

  if (body.voice_entry_id && !ctx.prefs.private_mode) {
    await ctx.supabase.from("voice_entries").update({
      language: result.language,
      original_transcript: result.original_transcript,
      clean_transcript: result.clean_transcript,
      processing_status: "transcribed",
      updated_at: new Date().toISOString(),
    }).eq("id", body.voice_entry_id).eq("user_id", ctx.userId);
  }
  return json(result);
});
