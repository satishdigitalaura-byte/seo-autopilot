import { getSupabaseClient } from '../lib/supabaseClient.js';
import { generateText } from '../lib/llmClient.js';
import { getStrikingDistanceQueries, getContentGapQueries, getQueryMovement } from '../lib/gscClient.js';
import { getKeywordIdeas } from '../lib/googleAdsClient.js';
import { scoreKeywords, clusterKeywords } from '../lib/keywordStrategy.js';
import { sendNotificationEmail } from '../lib/emailClient.js';
import { renderEmailShell } from '../lib/emailTemplate.js';
import { getAgentConfig } from '../lib/agentSettings.js';

/**
 * Topic Discovery Agent — a senior SEO strategist that finds WHAT to write
 * about next, using the site's own real ranking data, not guesses.
 *
 * It does NOT write drafts and does NOT queue content_draft_agent tasks
 * directly. That's deliberate: content_draft_agent has a hard gate
 * (Guidelines §6) requiring a real ORIGINAL ELEMENT — a genuine client fact
 * or case-study number — before it will write anything, and this agent has
 * no way to invent one (nor should it). So its job stops at: analyze real
 * data, rank real opportunities, explain the real strategy in plain
 * language, and email a human a ready-to-use shortlist. A human picks one
 * and creates it from the panel, supplying the one thing only a human can:
 * a real fact about the business.
 *
 * REAL DATA SOURCES ONLY (no invented search volumes, no fabricated
 * competitor claims):
 *  - Striking-distance queries (GSC): real queries already ranking
 *    position 4-20 — the cheapest wins, since Google already considers the
 *    site relevant for these.
 *  - Content gap queries (GSC): real queries ranking 21-50 — proof of
 *    topical relevance with no dedicated page (or a page too thin to rank).
 *  - Query movement (GSC, last 28 days vs previous 28): which real queries
 *    are trending UP right now for this exact site — not a generic
 *    "trending on Google" list, but queries genuinely gaining traction for
 *    THIS site's own content and audience.
 *  - Google Ads Keyword Planner: real monthly search volume + competition
 *    for the above, so priority isn't just "biggest number of impressions"
 *    but genuine demand vs. difficulty.
 */

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

function dateRange(daysAgoStart, daysAgoEnd) {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - daysAgoEnd);
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - daysAgoStart);
  return { startDate: fmtDate(start), endDate: fmtDate(end) };
}

const STRATEGIST_SYSTEM_PROMPT = `You are the most experienced SEO strategist at a top-tier agency — deeper judgment than any single specialist, because you weigh on-page, technical, competitive, search-intent, and business-conversion angles together on every call, the way a strategist with 15+ years and thousands of ranked pages across every niche would. You have three jobs on every topic you rank: (1) will this actually rank given the REAL data below, (2) will it actually bring the RIGHT kind of visitor (matching business intent, not just traffic), (3) is it worth the effort compared to the other real opportunities in front of you right now.

Rules you must never break:
- Use ONLY the real numbers given to you below. Never invent search volume, competitor names, or ranking data that isn't in the input.
- Prioritize genuine ranking leverage over vanity metrics: a striking-distance query (already ranking, just needs a push) usually beats a content-gap query (starting from nothing), which usually beats a brand-new keyword idea with zero current relevance — unless the real search volume/competition numbers argue otherwise. Explain your actual reasoning per pick, don't just follow this ordering blindly.
- Prefer queries with clear commercial or informational intent that matches what this business actually sells/does over generic high-volume terms that would bring the wrong visitor.
- If two opportunities target the same underlying topic, don't recommend both — pick the stronger one (avoids the site cannibalizing its own rankings).
- For each pick, decide "refresh_existing" (a real ranking page already exists for this, per the data) vs "new_page" (no real page targets this yet) — get this right using the data given, don't guess.`;

