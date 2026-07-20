/**
 * LLM client — the "thinking" layer every agent shares.
 *
 * Default provider: Google Gemini (free tier via Google AI Studio).
 *   - Get a free key: https://aistudio.google.com/apikey
 *   - Set GEMINI_API_KEY in .env (local) and as a GitHub Actions secret.
 *   - Override the model any time with LLM_MODEL (default: gemini-2.5-flash).
 *
 * Claude and OpenAI are also supported (see callClaude/callOpenAI below), but
 * are OFF by default — this project's whole design point is near-$0
 * operation on Gemini's free tier. They only activate if an agent is
 * explicitly configured (via the panel's Agent Settings) to use them AND the
 * matching API key (ANTHROPIC_API_KEY / OPENAI_API_KEY) is present; if the
 * key is missing, generateText falls back to Gemini with a console warning
 * rather than silently failing the task.
 */

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = process.env.LLM_MODEL || 'gemini-flash-lite-latest';

async function callGemini({ prompt, maxTokens, temperature, model }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      'GEMINI_API_KEY missing — get a free key at https://aistudio.google.com/apikey and set it in .env / GitHub secrets.'
    );
  }
  const res = await fetch(`${GEMINI_ENDPOINT}/${model || DEFAULT_MODEL}:generateContent?key=${key}`, {
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

async function callClaude({ prompt, maxTokens, temperature, model }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY missing — cannot use Claude for this agent.');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || 'claude-sonnet-5',
      max_tokens: maxTokens || 4096,
      temperature,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Claude API ${res.status}: ${data?.error?.message || 'request failed'}`);
  }
  return data?.content?.map((c) => c.text).join('') || '';
}

async function callOpenAI({ prompt, maxTokens, temperature, model }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY missing — cannot use OpenAI for this agent.');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: model || 'gpt-4.1-mini',
      max_tokens: maxTokens,
      temperature,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`OpenAI API ${res.status}: ${data?.error?.message || 'request failed'}`);
  }
  return data?.choices?.[0]?.message?.content || '';
}

/**
 * @param {object} opts
 * @param {string} opts.prompt        - the full prompt text
 * @param {number} [opts.maxTokens=500]
 * @param {number} [opts.temperature=0.4]
 * @param {string} [opts.model] - override the default model for this one call
 * @param {'gemini'|'claude'|'openai'} [opts.provider] - which LLM to use;
 *   defaults to gemini (this project's free-tier default). Falls back to
 *   gemini automatically if the requested provider's API key isn't set.
 * @returns {Promise<string>} the model's text response
 */
export async function generateText({ prompt, maxTokens = 500, temperature = 0.4, model, provider = 'gemini' }) {
  if (provider === 'claude' && process.env.ANTHROPIC_API_KEY) {
    return callClaude({ prompt, maxTokens, temperature, model });
  }
  if (provider === 'openai' && process.env.OPENAI_API_KEY) {
    return callOpenAI({ prompt, maxTokens, temperature, model });
  }
  if (provider !== 'gemini') {
    console.warn(`Provider "${provider}" requested but its API key isn't set — falling back to Gemini.`);
  }
  return callGemini({ prompt, maxTokens, temperature, model: provider === 'gemini' ? model : undefined });
}
