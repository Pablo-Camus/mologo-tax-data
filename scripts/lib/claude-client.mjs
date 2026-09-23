// claude-client.mjs — thin wrapper around the Anthropic Messages API.
// Network I/O isolated here so parse-proposal.mjs can be unit tested without
// hitting the network.

const MODEL = 'claude-haiku-4-5';
const API_URL = 'https://api.anthropic.com/v1/messages';

function buildHintsSection(hints) {
  if (!hints || (!hints.income_tax && !hints.ss)) return '';
  const lines = ['', 'IMPORTANT country-specific context for this comparison (read before proposing anything):'];
  if (hints.income_tax) lines.push(`- income_tax: ${hints.income_tax}`);
  if (hints.ss) lines.push(`- ss: ${hints.ss}`);
  return lines.join('\n') + '\n';
}

function buildPrompt(code, currentEntry, pageText, hints) {
  return `You are a tax-data extraction assistant for Mologo, a freelance invoicing app. Extract the CURRENT personal income tax brackets and, if present, the mandatory social-security/self-employment contribution rate for self-employed individuals/freelancers in country "${code}" from the official page text below.

Current stored data (for reference — only report "changed": true if the official page clearly shows something different):
${JSON.stringify(currentEntry, null, 2)}
${buildHintsSection(hints)}
CRITICAL rules about what "changed" means:
- Compare the OFFICIAL PAGE's numbers to the stored data as the SAME underlying concept. Many official pages show only a partial figure (a federal/state-only scale, one layer of a multi-layer tax, the employee-side rather than self-employed rate, a regional/municipal variant, an optional alternate regime). If the page's number represents a different concept than what is stored (see any hint above), that is NOT a change — it means the page isn't a like-for-like comparison, so report { "changed": false } unless you can convert it into the same terms the stored data uses (e.g. state-only → combined, using a hint's stated conversion).
- The ss field must always be the SELF-EMPLOYED / freelance contribution regime specifically (e.g. autónomos, Freiberufler, indépendant, self-employment tax) — never the employee-side payroll withholding rate for salaried workers, even if that's what a page shows first.
- You are NEVER allowed to claim the stored data is wrong, outdated by inference, or "incorrect" — you have no authority to judge that. Only report what the official page's text says vs. what is stored, as two facts, and let a human decide. Do not write phrases like "the stored data contained incorrect rates" in "note" or anywhere else.
- If you are not confident the page's figure and the stored figure represent the exact same thing, prefer { "changed": false } over guessing.

Official page content (may include multiple sources, each marked "--- SOURCE: <url> ---"):
${pageText}

Reply with ONLY a JSON object (no markdown fences, no explanation) matching this exact shape:
{
  "changed": true,
  "income_tax": {
    "year": 2025,
    "brackets": [
      { "from": 0, "to": 12570, "rate": 0 },
      { "from": 12570, "to": null, "rate": 20 }
    ],
    "note": "optional short note about special rules",
    "sourceUrl": "https://exact-source-url-you-used",
    "quote": "short exact quote/snippet from the page text that supports these numbers"
  },
  "ss": {
    "mode": "percent",
    "rate": 26.85,
    "note": "optional",
    "sourceUrl": "https://exact-source-url-you-used",
    "quote": "short exact quote from the page text supporting this rate"
  }
}

Rules:
- "sourceUrl" MUST be one of the exact URLs given in a "--- SOURCE: ... ---" header above — never invent or normalize a URL.
- "quote" MUST be a short verbatim snippet copied from the page content, not paraphrased — this is what a human reviewer will check against the source.
- Omit "income_tax" entirely if you found no clear bracket data, or found only ss data. Omit "ss" entirely if you found no clear SS/contribution rate, or the country has none.
- "from"/"to" are annual income amounts in local currency; "to" is null only for the top bracket. "rate" is the marginal/contribution rate as a plain number (20 not 0.20).
- If both income_tax and ss are unchanged from the current stored data, or you cannot find clear numbers for either, reply with exactly: { "changed": false }
- Never omit "changed".`;
}

/**
 * Calls Claude to extract a fiscal-data proposal for one country.
 * @returns {Promise<{ ok: true, raw: string } | { ok: false, reason: string }>}
 */
export async function requestProposal({ apiKey, code, currentEntry, pageText, hints }) {
  if (!apiKey) return { ok: false, reason: 'no API key configured' };
  if (!pageText || !pageText.trim()) return { ok: false, reason: 'no page text to analyze' };

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1536,
        messages: [{ role: 'user', content: buildPrompt(code, currentEntry, pageText, hints) }],
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, reason: `Claude API HTTP ${res.status}: ${errText.slice(0, 300)}` };
    }
    const data = await res.json();
    const text = data?.content?.[0]?.text;
    if (typeof text !== 'string') return { ok: false, reason: 'Claude response missing content[0].text' };
    return { ok: true, raw: text };
  } catch (e) {
    return { ok: false, reason: e.message || String(e) };
  }
}