async function buildSiteDataDigest(supabase, site, gscProperty) {
  const current = dateRange(31, 3);
  const previous = dateRange(59, 31);

  const [strikingDistance, contentGap, movement] = await Promise.all([
    getStrikingDistanceQueries(gscProperty, current.startDate, current.endDate).catch((err) => {
      console.warn(`Striking-distance lookup failed for ${site.domain}: ${err.message}`);
      return [];
    }),
    getContentGapQueries(gscProperty, current.startDate, current.endDate).catch((err) => {
      console.warn(`Content-gap lookup failed for ${site.domain}: ${err.message}`);
      return [];
    }),
    getQueryMovement(gscProperty, current, previous).catch((err) => {
      console.warn(`Query-movement lookup failed for ${site.domain}: ${err.message}`);
      return { gaining: [], losing: [] };
    }),
  ]);

  const topStriking = strikingDistance.slice(0, 15);
  const topGap = contentGap.slice(0, 15);
  const topGaining = (movement.gaining || []).filter((m) => m.delta > 0).slice(0, 10);

  // Seed Ads keyword ideas from the real queries already surfaced above — not
  // a guessed list — so the "real search volume" data is grounded in queries
  // this exact site is already relevant for.
  const seedTerms = [...new Set([
    ...topStriking.map((q) => q.query),
    ...topGap.map((q) => q.query),
    ...topGaining.map((q) => q.query),
  ])].slice(0, 15);

  const adsIdeas = seedTerms.length ? await getKeywordIdeas(seedTerms).catch(() => []) : [];

  // Turn the raw real Ads numbers into the advanced strategic signals: a
  // derived difficulty (0-100), an opportunity score (demand vs difficulty),
  // and the real 12-month demand trend. Every number stays derived-in-the-open
  // from Google's own figures — scoreKeywords invents nothing.
  const scoredIdeas = scoreKeywords(adsIdeas);
  const adsByKeyword = new Map(scoredIdeas.map((a) => [a.keyword.toLowerCase(), a]));

  // Semantic clusters over the real scored keywords — the LLM only groups the
  // exact real keywords, never inventing terms or numbers (see keywordStrategy).
  const keywordClusters = scoredIdeas.length
    ? await clusterKeywords(scoredIdeas, site.name).catch((err) => {
        console.warn(`Keyword clustering failed for ${site.domain}: ${err.message}`);
        return [];
      })
    : [];

  const withVolume = (q) => {
    const ads = adsByKeyword.get(q.query.toLowerCase());
    return {
      ...q,
      avgMonthlySearches: ads?.avgMonthlySearches ?? null,
      competition: ads?.competition ?? null,
      // Advanced derived signals — attached only where a real matching Ads idea
      // exists, otherwise left null (never fabricated).
      difficulty: ads?.difficulty ?? null,
      opportunity: ads?.opportunity ?? null,
      demandTrend: ads?.demandTrend ?? null,
    };
  };

  return {
    strikingDistance: topStriking.map(withVolume),
    contentGap: topGap.map(withVolume),
    trending: topGaining.map((m) => ({ ...m, ...withVolume({ query: m.query }) })),
    keywordClusters,
    dateRanges: { current, previous },
  };
}

