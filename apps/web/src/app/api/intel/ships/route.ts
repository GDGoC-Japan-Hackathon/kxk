import { NextResponse } from "next/server";
import { fetchShips } from "@/services/shipsService";

export const runtime = "nodejs";

export async function GET() {
  const result = await fetchShips();
  const status = result.status === "error" ? 502 : 200;
  return NextResponse.json(result, { status });
}
