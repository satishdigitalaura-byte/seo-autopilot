import { getSupabaseClient } from './supabaseClient.js';
import { getRelatedQueries } from './gscClient.js';
import { generateText } from './llmClient.js';

/**
 * Real keyword research for a topic, before any content gets written.
 * We don't have a paid keyword tool (Ahrefs/Semrush) — per
 * SEO_AUTOPILOT_MASTER_ARCHITECTURE.md §8, the $0 substitute is: use the
 * site's OWN real Search Console query data (genuine, not guessed) as the
 * primary signal, then use Gemini only to classify/organize that real data
 * (search intent, primary vs. secondary), never to invent volume/difficulty
 * numbers it has no way of actually knowing.
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

  let realQueries = [];
  if (gscProperty) {
    realQueries = await getRelatedQueries(gscProperty, [topic, ...seedTerms]);
  }

  const prompt = `You are doing keyword research for an SEO content brief. You are NOT allowed to invent search volume or difficulty numbers — you don't have that data. Your only job is to organize the REAL data given below and suggest natural keyword phrasing a human would actually type.

TOPIC: ${topic}

REAL search queries that already bring visitors to this site, related to this topic (from Google Search Console — genuine data, may be empty for a brand-new topic):
${realQueries.length ? realQueries.slice(0, 20).map((q) => `- "${q.query}" (${q.clicks} clicks, ${q.impressions} impressions, avg position ${q.position.toFixed(1)})`).join('\n') : '(none yet — this is a new topic for this site, no historical query data)'}

Based on the topic and the real data above (if any), return ONLY a JSON object:
{
  "primaryKeyword": "the single best target phrase — prefer a real query above if one fits, otherwise the most natural phrasing of the topic",
  "secondaryKeywords": ["5-15 natural variations/related phrases a person would actually search"],
  "longTailKeywords": ["4-6 longer, more specific phrases (4+ words) a person close to converting would type — prefer real longer queries from the data above if any fit"],
  "nlpSemanticKeywords": ["8-15 topic-relevant terms/entities Google's NLP would expect near this topic (industry terms, tools, concepts) — NOT synonyms of the primary keyword, genuinely related vocabulary a subject-matter expert would naturally use"],
  "searchIntent": "one of: informational | commercial-investigation | transactional | navigational",
  "whatUserActuallyWants": "1 sentence — what is the searcher trying to accomplish (compare options, see pricing, get proof, etc.) so the content answers the real need, not a tangent",
  "funnelStage": "one of: TOFU | MOFU | BOFU",
  "reasoning": "one sentence on why, referencing the real query data if it was used"
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
      longTailKeywords: [],
      nlpSemanticKeywords: [],
      searchIntent: 'informational',
      whatUserActuallyWants: '',
      funnelStage: 'TOFU',
      reasoning: 'Model response could not be parsed — falling back to the raw topic as primary keyword.',
    };
  }

  return { ...parsed, realQueriesUsed: realQueries.slice(0, 20) };
}