function buildStrategistPrompt(site, digest) {
  // Real derived signals (difficulty/opportunity/trend) come straight off the
  // digest — surfaced so the strategist can copy them per pick, never guess.
  const signals = (q) => `difficulty: ${q.difficulty ?? 'n/a'} | opportunity: ${q.opportunity ?? 'n/a'} | trend: ${q.demandTrend ?? 'n/a'}`;

  // A lookup so the cluster block can echo the real volume/difficulty for each
  // clustered keyword where we have it (from the enriched digest items above).
  const detailByKw = new Map();
  for (const q of [...digest.strikingDistance, ...digest.contentGap, ...digest.trending]) {
    if (q?.query) detailByKw.set(q.query.toLowerCase(), q);
  }
  const clusters = digest.keywordClusters || [];
  const clusterBlock = clusters.length
    ? clusters.map((c) => {
        const kws = (c.keywords || []).map((kw) => {
          const d = detailByKw.get(String(kw).toLowerCase());
          return `    - "${kw}" | monthly searches: ${d?.avgMonthlySearches ?? 'n/a'} | difficulty: ${d?.difficulty ?? 'n/a'}`;
        }).join('\n');
        return `- CLUSTER "${c.clusterName}" (intent: ${c.intent || 'n/a'})${c.note ? ` — ${c.note}` : ''}\n${kws}`;
      }).join('\n')
    : '(no keyword clusters available this period)';

  return `${STRATEGIST_SYSTEM_PROMPT}

═══ SITE ═══
${site.name} (${site.domain})${site.is_ymyl ? ' — YMYL site, prefer topics that don\'t require unverifiable medical/financial claims' : ''}

═══ REAL DATA — STRIKING DISTANCE (already ranking position 4-20, real GSC impressions) ═══
${digest.strikingDistance.length ? digest.strikingDistance.map((q) => `- "${q.query}" | page: ${q.page} | position: ${q.position.toFixed(1)} | impressions: ${q.impressions} | clicks: ${q.clicks} | monthly searches: ${q.avgMonthlySearches ?? 'n/a'} | competition: ${q.competition ?? 'n/a'} | ${signals(q)}`).join('\n') : '(none found this period)'}

═══ REAL DATA — CONTENT GAPS (real GSC queries stuck at position 21-50, likely no dedicated page or a thin one) ═══
${digest.contentGap.length ? digest.contentGap.map((q) => `- "${q.query}" | page: ${q.page} | position: ${q.position.toFixed(1)} | impressions: ${q.impressions} | monthly searches: ${q.avgMonthlySearches ?? 'n/a'} | competition: ${q.competition ?? 'n/a'} | ${signals(q)}`).join('\n') : '(none found this period)'}

═══ REAL DATA — TRENDING (queries genuinely gaining clicks for THIS site, last 28 days vs prior 28) ═══
${digest.trending.length ? digest.trending.map((q) => `- "${q.query}" | clicks now: ${q.clicksNow} (was ${q.clicksBefore}) | position now: ${q.positionNow?.toFixed?.(1) ?? q.positionNow} | monthly searches: ${q.avgMonthlySearches ?? 'n/a'} | ${signals(q)}`).join('\n') : '(none found this period)'}

═══ REAL DATA — CONTENT CLUSTERS (real keywords grouped by shared search intent; volume + difficulty are Google-derived, not invented) ═══
${clusterBlock}

Notes on the numbers above:
- "difficulty" (0-100) and "opportunity" (0-100) are directional scores DERIVED from Google's real competition index + real search volume + the real 12-month trend. "trend" is rising/falling/stable/unknown off the real 12-month volume series. These are REAL values from the data block — when a pick has one, COPY it verbatim into the pick's fields below. NEVER invent, round, or estimate a difficulty/opportunity/trend that isn't shown; use null if the data shows 'n/a'.
- Use the CONTENT CLUSTERS block to decide which cluster (if any) each pick belongs to — set "clusterName" to that cluster's exact name, or null if the pick's keyword isn't in any cluster.

Analyze this real data like the senior strategist described above. CRITICAL OUTPUT RULE: respond with ONE valid JSON object and NOTHING else — no Markdown, no code fences, no bullet points, no explanation before or after. Your entire response must start with { and end with }. Use this exact schema:
{
  "topPicks": [
    {
      "targetKeyword": "the exact real query/topic from the data above",
      "suggestedTitle": "a specific, non-commodity working title for this topic",
      "contentType": "refresh_existing or new_page",
      "existingPage": "the real page URL from the data if contentType is refresh_existing, else null",
      "priorityScore": 1-10,
      "opportunityType": "striking_distance or content_gap or trending",
      "strategicReasoning": "2-4 sentences: why THIS one, referencing the real numbers, and what specifically needs to happen (e.g. deepen coverage, add a comparison section, target a more specific intent) to actually move it",
      "realFactNeeded": "one sentence describing what kind of genuine client fact/case-study number would make this article strong (this agent cannot supply it — a human must)",
      "storyAngles": [
        { "angle": "one concrete narrative/hook the article could take, one line", "whyItWorks": "one line tying it to the REAL search intent or the real numbers above" }
      ],
      "keywordDifficulty": "the real derived difficulty (0-100) for this pick's keyword copied from the data block, or null if 'n/a'",
      "opportunityScore": "the real derived opportunity score (0-100) copied from the data block, or null if 'n/a'",
      "demandTrend": "rising | falling | stable | unknown copied from the data block, or null if 'n/a'",
      "clusterName": "the exact name of the CONTENT CLUSTER this pick's keyword belongs to, or null if none"
    }
  ],
  "overallStrategyNote": "2-3 sentences on the overall pattern in this site's opportunities right now (e.g. mostly striking-distance wins available, or a content-gap cluster around one theme)"
}

About "storyAngles": give 2-3 DISTINCT angles per pick. An angle is purely a FRAMING suggestion for HOW to present the one real fact the human will supply (already captured in "realFactNeeded") — e.g. "Frame it as a before/after transformation timeline", "Lead with the single most surprising real number", "Structure it as a myth-vs-reality comparison". Angles must NOT fabricate any result, statistic, competitor, or client outcome — they only describe the storytelling shape around the real fact. Keep them concrete and specific to this topic, not generic.

Return exactly the 3 strongest picks — quality over quantity. Keep each "strategicReasoning" to 2-3 tight sentences so the whole response stays compact and valid.`;
}

/**
 * Robustly extract the strategist JSON from a model response. The bigger,
 * more detailed strategist prompt occasionally makes the model "explain" in
 * Markdown/prose instead of returning clean JSON, so we: strip ```json fences,
 * grab the outermost {...}, and only then parse. Returns the parsed object or
 * null (caller then attempts a repair pass).
 */
