// Scheduled job (pg_cron / external cron): refresh every topic and pre-build daily digests.
// Auth: header x-cron-secret = CRON_SECRET (or service role bearer). No user context.
import { corsHeaders, json } from "../_shared/cors.ts";
import { GeminiClient, geminiConfigFromEnv } from "../_shared/gemini.ts";
import { isCronRequest, serviceClient } from "../_shared/service.ts";
import { buildDigest, refreshTopic, TOPICS } from "../_shared/news.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!isCronRequest(req)) return json({ error: "forbidden" }, 403);
  const service = serviceClient();
  const gemini = new GeminiClient(geminiConfigFromEnv((k) => Deno.env.get(k)));
  const report: Record<string, unknown> = {};
  for (const topic of TOPICS) {
    const r = await refreshTopic(service, topic, true);
    let digest = false;
    try { digest = !!(await buildDigest(service, gemini, topic, false)); } catch (e) { r.errors.push(`digest: ${e instanceof Error ? e.message : e}`); }
    report[topic] = { ...r, digest };
  }
  return json({ ok: true, report });
});
