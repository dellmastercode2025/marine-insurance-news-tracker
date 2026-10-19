// POST /news { topic?: "marine"|"aviation"|"kazakhstan", refresh?: boolean, digest?: boolean, limit?: number }
// Lazily refreshes a topic when its feeds are older than 30 minutes, returns items (+ today's AI digest on request).
import { serveWith } from "../_shared/handler.ts";
import { readJson } from "../_shared/auth.ts";
import { HttpError, json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/service.ts";
import { buildDigest, refreshTopic, TOPIC_TITLE, TOPICS, type NewsTopic } from "../_shared/news.ts";

serveWith(async (req, _ctx, gemini) => {
  const body = await readJson<{ topic?: string; refresh?: boolean; digest?: boolean; limit?: number }>(req).catch(() => ({} as { topic?: string; refresh?: boolean; digest?: boolean; limit?: number }));
  const topic = (body.topic ?? "marine") as NewsTopic;
  if (!TOPICS.includes(topic)) throw new HttpError(400, "unknown topic");
  const service = serviceClient();
  const refresh = await refreshTopic(service, topic, body.refresh === true);
  const { data: items } = await service.from("news_items").select("id,source,title,url,summary,language,published_at").eq("topic", topic).order("published_at", { ascending: false }).limit(Math.min(body.limit ?? 60, 200));
  const { data: log } = await service.from("news_refresh_log").select("refreshed_at,last_error").eq("topic", topic).maybeSingle();
  let digest: string | null = null;
  if (body.digest) {
    try { digest = await buildDigest(service, gemini, topic, body.refresh === true); } catch (e) { console.warn("digest failed", e instanceof Error ? e.message : e); }
  } else {
    const { data } = await service.from("news_digests").select("content").eq("topic", topic).eq("digest_date", new Date().toISOString().slice(0, 10)).maybeSingle();
    digest = data?.content ?? null;
  }
  return json({ topic, title: TOPIC_TITLE[topic], items: items ?? [], refreshed_at: log?.refreshed_at ?? null, refresh_errors: refresh.errors, digest });
});
