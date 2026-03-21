export type Timeframe = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y";

export interface MarketPoint {
  time: number;
  value: number;
}

export interface MarketSeries {
  symbol: "BTC" | "SP500" | "NASDAQ" | "GOLD" | "DXY" | "OIL";
  name: string;
  points: MarketPoint[];
  source: string;
}

const TIMEFRAME_DAYS: Record<Timeframe, number> = {
  "1D": 1,
  "1W": 7,
  "1M": 30,
  "3M": 90,
  "6M": 180,
  "1Y": 365,
};

function cutByTimeframe(points: MarketPoint[], timeframe: Timeframe): MarketPoint[] {
  const cutoff = Date.now() - TIMEFRAME_DAYS[timeframe] * 24 * 60 * 60 * 1000;
  return points.filter((point) => point.time >= cutoff);
}

function normalizeFRED(series: Record<string, unknown>[], timeframe: Timeframe): MarketPoint[] {
  return cutByTimeframe(
    series
      .map((item) => {
        const t = Date.parse(String(item.date));
        const v = Number(item.value);
        if (Number.isNaN(t) || Number.isNaN(v)) return null;
        return { time: t, value: v };
      })
      .filter((row): row is MarketPoint => row !== null),
    timeframe,
  );
}

async function fetchBtcSeries(timeframe: Timeframe): Promise<MarketSeries> {
  const days = Math.min(TIMEFRAME_DAYS[timeframe], 365);
  const response = await fetch(`https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${days}`, {
    next: { revalidate: 300 },
  });
  if (!response.ok) throw new Error(`CoinGecko request failed (${response.status})`);
  const payload = (await response.json()) as { prices: Array<[number, number]> };
  const points = payload.prices.map(([time, value]) => ({ time, value }));
  return { symbol: "BTC", name: "Bitcoin", points, source: "CoinGecko" };
}

async function fetchAlphaSeries(symbol: string, name: string, timeframe: Timeframe): Promise<MarketSeries> {
  const apiKey = process.env.ALPHAVANTAGE_API_KEY;
  if (!apiKey) return { symbol: symbol as MarketSeries["symbol"], name, points: [], source: "AlphaVantage" };

  const params = new URLSearchParams({
    function: "TIME_SERIES_DAILY",
    symbol,
    outputsize: "full",
    apikey: apiKey,
  });

  const response = await fetch(`https://www.alphavantage.co/query?${params.toString()}`, {
    next: { revalidate: 900 },
  });
  if (!response.ok) throw new Error(`AlphaVantage request failed (${response.status})`);

  const payload = (await response.json()) as Record<string, Record<string, { "4. close": string }>>;
  const series = payload["Time Series (Daily)"] ?? {};

  const points = cutByTimeframe(
    Object.entries(series)
      .map(([date, ohlc]) => {
        const time = Date.parse(`${date}T00:00:00Z`);
        const value = Number(ohlc["4. close"]);
        if (Number.isNaN(time) || Number.isNaN(value)) return null;
        return { time, value };
      })
      .filter((row): row is MarketPoint => row !== null)
      .sort((a, b) => a.time - b.time),
    timeframe,
  );

  return {
    symbol: (symbol === "SPY" ? "SP500" : "NASDAQ") as MarketSeries["symbol"],
    name,
    points,
    source: "AlphaVantage",
  };
}

async function fetchFredSeries(seriesId: string, symbol: MarketSeries["symbol"], name: string, timeframe: Timeframe): Promise<MarketSeries> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) return { symbol, name, points: [], source: "FRED" };

  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: "json",
    sort_order: "asc",
    limit: "1000",
  });

  const response = await fetch(`https://api.stlouisfed.org/fred/series/observations?${params.toString()}`, {
    next: { revalidate: 1800 },
  });
  if (!response.ok) throw new Error(`FRED request failed (${response.status})`);

  const payload = (await response.json()) as { observations?: Array<Record<string, unknown>> };
  const points = normalizeFRED(payload.observations ?? [], timeframe);
  return { symbol, name, points, source: "FRED" };
}

const cache = new Map<Timeframe, { ts: number; data: MarketSeries[] }>();

export async function fetchMarketSeries(timeframe: Timeframe): Promise<MarketSeries[]> {
  const cached = cache.get(timeframe);
  if (cached && Date.now() - cached.ts < 1000 * 60 * 5) return cached.data;

  const [btc, sp500, nasdaq, gold, dxy, oil] = await Promise.all([
    fetchBtcSeries(timeframe),
    fetchAlphaSeries("SPY", "S&P 500 (SPY proxy)", timeframe),
    fetchAlphaSeries("QQQ", "NASDAQ 100 (QQQ proxy)", timeframe),
    fetchFredSeries("GOLDAMGBD228NLBM", "GOLD", "Gold PM Fix", timeframe),
    fetchFredSeries("DTWEXBGS", "DXY", "Dollar Index", timeframe),
    fetchFredSeries("DCOILWTICO", "OIL", "WTI Crude", timeframe),
  ]);

  const data = [btc, sp500, nasdaq, gold, dxy, oil];
  cache.set(timeframe, { ts: Date.now(), data });
  return data;
}
