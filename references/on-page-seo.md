# On-Page SEO — Detailed Execution Guide

## Title Tag Optimization

### Rules
- Length: 50-60 characters (Google truncates at ~580px width)
- Format: `Primary Keyword | Brand Name` or `Primary Keyword - Secondary Keyword | Brand`
- Unique: Never duplicate title tags across pages
- Front-loaded: Most important keyword near the beginning
- Human-readable: Written for people, not just algorithms

### Formulas by Page Type
```
Homepage:     [Brand Name] | [Primary Service] in [City]
Service page: [Service Name] in [City] | [Brand Name]
Blog post:    [How to/What is] [Topic]: [Benefit/Result]
Location pg:  [Service] in [City, State] | [Brand Name]
About page:   About [Brand Name] | [What You Do]
Contact page: Contact [Brand Name] | [City, State]
```

### Common Mistakes to Fix
- Titles over 60 characters → Truncated in SERPs
- Duplicate titles → Confuses Google about page purpose
- Missing brand name → Lost brand recognition opportunity
- Keyword at end → Less weight given to end of title
- Generic titles ("Home", "Page 1") → Zero SEO value

---

## Meta Description Optimization

### Rules  
- Length: 150-160 characters
- Must include: Primary keyword (Google bolds it in results)
- Must have: A call to action ("Learn more", "Get a free quote", "Call today")
- Unique: Every page needs a unique meta description
- Compelling: Written to earn the click, not just describe the page

### Formula
```
[Primary keyword] + [key benefit or what they'll get] + [call to action]

Example:
"Professional plumbing services in Austin, TX. 24/7 emergency repairs, 
licensed plumbers, upfront pricing. Call for a free estimate today!"
```

### When Meta Descriptions Don't Show
Google sometimes ignores your meta description and pulls its own text.
This happens when Google thinks another snippet better matches the query.
Fix: Ensure your page content has clear, well-organized paragraphs that 
answer common questions about that topic.

---

## Heading Structure (H1-H6)

### Rules
- H1: Exactly ONE per page. Contains primary keyword. Describes the whole page.
- H2: Main sections. Include secondary keywords naturally.
- H3: Subsections under H2. More specific topics.
- H4-H6: Rarely needed. Only for complex, deeply structured content.
- Never skip levels (don't go H1 → H3 without an H2)

### Audit Process
```
1. Extract all headings from the page
2. Check: Is there exactly one H1?
3. Check: Does H1 contain the primary keyword?
4. Check: Is the hierarchy logical? (H1 > H2 > H3)
5. Check: Do headings describe the content below them?
6. Fix: Adjust heading tags in WordPress editor or theme
```

---

## URL Slug Optimization

### Rules
- Short: 3-5 words maximum
- Keywords: Primary keyword in URL
- Hyphens: Use hyphens (-) not underscores (_)
- Lowercase: Always lowercase
- No stop words: Remove "a", "the", "and", "or", "but", "in"
- No dates: Avoid /2024/03/ style URLs for evergreen content

### Examples
```
❌ Bad: /services/professional-residential-and-commercial-plumbing-services-austin-texas
✅ Good: /plumbing-services-austin

❌ Bad: /blog/2024/03/15/how_to_fix_a_leaky_faucet_at_home_yourself
✅ Good: /fix-leaky-faucet

❌ Bad: /page?id=147
✅ Good: /about
```

### WARNING on Changing URLs
**Only change URLs if the current URL is seriously bad.**
- Always set up a 301 redirect from old URL to new URL
- Update all internal links pointing to the old URL
- Submit new sitemap to GSC after URL changes
- Expect temporary ranking dip of 2-4 weeks after changes

---

## Content Optimization

### Keyword Density
- Target: 1-2% keyword density (natural usage)
- Primary keyword: In first 100 words, in conclusion, in at least one H2
- Semantic keywords: Related terms (LSI keywords) throughout
- Check with: Count keyword appearances / total word count × 100

### Content Length Guidelines
```
Homepage:        500-1,000 words
Service pages:   800-1,500 words
Blog posts:      1,500-2,500 words (or more for complex topics)
Location pages:  600-1,000 words (unique per location)
FAQ pages:       Depends on questions covered
Product pages:   300-500 words minimum + specs
```

### Content Quality Signals (E-E-A-T)
- **Experience**: First-hand experience with the topic
- **Expertise**: Author credentials, qualifications shown
- **Authoritativeness**: External sources linking to this page
- **Trustworthiness**: Accurate info, citations, secure site, clear contact info

### Content Improvements to Make
1. Add/update author bio with credentials
2. Add "Last updated: [date]" to articles
3. Link to authoritative external sources (Gov sites, .edu, recognized experts)
4. Add FAQ section to service/product pages
5. Include original statistics, data, or insights where possible

---

## Image Optimization

### Alt Text Rules
- Descriptive: What does the image show?
- Keyword: Include primary keyword ONLY if it naturally fits
- Not stuffed: "plumber fixing sink" not "plumber plumbing service Austin TX best plumber"
- Empty for decorative: `alt=""` for icons/decorative images
- Length: 10-15 words maximum

### Technical Image Requirements
- Format: WebP preferred, JPEG for photos, PNG for graphics with transparency
- Size: Compress to under 200KB without visible quality loss
- Dimensions: Match display size (don't upload 3000px image displayed at 300px)
- Lazy loading: Add `loading="lazy"` to images below the fold
- File names: Descriptive with hyphens (kitchen-remodel-austin.jpg not IMG_4821.jpg)

---

## Internal Linking Strategy

### Rules
- Every page should link TO other relevant pages
- Every page should receive links FROM other relevant pages
- Use descriptive anchor text (not "click here" or "read more")
- Prioritize: Homepage → Service pages → Blog posts → Location pages
- Aim for 2-5 internal links per page

### Anchor Text Guidelines
```
❌ Bad: "Click here to learn more about our services"
✅ Good: "Learn more about our Austin plumbing services"

❌ Bad: "Read this article"  
✅ Good: "See our guide to fixing leaky faucets"
```

### Finding Internal Link Opportunities
1. For each page, identify 3-5 related pages on the site
2. Look for mentions of topics that have their own page
3. Add contextual links within content body (not just navigation)
4. Ensure your most important pages have the most internal links pointing to them

---

## Page-by-Page Optimization Workflow

```
FOR EACH PAGE:
1. Identify primary keyword (check GSC for what query drives traffic to this page)
2. Check current title → Rewrite if needed
3. Check current meta description → Rewrite if needed
4. Check H1 → Ensure it exists and includes keyword
5. Check H2s → Ensure logical structure
6. Check URL → Flag if it needs changing (with caution)
7. Scan first 100 words → Ensure keyword appears naturally
8. Check all images → Add/fix alt text
9. Count internal links → Add if under 2
10. Check content length → Flag if significantly shorter than competitors
11. Save changes via WordPress/Yoast/RankMath API
12. Log: "Updated [page name]: Changed title from X to Y, meta from X to Y"
```
