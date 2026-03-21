import { NextRequest, NextResponse } from "next/server";
import { getApiUrl } from "@/lib/api";
import { fetchMarketSeries } from "@/services/marketService";
import { fetchGlobalNews } from "@/services/newsService";
import type { ChatContextPayload, ChatReply } from "@/types/chat";

type RequestBody = {
  message?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
};

type FocusSignals = {
  countries: string[];
  assets: string[];
  asksTransmission: boolean;
  asksComparison: boolean;
  asksPortfolio: boolean;
  asksImportance: boolean;
};

const COUNTRY_PATTERNS: Array<[string, string]> = [
  ["united states", "United States"],
  ["america", "United States"],
  ["us", "United States"],
  ["japan", "Japan"],
  ["china", "China"],
  ["europe", "Europe"],
  ["euro area", "Europe"],
  ["germany", "Germany"],
  ["france", "France"],
  ["uk", "United Kingdom"],
  ["united kingdom", "United Kingdom"],
  ["britain", "United Kingdom"],
  ["india", "India"],
  ["korea", "Korea"],
  ["south korea", "South Korea"],
  ["taiwan", "Taiwan"],
  ["iran", "Iran"],
  ["israel", "Israel"],
  ["saudi", "Saudi Arabia"],
  ["middle east", "Middle East"],
  ["africa", "Africa"],
  ["nigeria", "Nigeria"],
  ["egypt", "Egypt"],
  ["south africa", "South Africa"],
];

const ASSET_PATTERNS: Array<[string, string]> = [
  ["oil", "oil"],
  ["crude", "oil"],
  ["energy", "energy"],
  ["inflation", "inflation"],
  ["bonds", "bonds"],
  ["bond", "bonds"],
  ["rates", "rates"],
  ["yield", "yields"],
  ["treasury", "Treasuries"],
  ["equities", "equities"],
  ["equity", "equities"],
  ["stocks", "equities"],
  ["dollar", "dollar"],
  ["fx", "FX"],
  ["yen", "yen"],
  ["gold", "gold"],
  ["bitcoin", "bitcoin"],
  ["semiconductor", "semiconductors"],
  ["semis", "semiconductors"],
  ["chip", "semiconductors"],
  ["tariff", "tariffs"],
  ["trade", "trade"],
  ["portfolio", "portfolio"],
];

function extractOutputText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const direct = (payload as { output_text?: unknown }).output_text;
  if (typeof direct === "string" && direct.trim()) return direct;

  const output = (payload as { output?: unknown }).output;
  if (!Array.isArray(output)) return "";

  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const text = (block as { text?: unknown }).text;
      if (typeof text === "string" && text.trim()) parts.push(text);
    }
  }
  return parts.join("\n");
}

function deriveEffectiveQuestion(message: string, history: NonNullable<RequestBody["history"]>) {
  const trimmed = message.trim();
  const previousUser = [...history].reverse().find((item) => item.role === "user" && item.content.trim())?.content.trim();
  if (!previousUser) return trimmed;

  const isShortFollowUp = trimmed.split(/\s+/).length <= 10;
  const refersBack = /\b(and|also|then|what about|how about|why|which|that|this|compare|vs|versus)\b/i.test(trimmed);
  if (!isShortFollowUp && !refersBack) return trimmed;
  return `${previousUser}\nFollow-up question: ${trimmed}`;
}

function uniqueMatches(message: string, patterns: Array<[string, string]>) {
  const lower = message.toLowerCase();
  const matches = patterns
    .filter(([pattern]) => new RegExp(`(^|[^a-z])${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-z])`, "i").test(lower))
    .map(([, label]) => label);
  return [...new Set(matches)];
}

function extractFocusSignals(message: string): FocusSignals {
  const lower = message.toLowerCase();
  return {
    countries: uniqueMatches(message, COUNTRY_PATTERNS),
    assets: uniqueMatches(message, ASSET_PATTERNS),
    asksTransmission: /\b(how|transmit|flow through|spill|pass through|impact|affect|feed into)\b/.test(lower),
    asksComparison: /\b(compare|versus|vs|relative to|difference)\b/.test(lower),
    asksPortfolio: /\b(portfolio|book|holdings|allocation|hedge|exposure|drawdown)\b/.test(lower),
    asksImportance: /\b(which|what matters|biggest|top|main|key|most important)\b/.test(lower),
  };
}

