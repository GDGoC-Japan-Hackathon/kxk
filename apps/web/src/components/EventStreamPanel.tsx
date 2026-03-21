"use client";

import { EventFilter, EventItem } from "@/types/worldlens";

const categories = ["all", "geopolitics", "macro", "commodities", "tech", "crypto", "earnings"] as const;
const regions = ["all", "NA", "SA", "EU", "MEA", "APAC"] as const;

type EventStreamPanelProps = {
  events: EventItem[];
  loading: boolean;
  error?: string;
  selectedId?: string;
  filters: EventFilter;
  countries: Array<{ code: string; name: string }>;
  onFilterChange: (next: EventFilter) => void;
  onHoverEvent?: (event: EventItem | undefined) => void;
  onSelectEvent: (event: EventItem) => void;
};

export function EventStreamPanel({
  events,
  loading,
  error,
  selectedId,
  filters,
  countries,
  onFilterChange,
  onHoverEvent,
  onSelectEvent,
}: EventStreamPanelProps) {
  return (
    <section className="panel h-full">
      <header className="panel-header">
        <h2>Event Stream</h2>
        <span>{events.length} events</span>
      </header>

      <div className="filter-grid mt-3">
        <label>
          <span>Category</span>
          <select value={filters.category} onChange={(event) => onFilterChange({ ...filters, category: event.target.value as EventFilter["category"] })}>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Region</span>
          <select value={filters.region} onChange={(event) => onFilterChange({ ...filters, region: event.target.value as EventFilter["region"] })}>
            {regions.map((region) => (
              <option key={region} value={region}>
                {region}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Country</span>
          <select value={filters.countryCode} onChange={(event) => onFilterChange({ ...filters, countryCode: event.target.value })}>
            <option value="all">all</option>
            {countries.map((item) => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Severity</span>
          <select value={filters.minSeverity} onChange={(event) => onFilterChange({ ...filters, minSeverity: Number(event.target.value) })}>
            <option value={0}>0.00</option>
            <option value={0.3}>0.30</option>
            <option value={0.5}>0.50</option>
            <option value={0.7}>0.70</option>
          </select>
        </label>

        <label className="col-span-2">
          <span>Time Window</span>
          <select value={filters.sinceMinutes} onChange={(event) => onFilterChange({ ...filters, sinceMinutes: Number(event.target.value) })}>
            <option value={30}>30m</option>
            <option value={240}>4h</option>
            <option value={1440}>24h</option>
            <option value={10080}>7d</option>
          </select>
        </label>
      </div>

      <div className="event-list mt-3">
        {loading && <p className="state-msg">Loading event stream...</p>}
        {!loading && error && <p className="state-msg text-red-300">{error}</p>}
        {!loading && !error && events.length === 0 && <p className="state-msg">No events in this filter slice.</p>}

        {!loading && !error && events.length > 0 && (
          <ul>
            {events.map((event) => (
              <li key={event.id}>
                <article
                  className={`event-card ${event.id === selectedId ? "active" : ""}`}
                  onMouseEnter={() => onHoverEvent?.(event)}
                  onMouseLeave={() => onHoverEvent?.(undefined)}
                >
                  <button type="button" className="event-main" onClick={() => onSelectEvent(event)}>
                    <div className="event-title-row">
                      <strong>{event.title}</strong>
                      <span className={`sev sev-${event.severity >= 0.7 ? "high" : event.severity >= 0.4 ? "med" : "low"}`}>
                        {event.severity.toFixed(2)}
                      </span>
                    </div>
                    <p>
                      {event.country} ({event.country_code}) · {event.region} · {event.category}
                    </p>
                    <p>
                      {event.source} · Updated {new Date(event.updated_at).toLocaleString()} · {event.article_count} articles · {event.provenance}
                    </p>
                  </button>
                  <a href={event.url} target="_blank" rel="noreferrer" className="source-link">
                    Open source
                  </a>
                </article>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
