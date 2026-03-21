import { NextRequest, NextResponse } from "next/server";
import { getApiUrl } from "@/lib/api";
import { generateAiAnalysis } from "@/services/aiService";
import { Timeframe } from "@/services/marketService";

const VALID_TIMEFRAMES = new Set<Timeframe>(["1D", "1W", "1M", "3M", "6M", "1Y"]);

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { timeframe?: Timeframe };
    const timeframe = body.timeframe && VALID_TIMEFRAMES.has(body.timeframe) ? body.timeframe : "1W";
    const response = await fetch(`${getApiUrl()}/intel/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timeframe }),
      cache: "no-store",
    });
    if (response.ok) {
      const text = await response.text();
      return new NextResponse(text, {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const analysis = await generateAiAnalysis(timeframe);
    return NextResponse.json({ analysis, updatedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The analysis service is temporarily unavailable." },
      { status: 502 },
    );
  }
}
