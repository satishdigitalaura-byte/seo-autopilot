/**
 * SEO Autopilot connector — drop-in Express router.
 *
 * WHAT THIS IS: the thin API layer described in SEO_AUTOPILOT_MASTER_ARCHITECTURE.md §5.
 * It lets the central automation system (GitHub Actions + Supabase, run by the agency)
 * apply already-human-approved changes to this site. It does NOT contain any AI logic,
 * scheduling, or decision-making — that all happens centrally. This file only:
 *   1. Checks a shared-secret header so random internet traffic can't call it
 *   2. Calls four functions you fill in with your existing DB/content logic
 *
 * HOW TO INSTALL (developer):
 *   1. Copy this file into your Express project, e.g. routes/seoAgent.js
 *   2. Fill in the four TODO functions below using the same DB calls your
 *      admin panel already uses to save a blog post / update meta / etc.
 *   3. Add to your main app file:
 *        import seoAgentRouter from './routes/seoAgent.js';
 *        app.use('/api/seo-agent', seoAgentRouter);
 *   4. Set the environment variable SEO_AGENT_SHARED_SECRET on the server
 *      (Hostinger hPanel -> Node.js App -> Environment Variables) to the
 *      value the agency gave you. Redeploy.
 *   5. Tell the agency the endpoint is live: https://thedigitalaura.com/api/seo-agent
 */

import express from 'express';

const router = express.Router();

// ---- TODO (developer fills these in with existing DB/content logic) ----

/** Write approved content live. payload: { slug, title, content, metaDescription, targetKeyword } */
async function applyPublish(payload) {
  throw new Error('applyPublish() not implemented yet — wire this to your existing "save blog post" DB call.');
}

/** Write/update JSON-LD schema for a page. payload: { slug, jsonLd } */
async function applySchemaUpdate(payload) {
  throw new Error('applySchemaUpdate() not implemented yet.');
}

/** Regenerate sitemap.xml (and ideally ping Google/Bing). No payload. */
async function regenerateSitemap() {
  throw new Error('regenerateSitemap() not implemented yet.');
}

/** Insert/update internal links inside a page's content. payload: { slug, links: [{anchorText, targetUrl}] } */
async function applyInternalLinks(payload) {
  throw new Error('applyInternalLinks() not implemented yet.');
}

// ---- Auth middleware — do not remove ----

function requireSharedSecret(req, res, next) {
  const provided = req.header('X-Seo-Agent-Secret');
  if (!provided || provided !== process.env.SEO_AGENT_SHARED_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

router.use(express.json({ limit: '2mb' }));
router.use(requireSharedSecret);

// ---- Routes ----

router.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

router.post('/publish', async (req, res) => {
  // Belt-and-suspenders: the central system should only ever call this for a
  // task whose Supabase row has approved_by_human = true, but this endpoint
  // also refuses to act without that flag echoed in the request body.
  if (req.body.approvedByHuman !== true) {
    return res.status(403).json({ error: 'missing approvedByHuman flag — refusing to publish' });
  }
  try {
    const result = await applyPublish(req.body);
    res.json({ status: 'published', result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/schema/update', async (req, res) => {
  try {
    const result = await applySchemaUpdate(req.body);
    res.json({ status: 'updated', result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sitemap/regenerate', async (req, res) => {
  try {
    const result = await regenerateSitemap();
    res.json({ status: 'regenerated', result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/internal-links/apply', async (req, res) => {
  try {
    const result = await applyInternalLinks(req.body);
    res.json({ status: 'updated', result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
