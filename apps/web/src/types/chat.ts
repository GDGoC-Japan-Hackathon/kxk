export type ChatMode = "Macro" | "Geopolitics" | "Markets" | "Portfolio Risk";

export type ChatQueryType = "global_risk" | "country_region" | "market_asset" | "portfolio";

export type ChatReply = {
  summary: string;
  answer: string[];
  keyRisks: string[];
  marketImpact: string[];
  watchlist: string[];
  relatedArticles: ContextHeadline[];
  followUp: string;
  confidenceLabel: string;
  queryType: ChatQueryType;
};

export type ChatMessage =
  | {
      id: string;
      role: "user";
      content: string;
      createdAt: string;
    }
  | {
      id: string;
      role: "assistant";
      content: string;
      createdAt: string;
      reply: ChatReply;
      engineState: "live" | "standby";
    };

export type ContextHeadline = {
  title: string;
  source: string;
  url: string;
  country: string;
  image: string | null;
};

export type ContextMarket = {
  symbol: string;
  name: string;
  latest: number | null;
  changePct: number | null;
  source: string;
};

export type ChatContextPayload = {
  markets: ContextMarket[];
  headlines: ContextHeadline[];
  watchAssets: string[];
  engineState: "live" | "standby";
  queryType: ChatQueryType;
};

export type ChatResponsePayload = {
  reply: ChatReply;
  context: ChatContextPayload;
};

export type ChatRequestPayload = {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
};

export type AiAnalysis = {
  marketSummary: string;
  bullishFactors: string[];
  bearishRisks: string[];
  scenarioOutlook: string;
};
