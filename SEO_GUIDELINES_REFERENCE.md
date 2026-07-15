# SEO Guidelines Reference (as of June 2026\)

## Purpose of this document

This is the source-of-truth reference for building any SEO agent, watcher, or automation — across all layers (not just Layer 1). It exists because rules, thresholds, and official guidance change, and agent logic built on stale assumptions is expensive to unwind later. Every rule below traces to an official source (Google Search Central, Bing Webmaster, or Google's own Search Quality Rater Guidelines) rather than third-party SEO blog interpretation, except where explicitly marked as "industry observation, not official."

**One correction to our prior agent designs, found during this research:** earlier agent specs included GEO/AIO tactics like "answer the core question in the first 40-60 words" and "fact density every 150-200 words" as hardcoded content rules. Google's own official generative-AI optimization guide (June 2026\) explicitly says this is **not necessary** and lists several popular "GEO/AEO" tactics as myths for Google Search specifically. See Section 5 below — this matters because hardcoding those rules into a Content Agent would be optimizing for a model of how AI search works that Google has explicitly contradicted.

---

## 1\. Google Search Essentials (the foundation)

Source: developers.google.com/search/docs/essentials (official, last updated Dec 2025\)

Three pillars determine eligibility to appear in Google Search at all — these are gatekeeping rules, not ranking factors:

1. **Technical requirements** — bare minimum for Google to show a page:  
     
   - Googlebot isn't blocked (robots.txt, meta robots, X-Robots-Tag)  
   - Page returns HTTP 200 (not 4xx/5xx)  
   - Page has indexable content in a supported file format

   

2. **Spam policies** — see Section 2 below for the full official list  
     
3. **Key best practices**:  
     
   - Create helpful, reliable, people-first content  
   - Use the words people actually search for, in titles/headings/alt text/link text  
   - Make links crawlable (real `<a href>`, not JS-only navigation)  
   - Follow best practices for images, video, structured data, JavaScript  
   - Enable relevant search appearance features  
   - Use proper removal/noindex methods for content that shouldn't appear

**Agent implication:** A "Technical SEO Agent" should treat these three as binary pass/fail checks, separate from quality/ranking scoring. A page can be perfectly optimized and still be invisible if it fails these basics.

---

## 2\. Google's official Spam Policies (complete list)

Source: developers.google.com/search/docs/essentials/spam-policies (official, last updated May 2026\)

This is the authoritative list an automated Content/Technical agent should check against before anything gets published. Each category below is real, named, and currently enforced:

| Policy | What it covers | Agent-relevant check |
| :---- | :---- | :---- |
| **Cloaking** | Showing different content to crawlers vs. users | Diff rendered HTML for bot vs. browser user-agent |
| **Doorway abuse** | Multiple near-duplicate pages/domains funneling to one destination | Flag near-duplicate page clusters targeting similar queries |
| **Expired domain abuse** | Repurposing an expired domain's authority for unrelated low-value content | N/A for agencies building new sites; relevant if ever acquiring aged domains |
| **Hacked content** | Code/page/content injection, malicious redirects | Site Health Watcher should diff page content/links against known-good baseline |
| **Hidden text/link abuse** | White-on-white text, off-screen CSS, font-size:0, single-character hidden links | Flag CSS patterns matching these techniques |
| **Keyword stuffing** | Unnatural repetition/lists of keywords or phone numbers/locations | Flag content where keyword density crosses an unnatural threshold |
| **Link spam** | Buying/selling links, link exchanges, unqualified paid links, widget links, footer link farms, forum signature spam | Backlink Monitoring Agent should flag sudden spikes from low-quality/irrelevant domains |
| **Machine-generated traffic** | Automated scraping of Google results, unauthorized automated querying | N/A for our agents (we use official APIs, not scraping Google itself) |
| **Malicious practices** | Malware, unwanted software, back-button hijacking | Site Health Watcher scope |
| **Misleading functionality** | Fake tools/generators that don't deliver as advertised | N/A unless building tool pages |
| **Scaled content abuse** | **Most relevant to our Content Agent.** Many pages generated primarily to manipulate rankings rather than help users — explicitly includes AI-generated pages "without adding value," scraped/synonymized content, and stitched-together content | **Critical guardrail for Content Draft Agent — see Section 6** |
| **Scraping** | Republishing others' content without original value or citation | Content Agent must never republish competitor/scraped content as "research" |
| **Site reputation abuse** | Hosting third-party content mainly to exploit a host site's existing authority (e.g., "best casinos" content on a medical site) | Relevant if any client site hosts guest/sponsored content — flag topic mismatches |
| **Sneaky redirects** | Redirecting users somewhere different from what was shown to search engines | Site Health Watcher: diff bot-rendered vs. user-rendered redirect targets |
| **Thin affiliation** | Copy-pasted affiliate content with zero original value | Relevant for any e-commerce/affiliate client work |
| **User-generated spam** | Spam in comments, forums, file uploads | Relevant if any client site has UGC surfaces |

**Important nuance directly from Google's documentation:** paid/sponsored links are NOT a violation if properly qualified with `rel="nofollow"` or `rel="sponsored"`. Native advertising and editorial content are explicitly **not** considered spam — only when used to manipulate ranking signals. An automation that flags every external/sponsored link as "bad" would be wrong; check for the `rel` attribute instead.

---

## 3\. E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness)

Source: Google's Search Quality Rater Guidelines (182 pages, most recent substantive update September 11, 2025), various official Google statements.

**Critical framing, stated directly by Google and worth keeping in every spec:** E-E-A-T is **not a ranking factor** and there is no "E-E-A-T score" in the algorithm. It's a framework human quality raters use to evaluate pages; their assessments train the algorithms, which then try to replicate those judgments at scale. Agent logic should treat E-E-A-T signals as **inputs that correlate with ranking outcomes**, not as a literal score to compute and optimize directly.

**The four components:**

- **Experience** (added 2022, the newest pillar) — firsthand, lived involvement with the topic. A product review from someone who used the product; hardest signal to fake.  
- **Expertise** — demonstrated knowledge or credentials in the subject.  
- **Authoritativeness** — recognition and reputation in the field, from sources other than the site itself.  
- **Trustworthiness** — accuracy, transparency, security, and overall reliability. Described by Google as the most important of the four, since a page can have experience/expertise/authority and still be untrustworthy (e.g., intentionally misleading).

**Practical signals an audit/content agent should check for:**

- Named, credentialed authors with bylines (not "Admin" or no author at all)  
- Author bio pages with verifiable credentials  
- "Last reviewed/updated" dates, especially for YMYL content  
- Clear citations to authoritative sources  
- Transparent ownership/about/contact information  
- Editorial review process disclosed for AI-assisted content  
- For medical/financial content specifically: named reviewer with relevant credentials

**Filler content is now explicitly penalized.** The Quality Rater Guidelines added specific guidance instructing raters to penalize "filler" — generic padding before substantive content (e.g., three paragraphs of "In today's digital landscape..." before the actual answer). A Content Agent's drafting prompts should explicitly forbid this pattern.

---

## 4\. YMYL (Your Money or Your Life)

Source: Search Quality Rater Guidelines, official Google.

YMYL \= topics where inaccurate content could cause real harm to health, financial stability, safety, or societal wellbeing. YMYL pages face **much stricter** quality evaluation than ordinary content.

**As of the September 2025 update, YMYL categories are:**

- Health and safety  
- Financial stability (loans, investments, taxes, insurance, retirement)  
- Safety (e.g., information that could endanger physical safety if wrong)  
- **Government, Civics & Society** (expanded/renamed in Sept 2025\) — explicitly now includes election/voting information and trust in public institutions, not just "society" broadly  
- Groups of people (content that could negatively affect a demographic group's reputation or treatment)  
- Other topics impacting major life decisions (e.g., major purchases, major life events)

**Practical implication for agency clients:** based on your client roster, the following are YMYL or YMYL-adjacent and require the stricter treatment below: Bavishi Fertility Institute, VigiRA Med Ltd, any healthcare/medical client, and arguably financial-services-adjacent clients. E-commerce, local services (bikes, water filtration, gifting) are generally **not** YMYL but still benefit from baseline E-E-A-T.

**For YMYL content specifically, an agent-driven content/audit workflow should enforce:**

- Mandatory named author with relevant credentials — no exceptions  
- Mandatory human expert review before publish (never auto-publish YMYL content)  
- More frequent content review cycles (don't let YMYL pages go stale — track "last reviewed" age and flag at a shorter threshold than general content)  
- Higher bar for citation/sourcing — link to primary, authoritative sources, not secondary summaries

**One data point worth knowing (industry research, not official Google data):** a correlation study found E-E-A-T-related signals correlate with roughly 8% of ranking weight across all queries, rising to roughly 24% for YMYL queries specifically. Treat this as directional, not a literal weight to encode — Google does not publish ranking-factor weights.

---

## 5\. GEO / AIO / AI Overviews — what's real vs. myth

Source: developers.google.com/search/docs/fundamentals/ai-optimization-guide (official Google document, last updated June 15, 2026 — i.e., extremely current).

This is the single most important correction from this research pass, because it directly overrides assumptions in earlier agent designs.

**Google's own position:** "AEO" and "GEO" are just industry terms for optimizing for AI search experiences — from Google's perspective, this is still just SEO. Google's AI features (AI Overviews, AI Mode) are built on the same core ranking/quality systems as regular Search, using:

- **RAG (retrieval-augmented generation / "grounding")** — pulls from the same Search index, using the same ranking systems, then generates a response citing the retrieved pages  
- **Query fan-out** — the model generates related sub-queries to gather more complete information (e.g., "fix lawn full of weeds" triggers fan-out queries like "best herbicides for lawns")

**What ACTUALLY matters for AI Overview visibility (per Google, official):**

- Unique point of view / firsthand experience — not a summary of what's already out there  
- Non-commodity content — genuinely adds something beyond common knowledge (Google's own example: "7 Tips for First-Time Homebuyers" \= commodity/low-value; "Why We Waived the Inspection & Saved Money: A Look Inside the Sewer Line" \= non-commodity/high-value)  
- Content organized for human readers — clear paragraphs, sections, headings  
- Good page experience, crawlability, technical SEO — same fundamentals as regular Search  
- High-quality supporting images/video where relevant

**What Google explicitly says you do NOT need to do (direct mythbusting, official, June 2026):**

- ❌ **llms.txt files or other "AI text files"** — Google Search does not use them at all. Creating one doesn't help or hurt Google visibility (may still be worth doing for OTHER AI platforms that do support it, like some chatbots — but not for Google).  
- ❌ **"Chunking" content into tiny AI-readable pieces** — not required; Google's systems already parse multi-topic pages and surface the relevant part.  
- ❌ **Rewriting content in a special "AI-friendly" style** — Google's models understand synonyms and general meaning; there's no need to manually cover every query variation.  
- ❌ **Seeking inauthentic "mentions" across the web** — doesn't help; Google's spam systems block this regardless of intent.  
- ❌ **Overinvesting in structured data specifically for AI** — schema isn't required for AI Overview eligibility (though still worth doing for rich results generally).

**Correction to apply to existing agent specs:** Any "GEO/AIO Optimization Agent" that rewrites the first 40-60 words into a rigid "direct answer" format or enforces artificial "fact density per N words" is optimizing against a model of AI search that Google has explicitly disclaimed. Replace that logic with: (1) check for genuine non-commodity value/unique POV, (2) check standard E-E-A-T/technical signals, (3) leave structural/length decisions to what serves the human reader. This is a simpler agent and a more defensible one.

**Where the old GEO tactics (direct-answer-first, fact density, llms.txt) may still have merit:** for **other AI platforms** specifically — ChatGPT/Perplexity/Claude-type answer engines that aren't Google — since they don't all use the same RAG/fan-out approach and some do reportedly use llms.txt-style files or favor more extractable formatting. If an "AI Citation Agent" is built later to track citations across Perplexity/ChatGPT specifically (not Google AI Overviews), it's reasonable to keep format-optimization logic there — just don't apply it as a Google-ranking tactic.

**Bing's AI surface area is also relevant:** Bing's index powers Microsoft Copilot and (per industry reporting) a notable share of ChatGPT Search citations — so Bing Webmaster Tools optimization has AI-citation value beyond Bing's own \~5-9% search share. Bing Webmaster Tools includes its own "AI Performance" report tracking Copilot/Bing AI citation frequency (Bing-ecosystem only, doesn't cover ChatGPT/Perplexity/Gemini directly).

---

## 6\. Guidance on AI-generated content specifically

Source: Google's official "Guidance on using generative AI" \+ multiple confirmations from Google's Search Liaison and John Mueller.

**The core, repeatedly-confirmed position:** Google does not penalize content for being AI-generated. Google evaluates quality regardless of how content was produced. The actual test is "Who, How, and Why" — who created it, how (including AI involvement), and why (to genuinely help readers vs. to manipulate rankings).

**What gets penalized is not "AI" — it's low-effort, unoriginal, valueless mass production**, whether created by AI, humans, or scraping. This is formally codified as "scaled content abuse" (Section 2 above).

**For the Content Draft Agent specifically, this means:**

- AI-assisted drafts are fine as a starting point — this is not a violation  
- The violation risk is in *skipping* human review, originality, and added value — not in using AI as a tool  
- Every AI-assisted draft needs: human editorial review, fact-checking, and at least one element of unique value the AI couldn't have produced alone (an original data point, a real client case study figure, a genuine expert opinion, a firsthand observation)  
- Never publish at a volume/cadence that looks like it's optimizing for ranking-by-quantity rather than reader value — this is the literal definition of scaled content abuse  
- This reinforces what's already correctly built into the architecture: **draft-only, never auto-publish**

---

## 7\. Core Web Vitals — current official thresholds

Source: developers.google.com/search/docs/appearance/core-web-vitals (official).

| Metric | Measures | Good | Needs Improvement | Poor |
| :---- | :---- | :---- | :---- | :---- |
| **LCP** (Largest Contentful Paint) | Loading speed | \< 2.5s | 2.5s – 4.0s | \> 4.0s |
| **INP** (Interaction to Next Paint) | Responsiveness | \< 200ms | 200ms – 500ms | \> 500ms |
| **CLS** (Cumulative Layout Shift) | Visual stability | \< 0.1 | 0.1 – 0.25 | \> 0.25 |

**Measurement methodology (important for the Site Health Watcher's logic):** Google evaluates these at the **75th percentile (p75)** of real visitor data over a rolling 28-day window (via the Chrome User Experience Report / CrUX), not lab data, not averages. A page only gets an overall "Good" status when all three metrics pass simultaneously at p75. This means:

- A single slow test run via PageSpeed Insights is **lab data**, useful for debugging but not what Google actually uses to evaluate the live site  
- True compliance tracking should reference CrUX/Search Console field data where possible, with PageSpeed Insights lab data as a faster, real-time proxy between CrUX refresh cycles  
- Mobile performance is the primary signal (Google uses mobile-first evaluation even for desktop ranking)

**Note on the previously-specced default thresholds:** the earlier Site Health Watcher design used "performance score below 50" as a flag trigger — that's a reasonable lab-data proxy, but the *actual* compliance bar is the three field-data thresholds above at p75. Recommend the watcher check both: lab score as a fast daily signal, and CrUX/Search Console field data (refreshes \~daily but represents a 28-day trailing window) as the authoritative signal, surfaced at least weekly.

INP specifically is the hardest metric for most sites to pass and is JavaScript-architecture-dependent (not fixable via image compression/caching alone) — worth flagging to clients separately from LCP/CLS fixes since the remediation path is different and more expensive.

---

## 8\. Core Updates — what they are and aren't

Source: Google's official Core Updates documentation \+ Google Search Status Dashboard, corroborated by multiple independent SEO industry analyses of the March 2026 update.

**What a core update is, per Google's own framing:** a broad recalibration of how Google's ranking systems evaluate content quality across the entire index — not a targeted penalty, not a new policy, not a punishment for any individual site. Google's official line: "Your content didn't get worse, other content just got reassessed as better." There is no specific "fix list" for recovering from a core update — Google's guidance is to keep improving overall quality and wait for a future update cycle for re-evaluation.

**Cadence:** roughly every 3-4 months historically (three core updates in 2025: March, June, December; first 2026 core update: March 27 – April 8, 2026, completing in \~12 days). Expect roughly quarterly major recalibrations going forward — useful for setting client expectations and Master Report Agent commentary ("this dip aligns with a known core update, not a site-specific issue").

**March 2026 core update — the most volatile on record at time of writing**, with industry tracking showing \~80% of top-3 results changing position and \~24% of top-10 pages falling out of the top 100 entirely. Pattern observed across independent analyses: a shift away from intermediary/aggregator/comparison content and toward **destination sources** — official sites, brand-owned domains, primary data sources, government/institutional domains. Sites that lost the most were those summarizing existing top-10 content without original data or firsthand experience — directly reinforcing the E-E-A-T/non-commodity-content principles in Sections 3 and 5\.

**Agent implication for the Master Report Agent:** when a client's rankings shift significantly, check the Google Search Status Dashboard (status.search.google.com) for a recent/in-progress core or spam update before treating it as a site-specific technical or content issue. Google explicitly advises waiting at least one full week after a rollout completes before drawing conclusions or making major changes — a sudden mid-rollout reaction can fix something that wasn't actually broken, or waste effort on noise.

---

## 9\. Bing guidelines (relevant for agency's UK/Ireland/Canada clients especially, and for AI-citation reach)

Source: Bing Webmaster Tools official documentation \+ multiple corroborating industry sources.

Bing holds a smaller direct share of search (\~5-9% globally) but matters for two reasons: (1) some markets/demographics skew more Bing-heavy, and (2) **Bing's index powers Microsoft Copilot, and reportedly a large share of ChatGPT Search citations trace back to Bing's index** — so Bing optimization has AI-citation reach beyond Bing's own traffic share.

**Where Bing differs meaningfully from Google (confirmed across multiple sources, though Bing's own official guidelines are less granular than Google's):**

- Bing gives **more direct weight to exact-match keywords** in title, H1, opening paragraph, URL, and meta description — keyword placement discipline matters more on Bing than Google  
- Bing **explicitly treats social signals (likes, shares, engagement on LinkedIn/X/Facebook) as a ranking factor** — Google has stated it does not use social signals directly  
- Bing **uses the meta description you write more literally** — Google frequently rewrites meta descriptions based on query context; Bing is more likely to display what's actually written, making meta description quality a more direct lever  
- Bing's Core Web Vitals weighting is less explicit/confirmed than Google's, though fast/stable pages still perform better generally  
- Bing rewards **content freshness** with a similar but somewhat more pronounced emphasis than Google, particularly for news/event-type content

**Practical agent implication:** A Technical SEO Agent should also verify Bing Webmaster Tools verification \+ sitemap submission (separate from Google Search Console — easy to forget, free, and one-click import from GSC is supported). A Schema/Meta Agent generating meta descriptions should not assume Google's rewriting behavior will save a mediocre one — write it well for Bing's sake too.

---

## 10\. Quick-reference checklist for any new Content/Technical agent being built

Use this as a pre-build checklist so individual agent specs don't silently miss something covered above:

- [ ] Does this agent's logic respect the **draft-only / human-review-required** rule for any content meant to publish? (Section 6\)  
- [ ] If this agent touches YMYL-adjacent client content, does it enforce the stricter author/review/freshness bar? (Section 4\)  
- [ ] Does this agent avoid hardcoding now-mythbusted GEO tactics (forced first-40-words answers, fact-density-per-word-count) as Google-ranking logic? (Section 5\)  
- [ ] Does this agent's spam-detection logic reference the actual named Google spam policy categories rather than generic "looks spammy" heuristics? (Section 2\)  
- [ ] Does this agent's Core Web Vitals logic reference p75/field-data methodology rather than treating a single lab-data run as the compliance signal? (Section 7\)  
- [ ] Does this agent account for Bing separately, where relevant, rather than assuming Google-only optimization covers all search surfaces? (Section 9\)  
- [ ] If this agent reports ranking drops, does it check for an active/recent core or spam update before attributing the drop to a site-specific cause? (Section 8\)

---

## Sources referenced in this document

- Google Search Essentials — developers.google.com/search/docs/essentials  
- Google Spam Policies — developers.google.com/search/docs/essentials/spam-policies  
- Google's Guide to Optimizing for Generative AI Features — developers.google.com/search/docs/fundamentals/ai-optimization-guide  
- Google Core Web Vitals — developers.google.com/search/docs/appearance/core-web-vitals  
- Google Search Quality Rater Guidelines (182 pages, Sept 2025 version) — guidelines.raterhub.com  
- Bing Webmaster Tools documentation — bing.com/webmasters  
- Independent industry analysis of March 2026 Core Update (Search Engine Land/SE Ranking data, Amsive/Sistrix data) — used only for directional/observational context, clearly marked as such above, not as official Google policy

This document should be refreshed periodically (suggest: before any major new agent layer is built, and at minimum after each confirmed Google core update) since thresholds, spam categories, and especially the AI-search guidance are actively evolving areas.  
