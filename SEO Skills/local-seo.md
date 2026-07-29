# Local SEO — Detailed Execution Guide

## What is Local SEO? (Plain English)
Local SEO is how you make your business appear in Google when someone nearby searches 
for what you offer. The goal is to appear in:
1. **Google Maps / Local Pack** (the map with 3 business listings)
2. **Organic results** below the map
3. **"Near me" searches**

---

## NAP Consistency

### What is NAP?
NAP = **N**ame, **A**ddress, **P**hone number
Google cross-references your NAP across your website, Google Business Profile, 
and hundreds of other directories. If they don't all match exactly, it creates 
confusion and hurts your local rankings.

### NAP Audit Process
```
1. Note EXACT business name, address, and phone as it should appear
   Example:
   Name: "Austin Plumbing Pro" (not "Austin Plumbing Pros" or "Austin Plumbing Pro LLC")
   Address: "123 Main Street, Suite 4, Austin, TX 78701" (exact, consistent formatting)
   Phone: "(512) 555-0123" (choose format and never deviate)

2. Check these locations for consistency:
   - Website homepage (footer)
   - Website contact page
   - Google Business Profile
   - Yelp listing
   - Facebook page
   - Better Business Bureau
   - Yellow Pages
   - Any industry directories

3. Fix every mismatch — even small ones like "St." vs "Street" matter
```

### Adding NAP to WordPress
```
Add to footer and contact page:
<address>
  Austin Plumbing Pro<br>
  123 Main Street, Suite 4<br>
  Austin, TX 78701<br>
  <a href="tel:+15125550123">(512) 555-0123</a>
</address>

Also add LocalBusiness schema (see schema-templates.md for exact code)
```

---

## Google Business Profile (GBP) Optimization

