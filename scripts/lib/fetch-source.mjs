// fetch-source.mjs — fetches an official government page and strips it down
// to plain text for the Claude prompt. Network I/O lives only here so the
// rest of the pipeline stays testable without mocking fetch everywhere.

const USER_AGENT = 'Mozilla/5.0 (compatible; MologoFiscalBot/1.0; +https://mologo.app)';
const TIMEOUT_MS = 15000;
const MAX_CHARS = 8000;

/**
 * Fetches a URL and returns stripped plain text, or null on any failure
 * (network error, non-2xx, timeout). Never throws.
 */
export async function fetchPageText(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, MAX_CHARS);
    return { ok: true, text };
  } catch (e) {
    return { ok: false, reason: e.message || String(e) };
  }
}

/**
 * Fetches all URLs for a country, concatenated with a header per source so
 * Claude can cite which one a quote came from.
 */
export async function fetchCountryPages(urls) {
  const parts = [];
  const failures = [];
  for (const url of urls) {
    const result = await fetchPageText(url);
    if (result.ok) {
      parts.push(`--- SOURCE: ${url} ---\n${result.text}`);
    } else {
      failures.push({ url, reason: result.reason });
    }
  }
  return { text: parts.join('\n\n'), failures };
}
