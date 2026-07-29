import { getSupabaseClient } from './supabaseClient.js';
import { getRelatedQueries } from './gscClient.js';
import { generateText } from './llmClient.js';
import { getKeywordIdeas } from './googleAdsClient.js';
import { scoreKeywords, clusterKeywords } from './keywordStrategy.js';

/**
 * Real keyword research for a topic, before any content gets written.
 * Primary signal is the site's OWN real Search Console query data (genuine,
 * not guessed). As of 2026-07-18 this is enriched with real Google Ads
 * Keyword Planner search-volume data too (getKeywordIdeas — returns [] and
 * is skipped silently if Ads API access isn't configured/available, so this
 * agent keeps working on GSC-only data either way). Gemini is only ever used
 * to classify/organize this real data (search intent, primary vs.
 * secondary), never to invent volume/difficulty numbers it has no way of
 * actually knowing.
 */
export async function researchKeywords(site, topic) {
  const supabase = getSupabaseClient();

  const { data: creds } = await supabase
    .from('site_credentials')
    .select('credential_key, credential_value')
    .eq('site_id', site.id)
    .eq('credential_key', 'gsc_property');

  const gscProperty = creds?.[0]?.credential_value;
  const seedTerms = topic.split(/\s+/).filter((w) => w.length > 3);

  const [realQueries, adsKeywordIdeas] = await Promise.all([
    gscProperty ? getRelatedQueries(gscProperty, [topic, ...seedTerms]) : Promise.resolve([]),
    // Only the full topic phrase, not individual split words — single-word
    // seeds (e.g. "local", "businesses") pull in broad, unrelated ideas.
    getKeywordIdeas([topic]),
  ]);
  // Advanced Keyword Planner: score every real Ads idea by derived difficulty
  // + opportunity (volume vs. difficulty vs. real demand trend), best-first.
  const scoredAdsIdeas = scoreKeywords(adsKeywordIdeas);
  const topAdsIdeas = scoredAdsIdeas.slice(0, 20);
  // Group the real keywords into intent clusters so the brief can target a
  // cluster of related terms, not one bare keyword (LLM organises real data only).
  const keywordClusters = await clusterKeywords(topAdsIdeas, topic).catch(() => []);

  const prompt = `You are doing keyword research for an SEO content brief. You are NOT allowed to invent search volume or difficulty numbers — you don't have that data. Your only job is to organize the REAL data given below and suggest natural keyword phrasing a human would actually type.

═══ TARGETING MANDATE — THIS PAGE EXISTS TO GENERATE LEADS ═══
This content is commissioned to produce enquiries, not traffic. Choose keywords accordingly:

- REQUIRED search intent: **transactional** or **commercial-investigation**. Do NOT return "informational" unless the real data below makes any commercial framing impossible — and if you must, say why in reasoning.
- REQUIRED funnel stage: **BOFU** (ready to buy) or **MOFU** (actively comparing). Never TOFU.
- A buyer-intent keyword with 50 searches/month beats a curiosity keyword with 5,000. Rank by buying signal first, volume second.

Buyer-intent modifiers to prefer when they fit the real data: "services", "agency", "company", "consultant", "for [industry]", "pricing", "cost", "packages", "quote", "hire", "near me", "[city]", "best", "top", "vs", "alternative", "comparison", "review", "case study", "results", "ROI", "worth it".

Avoid pure-curiosity phrasings ("what is…", "why does…", "history of…", "meaning of…") unless the searcher plainly has budget and a decision in front of them.

IMPORTANT: This agency does NOT offer backlink building / link building / off-page link acquisition as a service. Never suggest "backlinks", "link building", "backlink profile", or similar off-page-link terms as keywords, and do not treat them as a topic to write about.

TOPIC: ${topic}

REAL search queries that already bring visitors to this site, related to this topic (from Google Search Console — genuine data, may be empty for a brand-new topic):
${realQueries.length ? realQueries.slice(0, 20).map((q) => `- "${q.query}" (${q.clicks} clicks, ${q.impressions} impressions, avg position ${q.position.toFixed(1)})`).join('\n') : '(none yet — this is a new topic for this site, no historical query data)'}

REAL monthly search volume from Google Ads Keyword Planner, with derived difficulty/opportunity scores (genuine volume data; difficulty 0-100 and opportunity 0-100 are transparent heuristics derived from Google's own competition + volume figures, not official Google numbers — may be empty if not configured):
${topAdsIdeas.length ? topAdsIdeas.map((k) => `- "${k.keyword}" (~${k.avgMonthlySearches}/mo, difficulty ${k.difficulty}, opportunity ${k.opportunity}, demand ${k.demandTrend || 'unknown'})`).join('\n') : '(not available for this request — rely on the GSC data and topic above only)'}

REAL keyword clusters (related terms grouped by shared search intent — target a whole cluster in one strong page rather than one bare keyword):
${keywordClusters.length ? keywordClusters.map((c) => `- ${c.clusterName} [${c.intent}]: ${(c.keywords || []).slice(0, 6).join(', ')}`).join('\n') : '(no clusters — not enough keyword data)'}

Based on the topic and the real data above (if any), return ONLY a JSON object:
{
  "primaryKeyword": "the single best BUYER-INTENT target phrase — prefer a real query/high-volume term above if one carries commercial or transactional intent, otherwise the most natural buyer-intent phrasing of the topic",
  "secondaryKeywords": ["5-15 natural variations/related phrases a person would actually search, weighted toward commercial intent"],
  "transactionalKeywords": ["3-6 phrases from someone ready to hire/buy right now — e.g. service+location, 'pricing', 'cost', 'agency', 'hire', 'quote', 'near me' patterns"],
  "commercialKeywords": ["3-6 comparison/evaluation phrases from someone choosing between options — 'best', 'top', 'vs', 'alternatives', 'review', 'worth it' patterns"],
  "longTailKeywords": ["4-6 longer, more specific phrases (4+ words) a person close to converting would type — prefer real longer queries from the data above if any fit"],
  "nlpSemanticKeywords": ["8-15 topic-relevant terms/entities Google's NLP would expect near this topic (industry terms, tools, concepts) — NOT synonyms of the primary keyword, genuinely related vocabulary a subject-matter expert would naturally use"],
  "searchIntent": "one of: transactional | commercial-investigation (use informational ONLY if genuinely unavoidable)",
  "whatUserActuallyWants": "1 sentence — what is the searcher trying to accomplish (compare options, see pricing, get proof, etc.) so the content answers the real need, not a tangent",
  "buyerStage": "1 sentence — where this searcher is in the buying decision and what would make them enquire",
  "funnelStage": "one of: BOFU | MOFU (never TOFU)",
  "reasoning": "one sentence on why, referencing the real query/volume data if it was used"
}`;

  const raw = await generateText({ prompt, maxTokens: 500, temperature: 0.3 });
  let parsed;
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : raw);
  } catch {
    parsed = {
      primaryKeyword: topic,
      secondaryKeywords: [],
      transactionalKeywords: [],
      commercialKeywords: [],
      longTailKeywords: [],
      nlpSemanticKeywords: [],
      // The fallback defaults now match the lead-generation mandate above.
      // They used to default to informational/TOFU, which silently produced a
      // pure-traffic brief on every parse failure.
      searchIntent: 'commercial-investigation',
      whatUserActuallyWants: '',
      buyerStage: '',
      funnelStage: 'MOFU',
      reasoning: 'Model response could not be parsed — falling back to the raw topic as primary keyword.',
    };
  }

  // Hard guard: the brief must never reach the writer as top-of-funnel, no
  // matter what the model returned. A TOFU brief produces a page that ranks
  // and generates nothing, which is the exact outcome this pipeline is meant
  // to avoid.
  if (!['BOFU', 'MOFU'].includes(String(parsed.funnelStage || '').toUpperCase())) {
    parsed.funnelStage = 'MOFU';
  }
  if (String(parsed.searchIntent || '').toLowerCase() === 'informational') {
    parsed.searchIntent = 'commercial-investigation';
  }

  return {
    ...parsed,
    realQueriesUsed: realQueries.slice(0, 20),
    adsKeywordIdeasUsed: topAdsIdeas,
    keywordClusters,
  };
}
