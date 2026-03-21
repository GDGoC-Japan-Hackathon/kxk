import { NextResponse } from "next/server";
import { fetchSatellites } from "@/services/satellitesService";

export const runtime = "nodejs";

export async function GET() {
  const result = await fetchSatellites();
  return NextResponse.json(result, { status: result.status === "error" ? 502 : 200 });
}
