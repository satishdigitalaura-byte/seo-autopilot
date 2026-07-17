# Technical SEO — Detailed Execution Guide

## Sitemap

### What It Is (Plain English)
A sitemap is a file that tells Google: "Here are all the pages on my website, 
please go look at them." Without it, Google has to discover pages by following links.

### Checklist
- [ ] Sitemap exists at: `yoursite.com/sitemap_index.xml` (Yoast) or `/sitemap.xml` (RankMath)
- [ ] Sitemap submitted in GSC → Sitemaps section
- [ ] Sitemap updates automatically when new posts/pages are published
- [ ] Sitemap only includes pages you WANT indexed (no tag pages, admin pages, etc.)
- [ ] All URLs in sitemap return 200 status (not 404 or 301)
- [ ] Sitemap under 50MB and under 50,000 URLs per file

### WordPress Implementation
```
Yoast SEO: Auto-generates sitemap. Enable at Yoast → General → Features → XML Sitemaps
RankMath: Auto-generates sitemap. Enable at RankMath → Sitemap → Status

To submit to GSC:
1. Go to Google Search Console
2. Click "Sitemaps" in left sidebar
3. Enter: sitemap_index.xml
4. Click Submit
```

---

## Robots.txt

### What It Is (Plain English)
A file that tells Google "do not look at these pages." Use carefully —
blocking the wrong pages can destroy your rankings.

### Correct Basic Robots.txt for WordPress
```
User-agent: *
Disallow: /wp-admin/
Disallow: /wp-includes/
Disallow: /wp-content/plugins/
Allow: /wp-admin/admin-ajax.php
Allow: /wp-content/uploads/

Sitemap: https://yoursite.com/sitemap_index.xml
```

### Common Mistakes to Fix
- `Disallow: /` → Blocks entire site (catastrophic!)
- Blocking `/wp-content/uploads/` → Hides your images from Google
- Blocking CSS/JS files → Google can't render your pages properly
- No sitemap reference → Google has to find it on its own

### How to Check
1. Visit: `yoursite.com/robots.txt`
2. Compare to correct template above
3. Test in GSC: Tools & Settings → Robots.txt Tester

---

## Core Web Vitals

### What They Are (Plain English)
Three measurements Google uses to score how good your website feels to use:
- **LCP (Largest Contentful Paint)**: How fast does the main content load? Target: Under 2.5 seconds
- **FID/INP (Interaction to Next Paint)**: How fast does the page respond to clicks? Target: Under 200ms  
- **CLS (Cumulative Layout Shift)**: Does content jump around while loading? Target: Under 0.1

### How to Check
- GSC → Core Web Vitals report (real-world data)
- PageSpeed Insights: https://pagespeed.web.dev/ (lab data + field data)
- Both desktop AND mobile scores matter

### Common Fixes for WordPress

**LCP Fixes (slow loading main content):**
```
1. Install caching plugin: WP Rocket (paid) or W3 Total Cache (free)
2. Use a CDN: Cloudflare (free tier available)
3. Compress images: Smush or ShortPixel plugin
4. Convert images to WebP format
5. Enable lazy loading for images
6. Preload your hero/banner image
7. Upgrade hosting if on shared/cheap hosting
```

**CLS Fixes (content jumping):**
```
1. Set explicit width and height on all images
2. Don't insert ads dynamically above content
3. Avoid fonts that cause text to shift (use font-display: swap)
4. Reserve space for embeds (videos, iframes)
```

**INP Fixes (slow response to clicks):**
```
1. Reduce JavaScript: Dequeue unused scripts
2. Defer non-critical JavaScript
3. Remove unused WordPress plugins (each adds JS/CSS)
```

---

## Canonicalization

### What It Is (Plain English)
When your website has multiple URLs showing the same content, canonical tags tell Google 
"THIS is the main version, ignore the others."

### Common WordPress Duplicate Content Issues
```
yoursite.com        (homepage)
yoursite.com/       (same, with trailing slash)
www.yoursite.com    (with www)
http://yoursite.com (non-HTTPS version)
yoursite.com/?page_id=1 (with query string)
```

### Fix: Self-Referencing Canonicals
Every page should have a canonical tag pointing to itself:
```html
<link rel="canonical" href="https://yoursite.com/exact-page-url/" />
```
Yoast and RankMath handle this automatically when configured correctly.

### Check Your Canonical Setup
```
1. Visit any page on your site
2. Right-click → View Page Source
3. Search (Ctrl+F) for "canonical"
4. Confirm the URL matches the page URL exactly
5. Confirm it uses HTTPS (not HTTP)
6. Confirm it's the www or non-www version you've chosen consistently
```

---

## Redirects