function detectQueryType(message: string): ChatContextPayload["queryType"] {
  const lower = message.toLowerCase();
  const focus = extractFocusSignals(message);
  if (focus.asksPortfolio) return "portfolio";
  if (focus.countries.length > 0 || /\b(country|region|boj|fed|ecb|pboc|government|election)\b/.test(lower)) return "country_region";
  if (focus.assets.length > 0 || /\b(usd|eur|jpy|asset|market|sector)\b/.test(lower)) {
    return "market_asset";
  }
  return "global_risk";
}

function scoreHeadline(item: ChatContextPayload["headlines"][number], message: string) {
  const haystack = `${item.title} ${item.country} ${item.source}`.toLowerCase();
  return message
    .toLowerCase()
    .split(/\W+/)
    .filter((token) => token.length > 2)
    .reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function scoreMarket(item: ChatContextPayload["markets"][number], message: string) {
  const haystack = `${item.symbol} ${item.name}`.toLowerCase();
  const lower = message.toLowerCase();
  let score = 0;
  for (const token of lower.split(/\W+/).filter((entry) => entry.length > 2)) {
    if (haystack.includes(token)) score += 1;
  }
  if (/\b(yen|japan|boj)\b/.test(lower) && item.symbol === "USDJPY") score += 5;
  if (/\b(oil|crude|energy)\b/.test(lower) && item.symbol === "OIL") score += 5;
  if (/\b(rates|yield|bond|treasury)\b/.test(lower) && item.symbol === "US10Y") score += 5;
  if (/\b(semiconductor|semis|chip)\b/.test(lower) && item.symbol === "NASDAQ") score += 4;
  return score;
}

function formatPct(value: number | null) {
  if (value == null || Number.isNaN(value)) return "flat";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function buildWatchlist(message: string, markets: ChatContextPayload["markets"]): string[] {
  const lower = message.toLowerCase();
  const watch = new Set<string>();
  if (/\b(yen|boj|japan)\b/.test(lower)) watch.add("USDJPY");
  if (/\b(oil|crude|energy)\b/.test(lower)) watch.add("Oil");
  if (/\b(rates|yield|treasury|bond)\b/.test(lower)) watch.add("US 10Y");
  if (/\b(dollar|usd|fx)\b/.test(lower)) watch.add("DXY");
  if (/\b(semiconductor|semis|chip)\b/.test(lower)) watch.add("Semis");
  if (/\b(portfolio|drawdown|exposure)\b/.test(lower)) watch.add("Portfolio beta");
  for (const market of markets) {
    watch.add(market.symbol === "US10Y" ? "US 10Y" : market.symbol === "OIL" ? "Oil" : market.symbol);
    if (watch.size >= 5) break;
  }
  return [...watch].slice(0, 5);
}

function buildFallbackReply(message: string, context: ChatContextPayload): ChatReply {
  const queryType = detectQueryType(message);
  const focus = extractFocusSignals(message);
  const headlines = [...context.headlines].sort((a, b) => scoreHeadline(b, message) - scoreHeadline(a, message));
  const markets = [...context.markets].sort((a, b) => scoreMarket(b, message) - scoreMarket(a, message));
  const leadHeadline = headlines[0];
  const secondHeadline = headlines[1];
  const leadMarket = markets[0];
  const secondMarket = markets[1];
  const watchlist = buildWatchlist(message, markets);
  const focusLabel = [...focus.countries, ...focus.assets].slice(0, 3).join(", ");

  let summary = focusLabel
    ? `The question centers on ${focusLabel}, so the answer should stay anchored to that transmission path.`
    : "The question should be read through catalyst first, then market confirmation.";
  let answer: string[] = [];
  let keyRisks: string[] = [];
  let marketImpact: string[] = [];

  if (focus.assets.includes("oil") && focus.assets.includes("inflation") && focus.assets.includes("bonds") && focus.assets.includes("equities")) {
    summary = "An oil spike is a cost shock first: it lifts near-term inflation pressure, pushes bond pricing toward higher inflation compensation, and usually compresses equity multiples outside energy.";
    answer = [
      "Inflation moves first through gasoline, diesel, freight, and input costs. Headline CPI usually reacts faster than core, but if energy stays high long enough it can leak into wages, services, and inflation expectations.",
      "Bonds then have to price the mix of higher near-term inflation and weaker growth. Early in the shock, front-end and breakeven inflation often move up. If the oil spike starts to threaten demand, the long end can eventually rally on growth fears even while inflation stays uncomfortable.",
      "Equities usually split. Energy producers and parts of commodity value chains can benefit, while transport, consumer discretionary, industrials, and duration-sensitive growth stocks tend to suffer from margin pressure and higher discount rates.",
    ];
    keyRisks = [
      "If the oil move is supply-driven and persistent, inflation expectations can re-anchor higher and keep central banks cautious for longer.",
      "If consumers absorb higher fuel bills, discretionary spending weakens and the shock broadens from inflation into earnings risk.",
      "If the move reverses quickly, the inflation scare fades and markets can unwind the first bearish cross-asset reaction just as fast.",
    ];
    marketImpact = [
      "Watch oil, breakeven inflation, and the front end of the Treasury curve first. That is the cleanest read on whether the shock is staying inflationary.",
      "Then watch credit spreads and cyclicals. If they weaken alongside higher energy, the market is shifting from inflation concern to growth damage.",
    ];
  } else if (queryType === "country_region") {
    const region = focus.countries[0] ?? leadHeadline?.country ?? "the country in focus";
    summary = `The answer should stay centered on ${region} and how that story transmits into FX, rates, and regional risk appetite.`;
    answer = [
      leadHeadline
        ? `The closest live headline is "${leadHeadline.title}" from ${leadHeadline.source}, which matters because it changes how investors price ${region}-specific policy and risk.`
        : `The first step is to isolate the local catalyst in ${region} and separate it from broader global noise.`,
      region === "Japan" || focus.assets.includes("yen")
        ? "For Japan, the main chain is policy expectations into yen moves, then exporter earnings, then regional equity sentiment."
        : `For ${region}, the market question is whether the story stays local or starts to spill into dollar funding, commodity pricing, or neighboring risk assets.`,
      leadMarket
        ? `${leadMarket.symbol} is the first market confirmation point and is currently ${formatPct(leadMarket.changePct)} on the latest read.`
        : "The first confirmation point is whether FX, local rates, and equities all move in the same direction.",
    ];
    keyRisks = [
      `${region}: a local headline becomes more serious when it starts changing policy expectations rather than only sentiment.`,
      secondHeadline ? `"${secondHeadline.title}" suggests the theme may be broadening beyond a single headline.` : "A second confirming headline would tell you the move is becoming more durable.",
      "If the story collides with dollar strength or oil strength, local assets usually absorb more pain.",
    ];
    marketImpact = [
      leadMarket ? `${leadMarket.symbol} is the fastest live signal and is currently ${formatPct(leadMarket.changePct)}.` : "FX is often the fastest signal for country-specific risk.",
      secondMarket ? `${secondMarket.symbol} is the next market to confirm or reject the move.` : "Then watch rates and local equities for confirmation.",
    ];
  } else if (queryType === "portfolio") {
    summary = "From a portfolio angle, the main issue is whether this remains a narrow headline shock or turns into a wider repricing of rates, FX, and beta.";
    answer = [
      `For the portfolio, start by mapping the question into exposures: ${focusLabel || "rates, FX, commodities, and index beta"}.`,
      "The important distinction is whether the shock is idiosyncratic to one country or sector, or whether it changes funding conditions and market-wide risk appetite.",
      leadHeadline
        ? `The strongest live context item is "${leadHeadline.title}", which should be tested against your largest correlated exposures rather than treated as an isolated news event.`
        : "If there is no single dominant live headline, focus on correlation clusters and where your drawdown would come from if the move broadens.",
    ];
    keyRisks = [
      "A portfolio drawdown usually accelerates when the same shock hits earnings, duration, and FX at once.",
      leadMarket ? `${leadMarket.symbol} is a useful stress signal because it shows whether the shock is already transmitting into liquid markets.` : "Rates, FX, and oil remain the first three stress signals.",
      "If hedges depend on the same macro factor as the book, diversification can vanish when you need it most.",
    ];
    marketImpact = [
      "Watch beta, rates sensitivity, FX translation, and commodity exposure separately rather than using a single portfolio label.",
      secondMarket ? `${secondMarket.symbol} is the next market to check for confirmation.` : "Cross-asset confirmation matters more than any single price move.",
    ];
  } else {
    if (leadHeadline) summary = `The best live fit for this question is "${leadHeadline.title}", but the answer should still stay tied to ${focusLabel || "the user’s stated target"}.`;
    answer = [
      focus.asksImportance
        ? `The first thing that matters is whether ${focusLabel || "the target market"} is being driven by a local catalyst or by a broader global repricing.`
        : `The answer should start with ${focusLabel || "the target risk"} itself, not with a generic market template.`,
      leadHeadline
        ? `The strongest live headline match is "${leadHeadline.title}" from ${leadHeadline.source}.`
        : "There is no single dominant live headline match, so cross-asset confirmation matters more than headline count.",
      leadMarket
        ? `${leadMarket.symbol} is the first confirmation point, currently ${formatPct(leadMarket.changePct)} on the latest read.`
        : "The first confirmation point is whether related assets begin moving together.",
    ];
    keyRisks = [
      leadHeadline
        ? `${leadHeadline.country}: if the story broadens, the market will treat it as more than a one-headline event.`
        : "The main risk is that the market reprices faster than the headlines suggest.",
      leadMarket
        ? `${leadMarket.symbol}: if the move extends beyond ${formatPct(leadMarket.changePct)}, the repricing is becoming more durable.`
        : "Rates, FX, and commodities remain the first three confirmation checks.",
      secondHeadline ? `"${secondHeadline.title}" suggests the theme is not isolated to one source.` : "A second confirming headline would strengthen the signal.",
    ];
    marketImpact = [
      leadMarket ? `${leadMarket.symbol} is the fastest market signal and is currently ${formatPct(leadMarket.changePct)}.` : "The fastest signals are usually FX, rates, and oil.",
      secondMarket ? `${secondMarket.symbol} is the next market to confirm or reject the move.` : "The next confirmation should come from a related asset, not just another headline.",
    ];
  }

  return {
    summary,
    answer,
    keyRisks,
    marketImpact,
    watchlist,
    relatedArticles: headlines.slice(0, 3),
    followUp:
      queryType === "portfolio"
        ? "If you want, I can narrow this to sector risk, factor exposure, or hedge ideas."
        : "If you want, I can narrow this to one country, one asset, or one portfolio sleeve.",
    confidenceLabel: context.engineState === "live" ? "Live model" : "Context-driven answer",
    queryType,
  };
}

async function generateOpenAiReply(message: string, history: NonNullable<RequestBody["history"]>, context: ChatContextPayload): Promise<ChatReply | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const effectiveQuestion = deriveEffectiveQuestion(message, history);
  const queryType = detectQueryType(effectiveQuestion);
  const rankedHeadlines = [...context.headlines].sort((a, b) => scoreHeadline(b, effectiveQuestion) - scoreHeadline(a, effectiveQuestion));
  const rankedMarkets = [...context.markets].sort((a, b) => scoreMarket(b, effectiveQuestion) - scoreMarket(a, effectiveQuestion));
  const shortlistedContext = {
    queryType,
    effectiveQuestion,
    headlines: rankedHeadlines.slice(0, 5),
    markets: rankedMarkets.slice(0, 6),
    watchAssets: buildWatchlist(effectiveQuestion, rankedMarkets),
    recentHistory: history.slice(-8),
  };
  const prompt = [
    `User question: ${message.trim()}`,
    effectiveQuestion !== message.trim() ? `Resolved question with history: ${effectiveQuestion}` : "",
    shortlistedContext.recentHistory.length
      ? `Recent conversation:\n${shortlistedContext.recentHistory.map((item) => `- ${item.role}: ${item.content}`).join("\n")}`
      : "",
    `Query type: ${queryType}`,
    `Market context:\n${shortlistedContext.markets.map((item) => `- ${item.symbol} (${item.name}): ${formatPct(item.changePct)}`).join("\n")}`,
    `Headline context:\n${shortlistedContext.headlines.map((item) => `- ${item.country}: ${item.title} | ${item.source} | ${item.url}`).join("\n")}`,
    `Suggested watchlist: ${shortlistedContext.watchAssets.join(", ") || "none"}`,
    "Return strict JSON only.",
  ].filter(Boolean).join("\n\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "You are WorldLens Macro Analyst AI. Answer the user's actual question directly before adding structure. Use recent history to resolve follow-ups. Do not use canned bullish/bearish/scenario templates. Keep the answer specific to the target country, asset, headline, or portfolio named by the user. If the user writes casually or imprecisely, infer the intended macro target from the question itself and answer that target. Return strict JSON with keys summary, answer, keyRisks, marketImpact, watchlist, relatedArticles, followUp, confidenceLabel, queryType. relatedArticles must only be chosen from the provided shortlist.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "macro_chat_reply",
          schema: {
            type: "object",
            properties: {
              summary: { type: "string" },
              answer: { type: "array", items: { type: "string" } },
              keyRisks: { type: "array", items: { type: "string" } },
              marketImpact: { type: "array", items: { type: "string" } },
              watchlist: { type: "array", items: { type: "string" } },
              relatedArticles: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    source: { type: "string" },
                    url: { type: "string" },
                    country: { type: "string" },
                    image: { anyOf: [{ type: "string" }, { type: "null" }] },
                  },
                  required: ["title", "source", "url", "country", "image"],
                  additionalProperties: false,
                },
              },
              followUp: { type: "string" },
              confidenceLabel: { type: "string" },
              queryType: { type: "string" },
            },
            required: ["summary", "answer", "keyRisks", "marketImpact", "watchlist", "relatedArticles", "followUp", "confidenceLabel", "queryType"],
            additionalProperties: false,
          },
        },
      },
    }),
  });

  if (!response.ok) return null;
  const payload = await response.json();
  const outputText = extractOutputText(payload);
  if (!outputText) return null;

  try {
    const raw = JSON.parse(outputText) as ChatReply;
    const allowed = new Map(context.headlines.map((item) => [item.url, item]));
    return {
      summary: raw.summary?.trim() || buildFallbackReply(message, context).summary,
      answer: Array.isArray(raw.answer) ? raw.answer.filter((item) => typeof item === "string" && item.trim()) : [],
      keyRisks: Array.isArray(raw.keyRisks) ? raw.keyRisks.filter((item) => typeof item === "string" && item.trim()) : [],
      marketImpact: Array.isArray(raw.marketImpact) ? raw.marketImpact.filter((item) => typeof item === "string" && item.trim()) : [],
      watchlist: Array.isArray(raw.watchlist) ? raw.watchlist.filter((item) => typeof item === "string" && item.trim()) : shortlistedContext.watchAssets,
      relatedArticles: Array.isArray(raw.relatedArticles)
        ? raw.relatedArticles.map((item) => allowed.get(item.url)).filter((item): item is NonNullable<typeof item> => Boolean(item))
        : [],
      followUp: raw.followUp?.trim() || "If you want, I can narrow this further.",
      confidenceLabel: raw.confidenceLabel?.trim() || "Live model",
      queryType: (raw.queryType as ChatContextPayload["queryType"]) || queryType,
    };
  } catch {
    return null;
  }
}

