import { fetchMarketSeries, Timeframe } from "@/services/marketService";
import { fetchGlobalNews } from "@/services/newsService";

export interface AiAnalysis {
  marketSummary: string;
  bullishFactors: string[];
  bearishRisks: string[];
  scenarioOutlook: string;
}

const FALLBACK_ANALYSIS: AiAnalysis = {
  marketSummary: "Live model coverage is not available for this turn, so the panel is using the latest market and news context instead.",
  bullishFactors: ["Cross-asset confirmation is still limited."],
  bearishRisks: ["A broader macro shock could still force a fresh repricing."],
  scenarioOutlook: "Use the latest rates, FX, and commodity moves as the primary confirmation path.",
};

export async function generateAiAnalysis(timeframe: Timeframe = "1W"): Promise<AiAnalysis> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return FALLBACK_ANALYSIS;

  const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  const [news, markets] = await Promise.all([fetchGlobalNews(), fetchMarketSeries(timeframe)]);

  const compactNews = news.slice(0, 40).map((item) => ({
    title: item.title,
    category: item.category,
    country: item.country,
    publishedAt: item.publishedAt,
  }));

  const compactMarkets = markets.map((series) => ({
    symbol: series.symbol,
    latest: series.points.at(-1)?.value ?? null,
    previous: series.points.at(-2)?.value ?? null,
    source: series.source,
  }));

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content:
            "You are a macro intelligence analyst. Return strict JSON with keys marketSummary:string, bullishFactors:string[], bearishRisks:string[], scenarioOutlook:string.",
        },
        {
          role: "user",
          content: `News: ${JSON.stringify(compactNews)}\nMarkets: ${JSON.stringify(compactMarkets)}`,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "market_analysis",
          schema: {
            type: "object",
            properties: {
              marketSummary: { type: "string" },
              bullishFactors: { type: "array", items: { type: "string" } },
              bearishRisks: { type: "array", items: { type: "string" } },
              scenarioOutlook: { type: "string" },
            },
            required: ["marketSummary", "bullishFactors", "bearishRisks", "scenarioOutlook"],
            additionalProperties: false,
          },
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed (${response.status})`);
  }

  const payload = (await response.json()) as { output_text?: string };
  if (!payload.output_text) return FALLBACK_ANALYSIS;

  try {
    return JSON.parse(payload.output_text) as AiAnalysis;
  } catch {
    return FALLBACK_ANALYSIS;
  }
}
