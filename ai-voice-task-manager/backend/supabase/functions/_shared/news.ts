// News aggregation: RSS/Atom + Google News queries per topic, keyword filters, Gemini digest in Russian.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { GeminiClient } from "./gemini.ts";

export type NewsTopic = "marine" | "aviation" | "kazakhstan";
export const TOPICS: NewsTopic[] = ["marine", "aviation", "kazakhstan"];
export const TOPIC_TITLE: Record<NewsTopic, string> = { marine: "Морское страхование", aviation: "Авиационное страхование", kazakhstan: "Страхование в Казахстане" };

interface Feed { url: string; source: string; filter?: RegExp; lang: string }

const gnews = (q: string, lang: "en" | "ru") =>
  lang === "en"
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`
    : `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ru&gl=KZ&ceid=KZ:ru`;

const MARINE_RE = /insur|underwrit|reinsur|P&I|protection and indemnity|hull|war risk|claim|casualty|salvage|general average|liability|страхов|перестрахов|P&I|каско|военн/i;
const AVIATION_RE = /insur|underwrit|reinsur|lessor|hull|liability|claim|страхов|перестрахов|авиа/i;
const KZ_INSURANCE_RE = /страхов|перестрахов|АРРФР|ОСГПО|КСЖ|актуар|insurance|Kazakhstan/i;

export const FEEDS: Record<NewsTopic, Feed[]> = {
  marine: [
    { url: gnews('"marine insurance" OR "P&I club" OR "hull and machinery" OR "war risk insurance" OR "marine underwriting"', "en"), source: "Google News", lang: "en" },
    { url: gnews('"морское страхование" OR "страхование судов" OR "P&I" OR "военные риски" судно', "ru"), source: "Google News (RU)", lang: "ru" },
    { url: "https://www.insurancejournal.com/rss/news/international/", source: "Insurance Journal", filter: MARINE_RE, lang: "en" },
    { url: "https://www.reinsurancene.ws/feed/", source: "Reinsurance News", filter: /marine|hull|P&I|shipping|cargo|war risk|vessel|tanker/i, lang: "en" },
    { url: "https://gcaptain.com/feed/", source: "gCaptain", filter: MARINE_RE, lang: "en" },
    { url: "https://splash247.com/feed/", source: "Splash247", filter: MARINE_RE, lang: "en" },
    { url: "https://www.maritime-executive.com/rss", source: "Maritime Executive", filter: MARINE_RE, lang: "en" },
  ],
  aviation: [
    { url: gnews('"aviation insurance" OR "aviation reinsurance" OR "aircraft insurance" OR "aviation underwriting" OR "aviation war risk"', "en"), source: "Google News", lang: "en" },
    { url: gnews('"авиационное страхование" OR "страхование воздушных судов" OR "авиастрахование"', "ru"), source: "Google News (RU)", lang: "ru" },
    { url: "https://www.insurancejournal.com/rss/news/international/", source: "Insurance Journal", filter: /aviation|aircraft|airline|lessor/i, lang: "en" },
    { url: "https://www.reinsurancene.ws/feed/", source: "Reinsurance News", filter: /aviation|aircraft|airline|lessor/i, lang: "en" },
  ],
  kazakhstan: [
    { url: gnews("страхование Казахстан", "ru"), source: "Google News (KZ)", filter: KZ_INSURANCE_RE, lang: "ru" },
    { url: gnews("страховой рынок Казахстана OR АРРФР страхование OR страховая компания Казахстан", "ru"), source: "Google News (KZ)", filter: KZ_INSURANCE_RE, lang: "ru" },
    { url: gnews('Kazakhstan insurance OR "Kazakhstan reinsurance"', "en"), source: "Google News", filter: KZ_INSURANCE_RE, lang: "en" },
    { url: "https://kursiv.media/feed/", source: "Kursiv", filter: /страхов|перестрахов/i, lang: "ru" },
    { url: "https://kapital.kz/rss", source: "Kapital.kz", filter: /страхов|перестрахов/i, lang: "ru" },
  ],
};

export interface FeedItem { title: string; url: string; summary: string | null; published_at: string | null; source: string; language: string }

const decode = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
const strip = (s: string) => decode(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const tag = (xml: string, name: string): string | null => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(xml);
  return m ? m[1] : null;
};

/** Minimal RSS 2.0 / Atom parser (no DOM in the edge runtime). */
export function parseFeed(xml: string, source: string, language: string): FeedItem[] {
  const items: FeedItem[] = [];
  const blocks = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) ?? xml.match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi) ?? [];
  for (const b of blocks) {
    const title = strip(tag(b, "title") ?? "");
    let url = decode(tag(b, "link") ?? "").trim();
    if (!url) { const href = /<link[^>]*href="([^"]+)"/i.exec(b); url = href ? decode(href[1]) : ""; }
    if (!title || !url) continue;
    const date = tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "updated") ?? tag(b, "dc:date");
    const published = date ? new Date(strip(date)) : null;
    const desc = tag(b, "description") ?? tag(b, "summary") ?? tag(b, "content") ?? "";
    const srcTag = strip(tag(b, "source") ?? "");
    items.push({
      title: title.slice(0, 300),
      url: url.slice(0, 1000),
      summary: strip(desc).slice(0, 600) || null,
      published_at: published && !Number.isNaN(published.getTime()) ? published.toISOString() : null,
      source: srcTag || source,
      language,
    });
  }
  return items;
}

export async function fetchFeed(feed: Feed, fetchImpl: typeof fetch = fetch): Promise<FeedItem[]> {
  const res = await fetchImpl(feed.url, { headers: { "user-agent": "Mozilla/5.0 (compatible; VoiceTasksNews/1.0)", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`${feed.source}: HTTP ${res.status}`);
  const items = parseFeed(await res.text(), feed.source, feed.lang);
  return feed.filter ? items.filter((i) => feed.filter!.test(`${i.title} ${i.summary ?? ""}`)) : items;
}

export const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

export async function refreshTopic(service: SupabaseClient, topic: NewsTopic, force = false): Promise<{ added: number; skipped: boolean; errors: string[] }> {
  const { data: log } = await service.from("news_refresh_log").select("refreshed_at").eq("topic", topic).maybeSingle();
  if (!force && log && Date.now() - new Date(log.refreshed_at).getTime() < REFRESH_INTERVAL_MS) return { added: 0, skipped: true, errors: [] };
  const errors: string[] = [];
  const results = await Promise.allSettled(FEEDS[topic].map((f) => fetchFeed(f)));
  const seen = new Set<string>();
  const rows = [];
  const cutoff = Date.now() - 21 * 86400_000;
  for (const r of results) {
    if (r.status === "rejected") { errors.push(String(r.reason?.message ?? r.reason)); continue; }
    for (const it of r.value) {
      const key = it.url.replace(/[?#].*$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      if (it.published_at && new Date(it.published_at).getTime() < cutoff) continue;
      rows.push({ topic, source: it.source, title: it.title, url: it.url, summary: it.summary, language: it.language, published_at: it.published_at ?? new Date().toISOString() });
    }
  }
  let added = 0;
  if (rows.length) {
    const { data, error } = await service.from("news_items").upsert(rows, { onConflict: "topic,url", ignoreDuplicates: true }).select("id");
    if (error) errors.push(error.message); else added = data?.length ?? 0;
  }
  await service.from("news_refresh_log").upsert({ topic, refreshed_at: new Date().toISOString(), items_added: added, last_error: errors.join("; ") || null });
  // keep the table small
  await service.from("news_items").delete().eq("topic", topic).lt("published_at", new Date(Date.now() - 60 * 86400_000).toISOString());
  return { added, skipped: false, errors };
}

export async function buildDigest(service: SupabaseClient, gemini: GeminiClient, topic: NewsTopic, force = false): Promise<string | null> {
  const today = new Date().toISOString().slice(0, 10);
  if (!force) {
    const { data } = await service.from("news_digests").select("content").eq("topic", topic).eq("digest_date", today).maybeSingle();
    if (data) return data.content;
  }
  const { data: items } = await service.from("news_items").select("title,source,url,summary,published_at").eq("topic", topic).gte("published_at", new Date(Date.now() - 3 * 86400_000).toISOString()).order("published_at", { ascending: false }).limit(40);
  if (!items?.length) return null;
  const res = await gemini.generate({
    systemInstruction: `You are an insurance market analyst writing for the head of insurance and risk at a Kazakhstani shipping company. Topic: ${TOPIC_TITLE[topic]}.
Write in Russian, Markdown. Structure: 1) «Главное» – 3-5 bullets with the most consequential developments (rates, claims, sanctions, regulation, capacity, major losses); 2) «Что это значит для нас» – 2-3 bullets with practical implications for a shipowner/corporate insured in Kazakhstan; 3) «Остальное» – one line per other notable item.
Every bullet must end with a source link in the form [источник](url). Do not invent facts beyond the provided items. Max 300 words.`,
    contents: [{ role: "user", parts: [{ text: JSON.stringify(items) }] }],
    temperature: 0.3,
  });
  const content = res.text.trim();
  if (content) await service.from("news_digests").upsert({ topic, digest_date: today, content, item_count: items.length }, { onConflict: "topic,digest_date" });
  return content || null;
}
