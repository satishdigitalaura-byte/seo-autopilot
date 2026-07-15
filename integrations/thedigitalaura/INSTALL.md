# SEO Autopilot connector — install guide (for the Digital Aura developer)

This adds one route file to the existing `admin-backend` (Express 5 + Sequelize + MySQL).
It lets the agency's central automation apply **already-human-approved** SEO changes
(publish a blog draft, set JSON-LD schema, insert internal links, regenerate sitemap).

It is **read-secret-gated** and touches only the existing `Blog` and `Page` models —
no schema changes, no new tables, no AI code on your server.

## 1. Copy the file
Copy `seoAgent.js` (in this folder) into:

```
admin-backend/src/routes/seoAgent.js
```

## 2. Mount it in `admin-backend/src/server.js`
Add this line next to the other `app.use('/api/...')` route lines:

```js
app.use('/api/seo-agent', require('./routes/seoAgent'));
```

> Put it **before** the `handleRedirects` middleware line, alongside the other API routes.

## 3. Set environment variables (on the server / hosting panel)
```
SEO_AGENT_SHARED_SECRET=<ask the agency — do NOT commit this value anywhere>
SITE_BASE_URL=https://thedigitalaura.com
# optional — where to write sitemap.xml (defaults to ../../public/sitemap.xml relative to the route file)
# SITEMAP_PATH=/var/www/thedigitalaura/public/sitemap.xml
```

> ⚠️ The real `SEO_AGENT_SHARED_SECRET` is a live credential and must **never** be
> written into any file that gets committed to git (this repo is public). Get it
> **privately** from the agency — it is stored in the agency's Supabase
> (`site_credentials`, key `seo_agent_shared_secret`) and must match exactly on both
> sides. If it is ever rotated, the agency updates both sides.

## 4. Redeploy the backend, then verify
```
curl -H "X-Seo-Agent-Secret: <the secret>" https://thedigitalaura.com/api/seo-agent/health
# -> {"status":"ok","time":"..."}
```
A call **without** the correct secret must return `401 unauthorized`.

## What each endpoint does (all POST, all require the secret header)

| Endpoint | Effect on the DB |
|---|---|
| `POST /api/seo-agent/publish` | Upsert a row in `blogs` by `slug`. Refuses unless body has `approvedByHuman: true`. Writes as **draft** by default; `cmsStatus: "published"` publishes live. |
| `POST /api/seo-agent/schema/update` | Sets `schema_code` (JSON-LD) on a `pages` or `blogs` row by `slug`. |
| `POST /api/seo-agent/internal-links/apply` | Inserts `<a href>` links into a blog post's `content` HTML (blogs only). |
| `POST /api/seo-agent/sitemap/regenerate` | Writes `sitemap.xml` from all **published** pages + blogs. |

## Safety notes
- The central system only ever calls `/publish` for a task whose Supabase row is
  `approved_by_human = true`, **and** this endpoint independently re-checks the
  `approvedByHuman` flag — double gate.
- Defaults to **draft** in the CMS, so nothing appears live until someone flips it
  (or the agency explicitly enables auto-publish by sending `cmsStatus: "published"`).
- Pages built with the GrapesJS editor (`grapes_data`) are intentionally not string-edited;
  only clean-HTML blog `content` is modified for internal links.
