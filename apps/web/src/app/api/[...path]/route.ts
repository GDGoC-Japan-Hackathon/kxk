import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const resolved = await params;
  return handleProxy(request, resolved.path);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const resolved = await params;
  return handleProxy(request, resolved.path);
}

async function handleProxy(request: NextRequest, pathArray: string[]) {
  try {
    const baseUrl = process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";
    const path = pathArray.length ? `/${pathArray.join("/")}` : "";
    const queryString = request.nextUrl.searchParams.toString();
    const targetUrl = `${baseUrl}${path}${queryString ? `?${queryString}` : ""}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    const fetchOptions: RequestInit = {
      method: request.method,
      headers: {
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
      fetchOptions.body = await request.text();
    }

    const response = await fetch(targetUrl, fetchOptions);
    clearTimeout(timeoutId);

    const text = await response.text();
    const data = text ? (JSON.parse(text) as unknown) : null;

    return NextResponse.json(data, { status: response.status });
  } catch (error: unknown) {
    const reason = error instanceof Error && error.name === "AbortError" ? "proxy timeout" : "proxy error";
    return NextResponse.json(
      {
        status: "error",
        updated_at: new Date().toISOString(),
        source: "bff",
        reason,
        data: null,
      },
      { status: 500 },
    );
  }
}
