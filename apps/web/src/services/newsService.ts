export type NewsCategory = "politics" | "economy" | "technology" | "energy" | "security" | "crypto";

export interface NewsItem {
  title: string;
  description: string;
  url: string;
  image: string | null;
  source: string;
  publishedAt: string;
  country: string;
  countryCode: string;
  continent: string;
  category: NewsCategory;
}

type GdeltArticle = {
  title?: string;
  url?: string;
  socialimage?: string;
  seendate?: string;
  sourceCommonName?: string;
  sourcecountry?: string;
  domain?: string;
  snippet?: string;
};

type RssItem = {
  title: string;
  url: string;
  source?: string;
  publishedAt: string;
  description: string;
};

const CATEGORY_QUERY: Record<NewsCategory, string> = {
  politics: "(geopolitics OR election OR diplomacy OR sanctions OR conflict OR tariff)",
  economy: "(inflation OR central bank OR GDP OR CPI OR recession OR bond yields)",
  technology: "(AI OR semiconductors OR cloud OR antitrust OR cyber OR chip exports)",
  energy: "(oil OR gas OR OPEC OR LNG OR shipping OR commodities)",
  security: "(war OR military OR defense OR missiles OR treaty OR security)",
  crypto: "(bitcoin OR ethereum OR crypto OR stablecoin OR SEC OR exchange)",
};

const RSS_QUERY: Record<NewsCategory, string> = {
  politics: "geopolitics OR elections OR diplomacy OR sanctions",
  economy: "inflation OR central bank OR GDP OR recession",
  technology: "AI OR semiconductors OR cyber OR antitrust",
  energy: "oil OR gas OR LNG OR OPEC OR shipping",
  security: "war OR military OR defense OR missiles",
  crypto: "bitcoin OR ethereum OR crypto OR stablecoin",
};

const CONTINENT_BY_CODE: Record<string, string> = {
  US: "North America",
  CA: "North America",
  MX: "North America",
  BR: "South America",
  AR: "South America",
  CL: "South America",
  CO: "South America",
  PE: "South America",
  GB: "Europe",
  IE: "Europe",
  FR: "Europe",
  DE: "Europe",
  ES: "Europe",
  IT: "Europe",
  NL: "Europe",
  BE: "Europe",
  CH: "Europe",
  AT: "Europe",
  PL: "Europe",
  UA: "Europe",
  RU: "Europe",
  TR: "Europe",
  SA: "Asia",
  AE: "Asia",
  IL: "Asia",
  IR: "Asia",
  IN: "Asia",
  CN: "Asia",
  JP: "Asia",
  KR: "Asia",
  ID: "Asia",
  SG: "Asia",
  TH: "Asia",
  VN: "Asia",
  AU: "Oceania",
  NZ: "Oceania",
  ZA: "Africa",
  EG: "Africa",
  NG: "Africa",
  KE: "Africa",
  MA: "Africa",
  QA: "Asia",
};

const TLD_COUNTRY_MAP: Record<string, string> = {
  uk: "GB",
  jp: "JP",
  kr: "KR",
  in: "IN",
  de: "DE",
  fr: "FR",
  it: "IT",
  es: "ES",
  ru: "RU",
  cn: "CN",
  au: "AU",
  ca: "CA",
  br: "BR",
  za: "ZA",
  us: "US",
  tr: "TR",
  sa: "SA",
  ae: "AE",
};