async function buildFallbackPayload(message: string) {
  const [marketsResult, headlinesResult] = await Promise.allSettled([fetchMarketSeries("1M"), fetchGlobalNews()]);
  const markets = marketsResult.status === "fulfilled" ? marketsResult.value : [];
  const headlines = headlinesResult.status === "fulfilled" ? headlinesResult.value : [];
  const context: ChatContextPayload = {
    markets: markets.slice(0, 8).map((item) => ({
      symbol: item.symbol,
      name: item.name,
      latest: item.points.at(-1)?.value ?? null,
      changePct: item.points.length >= 2 ? ((item.points.at(-1)?.value ?? 0) - (item.points.at(-2)?.value ?? 0)) / (item.points.at(-2)?.value || 1) * 100 : null,
      source: item.source,
    })),
    headlines: headlines.slice(0, 8).map((item) => ({
      title: item.title,
      source: item.source,
      url: item.url,
      country: item.country,
      image: item.image,
    })),
    watchAssets: [],
    engineState: "standby",
    queryType: detectQueryType(message),
  };
  const reply = buildFallbackReply(message, context);
  context.watchAssets = reply.watchlist;
  return { reply, context, updatedAt: new Date().toISOString() };
}

export async function POST(request: NextRequest) {
  const upstream = `${getApiUrl()}/intel/chat`;

  try {
    const body = (await request.json().catch(() => ({}))) as RequestBody;
    const message = body.message?.trim() || "What are the top global risks markets should care about right now?";
    const history = body.history ?? [];

    try {
      const response = await fetch(upstream, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history }),
        cache: "no-store",
      });

      if (response.ok) {
        const payload = await response.json();
        return NextResponse.json(payload);
      }
    } catch {
      // Fall through to local fallback.
    }

    const fallbackPayload = await buildFallbackPayload(message);
    const aiReply = await generateOpenAiReply(message, history, fallbackPayload.context);
    if (aiReply) {
      return NextResponse.json({
        reply: aiReply,
        context: {
          ...fallbackPayload.context,
          watchAssets: aiReply.watchlist,
          engineState: "live" as const,
          queryType: aiReply.queryType,
        },
        updatedAt: new Date().toISOString(),
      });
    }

    return NextResponse.json(fallbackPayload);
  } catch {
    const message = "What are the top global risks markets should care about right now?";
    return NextResponse.json(await buildFallbackPayload(message));
  }
}
