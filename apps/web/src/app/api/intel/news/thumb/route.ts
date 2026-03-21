import { NextRequest, NextResponse } from "next/server";

type NewsCategory = "politics" | "economy" | "technology" | "energy" | "security" | "crypto";

const CATEGORY_THEME: Record<NewsCategory, { start: string; end: string; accent: string }> = {
  politics: { start: "#10233f", end: "#224f86", accent: "#dbeafe" },
  economy: { start: "#1d2a3b", end: "#0f766e", accent: "#ccfbf1" },
  technology: { start: "#1b1f3b", end: "#4338ca", accent: "#e0e7ff" },
  energy: { start: "#3b1d14", end: "#b45309", accent: "#ffedd5" },
  security: { start: "#2b1220", end: "#9f1239", accent: "#ffe4e6" },
  crypto: { start: "#2f1f4a", end: "#7c3aed", accent: "#f3e8ff" },
};

function escapeSvgText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sourceBadge(source: string) {
  return source
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 3)
    .toUpperCase() || "WL";
}

function clampText(value: string, max: number) {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…` : value;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const title = clampText(searchParams.get("title")?.trim() || "WorldLens News", 90);
  const source = clampText(searchParams.get("source")?.trim() || "WorldLens", 32);
  const country = clampText(searchParams.get("country")?.trim() || "Global", 28);
  const category = (searchParams.get("category")?.trim() as NewsCategory) || "politics";
  const theme = CATEGORY_THEME[category] ?? CATEGORY_THEME.politics;
  const badge = escapeSvgText(sourceBadge(source));
  const safeTitle = escapeSvgText(title);
  const meta = escapeSvgText(`${country} · ${source}`);

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${theme.start}" />
          <stop offset="100%" stop-color="${theme.end}" />
        </linearGradient>
      </defs>
      <rect width="1200" height="675" rx="36" fill="url(#bg)" />
      <circle cx="1060" cy="140" r="180" fill="rgba(255,255,255,0.08)" />
      <circle cx="120" cy="600" r="220" fill="rgba(255,255,255,0.06)" />
      <rect x="72" y="68" width="132" height="64" rx="20" fill="rgba(255,255,255,0.14)" />
      <text x="138" y="110" text-anchor="middle" font-size="34" font-family="Arial, sans-serif" font-weight="700" fill="${theme.accent}">${badge}</text>
      <foreignObject x="72" y="170" width="1056" height="320">
        <div xmlns="http://www.w3.org/1999/xhtml" style="color:#ffffff;font-family:Arial,sans-serif;font-size:58px;font-weight:700;line-height:1.14;">
          ${safeTitle}
        </div>
      </foreignObject>
      <text x="72" y="598" font-size="34" font-family="Arial, sans-serif" fill="${theme.accent}">${meta}</text>
    </svg>
  `.trim();

  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
