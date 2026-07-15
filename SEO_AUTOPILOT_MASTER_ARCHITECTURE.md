# SEO AUTOPILOT — Master Architecture (Multi-Site, Multi-Host, $0 Cost)

## Companion documents

This builds on, and must stay consistent with:

- `SEO_GUIDELINES_REFERENCE.md` — every rule, threshold, and "myth vs. real" correction in that doc is binding on the agents described here. Section references below (e.g. "Guidelines §5") point back to it.  
- `PROJECT_SPEC.md` (Layer 1 — watchers) — this document absorbs and extends that spec rather than replacing it. The Supabase schema, GitHub Actions trigger, and credential-handling approach from that spec are the foundation everything else plugs into.

## What changed from the brief

You asked for four things that are each reasonable alone but pull against each other if taken literally together: **autopilot with minimum human intervention** \+ **never violate any policy** \+ **drive real traffic/leads/sales** \+ **get cited by LLMs**. Google's own scaled-content-abuse policy (Guidelines §2) and the AI-content guidance (Guidelines §6) exist specifically because ungoverned, human-review-free publishing is what gets sites penalized. So the actual design principle here is:

**Automate everything except the moment new content goes live.** Research, drafting, technical fixes, schema, internal links, monitoring, alerting, even drafting outreach — all autopilot. One human taps "approve" before a new page/post goes live, and that's the only required human touch in the entire loop.

This isn't a compromise on "minimum intervention" — it's the version of minimum intervention that doesn't get a client's site penalized in the next core update.

---

## 1\. The backbone (same pattern as Layer 1, now shared by everything)

┌──────────────────────────────────────────────────────────────────┐

│  GitHub Actions (free, scheduled \+ event-triggered workflows)     │

│  The universal clock — works regardless of host                  │

└──────────────────────────────┬─────────────────────────────────────┘

                                │

                                ▼

┌──────────────────────────────────────────────────────────────────┐

│  Central Supabase (free tier) — the shared brain                  │

│  \- Site registry, credentials, settings                           │

│  \- Agent task queue (this is what makes agents "talk")            │

│  \- Results/history per agent per site                             │

│  \- Event log (who triggered what, when, why)                      │

└──────────┬───────────────────────────────────────────┬────────────┘

           │                                            │

           ▼                                            ▼

┌─────────────────────────┐              ┌─────────────────────────┐

│ npm package installed    │              │ Claude API (Haiku for    │

│ in each client's          │◄────────────┤ cheap/frequent checks,   │

│ Next.js/Node app          │  calls out   │ Sonnet for drafting/     │

│ \- /api/seo-agent/\* routes │  to Claude   │ analysis-heavy work)     │

│ \- works on ANY host        │              └─────────────────────────┘

│   (VPS, Hostinger,         │

│   SiteGround, shared)      │

└──────────┬─────────────────┘

           │

           ▼

┌─────────────────────────┐

│ Slack (free webhooks)     │

│ \- Per-client channel       │

│ \- Master agency channel    │

│ \- "Approve this draft"     │

│   buttons via Slack        │

│   interactivity (free)     │

└─────────────────────────┘

**Why this is genuinely $0 at your scale:** GitHub Actions free tier (2,000 min/month on private repos, unlimited on public), Supabase free tier (500MB DB, generous API calls — plenty for a few dozen sites' worth of task queue/logs), Google APIs (GSC/GA4/PageSpeed all free), Slack (free workspace, webhooks \+ Slack's free interactive Block Kit for approve/reject buttons), DataForSEO has a small free trial credit but **is not free ongoing** — see Section 8 for the no-cost substitute.

**Why this works across mixed hosts:** no agent logic runs "on" the client's server except the thin API route the npm package exposes. All scheduling, queuing, and decision-making happens centrally (GitHub Actions \+ Supabase), and it simply calls out over HTTPS to whichever route is sitting on whatever host. A shared-hosting site on Hostinger and a VPS site on Contabo look identical to the system — just a URL to call.

---

## 2\. The "agents talk to each other in real time" mechanism

This is the part that makes it more than just "several separate cron jobs." The mechanism is a **task queue table in Supabase**, not literal real-time sockets (which would cost money to run 24/7) — but functionally it behaves like real-time because Supabase supports realtime subscriptions on its free tier, and GitHub Actions can run as often as every 5 minutes for near-instant pickup.

**How it works:**

1. Every agent, when it finds something, doesn't just alert — it **writes a task** to a shared `agent_tasks` table: `{site_id, source_agent, target_agent, task_type, payload, status}`  
2. Other agents (or the same agent on its next scheduled run) **read tasks addressed to them** and act  
3. This creates real chains without any agent needing to know about any other agent's internals — they only need to know the task schema

