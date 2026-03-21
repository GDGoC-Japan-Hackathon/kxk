const CELESTRAK_URL =
  "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.max(1, Math.min(Number(searchParams.get("limit") ?? "8"), 20));

  try {
    const response = await fetch(CELESTRAK_URL, {
      cache: "no-store",
      next: { revalidate: 0 },
    });

    if (!response.ok) {
      return Response.json(
        { error: `CelesTrak upstream failed with ${response.status}` },
        { status: 502 },
      );
    }

    const tle = await response.text();
    const limited = tle
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(0, limit * 3)
      .join("\n");

    return Response.json({ tle: limited });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Unable to reach CelesTrak." }, { status: 502 });
  }
}