const COUNTRY_KEYWORDS: Array<{ code: string; terms: string[] }> = [
  { code: "US", terms: ["united states", "u.s.", "us ", "america", "washington"] },
  { code: "CA", terms: ["canada", "ottawa"] },
  { code: "MX", terms: ["mexico", "mexican", "mexico city"] },
  { code: "BR", terms: ["brazil", "brazilian", "brasil", "brasilia"] },
  { code: "AR", terms: ["argentina", "argentine", "buenos aires"] },
  { code: "CL", terms: ["chile", "chilean", "santiago"] },
  { code: "CO", terms: ["colombia", "colombian", "bogota"] },
  { code: "PE", terms: ["peru", "peruvian", "lima"] },
  { code: "VE", terms: ["venezuela", "venezuelan", "caracas"] },
  { code: "EC", terms: ["ecuador", "ecuadorian", "quito"] },
  { code: "UY", terms: ["uruguay", "uruguayan", "montevideo"] },
  { code: "PY", terms: ["paraguay", "asuncion"] },
  { code: "BO", terms: ["bolivia", "bolivian", "la paz"] },
  { code: "GB", terms: ["united kingdom", "britain", "british", "england", "london"] },
  { code: "FR", terms: ["france", "french", "paris"] },
  { code: "DE", terms: ["germany", "german", "berlin"] },
  { code: "ES", terms: ["spain", "spanish", "madrid"] },
  { code: "IT", terms: ["italy", "italian", "rome"] },
  { code: "NL", terms: ["netherlands", "dutch", "amsterdam"] },
  { code: "BE", terms: ["belgium", "belgian", "brussels"] },
  { code: "CH", terms: ["switzerland", "swiss", "zurich", "geneva"] },
  { code: "AT", terms: ["austria", "austrian", "vienna"] },
  { code: "PL", terms: ["poland", "polish", "warsaw"] },
  { code: "UA", terms: ["ukraine", "ukrainian", "kyiv", "kiev"] },
  { code: "RO", terms: ["romania", "romanian", "bucharest"] },
  { code: "GR", terms: ["greece", "greek", "athens"] },
  { code: "TR", terms: ["turkey", "turkish", "ankara", "istanbul"] },
  { code: "RU", terms: ["russia", "russian", "moscow", "kremlin"] },
  { code: "MA", terms: ["morocco", "moroccan", "rabat"] },
  { code: "DZ", terms: ["algeria", "algerian", "algiers"] },
  { code: "TN", terms: ["tunisia", "tunisian", "tunis"] },
  { code: "EG", terms: ["egypt", "egyptian", "cairo"] },
  { code: "NG", terms: ["nigeria", "nigerian", "abuja", "lagos"] },
  { code: "GH", terms: ["ghana", "ghanaian", "accra"] },
  { code: "CI", terms: ["ivory coast", "cote d'ivoire", "abidjan"] },
  { code: "CM", terms: ["cameroon", "cameroonian", "yaounde"] },
  { code: "ET", terms: ["ethiopia", "ethiopian", "addis ababa"] },
  { code: "KE", terms: ["kenya", "kenyan", "nairobi"] },
  { code: "TZ", terms: ["tanzania", "tanzanian", "dar es salaam"] },
  { code: "UG", terms: ["uganda", "ugandan", "kampala"] },
  { code: "ZA", terms: ["south africa", "south african", "johannesburg", "pretoria", "cape town"] },
  { code: "AO", terms: ["angola", "luanda"] },
  { code: "MZ", terms: ["mozambique", "maputo"] },
  { code: "SA", terms: ["saudi arabia", "saudi", "riyadh"] },
  { code: "AE", terms: ["united arab emirates", "uae", "dubai", "abu dhabi"] },
  { code: "IL", terms: ["israel", "israeli", "jerusalem", "tel aviv"] },
  { code: "IR", terms: ["iran", "iranian", "tehran"] },
  { code: "IQ", terms: ["iraq", "iraqi", "baghdad"] },
  { code: "QA", terms: ["qatar", "qatari", "doha"] },
  { code: "IN", terms: ["india", "indian", "new delhi", "mumbai"] },
  { code: "PK", terms: ["pakistan", "pakistani", "islamabad"] },
  { code: "BD", terms: ["bangladesh", "dhaka"] },
  { code: "CN", terms: ["china", "chinese", "beijing"] },
  { code: "JP", terms: ["japan", "japanese", "tokyo"] },
  { code: "KR", terms: ["south korea", "korea", "korean", "seoul"] },
  { code: "TW", terms: ["taiwan", "taipei"] },
  { code: "TH", terms: ["thailand", "thai", "bangkok"] },
  { code: "VN", terms: ["vietnam", "vietnamese", "hanoi", "ho chi minh"] },
  { code: "MY", terms: ["malaysia", "malaysian", "kuala lumpur"] },
  { code: "SG", terms: ["singapore", "singaporean"] },
  { code: "ID", terms: ["indonesia", "indonesian", "jakarta"] },
  { code: "PH", terms: ["philippines", "philippine", "manila"] },
  { code: "AU", terms: ["australia", "australian", "canberra", "sydney"] },
  { code: "NZ", terms: ["new zealand", "wellington", "auckland"] },
];