### Types of Redirects
- **301 (Permanent)**: "This page moved forever." Use for: URL changes, site migrations, removing old pages
- **302 (Temporary)**: "This page moved temporarily." Rarely needed.
- **Never chain redirects**: A → B → C → D. Always go direct: A → D

### When to Use Redirects
- Changing a URL slug
- Deleting a page (redirect to most relevant alternative)
- Site migration (old domain → new domain)
- Merging duplicate pages into one

### WordPress Implementation
```
Plugin: Redirection (free) — https://wordpress.org/plugins/redirection/
Dashboard → Tools → Redirection → Add new redirect
From: /old-url/
To: /new-url/
Type: 301 Permanent
```

### Finding Broken Links (404 Errors)
```
GSC → Coverage → Not Found (404) errors
Also check: Broken Link Checker plugin (use temporarily, then deactivate)
Or: Screaming Frog SEO Spider (desktop app, free up to 500 URLs)
```

---

## HTTPS & Security

### Requirements
- Entire site must be HTTPS (padlock icon in browser)
- No mixed content (HTTP images/scripts on HTTPS pages)
- Valid SSL certificate (not expired)

### Checking Mixed Content
```
Browser: Open page → F12 (Developer Tools) → Console → Look for mixed content warnings
Or: https://www.whynopadlock.com/ (free tool)
```

### WordPress HTTPS Setup
```
1. Ensure SSL certificate installed on hosting (most hosts provide free Let's Encrypt)
2. WordPress Settings → General → Both URLs should be https://
3. Install "Really Simple SSL" plugin to fix mixed content automatically
4. In .htaccess, add redirect from HTTP to HTTPS:

RewriteEngine On
RewriteCond %{HTTPS} off
RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
```

---

## Indexing Audit

### Checking What Google Has Indexed
```
1. GSC → Coverage → Valid (how many pages indexed)
2. Compare to actual pages on your site
3. If indexed < actual pages, investigate why
```

### Pages That Should NOT Be Indexed
```
- /wp-admin/ (should be blocked in robots.txt)
- /cart/, /checkout/, /my-account/ (WooCommerce)
- Tag pages, author pages (usually duplicate content)
- Search results pages: /?s=
- Thank you / confirmation pages
- Duplicate content pages
```

### Pages That MUST Be Indexed
```
- Homepage
- All service/product pages
- All blog posts you've published
- All location/area pages
- About, Contact pages
```

### Fixing Indexing Issues
```
Page not indexed → Check:
1. Is it accidentally set to "noindex"? (WordPress editor → SEO settings)
2. Is it blocked in robots.txt?
3. Does it have duplicate content? (Canonical pointing elsewhere?)
4. Is it a new page? (May take 1-4 weeks to be indexed)
5. Does it have enough internal links pointing to it?

Fix → Submit URL directly in GSC → URL Inspection → Request Indexing
```

---

## Site Speed Optimization Workflow

```
Step 1: Run PageSpeed Insights on your homepage + top 5 pages
Step 2: Note scores (Desktop and Mobile separately)  
Step 3: Review "Opportunities" section — prioritized list of fixes
Step 4: Implement fixes in this order:
   a. Image compression (biggest impact, easiest fix)
   b. Enable caching plugin
   c. Enable CDN
   d. Defer render-blocking JavaScript
   e. Enable gzip compression
   f. Optimize database (WP-Optimize plugin)
Step 5: Re-run PageSpeed Insights to verify improvement
Step 6: Log scores before and after for client report
```

---

## Technical SEO Audit Template

```
TECHNICAL SEO AUDIT — [Site Name] — [Date]

CRAWLABILITY
☐ robots.txt: _____ (Pass/Fail — issue: _____)
☐ Sitemap: _____ (Pass/Fail — issue: _____)
☐ Sitemap in GSC: _____ (Pass/Fail)

INDEXING  
☐ Pages indexed: _____ / _____ total
☐ Indexing errors: _____ (list issues)
☐ Noindex pages accidentally set: _____

HTTPS & SECURITY
☐ HTTPS: _____ (Pass/Fail)
☐ Mixed content: _____ (Pass/Fail)
☐ SSL expiry: _____

CORE WEB VITALS
☐ LCP Desktop: _____ / Mobile: _____
☐ INP Desktop: _____ / Mobile: _____  
☐ CLS Desktop: _____ / Mobile: _____

PAGE SPEED
☐ PageSpeed Desktop: _____ / Mobile: _____

BROKEN LINKS
☐ 404 errors: _____ (list URLs)
☐ Redirect chains: _____ (list)

MOBILE
☐ Mobile-friendly test: _____ (Pass/Fail)
☐ Mobile usability errors in GSC: _____

STRUCTURED DATA
☐ Schema errors in GSC: _____ (list)
☐ Rich results eligible: _____

PRIORITY FIXES:
1. [Most critical issue]
2. [Second priority]
3. [Third priority]
```
