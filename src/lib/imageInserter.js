import { generateImage } from './imageGenClient.js';
import { uploadGeneratedImage } from './imageStorage.js';

// Cap per draft — keeps generation time and Neuron usage bounded even if the
// model suggests a long imagePlacements list; well within the free daily quota.
const MAX_IMAGES_PER_DRAFT = 4;

// visualDescription (a concrete scene tied to that section's real content) is
// what actually drives the generation — altText is accessibility/SEO copy,
// not a visual description, so using it alone produced generic images with
// no real connection to the section's specific content.
function buildImagePrompt({ visualDescription, altText, topic, siteName }) {
  const subject = (visualDescription && visualDescription.trim()) || altText || topic;
  return `Professional editorial blog illustration for a ${siteName || 'business'} article about "${topic}". Scene: ${subject}. Clean flat design, soft modern color palette, high quality, no text, no words, no letters, no numbers, no logos, no watermark.`;
}

/** End-offset (in the original html) right after each <h2>'s closing tag. */
function getH2EndPositions(html) {
  const positions = [];
  const regex = /<h2[^>]*>[\s\S]*?<\/h2>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    positions.push(match.index + match[0].length);
  }
  return positions;
}

/** Returns the end-offset of the first <h2>/<h3> whose text loosely matches, or null. */
function findHeadingEndPosition(html, headingText) {
  const target = String(headingText || '').trim().toLowerCase();
  if (!target) return null;
  const regex = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const innerText = match[1].replace(/<[^>]+>/g, '').trim().toLowerCase();
    if (innerText.includes(target) || target.includes(innerText)) {
      return match.index + match[0].length;
    }
  }
  return null;
}

/**
 * Generates real images (Cloudflare Workers AI, free tier) for a draft's
 * suggested imagePlacements and embeds them directly into contentHtml.
 * Never throws — a failed image (rate limit, transient error, etc) is
 * skipped so one bad image never fails an otherwise-good draft.
 *
 * The model's own imagePlacements.afterHeading text occasionally doesn't
 * exactly match any heading it actually wrote (a model consistency slip,
 * not something worth rejecting a draft over) — when that happens, the
 * image still gets placed after the next unused H2 instead of being
 * silently dropped, so a generated image is never wasted.
 *
 * @returns {Promise<{ html: string, generatedCount: number, skippedCount: number }>}
 */
export async function generateAndInsertImages({ contentHtml, imagePlacements, topic, siteName }) {
  if (!imagePlacements?.length) return { html: contentHtml, generatedCount: 0, skippedCount: 0 };

  const html = contentHtml;
  const fallbackPositions = getH2EndPositions(html);
  const usedFallbackPositions = new Set();
  const insertions = []; // { position, imgTag }
  let skippedCount = 0;

  for (const placement of imagePlacements.slice(0, MAX_IMAGES_PER_DRAFT)) {
    try {
      let position = findHeadingEndPosition(html, placement.afterHeading);
      if (position == null) {
        const nextFallback = fallbackPositions.find((p) => !usedFallbackPositions.has(p));
        if (nextFallback != null) {
          position = nextFallback;
          usedFallbackPositions.add(nextFallback);
        }
      }
      if (position == null) {
        skippedCount += 1;
        continue; // no headings at all to anchor to — genuinely nowhere sensible to put it
      }

      const prompt = buildImagePrompt({ visualDescription: placement.visualDescription, altText: placement.altText, topic, siteName });
      const buffer = await generateImage(prompt);
      const fileName = (placement.suggestedFileName || 'blog-image.png').replace(/[^a-z0-9.-]/gi, '-');
      const url = await uploadGeneratedImage(buffer, fileName);
      const altAttr = String(placement.altText || placement.visualDescription || '').replace(/"/g, '&quot;');
      const caption = String(placement.caption || '').trim();
      const imgTag = caption
        ? `<figure class="da-content-image-figure"><img src="${url}" alt="${altAttr}" loading="lazy" class="da-content-image" /><figcaption>${caption.replace(/</g, '&lt;')}</figcaption></figure>`
        : `<img src="${url}" alt="${altAttr}" loading="lazy" class="da-content-image" />`;
      insertions.push({ position, imgTag });
    } catch (err) {
      console.warn('Image generation/insert failed for one placement (non-fatal):', err.message);
      skippedCount += 1;
    }
  }

  // Splice from the end of the string backward so earlier insertions never
  // shift the offsets computed for later ones.
  insertions.sort((a, b) => b.position - a.position);
  let result = html;
  for (const { position, imgTag } of insertions) {
    result = result.slice(0, position) + imgTag + result.slice(position);
  }

  return { html: result, generatedCount: insertions.length, skippedCount };
}
