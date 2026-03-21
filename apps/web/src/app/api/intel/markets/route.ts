import { NextRequest, NextResponse } from "next/server";
import { fetchMarketSeries, Timeframe } from "@/services/marketService";

const VALID_TIMEFRAMES = new Set<Timeframe>(["1D", "1W", "1M", "3M", "6M", "1Y"]);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const timeframeRaw = (searchParams.get("timeframe") ?? "1M") as Timeframe;
    const timeframe = VALID_TIMEFRAMES.has(timeframeRaw) ? timeframeRaw : "1M";

    const items = await fetchMarketSeries(timeframe);
    return NextResponse.json({ items, timeframe, updatedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ items: [], error: error instanceof Error ? error.message : "Failed to fetch markets" }, { status: 500 });
  }
}