let cache: { ts: number; data: NewsItem[] } | null = null;
const TTL_MS = 1000 * 60 * 8;
const NEWS_FETCH_TIMEOUT_MS = 6500;
function sanitizeJsonText(raw: string) {
  return raw.replace(/[\u0000-\u001f]/g, "");
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const raw = await response.text();
  return JSON.parse(sanitizeJsonText(raw)) as T;
}

async function fetchWithTimeout(input: string, init?: RequestInit, timeoutMs = NEWS_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeCountryCode(value: string | undefined, urlRaw: string | undefined) {
  const direct = (value ?? "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(direct) && direct !== "ZZ") return direct;

  try {
    const host = new URL(urlRaw ?? "").hostname;
    const tld = host.split(".").at(-1)?.toLowerCase() ?? "";
    return TLD_COUNTRY_MAP[tld] ?? "GL";
  } catch {
    return "GL";
  }
}

function inferCountryFromText(article: GdeltArticle) {
  const haystack = `${article.title ?? ""} ${article.snippet ?? ""} ${article.url ?? ""}`.toLowerCase();
  if (!haystack.trim()) return null;

  let best: { code: string; score: number } | null = null;
  for (const entry of COUNTRY_KEYWORDS) {
    let score = 0;
    for (const term of entry.terms) {
      if (haystack.includes(term)) score += term.length > 6 ? 2 : 1;
    }
    if (!score) continue;
    if (!best || score > best.score) best = { code: entry.code, score };
  }

  return best?.code ?? null;
}

function countryName(code: string) {
  if (code === "GL") return "Global";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function continentName(code: string) {
  return CONTINENT_BY_CODE[code] ?? "Global";
}

function normalizeArticle(article: GdeltArticle, category: NewsCategory): NewsItem | null {
  if (!article.title || !article.url || !article.seendate) return null;

  const countryCode = inferCountryFromText(article) ?? normalizeCountryCode(article.sourcecountry, article.url);
  return {
    title: article.title.trim(),
    description: article.snippet?.trim() ?? "",
    url: article.url,
    image: article.socialimage?.trim() || null,
    source: article.sourceCommonName?.trim() || article.domain?.trim() || "GDELT",
    publishedAt: article.seendate,
    country: countryName(countryCode),
    countryCode,
    continent: continentName(countryCode),
    category,
  };
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractTag(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1].trim()) : "";
}

function extractMetaContent(html: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const value = match?.[1]?.trim();
    if (value) return decodeXml(value);
  }
  return null;
}

function normalizeImageUrl(raw: string | null, pageUrl: string) {
  if (!raw) return null;
  try {
    return new URL(raw, pageUrl).toString();
  } catch {
    return null;
  }
}

function extractMetaImageFromDescription(description: string, pageUrl: string) {
  const image = extractMetaContent(description, [
    /<img[^>]+src=["']([^"']+)["']/i,
    /<source[^>]+srcset=["']([^"'\s,]+)[^"']*["']/i,
  ]);
  return normalizeImageUrl(image, pageUrl);
}

function parseRssItems(xml: string): RssItem[] {
  const items: Array<RssItem | null> = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)]
    .map((match) => {
      const block = match[1];
      const title = extractTag(block, "title");
      const url = extractTag(block, "link");
      const publishedAt = extractTag(block, "pubDate");
      const description = extractTag(block, "description");
      const source = extractTag(block, "source");
      if (!title || !url) return null;
      return {
        title,
        url,
        source: source || "Google News",
        publishedAt: publishedAt ? new Date(publishedAt).toISOString() : new Date().toISOString(),
        description,
      };
    });

  return items.filter((item): item is RssItem => item !== null);
}

