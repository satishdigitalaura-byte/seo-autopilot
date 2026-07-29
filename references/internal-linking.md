# Internal Linking — Anchor Quality & Automation Rules

Internal linking is the one SEO lever that is fully under your control and
carries no policy risk — but only when the anchors are genuine. A wrong
automated link is worse than no link: it wastes crawl signal, confuses topical
relevance, and looks broken to the reader.

## Anchor Text Rules

### A good anchor
- Is a **phrase, never a single generic word.** "google ads targeting" is an
  anchor; "small" is not. A lone adjective or filler noun carries no topic and
  reads as an accident.
- **Describes the destination.** A reader who sees only the anchor should be
  able to guess what page it opens.
- **Already exists in the text.** Never insert a sentence to host a link, and
  never reword the author's prose to fit a keyword. Link text that appears
  verbatim in the copy is the only kind that stays natural.
- **Varies across the site.** Fifty links all reading "SEO services" is a
  recognisable manipulation pattern.

### Reject an anchor if
- It is one word, or contains fewer than two significant (non-stopword) words.
- It is a generic modifier: *small, large, better, best, top, new, easy, quick,
  more, great, real, simple, full.* These pass a naive length filter and are
  the most common source of bad automated links.
- It is a call to action: "click here", "read more", "this page", "learn more".
- The exact link already exists earlier in the same page.
- It sits inside an existing `<a>`, a heading, or a code block.

### Ordering
When several candidate anchors exist for the same target, prefer:
1. The destination's full title, if it appears verbatim in the text.
2. The longest multi-word phrase from that title that appears verbatim.
3. Nothing. Skipping is always a valid outcome — a page with two excellent
   internal links beats one with six padded ones.

## Volume & Placement

- **2-5 internal links per 1,000 words** of body content is a healthy range.
- **Cap automated links at 3 per page per run** so a page can't accumulate a
  wall of links over repeated runs.
- Prefer links in **body prose** over lists, footers or sidebars — contextual
  links carry more weight and are the ones readers actually follow.
- Link **only to pages that are live right now.** Verify the target exists
  before writing the link; never link to a slug that "should" exist.
- Link **deep**, not to the homepage. The homepage already has every internal
  link on the site pointing at it.

## Topical Relevance

Two pages should be linked only when they genuinely share a subject. A
reasonable, explainable test — no ML needed:

1. Strip stopwords from both page titles.
2. Require at least one significant shared word.
3. Require an anchor phrase (per the rules above) that appears verbatim in the
   source page's body.

If any step fails, do not link. The failure mode to avoid is linking two pages
that share only a common business word ("business", "marketing", "services"),
which describes half the site and signals nothing.

## Safety Rules for Automated Linking

- **Only the first bare occurrence** of an anchor gets linked. Never link every
  occurrence of a phrase.
- **Never modify text that is already inside a link.**
- **Never change the author's words** — only wrap existing text in an `<a>`.
- **Idempotent runs.** Running the agent twice must not produce two links, nor
  nested links.
- **Log every applied link** with the anchor and target so a bad rule can be
  found and reversed later.
- **Reversibility.** Adding a link changes live published content. Keep enough
  of a record to unwrap a link that turns out to be wrong.

## Auditing Existing Internal Links

Pull the live HTML of each published post and flag:

| Signal | Why it matters |
|---|---|
| Anchors of one word | Almost always an automation bug |
| Anchors like "click here" | No topical value |
| Links to 404s or drafts | Wastes crawl budget, bad UX |
| Pages with zero inbound internal links | Orphan pages — Google may never find them |
| Pages with 20+ outbound internal links in body | Dilutes every link's value |
| Same anchor → different destinations | Contradictory relevance signal |
