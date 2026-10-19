import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { label } from "../lib/dates";
import type { NewsResponse, NewsTopic } from "../lib/types";

const TOPICS: Array<[NewsTopic, string]> = [["marine", "Морское страхование"], ["aviation", "Авиационное страхование"], ["kazakhstan", "Страхование в Казахстане"]];

export default function News() {
  const [topic, setTopic] = useState<NewsTopic>(() => (localStorage.getItem("news.topic") as NewsTopic) || "marine");
  const [data, setData] = useState<NewsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [digestBusy, setDigestBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = async (opts: { refresh?: boolean; digest?: boolean } = {}) => {
    opts.digest ? setDigestBusy(true) : setBusy(true); setError(null);
    try { setData(await api.news(topic, opts)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); setDigestBusy(false); }
  };
  useEffect(() => { localStorage.setItem("news.topic", topic); void load(); const h = setInterval(() => void load(), 30 * 60 * 1000); return () => clearInterval(h); }, [topic]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = (data?.items ?? []).filter((i) => !q || `${i.title} ${i.summary ?? ""} ${i.source}`.toLowerCase().includes(q.toLowerCase()));
  const groups = new Map<string, typeof items>();
  for (const it of items) { const k = it.published_at ? new Date(it.published_at).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" }) : "Без даты"; groups.set(k, [...(groups.get(k) ?? []), it]); }

  return (
    <div>
      <div className="row"><h1 style={{ margin: 0 }}>Новости</h1><span className="grow" />
        <span className="muted tiny">{data?.refreshed_at ? `обновлено ${label(data.refreshed_at)}` : ""}</span>
        <button onClick={() => load({ refresh: true })} disabled={busy}>{busy ? "…" : "Обновить"}</button>
      </div>
      <div className="row" style={{ margin: "10px 0" }}>
        <div className="seg">{TOPICS.map(([id, l]) => <button key={id} className={topic === id ? "active" : ""} onClick={() => setTopic(id)}>{l}</button>)}</div>
        <input placeholder="Фильтр по словам…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} />
      </div>
      {error && <div className="error small">{error}</div>}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row"><b>✨ AI-дайджест за сегодня</b><span className="grow" /><button onClick={() => load({ digest: true, refresh: !data?.digest })} disabled={digestBusy}>{digestBusy ? "Готовлю…" : data?.digest ? "Пересобрать" : "Сформировать"}</button></div>
        {data?.digest ? <Markdown text={data.digest} /> : <div className="muted small" style={{ marginTop: 6 }}>Краткая выжимка главных событий с выводами для судовладельца в Казахстане. Формируется из последних 3 дней новостей.</div>}
      </div>
      {data?.refresh_errors?.length ? <div className="muted tiny" style={{ marginBottom: 8 }}>Часть источников недоступна: {data.refresh_errors.join("; ")}</div> : null}
      {busy && !data && <div className="muted">Загружаю ленту…</div>}
      {[...groups.entries()].map(([day, list]) => (
        <div key={day}>
          <h3>{day}</h3>
          {list.map((it) => (
            <a key={it.id} className="task" href={it.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none", color: "inherit" }}>
              <div className="grow">
                <div className="title">{it.title}</div>
                {it.summary && <div className="muted small" style={{ marginTop: 2 }}>{it.summary.slice(0, 220)}{it.summary.length > 220 ? "…" : ""}</div>}
                <div className="meta"><span className="chip">{it.source}</span><span className="muted tiny">{it.published_at ? new Date(it.published_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : ""}</span></div>
              </div>
            </a>
          ))}
        </div>
      ))}
      {data && items.length === 0 && !busy && <div className="muted">Пока нет новостей по этой теме. Нажмите «Обновить».</div>}
    </div>
  );
}

/** Tiny Markdown renderer: headings, bullets, bold, links. Enough for the digest. */
export function Markdown({ text }: { text: string }) {
  const inline = (s: string) => {
    const parts: Array<string | JSX.Element> = [];
    const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*/g;
    let last = 0, m: RegExpExecArray | null, k = 0;
    while ((m = re.exec(s))) {
      if (m.index > last) parts.push(s.slice(last, m.index));
      if (m[1]) parts.push(<a key={k++} href={m[2]} target="_blank" rel="noreferrer">{m[1]}</a>); else parts.push(<b key={k++}>{m[3]}</b>);
      last = m.index + m[0].length;
    }
    if (last < s.length) parts.push(s.slice(last));
    return parts;
  };
  return (
    <div className="small" style={{ marginTop: 6 }}>
      {text.split("\n").map((line, i) => {
        const t = line.trim();
        if (!t) return null;
        if (/^#{1,3}\s/.test(t)) return <div key={i} style={{ fontWeight: 700, marginTop: 8 }}>{inline(t.replace(/^#+\s/, ""))}</div>;
        if (/^[-*•]\s/.test(t)) return <div key={i} style={{ paddingLeft: 14, textIndent: -10, margin: "3px 0" }}>• {inline(t.replace(/^[-*•]\s/, ""))}</div>;
        if (/^\d+[.)]\s/.test(t)) return <div key={i} style={{ paddingLeft: 14, margin: "3px 0" }}>{inline(t)}</div>;
        return <div key={i} style={{ margin: "4px 0" }}>{inline(t)}</div>;
      })}
    </div>
  );
}
