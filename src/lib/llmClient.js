/**
 * LLM client — the "thinking" layer every agent shares.
 *
 * Default provider: Google Gemini (free tier via Google AI Studio).
 *   - Get a free key: https://aistudio.google.com/apikey
 *   - Set GEMINI_API_KEY in .env (local) and as a GitHub Actions secret.
 *   - Override the model any time with LLM_MODEL (default: gemini-2.5-flash).
 *
 * Kept deliberately tiny — plain fetch, no SDK — so it behaves identically in
 * GitHub Actions, locally, and on any host, with no dependency churn. Swapping
 * to another free provider later means changing only this one file.
 */

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = process.env.LLM_MODEL || 'gemini-flash-lite-latest';

/**
 * @param {object} opts
 * @param {string} opts.prompt        - the full prompt text
 * @param {number} [opts.maxTokens=500]
 * @param {number} [opts.temperature=0.4]
 * @returns {Promise<string>} the model's text response
 */
export async function generateText({ prompt, maxTokens = 500, temperature = 0.4 }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      'GEMINI_API_KEY missing — get a free key at https://aistudio.google.com/apikey and set it in .env / GitHub secrets.'
    );
  }

  const res = await fetch(`${GEMINI_ENDPOINT}/${DEFAULT_MODEL}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Gemini API ${res.status}: ${data?.error?.message || 'request failed'}`);
  }

  return data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
}
