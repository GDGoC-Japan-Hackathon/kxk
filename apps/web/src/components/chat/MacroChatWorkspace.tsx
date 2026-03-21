"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { sendMacroChatMessage } from "@/lib/api";
import type { ChatMessage, ChatReply } from "@/types/chat";

const STARTER_PROMPTS = [
  "What are the top global risks markets should care about right now?",
  "Explain the latest Japan risk in terms of yen, rates, and exporters.",
  "Which current headline matters most for a semiconductor portfolio?",
  "How would an oil spike transmit into inflation, bonds, and equities?",
];

function buildEmergencyReply(message: string): ChatReply {
  const lower = message.toLowerCase();

  if (/\b(oil|crude)\b/.test(lower) && /\binflation\b/.test(lower) && /\b(bonds?|yields?|treasur)\b/.test(lower) && /\b(equit|stocks?)\b/.test(lower)) {
    return {
      summary: "An oil spike usually hits inflation first, then bonds, then equities.",
      answer: [
        "Inflation absorbs the first hit through fuel, freight, utilities, and input costs. Headline inflation reacts faster than core, but persistent energy strength can bleed into broader pricing expectations.",
        "Bonds then reprice for a worse inflation mix. Front-end yields and inflation compensation often rise first. If the shock starts damaging growth, longer-dated bonds can later stabilize or rally on recession risk even while inflation stays elevated.",
        "Equities usually split. Energy names can benefit, while transport, consumer, industrial, and long-duration growth stocks tend to suffer from margin pressure and higher discount rates.",
      ],
      keyRisks: [
        "A supply-driven oil move is worse than a temporary headline spike because inflation expectations can stay high for longer.",
        "If higher fuel costs hit consumers, the story broadens from inflation into earnings and demand risk.",
        "If oil reverses quickly, the first cross-asset reaction can unwind just as quickly.",
      ],
      marketImpact: [
        "Watch oil, inflation breakevens, and the front end of the Treasury curve first.",
        "Then watch credit spreads and cyclicals to see whether the market is shifting from inflation concern to growth damage.",
      ],
      watchlist: ["Oil", "US 10Y", "Breakevens", "Energy equities", "Consumer cyclicals"],
      relatedArticles: [],
      followUp: "I can narrow this to the US, Europe, or a specific portfolio next.",
      confidenceLabel: "Local fallback",
      queryType: "market_asset",
    };
  }

  if (/\b(portfolio|holdings|exposure|hedge|allocation|book)\b/.test(lower)) {
    return {
      summary: "The right portfolio answer is to map the question into factor exposures first.",
      answer: [
        "Start by splitting the portfolio into rates, FX, commodity, and equity-beta exposure rather than treating it as one block.",
        "The key question is whether the shock stays local to one theme or starts changing broader funding conditions and risk appetite.",
        "If you want a useful next answer, ask for the transmission into your region, sector, or hedge sleeve explicitly.",
      ],
      keyRisks: [
        "Portfolio damage accelerates when the same shock hits earnings, duration, and FX at the same time.",
        "A hedge can fail if it depends on the same macro factor as the underlying risk.",
      ],
      marketImpact: ["Watch rates, dollar, oil, and index beta together rather than one price series in isolation."],
      watchlist: ["Portfolio beta", "Rates", "FX", "Oil"],
      relatedArticles: [],
      followUp: "Ask with the actual sector, country, or hedge exposure and I will answer that directly.",
      confidenceLabel: "Local fallback",
      queryType: "portfolio",
    };
  }

  return {
    summary: "I could not use the live route for this turn, so I am answering from the question itself.",
    answer: [
      `The question is about "${message.trim()}". The correct frame is to answer that target directly rather than fall back to a generic macro template.`,
      "If the question is country-specific, the chain is usually local catalyst into FX, rates, and then equities. If it is asset-specific, the chain is catalyst into positioning and cross-asset confirmation.",
      "Submit a follow-up with the country, asset, or portfolio sleeve named explicitly and this will narrow cleanly.",
    ],
    keyRisks: ["Without live context, the remaining risk is missing the latest confirming market move or headline."],
    marketImpact: ["The first cross-check should still be the most liquid related market: FX, rates, oil, or index beta."],
    watchlist: ["DXY", "US 10Y", "Oil", "Equities"],
    relatedArticles: [],
    followUp: "For example: What matters more for Japan right now, the yen or JGB yields?",
    confidenceLabel: "Local fallback",
    queryType: "global_risk",
  };
}

function formatStamp(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function normalizeReply(reply: Partial<ChatReply> | null | undefined): ChatReply {
  const summary = reply?.summary?.trim() || "I could not produce a clean answer for that turn.";
  const answer = Array.isArray(reply?.answer)
    ? reply.answer.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];

  return {
    summary,
    answer: answer.length ? answer : [summary],
    keyRisks: Array.isArray(reply?.keyRisks)
      ? reply.keyRisks.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [],
    marketImpact: Array.isArray(reply?.marketImpact)
      ? reply.marketImpact.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [],
    watchlist: Array.isArray(reply?.watchlist)
      ? reply.watchlist.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [],
    relatedArticles: Array.isArray(reply?.relatedArticles)
      ? reply.relatedArticles.filter(
          (item): item is ChatReply["relatedArticles"][number] =>
            !!item &&
            typeof item.title === "string" &&
            typeof item.source === "string" &&
            typeof item.url === "string" &&
            typeof item.country === "string" &&
            "image" in item,
        )
      : [],
    followUp: reply?.followUp?.trim() || "Ask a follow-up on one country, asset, or portfolio sleeve.",
    confidenceLabel: reply?.confidenceLabel?.trim() || "Adaptive context",
    queryType: reply?.queryType ?? "global_risk",
  };
}

