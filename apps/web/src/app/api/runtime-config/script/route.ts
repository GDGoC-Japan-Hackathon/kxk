import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const runtimeConfig = {
    apiBaseUrl: process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000",
    cesiumIonToken: process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN ?? "",
  };

  return new NextResponse(
    `window.__WORLDLENS_RUNTIME_CONFIG__ = ${JSON.stringify(runtimeConfig)};`,
    {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  );
}
