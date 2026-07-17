/**
 * Rule-based checks for the Policy Guardrail Agent, per SEO_GUIDELINES_REFERENCE.md
 * §2 (spam policies), §3 (E-E-A-T), §4 (YMYL), §6 (AI content). Google does not
 * publish an exact keyword-density number (§2: "unnatural threshold" only), so that
 * one check stays a heuristic — everything else below traces to an explicit rule in
 * the guidelines doc.
 */

const HIDDEN_TEXT_PATTERNS = [
  /display\s*:\s*none/i,
  /visibility\s*:\s*hidden/i,
  /font-size\s*:\s*0(px|em|%)?\b/i,
  /color\s*:\s*#fff(fff)?\s*;?\s*background(-color)?\s*:\s*#fff(fff)?/i,
];

/** Heuristic only — Guidelines §2 names "keyword stuffing" but Google does not publish a numeric threshold. */
const KEYWORD_DENSITY_MAX = 0.04;

// Guidelines §4 — Bavishi Fertility Institute, VigiRA Med Ltd, and any healthcare/medical
// or financial-services client are YMYL. Set is_ymyl = true on their `sites` row when added;
// this module only reads that flag, it doesn't guess domains.

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function checkHiddenText(html) {
  const hits = HIDDEN_TEXT_PATTERNS.filter((re) => re.test(html));
  return {
    id: 'hidden_text',
    passed: hits.length === 0,
    severity: 'reject',
    detail: hits.length ? `Matched ${hits.length} hidden-text pattern(s)` : null,
  };
}

function checkKeywordStuffing(text, targetKeyword) {
  if (!targetKeyword) {
    return { id: 'keyword_stuffing', passed: true, severity: 'reject', detail: 'No target keyword supplied — skipped' };
  }
  const words = stripHtml(text).toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return { id: 'keyword_stuffing', passed: true, severity: 'reject', detail: 'Empty content' };
  }
  const kw = targetKeyword.toLowerCase();
  const occurrences = words.join(' ').split(kw).length - 1;
  const density = occurrences / words.length;
  return {
    id: 'keyword_stuffing',
    passed: density <= KEYWORD_DENSITY_MAX,
    severity: 'reject',
    detail: `Keyword density ${(density * 100).toFixed(2)}% (max ${(KEYWORD_DENSITY_MAX * 100).toFixed(0)}%)`,
  };
}

function checkContentLength(payload) {
  const wordMin = Number(payload.wordMin || 0);
  if (!wordMin) {
    return { id: 'content_length', passed: true, severity: 'reject', detail: 'No wordMin supplied — skipped' };
  }
  const wordCount = stripHtml(payload.content || '').split(/\s+/).filter(Boolean).length;
  return {
    id: 'content_length',
    passed: wordCount >= wordMin,
    severity: 'reject',
    detail: wordCount >= wordMin ? null : `Only ${wordCount} words, needs at least ${wordMin} for this topic's competitiveness`,
  };
}

function checkOriginalElement(payload) {
  const hasOriginal = typeof payload.originalElement === 'string' && payload.originalElement.trim().length > 0;
  return {
    id: 'original_element_required',
    passed: hasOriginal,
    severity: 'reject',
    detail: hasOriginal ? null : 'No client-supplied data point / case-study figure / firsthand fact attached — required before leaving draft status',
  };
}

function checkScaledAbuse(payload) {
  const bulkCount = Number(payload.bulkGenerateCount || 1);
  const hasDataBackedReason = typeof payload.triggerReason === 'string' && payload.triggerReason.trim().length > 0;
  return {
    id: 'scaled_content_abuse',
    passed: bulkCount <= 1 && hasDataBackedReason,
    severity: 'reject',
    detail: bulkCount > 1
      ? `Batch content generation (count=${bulkCount}) is not allowed — every piece needs its own concrete trigger`
      : (hasDataBackedReason ? null : 'No concrete, data-backed trigger reason (e.g. GSC drop) attached to this content task'),
  };
}

function checkSneakyRedirect(payload, site) {
  if (payload.taskType !== 'redirect') {
    return { id: 'sneaky_redirect', passed: true, severity: 'escalate', detail: null };
  }
  let sameDomain = true;
  try {
    const destHost = new URL(payload.destinationUrl).hostname.replace(/^www\./, '');
    const siteHost = (site?.domain || '').replace(/^www\./, '');
    sameDomain = destHost === siteHost;
  } catch {
    sameDomain = false;
  }
  return {
    id: 'sneaky_redirect',
    passed: sameDomain,
    severity: 'escalate',
    detail: sameDomain ? null : 'Redirect destination is off-domain — needs human confirmation this is intentional',
  };
}

function checkYmyl(payload, site) {
  if (!site?.is_ymyl) {
    return { id: 'ymyl_extra_scrutiny', passed: true, severity: 'info', detail: null, forcesHumanReview: false };
  }
  // Guidelines §4: mandatory named, credentialed author for YMYL content — no exceptions.
  const hasCredentialedAuthor = typeof payload.authorName === 'string' && payload.authorName.trim().length > 0
    && typeof payload.authorCredentials === 'string' && payload.authorCredentials.trim().length > 0;
  return {
    id: 'ymyl_extra_scrutiny',
    passed: hasCredentialedAuthor,
    severity: 'reject',
    detail: hasCredentialedAuthor
      ? 'Site is YMYL — human expert review is mandatory regardless of other results'
      : 'Site is YMYL — a named author with stated credentials is required, none supplied',
    forcesHumanReview: true,
  };
}

/**
 * @param {object} payload - task payload; expected shape varies by taskType but
 *   commonly includes: taskType, content (HTML/text), targetKeyword, originalElement,
 *   triggerReason, bulkGenerateCount, destinationUrl
 * @param {object} site - the sites row (for is_ymyl / domain)
 */
export function runRuleChecks(payload, site) {
  const content = payload.content || '';
  const checks = [
    checkHiddenText(content),
    checkKeywordStuffing(content, payload.targetKeyword),
    checkContentLength(payload),
    checkOriginalElement(payload),
    checkScaledAbuse(payload),
    checkSneakyRedirect(payload, site),
    checkYmyl(payload, site),
  ];

  const hardFailures = checks.filter((c) => c.severity === 'reject' && !c.passed);
  const escalations = checks.filter((c) => c.severity === 'escalate' && !c.passed);
  const forcesHumanReview = checks.some((c) => c.forcesHumanReview);

  return { checks, hardFailures, escalations, forcesHumanReview };
}