function createPendingReply(): ChatReply {
  return {
    summary: "Reading the question and pulling the relevant macro context.",
    answer: ["This turn is still being generated."],
    keyRisks: [],
    marketImpact: [],
    watchlist: [],
    relatedArticles: [],
    followUp: "",
    confidenceLabel: "Generating",
    queryType: "global_risk",
  };
}

function renderSection(title: string, items: string[], className: string) {
  if (!items.length) return null;
  return (
    <section className={className}>
      <h3>{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

export function MacroChatWorkspace() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [engineLabel, setEngineLabel] = useState("Adaptive context");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, submitting]);

  const submitPrompt = async (rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message || submitting) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      createdAt: new Date().toISOString(),
    };

    const assistantPending: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "Reading the question and pulling the relevant macro context.",
      createdAt: new Date().toISOString(),
      reply: createPendingReply(),
      engineState: "standby",
    };

    const history = messages.slice(-8).map((item) => ({
      role: item.role,
      content: item.role === "assistant" ? item.reply.summary : item.content,
    }));

    setMessages((current) => [...current, userMessage, assistantPending]);
    setDraft("");
    setSubmitting(true);

    try {
      const payload = await sendMacroChatMessage({ message, history });
      const reply = normalizeReply(payload.reply);
      setEngineLabel(payload.context.engineState === "live" ? "Live model context" : "Adaptive context");

      setMessages((current) =>
        current.map((item) =>
          item.id === assistantPending.id
            ? {
                ...item,
                content: reply.summary,
                reply,
                engineState: payload.context.engineState,
              }
            : item,
        ),
      );
    } catch {
      const reply = normalizeReply(buildEmergencyReply(message));

      setEngineLabel("Local fallback");
      setMessages((current) =>
        current.map((item) =>
          item.id === assistantPending.id
            ? {
                ...item,
                content: reply.summary,
                reply,
                engineState: "standby",
              }
            : item,
        ),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleComposerKeyDown = async (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    await submitPrompt(draft);
  };

  return (
    <section className="chat-shell">
      <header className="chat-page-head">
        <p className="kicker">WorldLens Intelligence</p>
        <h1>Macro Analyst AI</h1>
        <p>Ask about global news, markets, or portfolio risk in plain language.</p>
      </header>

      <div className="chat-stage">
        <div className="chat-thread" aria-live="polite">
          {messages.length === 0 ? (
            <div className="chat-empty-state">
              <p className="chat-empty-kicker">Macro conversation</p>
              <h2>Ask one direct question and the answer will center on that question.</h2>
              <p className="chat-empty-copy">
                Use this for global risk, country-specific developments, market transmission, or portfolio exposure.
              </p>
            </div>
          ) : null}

          {messages.map((message) => (
            <article key={message.id} className={`chat-message ${message.role}`}>
              <div className="chat-message-meta">
                <span>{message.role === "user" ? "You" : "Macro Analyst AI"}</span>
                <small>{formatStamp(message.createdAt)}</small>
              </div>

              {message.role === "user" ? (
                <div className="chat-user-bubble">{message.content}</div>
              ) : (
                <div className="chat-assistant-card">
                  <p className="chat-assistant-summary">{message.reply.summary}</p>
                  <div className="chat-assistant-body">
                    {message.reply.answer.map((item) => (
                      <p key={item}>{item}</p>
                    ))}
                  </div>
                  {renderSection("Key Risks", message.reply.keyRisks, "chat-section")}
                  {renderSection("Market Impact", message.reply.marketImpact, "chat-section")}
                  {renderSection("Watchlist", message.reply.watchlist, "chat-section chat-section-tags")}
                  {message.reply.relatedArticles.length ? (
                    <section className="chat-section chat-related-links">
                      <h3>Sources</h3>
                      <div className="chat-related-list">
                        {message.reply.relatedArticles.map((item) => (
                          <a key={item.url} href={item.url} target="_blank" rel="noreferrer">
                            {item.image ? <img src={item.image} alt={item.title} loading="lazy" /> : <div className="chat-related-thumb-empty" />}
                            <div>
                              <strong>{item.title}</strong>
                              <span>
                                {item.country} · {item.source}
                              </span>
                            </div>
                          </a>
                        ))}
                      </div>
                    </section>
                  ) : null}
                  <div className="chat-assistant-foot">
                    <span>{message.reply.confidenceLabel}</span>
                    {message.reply.followUp ? <p>{message.reply.followUp}</p> : null}
                  </div>
                </div>
              )}
            </article>
          ))}
          <div ref={bottomRef} />
        </div>

        {messages.length === 0 ? (
          <div className="chat-starters" aria-label="Suggested prompts">
            {STARTER_PROMPTS.map((item) => (
              <button key={item} type="button" className="chat-starter-chip" onClick={() => void submitPrompt(item)}>
                {item}
              </button>
            ))}
          </div>
        ) : null}

        <div className="chat-composer">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="Ask about a headline, country, asset, or portfolio risk."
            rows={3}
          />
          <div className="chat-composer-actions">
            <span>{engineLabel} · Enter to send · Shift+Enter for newline</span>
            <button type="button" className="btn-primary" disabled={submitting || !draft.trim()} onClick={() => void submitPrompt(draft)}>
              {submitting ? "Analyzing..." : "Send"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