**Concrete example of a chain that runs itself:**

GSC Watcher (daily) finds: "/services/water-filtration" lost 40% clicks

        → writes task: {target: "content\_refresh\_agent", type: "investigate\_drop", payload: {url, metrics}}

Content Refresh Agent (picks up task within the hour) finds: page hasn't been

updated in 14 months, a competitor now ranks above it with fresher content

        → writes task: {target: "research\_agent", type: "competitor\_gap\_analysis", payload: {url, competitor\_urls}}

Research Agent pulls competitor content gaps (via free-tier-friendly method, see §8)

        → writes task: {target: "content\_draft\_agent", type: "draft\_refresh", payload: {url, gaps, original\_content}}

Content Draft Agent (Claude API) writes the refreshed draft, checks it against

the Guidelines doc's "non-commodity content" \+ "no scaled abuse" criteria itself

before even submitting for human review

        → writes task: {target: "human\_review\_queue", type: "approve\_draft", payload: {draft, diff\_vs\_original}}

Slack message arrives: "Draft ready for \[client\]/\[page\] — \[Approve\] \[Reject\] \[Edit\]"

        → Human taps Approve

        → Publish Agent pushes the change to the live site via the API route

        → Internal Linking Agent picks up the newly-published change, scans for

          related pages, adds/updates internal links automatically

        → Schema Agent checks the updated page has correct JSON-LD

        → Sitemap Agent regenerates and pings Google \+ Bing

One GSC flag triggered six agents and one human tap. That's the "real-time linking with minimum intervention" you asked for, built on a free, simple, debuggable mechanism rather than something fragile.

---

## 3\. Full agent roster, mapped to your four goals

Organized by what they actually accomplish, since "layers" was useful for sequencing the build but this is useful for understanding coverage.

### Goal: Never violate any policy (the governance layer — runs first, touches everything)

| Agent | What it does | Cost |
| :---- | :---- | :---- |
| **Policy Guardrail Agent** | Not a watcher — a *gate*. Every other agent that produces an output (draft content, a schema change, a redirect, an outreach email) must pass it through this agent before it's queued for human approval or auto-applied. Checks against Guidelines §2 (spam categories), §6 (AI content rules), §4 (YMYL stricter bar). Rejects/flags anything matching scaled-content-abuse patterns, hidden text, keyword stuffing, sneaky redirects, etc. | $0 — rule-based checks \+ one cheap Claude Haiku call per item |
| **Core Update Watch Agent** | Polls Google's Search Status Dashboard (status.search.google.com) and Bing's equivalent. If a core/spam update is rolling out or just completed, it suppresses "alarm" alerts agency-wide for 1 week (per Guidelines §8 — don't react mid-rollout) and annotates the Master Report so ranking dips aren't misattributed to a site issue. | $0 |

### Goal: Watching (Layer 1 — already specced, included here for completeness)

| Agent | Already covered in `PROJECT_SPEC.md` |
| :---- | :---- |
| GSC Watcher, GA4 Watcher, Site Health Watcher | Yes — no changes, except: update Site Health Watcher's CWV logic to check p75 field data, not just a single lab-data PageSpeed run (Guidelines §7 correction) |

### Goal: High traffic, leads, sales (the growth layer)

| Agent | What it does | Cost |
| :---- | :---- | :---- |
| **Keyword Gap Agent** | Finds queries competitors rank for that the client doesn't. Triggered weekly \+ on-demand when GSC Watcher flags a category-wide dip. | $0 — see §8 for free data source |
| **Content Refresh Agent** | The chain-starter shown in §2. Triggered by GSC Watcher flags, not on a blind schedule — this is more efficient and avoids "scaled content" risk since every refresh has a concrete, data-backed reason | $0 (Claude Haiku for triage, Sonnet only for the actual draft) |
| **Content Draft Agent** | Writes new/refresh drafts. Hard-gated: must cite at least one genuinely original element (a client-supplied data point, case study figure, or fact the agency has firsthand) before it's allowed to leave draft status — enforced by the Policy Guardrail Agent, not just a prompt instruction | Claude API cost only (\~$0.01-0.05/draft on Haiku for outline, Sonnet for final pass) |
| **Internal Linking Agent** | Runs after any publish event. Scans the site's existing pages for topical relevance, inserts/updates internal links automatically — this is pure technical work, safe to fully automate (no policy risk, Guidelines doc doesn't restrict this) | $0 |
| **CTA/Conversion Agent** | Lighter-touch: monitors GA4 for pages with high traffic but low conversion (form fills, calls, bookings) and flags — doesn't auto-edit CTAs/forms (too risky to automate blind), but drafts a suggested CTA change for human approval, same as content | $0 \+ tiny Claude cost |
| **Local/GBP Agent** | For local clients: monitors Google Business Profile via the free Business Profile API — flags unanswered reviews, posts updates, checks NAP consistency across directories | $0 |

