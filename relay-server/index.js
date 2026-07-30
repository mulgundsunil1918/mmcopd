/**
 * CureDesk WhatsApp Webhook Relay Server
 *
 * Receives webhooks from Meta, stores them in memory (ring buffer),
 * and exposes a polling endpoint for the Electron app to drain them.
 *
 * Deploy on Railway / Render / Fly.io (free tier).
 *
 * Environment variables:
 *   PORT             — listen port (default 3000)
 *   VERIFY_TOKEN     — must match wa_accounts.webhook_verify_token in the clinic DB
 *   PHONE_NUMBER_ID  — the clinic's Meta phone_number_id (for multi-tenant: comma-separated)
 *   SECRET           — shared secret the Electron app must send in X-Poll-Secret header
 *
 * Meta Developer Console → WhatsApp → Webhook:
 *   Callback URL:  https://<your-relay>.railway.app/webhook
 *   Verify token:  <value of VERIFY_TOKEN env var>
 *   Subscribe to: messages, message_status_updates
 */

import http from 'node:http';
import crypto from 'node:crypto';

const PORT          = parseInt(process.env.PORT || '3000', 10);
const VERIFY_TOKEN  = process.env.VERIFY_TOKEN  || '';
const POLL_SECRET   = process.env.SECRET        || '';
const MAX_EVENTS    = 500; // ring buffer cap

if (!VERIFY_TOKEN) console.warn('[relay] VERIFY_TOKEN not set — webhook verification will fail');
if (!POLL_SECRET)  console.warn('[relay] SECRET not set — poll endpoint is unprotected');

/** Ring buffer: oldest events drop off the front when cap is hit. */
const events = [];

function addEvent(type, payload) {
  events.push({ id: crypto.randomUUID(), type, payload, ts: Date.now() });
  if (events.length > MAX_EVENTS) events.shift();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost`);

  // ── GET /webhook — Meta's verification handshake ─────────────────────────
  if (req.method === 'GET' && url.pathname === '/webhook') {
    const mode      = url.searchParams.get('hub.mode');
    const token     = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(challenge);
    } else {
      res.writeHead(403);
      res.end('Forbidden');
    }
    return;
  }

  // ── POST /webhook — incoming events from Meta ─────────────────────────────
  if (req.method === 'POST' && url.pathname === '/webhook') {
    const buf = await readBody(req).catch(() => null);
    if (!buf) { res.writeHead(400); res.end(); return; }

    let body;
    try { body = JSON.parse(buf.toString()); } catch { res.writeHead(400); res.end(); return; }

    // Acknowledge immediately — Meta expects 200 within 20s
    res.writeHead(200);
    res.end();

    // Parse the WhatsApp business platform webhook envelope
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};

        // Inbound messages
        for (const msg of value.messages || []) {
          addEvent('inbound_message', { ...msg, phone_number_id: value.metadata?.phone_number_id });
        }

        // Status updates (sent/delivered/read/failed)
        for (const status of value.statuses || []) {
          addEvent('message_status', status);
        }
      }
    }
    return;
  }

  // ── GET /poll — Electron app polls this to drain events ──────────────────
  if (req.method === 'GET' && url.pathname.startsWith('/poll')) {
    // Auth check
    if (POLL_SECRET && req.headers['x-poll-secret'] !== POLL_SECRET) {
      res.writeHead(401); res.end('Unauthorized'); return;
    }

    // Optional: filter by phone_number_id path param /poll/{phone_number_id}
    const parts = url.pathname.split('/').filter(Boolean);
    const filterPhoneId = parts[1] || null;

    // Optional: only return events after a given timestamp (?since=<epoch_ms>)
    const since = parseInt(url.searchParams.get('since') || '0', 10);

    const filtered = events.filter((e) => {
      if (e.ts <= since) return false;
      if (filterPhoneId && e.payload?.phone_number_id !== filterPhoneId) return false;
      return true;
    });

    return json(res, 200, { events: filtered, server_ts: Date.now() });
  }

  // ── GET /health ───────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, { ok: true, queued: events.length, uptime: process.uptime() });
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => console.log(`[relay] listening on :${PORT}`));