function extractStrategistJson(raw) {
  if (!raw) return null;
  let text = String(raw).trim();
  // Strip a leading/trailing markdown code fence if present.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const candidate = text.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

export async function runTopicDiscoveryForSite(site) {
  const supabase = getSupabaseClient();

  const { data: creds } = await supabase
    .from('site_credentials')
    .select('credential_key, credential_value')
    .eq('site_id', site.id)
    .eq('credential_key', 'gsc_property');
  const gscProperty = creds?.[0]?.credential_value;
  if (!gscProperty) {
    return { skipped: true, reason: 'no gsc_property set in site_credentials for this site' };
  }

  const digest = await buildSiteDataDigest(supabase, site, gscProperty);
  const hasAnyData = digest.strikingDistance.length || digest.contentGap.length || digest.trending.length;
  if (!hasAnyData) {
    await supabase.from('agent_results').insert({
      site_id: site.id,
      agent_name: 'topic_discovery_agent',
      result: { decision: 'no_opportunities_found', dateRanges: digest.dateRanges },
    });
    return { site: site.domain, decision: 'no_opportunities_found' };
  }

  const agentConfig = await getAgentConfig('topic_discovery_agent');
  const prompt = buildStrategistPrompt(site, digest);
  // The upgraded strategist output (3-5 picks, each with reasoning + 2-3 story
  // angles + cluster/score fields) needs real headroom — 4000 truncated the
  // JSON mid-object. 8000 comfortably fits the full response.
  const maxTokens = agentConfig.maxTokens || 8000;
  let raw;
  try {
    raw = await generateText({
      prompt,
      maxTokens,
      temperature: 0.5,
      model: agentConfig.modelName || 'gemini-flash-latest',
      provider: agentConfig.modelProvider,
    });
  } catch (err) {
    console.warn(`${agentConfig.modelProvider} model unavailable for topic discovery, falling back to Gemini lite:`, err.message);
    raw = await generateText({ prompt, maxTokens, temperature: 0.5 });
  }

  let analysis = extractStrategistJson(raw);

  // Repair pass: if the model answered in Markdown/prose instead of JSON,
  // ask it once to convert its own answer into strict JSON only. This is a
  // pure format fix — it reasons over the SAME real content, invents nothing.
  if (!analysis) {
    console.warn(`Topic discovery: first response wasn't valid JSON for ${site.domain} — attempting one repair pass.`);
    if (process.env.DEBUG_TOPIC_DISCOVERY) console.warn('RAW:', raw.slice(0, 2000));
    try {
      const repairPrompt = `Convert the following analysis into a single valid, minified JSON object and output NOTHING else — no markdown, no code fences, no commentary. It must start with { and end with }. Preserve every value exactly; do not add or invent data. Use this exact shape: {"topPicks":[{"targetKeyword","suggestedTitle","contentType","existingPage","priorityScore","opportunityType","strategicReasoning","realFactNeeded","storyAngles":[{"angle","whyItWorks"}],"keywordDifficulty","opportunityScore","demandTrend","clusterName"}],"overallStrategyNote"}

ANALYSIS TO CONVERT:
${raw.slice(0, 16000)}`;
      const repaired = await generateText({ prompt: repairPrompt, maxTokens, temperature: 0 });
      analysis = extractStrategistJson(repaired);
    } catch (err) {
      console.warn(`Topic discovery repair pass failed for ${site.domain}:`, err.message);
    }
  }

  if (!analysis) {
    console.warn(`Topic discovery: could not parse model output even after repair for ${site.domain}`);
    return { site: site.domain, decision: 'failed_parse' };
  }

  const picks = Array.isArray(analysis.topPicks) ? analysis.topPicks : [];

  await supabase.from('agent_results').insert({
    site_id: site.id,
    agent_name: 'topic_discovery_agent',
    result: {
      decision: 'suggestions_ready',
      topPicks: picks,
      overallStrategyNote: analysis.overallStrategyNote,
      keywordClusters: digest.keywordClusters,
      dataSummary: {
        strikingDistanceCount: digest.strikingDistance.length,
        contentGapCount: digest.contentGap.length,
        trendingCount: digest.trending.length,
        keywordClustersCount: (digest.keywordClusters || []).length,
      },
      dateRanges: digest.dateRanges,
    },
  });

  await supabase.from('event_log').insert({
    site_id: site.id,
    actor: 'topic_discovery_agent',
    action: 'suggestions_generated',
    details: { picksCount: picks.length },
  });

  if (picks.length > 0) {
    try {
      const clusters = digest.keywordClusters || [];
      // Short "clusters found" summary near the top — real cluster names + their
      // top 2-3 real keywords, so the reader sees the thematic map at a glance.
      const clustersSummaryHtml = clusters.length ? `
        <div style="margin:0 0 18px;padding:12px 14px;background:#F8FAFF;border:1px solid #E5E7EB;border-radius:8px;">
          <div style="font-size:12px;font-weight:700;color:#0A1628;margin-bottom:6px;">Keyword clusters found (${clusters.length})</div>
          ${clusters.map((c) => `
            <div style="font-size:12px;color:#374151;margin-bottom:3px;"><span style="font-weight:600;color:#1A6FE8;">${c.clusterName}</span>: ${(c.keywords || []).slice(0, 3).map((kw) => `"${kw}"`).join(', ')}</div>
          `).join('')}
        </div>` : '';

      // Per-pick: story angles as a small bulleted list, and a one-line stat row
      // with the real derived difficulty / opportunity / trend / cluster.
      const anglesHtml = (p) => {
        const angles = Array.isArray(p.storyAngles) ? p.storyAngles.filter((a) => a && a.angle) : [];
        if (!angles.length) return '';
        return `
            <div style="font-size:12px;color:#0A1628;font-weight:600;margin:8px 0 4px;">Story angles to consider:</div>
            <ul style="margin:0 0 6px;padding-left:18px;">
              ${angles.map((a) => `<li style="font-size:12px;color:#374151;margin-bottom:3px;">${a.angle}${a.whyItWorks ? ` <span style="color:#6B7280;">— ${a.whyItWorks}</span>` : ''}</li>`).join('')}
            </ul>`;
      };
      const statsRow = (p) => {
        const parts = [];
        if (p.keywordDifficulty !== null && p.keywordDifficulty !== undefined) parts.push(`Difficulty ${p.keywordDifficulty}/100`);
        if (p.opportunityScore !== null && p.opportunityScore !== undefined) parts.push(`Opportunity ${p.opportunityScore}/100`);
        if (p.demandTrend) parts.push(`Demand ${p.demandTrend}`);
        if (p.clusterName) parts.push(`Cluster: ${p.clusterName}`);
        return parts.length ? `<div style="font-size:11px;color:#6B7280;margin-bottom:6px;">${parts.join(' &middot; ')}</div>` : '';
      };

      const bodyHtml = `
        <p style="margin-bottom:16px;">${analysis.overallStrategyNote || ''}</p>
        ${clustersSummaryHtml}
        ${picks.map((p, i) => `
          <div style="margin-bottom:18px;padding-bottom:18px;${i < picks.length - 1 ? 'border-bottom:1px solid #E5E7EB;' : ''}">
            <div style="font-size:13px;font-weight:700;color:#0A1628;margin-bottom:4px;">${i + 1}. ${p.suggestedTitle || p.targetKeyword} <span style="font-weight:400;color:#6B7280;">(priority ${p.priorityScore}/10)</span></div>
            <div style="font-size:12px;color:#6B7280;margin-bottom:6px;">Target: "${p.targetKeyword}" &middot; ${p.contentType === 'refresh_existing' ? `Refresh existing page: ${p.existingPage || ''}` : 'New page'} &middot; ${p.opportunityType}</div>
            ${statsRow(p)}
            <div style="font-size:13px;color:#374151;margin-bottom:6px;">${p.strategicReasoning || ''}</div>
            ${anglesHtml(p)}
            <div style="font-size:12px;color:#FF6B2B;">Needs from you: ${p.realFactNeeded || 'a real client fact/case-study number'}</div>
          </div>
        `).join('')}
        <p style="margin-top:8px;color:#6B7280;font-size:12px;">To turn any of these into an actual draft, use "Create Topic" in the panel with the target keyword above and your own real fact — this agent finds and prioritizes topics, but a human always supplies the genuine detail every draft is required to have. The story angles above are only framing ideas for that real fact — they don't invent any result.</p>
      `;
      await sendNotificationEmail({
        subject: `[Topic Ideas] ${site.domain} — ${picks.length} ranked opportunit${picks.length === 1 ? 'y' : 'ies'} found`,
        html: renderEmailShell({
          badgeLabel: 'New Topic Suggestions',
          badgeTone: 'good',
          heading: `${picks.length} SEO opportunit${picks.length === 1 ? 'y' : 'ies'} for ${site.domain}`,
          bodyHtml,
        }),
      });
    } catch (err) {
      console.warn('Topic discovery notification email failed (non-fatal):', err.message);
    }
  }

  return { site: site.domain, decision: 'suggestions_ready', picksCount: picks.length };
}
