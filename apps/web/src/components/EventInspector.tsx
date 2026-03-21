"use client";

import { CountryAggregate, EventItem } from "@/types/worldlens";

const paywallDomains = ["ft.com", "wsj.com", "bloomberg.com", "nytimes.com"];

type EventInspectorProps = {
  event?: EventItem;
  country?: CountryAggregate;
  countryEvents?: EventItem[];
  compact?: boolean;
};

const formatUtc = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(iso));

export function EventInspector({ event, country, countryEvents = [], compact = false }: EventInspectorProps) {
  return (
    <aside className={`inspector-card ${compact ? "inspector-compact" : ""}`} aria-live="polite">
      <p className="inspector-kicker">Event Inspector</p>

      {event ? (
        <>
          <h3>{event.title}</h3>
          <p className="inspector-meta">
            {event.country} ({event.country_code}) · {event.region} · severity {event.severity.toFixed(2)}
          </p>
          <p className="inspector-meta">
            Source: {event.source} · Updated: {formatUtc(event.updated_at)} UTC · Provenance: {event.provenance}
          </p>
          <p className="inspector-body">{event.summary}</p>
          <div className="inspector-tags">
            <span>{event.category}</span>
            <a href={event.url} target="_blank" rel="noreferrer" className="source-link">
              Open source
            </a>
          </div>
        </>
      ) : country ? (
        <>
          <h3>{country.name}</h3>
          <p className="inspector-meta">
            {country.region} · severity {country.severity_score.toFixed(2)} · {country.article_count} tracked issues
          </p>
          {countryEvents.length > 0 ? (
            <ul className="country-issues-list">
              {countryEvents.slice(0, 8).map((item) => (
                <li key={item.id}>
                  <a href={item.url} target="_blank" rel="noreferrer">
                    <strong>{item.title}</strong>
                    <span>
                      {item.source} · {formatUtc(item.updated_at)} UTC
                      {paywallDomains.some((domain) => item.url.includes(domain)) ? " · May require subscription" : ""}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="inspector-body">Hover or click event markers to display country issue links.</p>
          )}
        </>
      ) : (
        <>
          <h3>No selection</h3>
          <p className="inspector-body">Hover world bubbles or click a country to inspect active issues and sources.</p>
        </>
      )}
    </aside>
  );
}
