/**
 * Image generation — Cloudflare Workers AI (free tier: 10,000 Neurons/day,
 * no card on file, so it's structurally impossible to be billed unless the
 * account is separately upgraded). Model: SDXL-Lightning, fast + decent
 * quality for blog illustration use, not photorealistic product shots.
 */
const MODEL = '@cf/bytedance/stable-diffusion-xl-lightning';

/**
 * @param {string} prompt - plain-English description of the image. Keep it
 *   descriptive, not literal text-to-render — diffusion models render text
 *   in images badly, so callers should never ask for words/logos/numbers to
 *   appear in the image itself.
 * @returns {Promise<Buffer>} PNG image bytes
 */
export async function generateImage(prompt) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN missing — image generation is not configured.');
  }

  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: prompt.slice(0, 2000) }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Cloudflare image generation ${res.status}: ${errText.slice(0, 300)}`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('image')) {
    // Cloudflare returns JSON on error even with a 200 sometimes (rate limit, etc).
    const text = await res.text().catch(() => '');
    throw new Error(`Cloudflare image generation returned non-image response: ${text.slice(0, 300)}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