### Goal: Cited by LLMs (the AI-citation layer — built per Guidelines §5 correction)

This is the one area where the earlier "GEO/AIO Agent" design needs the most rework, since Google explicitly mythbusted several of its original tactics. Splitting it cleanly by destination, since "get cited by Google AI Overviews" and "get cited by ChatGPT/Perplexity/Claude" are different problems with different rules:

| Agent | What it does | Why this design |
| :---- | :---- | :---- |
| **Google AI Overview Agent** | Does NOT do forced-first-40-words rewriting or artificial fact-density. Instead checks: (1) does this page have a genuine unique POV / non-commodity angle, per Guidelines §5's exact test, (2) are E-E-A-T signals present (author, citations, freshness), (3) is it technically crawlable/indexed. Flags pages failing these for the Content Refresh Agent — it does not invent AI-specific formatting rules Google has disclaimed | $0 |
| **Bing/Copilot Citation Agent** | Monitors Bing Webmaster Tools' free "AI Performance" report (tracks Copilot/Bing AI citation frequency) — this is real, official, and free. Verifies Bing Webmaster Tools is set up for every client site (often skipped) and sitemap is submitted there too | $0 |
| **Non-Google AI Citation Agent** | For ChatGPT/Perplexity/Claude/Gemini specifically — these are NOT bound by Google's mythbusting (Guidelines §5 notes this explicitly). Here it's reasonable to: maintain an optional `llms.txt`\-style file (costs nothing, doesn't help Google but doesn't hurt, may help these other platforms), structure key pages with clear extractable Q\&A sections, and **periodically test actual citation** by querying these platforms' web-search-enabled modes with target questions and checking if the client's domain appears — this is the only real way to know if it's working, since none of these platforms publish a citation-tracking API as clean as Bing's | $0 (manual-ish — see note below) |

**Honest caveat on the Non-Google AI Citation Agent:** there's no free, official, automatable way to check "did Perplexity/ChatGPT cite my page" the way Bing's API allows for Copilot. The most defensible $0 approach is a lightweight scheduled job that runs a handful of target queries against these platforms' consumer interfaces (where web search is enabled) and parses the response for the client's domain — this is closer to semi-automated spot-checking than true monitoring, and should be presented to clients that way rather than oversold as a real-time tracker.

### Goal: Coordination / reporting (ties the above together)

| Agent | What it does | Cost |
| :---- | :---- | :---- |
| **Master Report Agent** | Weekly, per client: aggregates every other agent's results into one digest. Explicitly annotates any core-update overlap (from the Core Update Watch Agent) so drops aren't misread | $0 |
| **Human Review Queue** | Not really an "agent" — the Slack-based approval surface every content/CTA/outreach draft passes through. This is the deliberate, single point of required human time | $0 |

---

## 4\. Where the line is drawn on "minimum human intervention" — and why

Fully autopilot, zero human touch required:

- All watching/monitoring (Layer 1\)  
- All technical fixes that don't change visible content meaning: schema/JSON-LD generation, sitemap regeneration, internal link insertion, redirect cleanup, broken link fixes  
- All research/analysis: keyword gaps, competitor analysis, backlink monitoring, CWV diagnostics  
- Local/GBP review flagging, NAP consistency checks  
- Report generation and Slack delivery

Requires one human tap (Slack button, not a meeting, not a doc review):

- Any new or refreshed page content before it goes live  
- Any outreach email before it sends  
- Any CTA/conversion copy change before it goes live

**Why this specific line, not less:** every item in the second list is exactly the category Google's spam policies and AI-content guidance (Guidelines §2, §6) treat as higher-risk when fully unsupervised — manipulating rankings via volume, or publishing without genuine value-add. Everything in the first list is either pure technical correctness (no judgment call, no policy risk) or pure information-gathering (nothing public-facing changes). This split is not arbitrary caution — it's the actual shape of where Google's own rules draw the risk line.

---

## 5\. Multi-site, multi-host mechanics (how this actually works across SiteGround/Hostinger/VPS)

No change in principle from the Layer 1 spec, restated because it now applies to more agents:

