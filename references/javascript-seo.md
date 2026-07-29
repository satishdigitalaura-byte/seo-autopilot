# JavaScript & Rendering SEO — Detailed Execution Guide

The single most damaging SEO failure on a modern JS site is invisible in a
browser: the page looks perfect to a human and is empty to a crawler. Every
other optimisation in this library is worthless on a page Google can't read.

## Why this matters (Plain English)

A React/Vue/Next/Angular site ships a nearly empty HTML file plus a JavaScript
bundle. The browser runs the JavaScript and builds the page. Google can run
JavaScript too — but on a delay, inconsistently, and never for the tags it
reads *before* rendering. Anything that must be in the initial HTML (title,
meta description, canonical, structured data, Open Graph) is read from the raw
file, not from what JavaScript later sets.

So a site can rank perfectly for its homepage and have every single blog post
treated as a duplicate of that homepage.

## The Raw-HTML Test (run this before any other technical work)

```
curl -s https://example.com/blog/some-post > raw.html
```

Then check the raw file — NOT the browser, NOT DevTools "Elements" (which shows
the post-JavaScript DOM and will lie to you):

| Check | Command | Pass condition |
|---|---|---|
| Article text present | `grep -c "a distinctive phrase from the article" raw.html` | ≥ 1 |
| Correct title | `grep -o "<title>[^<]*</title>" raw.html` | The article's title, NOT the site/homepage title |
| Correct meta description | `grep -o '<meta name="description"[^>]*>' raw.html` | The article's description |
| Self-referencing canonical | `grep -o '<link rel="canonical"[^>]*>' raw.html` | Points at THIS url |
| Article structured data | `grep -c 'application/ld+json' raw.html` | ≥ 1, and of type Article/BlogPosting |

If the title and canonical come back as the homepage's, stop. Nothing else you
do to that page can work until this is fixed.

## The Four Failure Modes, in severity order

### 1. Canonical points at the homepage (CRITICAL — actively de-indexing)
```html
<!-- On /blog/my-post -->
<link rel="canonical" href="https://example.com/" />
```
This is not a missing optimisation, it is an instruction. It tells Google "this
URL is a duplicate of the homepage; index the homepage instead." The page will
be dropped from the index even if everything else is perfect. Fix this first,
always.

**Correct:** every URL's canonical points at itself.
```html
<link rel="canonical" href="https://example.com/blog/my-post" />
```

### 2. Shared title / meta description across routes (CRITICAL)
The SPA shell's static `<head>` is served for every route, so every page
inherits the homepage's tags. Symptoms in Search Console: "Duplicate without
user-selected canonical", and pages that get impressions only for brand terms.

Note that this can be *partial* — marketing routes may be prerendered correctly
while blog routes are not. Always test a blog URL specifically; testing only
`/` and `/about` will show a false clean result.

### 3. Body content not in the raw HTML (HIGH)
Google will usually render it eventually, but indexing is delayed by days-to-
weeks, competitive queries are lost in the meantime, and any crawler that
doesn't execute JavaScript (most AI crawlers, most social preview bots, Bing at
lower priority) sees nothing at all.

### 4. Structured data injected client-side (MEDIUM)
JSON-LD added by JavaScript after load is frequently missed. Rich results
silently never appear. Put JSON-LD in the server-rendered HTML.

## How to Fix (in order of preference)

1. **Server-side rendering (SSR)** for the affected routes. Best outcome:
   correct tags and full content in the raw HTML on every request.
2. **Static generation / prerendering at build time.** Ideal for blog posts,
   which change rarely. Cheaper than SSR and just as effective for crawlers.
3. **A prerender service for crawlers only.** Acceptable and explicitly allowed
   by Google as *dynamic rendering*, but treated as a workaround, not a
   solution — it must serve crawlers the SAME content human users get.

**Never** solve this by serving different *content* to crawlers than to users
based on user-agent. Identical content rendered differently is fine; different
content is cloaking and is a spam violation.

## Minimum Per-Route Requirements

Every indexable route must have, in the raw HTML:

- [ ] `<title>` unique to that route
- [ ] `<meta name="description">` unique to that route
- [ ] `<link rel="canonical">` pointing to that route's own absolute URL
- [ ] The page's primary content as real text
- [ ] One `<h1>` containing the page's actual topic
- [ ] Route-appropriate JSON-LD (Article/BlogPosting for posts)
- [ ] `og:title`, `og:description`, `og:image` matching the route

## Verifying a Fix

1. Re-run the Raw-HTML Test above — this is the ground truth.
2. Google Search Console → URL Inspection → **View Crawled Page**. Compare the
   HTML Google actually stored against the browser view.
3. Rich Results Test — confirms structured data is seen server-side.
4. Search `site:example.com/blog/the-slug` — reappearance confirms the
   de-indexing has reversed. Expect days-to-weeks, not hours.

## Trailing Slashes

Pick one form and be consistent: `/about` or `/about/`, never both. A canonical
that uses the opposite form from the URL that's actually served creates a
self-conflicting signal. Redirect one form to the other with a 301.
