import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFeed, FEEDS, TOPICS } from "../supabase/functions/_shared/news.ts";

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>
<item><title><![CDATA[P&amp;I clubs raise rates &amp; deductibles]]></title><link>https://example.com/a?utm=1</link><pubDate>Mon, 13 Oct 2026 08:00:00 GMT</pubDate><description><![CDATA[<p>Marine <b>insurance</b> renewals…</p>]]></description><source url="https://x">Lloyd's List</source></item>
<item><title>No link item</title></item>
<item><title>Aviation war risk capacity shrinks</title><link>https://example.com/b</link><pubDate>Tue, 14 Oct 2026 09:30:00 +0500</pubDate></item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Kazakhstan insurance market grows 20%</title><link href="https://example.kz/n1" rel="alternate"/><updated>2026-10-12T10:00:00Z</updated><summary>АРРФР отчёт</summary></entry></feed>`;

test("parses RSS 2.0 with CDATA, entities and per-item source", () => {
  const items = parseFeed(RSS, "Fallback", "en");
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "P&I clubs raise rates & deductibles");
  assert.equal(items[0].source, "Lloyd's List");
  assert.equal(items[0].summary, "Marine insurance renewals…");
  assert.equal(items[0].published_at, "2026-10-13T08:00:00.000Z");
  assert.equal(items[1].source, "Fallback");
  assert.equal(items[1].published_at, "2026-10-14T04:30:00.000Z");
});

test("parses Atom with href links", () => {
  const items = parseFeed(ATOM, "Atom", "ru");
  assert.equal(items.length, 1);
  assert.equal(items[0].url, "https://example.kz/n1");
  assert.equal(items[0].summary, "АРРФР отчёт");
});

test("every topic has feeds with valid URLs", () => {
  for (const t of TOPICS) {
    assert.ok(FEEDS[t].length >= 3);
    for (const f of FEEDS[t]) assert.ok(/^https:\/\//.test(f.url), f.url);
  }
});
