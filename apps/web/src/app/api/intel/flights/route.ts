import { NextResponse } from "next/server";
import { fetchFlights } from "@/services/flightsService";

export const runtime = "nodejs";

export async function GET() {
  const result = await fetchFlights();
  return NextResponse.json(result, { status: result.status === "error" ? 502 : 200 });
}
