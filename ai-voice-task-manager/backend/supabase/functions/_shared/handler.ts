// Wraps an edge function: CORS preflight, auth, JSON errors, Gemini client construction.
import { authenticate, type RequestContext } from "./auth.ts";
import { corsHeaders, HttpError, json } from "./cors.ts";
import { GeminiClient, GeminiError, geminiConfigFromEnv } from "./gemini.ts";

export type Handler = (req: Request, ctx: RequestContext, gemini: GeminiClient) => Promise<Response>;

export function serveWith(handler: Handler): void {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "POST only" }, 405);
    const started = Date.now();
    try {
      const ctx = await authenticate(req);
      const gemini = new GeminiClient(geminiConfigFromEnv((k) => Deno.env.get(k)));
      const res = await handler(req, ctx, gemini);
      res.headers.set("x-elapsed-ms", String(Date.now() - started));
      return res;
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, details: e.details }, e.status);
      if (e instanceof GeminiError) return json({ error: "AI provider error", details: e.message }, 502);
      // Log minimisation: message only, never request bodies / transcripts.
      console.error("unhandled", e instanceof Error ? e.message : e);
      return json({ error: "Internal error" }, 500);
    }
  });
}