async function fetchRssByCategory(category: NewsCategory): Promise<NewsItem[]> {
  const params = new URLSearchParams({
    q: RSS_QUERY[category],
    hl: "en-US",
    gl: "US",
    ceid: "US:en",
  });
  const response = await fetchWithTimeout(`https://news.google.com/rss/search?${params.toString()}`, {
    headers: {
      Accept: "application/rss+xml, application/xml, text/xml",
    },
    next: { revalidate: 300 },
  });

  if (!response.ok) {
    throw new Error(`Google News RSS failed (${response.status}) for ${category}`);
  }

  const xml = await response.text();
  const items: Array<NewsItem | null> = parseRssItems(xml)
    .map((item) => {
      const countryCode = inferCountryFromText({
        title: item.title,
        snippet: item.description,
        url: item.url,
      }) ?? normalizeCountryCode(undefined, item.url);

      if (!countryCode || countryCode === "GL") return null;
      return {
        title: item.title,
        description: item.description,
        url: item.url,
        image: extractMetaImageFromDescription(item.description, item.url),
        source: item.source ?? "Google News",
        publishedAt: item.publishedAt,
        country: countryName(countryCode),
        countryCode,
        continent: continentName(countryCode),
        category,
      } satisfies NewsItem;
    });

  return items.filter((item): item is NewsItem => item !== null);
}

async function fetchByCategory(category: NewsCategory): Promise<NewsItem[]> {
  const params = new URLSearchParams({
    query: CATEGORY_QUERY[category],
    mode: "ArtList",
    format: "json",
    maxrecords: "80",
    sort: "DateDesc",
    formatting: "json",
  });

  const response = await fetchWithTimeout(`https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`, {
    next: { revalidate: 300 },
  });

  if (!response.ok) {
    throw new Error(`GDELT request failed (${response.status}) for ${category}`);
  }

  const payload = await parseJsonResponse<{ articles?: GdeltArticle[] }>(response);
  return (payload.articles ?? [])
    .map((article) => normalizeArticle(article, category))
    .filter((item): item is NewsItem => item !== null);
}

export async function fetchGlobalNews(): Promise<NewsItem[]> {
  const now = Date.now();
  if (cache && now - cache.ts < TTL_MS) return cache.data;

  const categories = Object.keys(CATEGORY_QUERY) as NewsCategory[];
  const grouped = await Promise.allSettled(categories.map((category) => fetchByCategory(category)));
  const rssGrouped = await Promise.allSettled(categories.map((category) => fetchRssByCategory(category)));

  const dedup = new Map<string, NewsItem>();
  for (const result of grouped) {
    if (result.status !== "fulfilled") continue;
    for (const item of result.value) {
      if (!dedup.has(item.url)) dedup.set(item.url, item);
    }
  }
  for (const result of rssGrouped) {
    if (result.status !== "fulfilled") continue;
    for (const item of result.value) {
      if (!dedup.has(item.url)) dedup.set(item.url, item);
    }
  }

  if (dedup.size === 0) {
    const rejected = grouped.find((result) => result.status === "rejected") as PromiseRejectedResult | undefined;
    const rssRejected = rssGrouped.find((result) => result.status === "rejected") as PromiseRejectedResult | undefined;
    if (rejected) throw rejected.reason;
    if (rssRejected) throw rssRejected.reason;
  }

  const normalized = [...dedup.values()]
    .filter((item) => item.countryCode !== "GL")
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  cache = { ts: now, data: normalized };
  return normalized;
}
