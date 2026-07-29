# GSC Analysis — How to Read & Act on Google Search Console Data

## Connecting GSC to Claude Code

### Option 1: Manual Export (Easiest)
```
1. GSC → Performance → Export → Download CSV
2. Upload CSV to Claude Code session
3. Claude analyzes the data
```

### Option 2: GSC API via MCP
```
Install: @modelcontextprotocol/server-google-search-console
Requires: Google Cloud Console → Enable Search Console API → OAuth credentials
```

### Option 3: Google Sheets Integration
```
Use "Search Analytics for Sheets" Google Sheets add-on
Export GSC data to Sheets → Share with Claude Code
```

---

## Key Metrics Explained (Plain English)

| Metric | What It Means | Good Target |
|--------|---------------|-------------|
| **Impressions** | Times your site appeared in Google results | Growing month over month |
| **Clicks** | Times someone clicked your result | Growing month over month |
| **CTR** | % of impressions that became clicks | 2-5% overall; 10-30% for branded |
| **Average Position** | Average ranking position | Under 10 = Page 1 (goal) |

---

## The 5 Most Valuable GSC Reports

### 1. Performance → Search Results (Queries)
**What to do:**
```
Sort by Impressions (high to low)
Look for: High impressions + Low CTR + Position 1-10
These are your QUICK WIN pages — small changes can get more clicks

Look for: High impressions + Position 11-20
These are JUST BELOW PAGE 1 — worth investing to push to page 1

Look for: Branded queries growing
This means your brand awareness is increasing (good signal)

Look for: Queries you rank for that you didn't create pages for
These are CONTENT GAPS — create pages targeting these terms
```

### 2. Performance → Pages
**What to do:**
```
Sort by Clicks (high to low)
These are your MONEY PAGES — protect and invest in them

Sort by Impressions (high to low) but filter for low CTR
These pages are seen but not clicked — fix their titles/meta descriptions

Compare: What % of your pages get ANY traffic?
If less than 30% of pages get clicks, you have an orphan content problem
```

### 3. Coverage Report (Indexing)
**What to do:**
```
Check: "Valid" count vs total pages on site
If Valid << Total: You have indexing issues to investigate

Check: "Error" section — fix all errors
Check: "Excluded" section — review items in:
  - "Crawled, not indexed" → Google saw it but chose not to index (usually thin content)
  - "Discovered, not indexed" → Google found it but hasn't crawled yet
  - "Noindex tag" → Is this intentional? Check each URL
```

### 4. Core Web Vitals
**What to do:**
```
Check "Good URLs" vs "Needs Improvement" vs "Poor URLs"
Target: 100% Good URLs
Click through to see which specific pages have issues
Focus on fixing mobile scores (they affect rankings most)
```

### 5. Manual Actions
**What to do:**
```
Should be empty. If not empty:
THIS IS URGENT — Google has penalized your site
Read the exact action, understand what caused it, fix immediately
Submit reconsideration request after fixing
```

---

## Opportunity Analysis Framework

### Quick Wins (Do First — High impact, low effort)
```
Query filter: Position BETWEEN 4 AND 10, Impressions > 100
Action: Optimize those exact pages for those exact queries
  - Add the query to the title tag if not there
  - Add the query to the H1 if not there
  - Add the query to meta description
  - Add more content addressing that specific query
Expected result: Pages can move from position 6 to position 1-3 within weeks
```

### CTR Optimization (High impressions, low CTR)
```
Query filter: CTR < 2%, Impressions > 200
Action: Rewrite title and meta description for those pages
  - Make title more compelling and keyword-forward
  - Add numbers ("7 Ways to...", "Complete Guide to...")
  - Add power words (Best, Ultimate, Free, Guide)
  - Meta description: Add clear benefit and call to action
Expected result: CTR can double or triple with better titles
```

### Content Gap Analysis
```
1. Export all queries from GSC
2. Look for queries where you rank 11-50 (not page 1)
3. Check: Do you have a dedicated page for these queries?
4. If not: Create a new page targeting that query
5. If yes: The existing page needs significant improvement
```

### Lost Traffic Investigation
```
Compare: Current 3 months vs Previous 3 months
Filter: Pages/queries where clicks dropped significantly
Check:
  - Did the page ranking drop? (position increased?)
  - Did something change on the page?
  - Did a competitor publish better content?
  - Was there an algorithm update? (Check Google update calendar)
Action: For each significant drop, investigate and fix root cause
```

---

## Monthly SEO Report Template

```
📊 SEO MONTHLY REPORT
Site: [URL]
Period: [Month Year] vs [Previous Month Year]
Prepared by: Claude Code SEO Specialist
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📈 TRAFFIC OVERVIEW
Total Clicks:       [X] (▲/▼ X% vs last month)
Total Impressions:  [X] (▲/▼ X%)
Average CTR:        [X]% (▲/▼ X%)
Average Position:   [X] (▲/▼ X positions)
Pages with traffic: [X] pages

🏆 TOP PERFORMING PAGES
1. [Page] — [X clicks], [X impressions], [X% CTR], Position [X]
2. [Page] — [X clicks], [X impressions], [X% CTR], Position [X]
3. [Page] — [X clicks], [X impressions], [X% CTR], Position [X]

🔍 TOP QUERIES (by clicks)
1. "[query]" — [X clicks], Position [X]
2. "[query]" — [X clicks], Position [X]
3. "[query]" — [X clicks], Position [X]

🎯 OPPORTUNITIES IDENTIFIED
• [Page] ranks position [X] for "[query]" — optimize for quick win
• [Page] has [X] impressions but [X]% CTR — improve title/meta
• [X] queries found with no dedicated page — content gap

✅ WORK COMPLETED THIS MONTH
• Fixed [X] on-page issues across [X] pages
• Resolved [X] technical SEO errors
• Created [X] new pieces of content
• Fixed [X] broken links
• Added schema to [X] pages

📋 NEXT MONTH PRIORITIES
1. [Specific action]
2. [Specific action]
3. [Specific action]

⚠️ ISSUES TO MONITOR
• [Any ongoing concerns]
```

---

## GSC Alerts to Set Up

```
1. Coverage errors spike → Investigate crawling issues
2. Manual action received → URGENT — fix immediately  
3. Significant traffic drop → Algorithm update or technical issue
4. Core Web Vitals degradation → Check recent site changes

Set up email alerts in GSC:
GSC → Settings → Associations → Manage → Email preferences
```

---

## Interpreting Position Changes

```
Position improved:
- Your page is more relevant/authoritative than before
- Keep doing what's working
- Consider expanding content on those pages

Position dropped:
- Competitor published better content
- Google algorithm update changed ranking criteria  
- Your page lost backlinks or E-E-A-T signals
- Technical issue caused crawling problems
- Your page content is now outdated

Position 11-20 (second page):
- This is the "no man's land" — almost no traffic
- Prioritize these for intensive optimization
- Even getting to position 8 is 3x more traffic than position 11
```