### Complete Profile Checklist
- [ ] Business name: Exact legal name, no keyword stuffing
- [ ] Category: Primary category is most specific match, add 2-4 secondary categories
- [ ] Address: Matches NAP on website exactly
- [ ] Phone: Local number preferred over toll-free
- [ ] Website: Link to your homepage (or specific location page if multi-location)
- [ ] Hours: Accurate, including holiday hours
- [ ] Description: 750 characters, includes primary keyword and location naturally
- [ ] Photos: Minimum 10 photos (logo, cover, interior, exterior, team, work examples)
- [ ] Services: List all services with descriptions
- [ ] Products: If applicable, add product listings
- [ ] Attributes: All relevant attributes checked (women-owned, wheelchair accessible, etc.)
- [ ] Q&A: Add 5-10 common questions with answers yourself (don't wait for customers to ask)

### GBP Posts Strategy
Post weekly to Google Business Profile:
```
Types of posts to rotate:
- "What's new": New service offerings, announcements
- "Offers": Special deals or promotions
- "Events": If you host any events
- "Products": Feature individual products/services

Post formula:
[Attention-grabbing first line] + [Benefit to customer] + [Call to action with phone/link]
Posts expire after 7 days — post consistently
```

### Review Strategy
```
1. Respond to EVERY review (positive and negative) within 24-48 hours
2. Positive response: Thank them, mention the specific service
3. Negative response: Apologize, take responsibility, offer to make it right offline
4. Get more reviews: After every job, send follow-up with direct GBP review link

Direct review link format:
https://search.google.com/local/writereview?placeid=[YOUR_PLACE_ID]
(Find Place ID: GBP → Info → View on maps → URL contains "place/" followed by ID)
```

---

## Location Pages

### When to Create Location Pages
- You serve multiple cities/areas (plumber serving Austin, Round Rock, Cedar Park)
- Create ONE dedicated page per service area

### Location Page Formula
```
URL: /plumbing-services-round-rock/
Title: Plumbing Services in Round Rock, TX | Austin Plumbing Pro
H1: Professional Plumbing Services in Round Rock, TX

Content must include (UNIQUE for each location — never copy-paste):
- Intro mentioning the city (2-3 paragraphs)
- Specific services offered in that area
- Why you serve that area (how long, what neighborhoods)
- Local reference (landmark, neighborhood name, something specific to that city)
- Testimonial from a customer in that city (if available)
- Local phone number if you have one
- Embedded Google Map centered on that city
- Call to action
- LocalBusiness schema with that location's details

Content length: 600-1,000 words minimum
```

### Common Mistake to Avoid
❌ Creating location pages that are identical except the city name changes
✅ Write genuinely unique content for each location

---

## Local Keyword Strategy

### Keyword Patterns for Local SEO
```
Primary pattern: [Service] in [City]
Secondary pattern: [Service] near [Landmark/Neighborhood]  
Intent pattern: [Service] [City] + action word

Examples for a plumber in Austin:
- "plumber in Austin TX"
- "emergency plumber Austin"
- "water heater repair Austin"
- "plumbing services near downtown Austin"
- "24 hour plumber Austin TX"
- "licensed plumber Austin"
- "drain cleaning Austin TX"
```

### Implementing Local Keywords
```
On each service page:
- Title: "[Service] in [City] | [Brand]"
- First H2: "Professional [Service] in [City]"
- First paragraph: "[City] residents trust [Brand] for [service]..."
- Add 2-3 neighborhood references naturally in body
- Include city in closing paragraph and CTA
```

---

## Local Citations

### What Are Citations? (Plain English)
Citations are any online mention of your business name, address, and phone number.
Think of them as "votes" that tell Google your business is real and established.

### Priority Citation Sources
```
Tier 1 (Most Important — Do First):
- Google Business Profile
- Bing Places for Business
- Apple Maps Connect
- Yelp
- Facebook Business Page

Tier 2 (Industry-General):
- Better Business Bureau (bbb.org)
- Angi (formerly Angie's List)
- HomeAdvisor
- Yellow Pages (yp.com)
- Foursquare
- Hotfrog

Tier 3 (Industry-Specific):
- HomeAdvisor, Thumbtack (home services)
- Healthgrades, Zocdoc (medical)
- Avvo, FindLaw (legal)
- TripAdvisor, OpenTable (restaurants/hotels)
- Find the top directories for your specific industry
```

### Citation Audit Workflow
```
1. Search Google: "site:yelp.com [business name]" → Find existing Yelp listing
2. Check each Tier 1 source manually
3. Use Moz Local or BrightLocal (paid tools) for comprehensive citation audit
4. For each listing found:
   a. Is NAP correct? → Update if not
   b. Is there a duplicate listing? → Claim and remove duplicate
5. Create missing listings starting with Tier 1
```

---

## Structured Data for Local SEO

Read `references/schema-templates.md` for the exact JSON-LD code.

### Required Schema for Local Businesses
1. `LocalBusiness` (or specific subtype) — on every page
2. `BreadcrumbList` — on interior pages
3. `FAQPage` — on service pages with FAQ sections
4. `Review` + `AggregateRating` — if displaying reviews on site

---

## Local SEO Monthly Tasks

```
WEEKLY:
□ Respond to any new GBP reviews
□ Publish one GBP post
□ Check for new questions in GBP Q&A

MONTHLY:
□ Check GSC for local keyword ranking changes
□ Verify NAP still consistent across top directories
□ Add new photos to GBP (2-3 per month)
□ Check for new citation opportunities
□ Monitor local keyword positions for "[service] in [city]" terms

QUARTERLY:  
□ Full citation audit using BrightLocal or Moz Local
□ Competitor analysis: What are top local competitors doing?
□ Review location page performance in GSC
□ Update GBP business description and service offerings if needed
□ Check for seasonal keyword opportunities
```

---

## Local SEO Audit Template

```
LOCAL SEO AUDIT — [Business Name] — [Date]

GOOGLE BUSINESS PROFILE
☐ Profile claimed and verified: Yes/No
☐ Profile completeness: ____% complete
☐ Photos: _____ (target: 10+)
☐ Reviews: _____ total, _____ avg rating
☐ Review response rate: _____%
☐ GBP posts: Last post _____ days ago
☐ Missing elements: _____

NAP CONSISTENCY
☐ Website NAP: _____
☐ GBP NAP: _____ (Match? Yes/No)  
☐ Yelp NAP: _____ (Match? Yes/No)
☐ Facebook NAP: _____ (Match? Yes/No)
☐ Discrepancies found: _____

LOCATION PAGES
☐ Number of service areas: _____
☐ Location pages created: _____
☐ Missing location pages needed: _____

LOCAL KEYWORDS
☐ Ranking for "[primary service] in [city]": Position _____
☐ Appearing in local pack: Yes/No
☐ Top local keyword opportunities: _____

CITATIONS
☐ Total citations found: _____
☐ Inconsistent citations: _____
☐ Missing Tier 1 citations: _____

SCHEMA
☐ LocalBusiness schema: Yes/No
☐ Schema errors: _____

PRIORITY FIXES:
1. _____
2. _____
3. _____
```