- Every site gets the npm package installed once, mounted at `/api/seo-agent/*` (renamed from `/api/seo-watcher/*` to reflect the expanded scope — same routes, same pattern, more endpoints)  
- New endpoints needed beyond Layer 1's: `/api/seo-agent/publish` (applies an approved draft), `/api/seo-agent/tasks/pull` (lets the site report back task completion), `/api/seo-agent/schema/update`, `/api/seo-agent/sitemap/regenerate`  
- **Publish endpoint is the one with real-world consequence** — it must require the shared secret (Layer 1 §5.3) AND only ever be called as a result of a human-approved task in Supabase, never directly. The npm package should refuse to execute a "publish" task whose Supabase row isn't marked `approved_by_human: true`.  
- Shared hosting (SiteGround, basic Hostinger plans) sometimes restricts outbound requests or has tighter execution time limits on serverless-style functions — flag to the developer as a known constraint to test early, not assume away. If a given shared host can't reliably run the API route, fall back to that site reporting status less frequently rather than failing silently.

---

## 6\. What this means for the existing PROJECT\_SPEC.md (Layer 1\)

Layer 1's spec doesn't need to be thrown out — it needs three additions before a developer builds beyond it:

1. **Add the `agent_tasks` table** to the Supabase schema now, even though Layer 1 alone doesn't strictly need it — adding it later means a migration; adding it now costs nothing and is the foundation for everything in this document  
2. **Rename the route namespace** from `/api/seo-watcher/*` to `/api/seo-agent/*` for forward compatibility (or keep both — alias is fine, just don't paint into a naming corner)  
3. **Patch the Site Health Watcher's CWV check** to reference p75/field data per Guidelines §7, not single-run lab data

---

## 7\. Build order (revised, given the expanded scope)

1. Layer 1 watchers (as already specced) \+ the `agent_tasks` table addition above  
2. **Policy Guardrail Agent first**, before any content-producing agent — this is the safety rail and should exist before anything it needs to gate  
3. Content Refresh Agent \+ Content Draft Agent \+ Human Review Queue (Slack approval flow) — this is the highest-leverage chain for traffic/leads  
4. Internal Linking Agent \+ Schema Agent \+ Sitemap Agent (pure technical, low risk, quick wins)  
5. Google AI Overview Agent \+ Bing/Copilot Citation Agent (cheap, high signal given the Guidelines §5 correction)  
6. Keyword Gap Agent \+ CTA/Conversion Agent  
7. Local/GBP Agent (only for clients where relevant)  
8. Non-Google AI Citation Agent (lowest priority — least automatable, most "nice to have" given the caveat in §3)  
9. Master Report Agent (built last, since it aggregates everything else)

---

## 8\. Replacing DataForSEO — the one paid tool in the original design — with $0 alternatives

DataForSEO was in the earlier 15-agent design for keyword/competitor/backlink data and is genuinely useful, but it is not free ongoing (small free trial credit only). Since the brief now says "no cost or very very little cost," here's what to use instead:

| Need | Paid tool it replaces | $0 alternative |
| :---- | :---- | :---- |
| Keyword gap / competitor ranking data | DataForSEO | Google Search Console's own data (free, already in Layer 1\) for the client's own rankings; Google's free "People Also Ask" / autocomplete scraping is against Google's own ToS for automated querying (Guidelines §2, "machine-generated traffic") so avoid it — instead use **Google Trends API (free)** for directional keyword interest, and manual/semi-automated competitor content review (Research Agent fetches competitor public pages directly via standard web requests, which is normal browsing, not scraping Google's results) |
| Backlink monitoring | DataForSEO / Ahrefs / Semrush | **Google Search Console's own "Links" report (free)** — shows top linking sites and pages. Less comprehensive than paid tools but genuinely $0 and sufficient for catching toxic spikes or major authoritative gains |
| Site crawling for technical audits | Paid crawlers (Screaming Frog has a free tier capped at 500 URLs, which is actually fine for most of your client sites) | Screaming Frog free tier, or a simple custom crawler (Node.js \+ a sitemap parser) run via GitHub Actions — genuinely $0 either way |

**Bottom line on this tradeoff:** the system above is fully buildable at $0 recurring cost using only Google's own free APIs, Bing Webmaster Tools, GitHub Actions, Supabase free tier, Slack free tier, and Claude API pay-as-you-go (which is usage-based cents, not a recurring infra cost, and only triggered by actual content drafting work — not by watching/monitoring). If you ever want DataForSEO-grade competitor depth later, it's a clean add-on, not a redesign.

---

## 9\. Open questions before a developer builds this layer

- Confirm: should the Human Review Queue live entirely in Slack (fastest, $0, but no persistent UI), or also surface in the dashboard from Layer 1's spec (more visible, slightly more build time, still $0)? Recommend Slack-first, dashboard mirror later if needed.  
- Confirm: for the Non-Google AI Citation spot-checking (§3), is the manual-ish nature acceptable, or should that agent be deprioritized entirely until a real free/cheap API exists for this? Recommend deprioritizing per the build order in §7 rather than overbuilding something inherently limited.

