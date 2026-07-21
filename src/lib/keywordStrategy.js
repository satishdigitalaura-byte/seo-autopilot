import { getKeywordIdeas } from './googleAdsClient.js';
import { generateText } from './llmClient.js';

/**
 * Keyword Strategy layer — the "advanced Keyword Planner".
 *
 * Turns the raw real Google Ads Keyword Planner numbers (volume, competition
 * index, 12-month demand trend) into strategic signals a human strategist
 * actually uses: a transparent difficulty score, an opportunity score that
 * weighs demand against difficulty, and semantic clusters so content can
 * target a whole cluster of related intent rather than one bare keyword.
 *
 * ANTI-FABRICATION: every number here is DERIVED, in the open, from Google's
 * own returned figures (avgMonthlySearches + competitionIndex + the real
 * monthly volume series). The difficulty/opportunity scores are clearly
 * labelled directional heuristics — the same honest posture the SEO Audit
 * Agent takes with its CTR-by-position benchmark — never presented as an
 * official Google metric. The LLM is used ONLY to name/group real keywords
 * into clusters; it is never asked to invent a volume or difficulty.
 */

/**
 * Directional keyword difficulty (0-100). We use Google's real
 * competitionIndex (a genuine 0-100 figure for paid competition) as the
 * backbone — it correlates with, though is not identical to, organic
 * difficulty — and nudge it up slightly for very high-volume head terms,
 * which are harder to rank organically than their competition index alone
 * suggests. Transparent and reproducible; not an official Google number.
 */
export function keywordDifficulty({ competitionIndex = 0, avgMonthlySearches = 0 }) {
  let d = Number(competitionIndex) || 0;
  if (avgMonthlySearches >= 10000) d += 12;
  else if (avgMonthlySearches >= 1000) d += 6;
  return Math.max(0, Math.min(100, Math.round(d)));
}

/**
 * Opportunity score (0-100): rewards real demand, penalises difficulty.
 * sqrt-dampens volume so a single huge head term doesn't drown out a cluster
 * of winnable mid-volume terms. Rising demand gets a small boost, falling
 * demand a small penalty — both straight off the real 12-month series.
 */
export function opportunityScore({ avgMonthlySearches = 0, competitionIndex = 0, demandTrend = 'unknown' }) {
  const difficulty = keywordDifficulty({ competitionIndex, avgMonthlySearches });
  const demand = Math.sqrt(Math.max(0, avgMonthlySearches)); // dampened
  const demandNorm = Math.min(100, (demand / Math.sqrt(50000)) * 100); // ~50k/mo saturates
  let score = demandNorm * ((100 - difficulty) / 100);
  if (demandTrend === 'rising') score *= 1.12;
  else if (demandTrend === 'falling') score *= 0.88;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** Attaches difficulty + opportunity to each real keyword idea and sorts best-first. */
export function scoreKeywords(ideas) {
  return (ideas || [])
    .map((k) => ({
      ...k,
      difficulty: keywordDifficulty(k),
      opportunity: opportunityScore(k),
    }))
    .sort((a, b) => b.opportunity - a.opportunity);
}

/**
 * Full advanced keyword pull for a set of seed terms: real Ads ideas,
 * scored + sorted. Returns [] (never throws) if Ads access is unavailable,
 * so every caller keeps working on whatever other real data it has.
 */
export async function getScoredKeywordIdeas(seedTerms) {
  const seeds = [...new Set((seedTerms || []).filter(Boolean))].slice(0, 20);
  if (!seeds.length) return [];
  const ideas = await getKeywordIdeas(seeds).catch(() => []);
  return scoreKeywords(ideas);
}

/**
 * Groups real scored keywords into named semantic clusters using the LLM as
 * an organiser only — it receives the real keyword list and must return
 * clusters built strictly from those exact keywords, inventing no new terms
 * and no new numbers. Falls back to a single "all keywords" cluster if the
 * model output can't be parsed or there's nothing to cluster.
 */
export async function clusterKeywords(scoredKeywords, topic) {
  const list = (scoredKeywords || []).slice(0, 40);
  if (list.length < 3) {
    return list.length
      ? [{ clusterName: topic || 'Primary', intent: 'informational', keywords: list.map((k) => k.keyword) }]
      : [];
  }

  const prompt = `You are organising REAL keyword-research data into semantic clusters for an SEO content strategy. You may ONLY group the exact keywords given below — do NOT invent new keywords, do NOT invent or change any number.

TOPIC CONTEXT: ${topic || '(general)'}

REAL KEYWORDS (each with real monthly volume and a derived difficulty 0-100):
${list.map((k) => `- "${k.keyword}" | vol ${k.avgMonthlySearches}/mo | difficulty ${k.difficulty} | trend ${k.demandTrend || 'unknown'}`).join('\n')}

Group these into 2-5 clusters, where each cluster is a set of keywords a single strong page could realistically target together (same underlying search intent). Return ONLY JSON:
{
  "clusters": [
    {
      "clusterName": "a short human label for this intent group",
      "intent": "one of: informational | commercial-investigation | transactional | navigational",
      "keywords": ["exact keywords from the list above that belong together"],
      "note": "one short sentence on why these belong together / what a page targeting them should do"
    }
  ]
}`;

  try {
    const raw = await generateText({ prompt, maxTokens: 800, temperature: 0.3 });
    const m = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : raw);
    const clusters = Array.isArray(parsed.clusters) ? parsed.clusters : [];
    // Keep only clusters whose keywords are genuinely from the real list —
    // guards against the model slipping in an invented term.
    const allowed = new Set(list.map((k) => k.keyword.toLowerCase()));
    const cleaned = clusters
      .map((c) => ({
        ...c,
        keywords: (c.keywords || []).filter((kw) => allowed.has(String(kw).toLowerCase())),
      }))
      .filter((c) => c.keywords.length);
    if (cleaned.length) return cleaned;
  } catch {
    // fall through to the single-cluster fallback
  }
  return [{ clusterName: topic || 'Primary', intent: 'informational', keywords: list.map((k) => k.keyword) }];
}
