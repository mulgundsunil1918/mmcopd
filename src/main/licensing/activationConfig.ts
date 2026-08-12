/**
 * Where the app fetches licences from during **online activation** (Phase 2).
 *
 * OFFLINE by default. While the placeholder below is unchanged (or the value is
 * empty), the app stays fully offline — the clinic pastes a licence code you
 * generate with the keygen. That path always works and needs no server.
 *
 * ── To turn ON one-tap online activation ──────────────────────────────────
 *   1. Deploy server/activation-server.mjs  (see server/README.md).
 *   2. Search-replace the placeholder host on the HARDCODED_ACTIVATION_URL line
 *      below with your live base URL, e.g.
 *         'https://curedesk-activate.up.railway.app'
 *      (just swap `REPLACE-ME.up.railway.app` for your real host, keep https).
 *   3. Rebuild the app.
 *
 * The env var CUREDESK_ACTIVATION_URL overrides this at runtime (handy for
 * testing against a local/staging server without editing this file).
 *
 * ⚠️  SAFETY: a URL that still contains `REPLACE-ME` is treated as "not
 * configured", so an un-replaced placeholder never shows a broken online
 * button — the app simply behaves as offline-only until you swap in a real URL.
 */
const HARDCODED_ACTIVATION_URL = 'https://REPLACE-ME.up.railway.app';

/** A blank URL, or one still carrying the REPLACE-ME placeholder, means "no server". */
const isUnconfigured = (u: string) => u === '' || /REPLACE-ME/i.test(u);

const RAW = (process.env.CUREDESK_ACTIVATION_URL || HARDCODED_ACTIVATION_URL)
  .trim()
  .replace(/\/+$/, '');

export const ACTIVATION_SERVER_URL = isUnconfigured(RAW) ? '' : RAW;
