"use client";

import { useEffect, useMemo, useState } from "react";
import { MarketStrip } from "@/components/MarketStrip";
import { SiteHeader } from "@/components/SiteHeader";

type NewsCategory = "politics" | "economy" | "technology" | "energy" | "security" | "crypto";

type NewsItem = {
  title: string;
  description: string;
  url: string;
  image: string | null;
  source: string;
  publishedAt: string;
  country: string;
  countryCode: string;
  continent: string;
  category: NewsCategory;
};

const CONTINENTS = ["all", "Africa", "Asia", "Europe", "North America", "South America", "Oceania", "Global"];
const CATEGORIES: Array<NewsCategory | "all"> = ["all", "politics", "economy", "technology", "energy", "security", "crypto"];
const CATEGORY_SET = new Set<NewsCategory>(["politics", "economy", "technology", "energy", "security", "crypto"]);

function formatTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date);
}

function normalizeNewsItem(raw: Partial<NewsItem>): NewsItem | null {
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!url || !title) return null;

  const category = CATEGORY_SET.has(raw.category as NewsCategory) ? (raw.category as NewsCategory) : "politics";
  const countryCode = typeof raw.countryCode === "string" && raw.countryCode.trim() ? raw.countryCode.trim().toUpperCase() : "GL";

  return {
    title,
    description: typeof raw.description === "string" ? raw.description.trim() : "",
    url,
    image: typeof raw.image === "string" && raw.image.trim() ? raw.image.trim() : null,
    source: typeof raw.source === "string" && raw.source.trim() ? raw.source.trim() : "Unknown source",
    publishedAt: typeof raw.publishedAt === "string" && raw.publishedAt.trim() ? raw.publishedAt : new Date().toISOString(),
    country: typeof raw.country === "string" && raw.country.trim() ? raw.country.trim() : "Global",
    countryCode,
    continent: typeof raw.continent === "string" && raw.continent.trim() ? raw.continent.trim() : "Global",
    category,
  };
}

function themeLabel(category: string | null | undefined) {
  if (!category || category === "all") return "All themes";
  return `${category[0]?.toUpperCase() ?? ""}${category.slice(1) || ""}` || "All themes";
}

export default function NewsPage() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [continent, setContinent] = useState("all");
  const [country, setCountry] = useState("all");
  const [category, setCategory] = useState<NewsCategory | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ limit: "300" });
    if (continent !== "all") params.set("continent", continent);
    if (country !== "all") params.set("country", country);

    fetch(`/api/intel/news?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((payload: { items?: Partial<NewsItem>[]; error?: string }) => {
        if (!active) return;
        if (payload.error) {
          setError(payload.error);
          setItems([]);
          return;
        }
        const normalized = (payload.items ?? [])
          .map((item) => normalizeNewsItem(item))
          .filter((item): item is NewsItem => item !== null);
        setItems(normalized);
      })
      .catch(() => {
        if (active) {
          setError("Failed to fetch global headlines");
          setItems([]);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [continent, country]);

  const countries = useMemo(() => {
    const unique = new Set(items.map((item) => `${item.countryCode}|${item.country}`));
    return ["all", ...[...unique].sort((a, b) => a.localeCompare(b))];
  }, [items]);

  const filteredItems = useMemo(() => {
    if (category === "all") return items;
    return items.filter((item) => item.category === category);
  }, [items, category]);

  return (
    <main className="screen-shell">
      <SiteHeader />
      <MarketStrip />

      <div className="page-head pt-28">
        <p className="kicker">Global News</p>
        <h1>News Intelligence Feed</h1>
      </div>

      <section className="news-page-layout">
        <aside className={`panel news-filter-dock ${filtersOpen ? "open" : ""}`}>
          <div className="news-filter-dock-head">
            <div>
              <p className="kicker">Remote</p>
              <h2>Filters</h2>
            </div>
            <button
              type="button"
              className="news-filter-toggle"
              onClick={() => setFiltersOpen((current) => !current)}
              aria-expanded={filtersOpen}
              aria-controls="news-filter-controls"
            >
              {filtersOpen ? "Hide" : "Show"}
            </button>
          </div>

          <div className="news-filter-summary">
            <span>{filteredItems.length} stories</span>
            <span>{continent === "all" ? "All countries" : continent}</span>
            <span>{themeLabel(category)}</span>
          </div>

          <div id="news-filter-controls" className={`news-filter-controls ${filtersOpen ? "open" : ""}`}>
            <div className="news-filter-row">
              <label>
                <span>Continent</span>
                <select value={continent} onChange={(event) => setContinent(event.target.value)}>
                  {CONTINENTS.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>

              <label>
                <span>Country</span>
                <select value={country} onChange={(event) => setCountry(event.target.value)}>
                  {countries.map((item) => {
                    if (item === "all") return <option key="all" value="all">all</option>;
                    const [code, name] = item.split("|");
                    return <option key={code} value={code}>{name}</option>;
                  })}
                </select>
              </label>

              <label className="news-filter-wide">
                <span>Theme</span>
                <select value={category} onChange={(event) => setCategory(event.target.value as NewsCategory | "all")}>
                  {CATEGORIES.map((item) => (
                    <option key={item} value={item}>{themeLabel(item)}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </aside>

        <div className="news-feed-stack">
          {loading ? <p className="state-msg">Loading headlines...</p> : null}
          {error ? <p className="state-msg text-red-300">{error}</p> : null}
          {!loading && !error && filteredItems.length === 0 ? <p className="state-msg">No headlines in this filter slice.</p> : null}

          <section className="news-feed-list">
            {filteredItems.map((item) => (
              <article key={`${item.url}-${item.publishedAt}`} className="news-feed-card">
                <a href={item.url} target="_blank" rel="noreferrer" className="news-feed-thumb-link">
                  {item.image ? <img src={item.image} alt={item.title} loading="lazy" /> : <div className="news-thumb-empty" />}
                </a>

                <div className="news-feed-body">
                  <div className="news-feed-meta">
                    <span>{item.country}</span>
                    <span>{themeLabel(item.category)}</span>
                    <span>{formatTime(item.publishedAt)} UTC</span>
                  </div>

                  <a href={item.url} target="_blank" rel="noreferrer" className="news-feed-title">
                    {item.title}
                  </a>

                  <p className="news-feed-description">{item.description || "Open the source article for the full report."}</p>

                  <div className="news-feed-footer">
                    <span>{item.source}</span>
                    <a href={item.url} target="_blank" rel="noreferrer">Open article</a>
                  </div>
                </div>
              </article>
            ))}
          </section>
        </div>
      </section>
    </main>
  );
}
