# Blog Post Design Spec — for the developer

**Problem:** Blog pages currently render the article body with almost no visual
styling — it looks like plain copy-pasted text (default heading sizes, no
spacing rhythm, no highlight boxes, table looks like a raw HTML table).
The article HTML content itself is fine (correct headings, lists, tables) —
what's missing is CSS for the blog article body.

**Brand colors already in use elsewhere on the site** (matches the email
notification template, so blog styling should reuse the same palette):

| Name | Hex | Use |
|---|---|---|
| Dark | `#0A1628` | headings, header background |
| Blue | `#1A6FE8` | links, primary accent |
| Orange | `#FF6B2B` | CTA buttons, highlight accent |
| Green | `#22C55E` | positive/stat callouts |
| Gray | `#6B7280` | secondary/meta text |
| Background | `#F8FAFF` | callout box backgrounds |
| Border | `#E5E7EB` | card/box borders |

---

## 1. Base typography (apply to the blog article body wrapper)

```css
.blog-article {
  font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: #1F2937;
  font-size: 17px;
  line-height: 1.75;
}
.blog-article h1 { font-size: 34px; font-weight: 800; color: #0A1628; line-height: 1.25; margin: 0 0 20px; }
.blog-article h2 { font-size: 26px; font-weight: 700; color: #0A1628; margin: 40px 0 16px; }
.blog-article h3 { font-size: 20px; font-weight: 700; color: #0A1628; margin: 28px 0 12px; }
.blog-article p { margin: 0 0 20px; }
.blog-article ul, .blog-article ol { margin: 0 0 20px; padding-left: 24px; }
.blog-article li { margin-bottom: 8px; }
.blog-article a { color: #1A6FE8; text-decoration: underline; text-underline-offset: 2px; }
.blog-article strong { color: #0A1628; }
```

## 2. Tables (used for comparisons / checklists)

```css
.blog-article table { width: 100%; border-collapse: collapse; margin: 24px 0; font-size: 15px; }
.blog-article th { background: #0A1628; color: #fff; text-align: left; padding: 12px 16px; }
.blog-article td { padding: 12px 16px; border-bottom: 1px solid #E5E7EB; }
.blog-article tr:nth-child(even) td { background: #F8FAFF; }
```

## 3. New content classes the agent now outputs — style these

The content agent has been updated to wrap key moments in these classes.
Add CSS for them (they don't exist yet, so right now they render as plain
unstyled text):

**`.da-stat-callout`** — the single biggest result/number from the article,
placed early. Should look like a bold highlight card.
```css
.da-stat-callout {
  background: #F8FAFF;
  border-left: 4px solid #FF6B2B;
  border-radius: 8px;
  padding: 20px 24px;
  margin: 28px 0;
  font-size: 19px;
  font-weight: 600;
  color: #0A1628;
}
```

**`.da-key-takeaway`** — a short bullet summary box.
```css
.da-key-takeaway {
  background: #FFFFFF;
  border: 1px solid #E5E7EB;
  border-radius: 10px;
  padding: 20px 24px;
  margin: 28px 0;
}
.da-key-takeaway strong { display: block; color: #1A6FE8; font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 10px; }
```

**`.da-pullquote`** — a direct claim/result quoted as a visual break.
```css
.da-pullquote {
  border-left: 4px solid #1A6FE8;
  margin: 32px 0;
  padding: 4px 0 4px 20px;
  font-size: 21px;
  font-weight: 600;
  color: #0A1628;
  font-style: normal;
}
```

**`.da-cta-box`** — the closing call-to-action.
```css
.da-cta-box {
  background: #0A1628;
  color: #FFFFFF;
  border-radius: 12px;
  padding: 28px 32px;
  margin: 40px 0 0;
  text-align: center;
}
.da-cta-box a {
  display: inline-block;
  margin-top: 12px;
  background: #FF6B2B;
  color: #FFFFFF;
  padding: 12px 24px;
  border-radius: 8px;
  text-decoration: none;
  font-weight: 700;
}
```

## 4. FAQ section

```css
.blog-article .faq-item { border-bottom: 1px solid #E5E7EB; padding: 16px 0; }
.blog-article .faq-item h3 { margin: 0 0 8px; font-size: 17px; }
.blog-article .faq-item p { margin: 0; color: #374151; }
```

## 5. Table of contents (when `needsTableOfContents` is true)

A simple sticky/anchor-link box near the top, linking to each H2 by id:
```css
.blog-toc {
  background: #F8FAFF;
  border: 1px solid #E5E7EB;
  border-radius: 10px;
  padding: 20px 24px;
  margin: 24px 0 32px;
}
.blog-toc a { display: block; padding: 4px 0; color: #1A6FE8; text-decoration: none; }
```

---

**Scope note:** this only covers the article body. Page shell (header, nav,
footer, breadcrumbs) already matches the rest of the site since every blog
route renders through the same template — no change needed there.
