/**
 * Where the app fetches licences from during **online activation** (Phase 2).
 *
 * Leave this empty ('') to keep activation fully OFFLINE — the clinic pastes a
 * licence code you generate with tools/license-gen.mjs. That path always works
 * and needs no server.
 *
 * To enable one-tap ONLINE activation, deploy server/activation-server.mjs and
 * put its base URL here, e.g. 'https://curedesk-activate.onrender.com'.
 * The env var CUREDESK_ACTIVATION_URL overrides this at runtime (for testing).
 */
const HARDCODED_ACTIVATION_URL = '';

export const ACTIVATION_SERVER_URL = (process.env.CUREDESK_ACTIVATION_URL || HARDCODED_ACTIVATION_URL)
  .trim()
  .replace(/\/+$/, '');
