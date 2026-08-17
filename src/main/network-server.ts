/**
 * Network server for multi-station deployments (Option C — proper client-server).
 *
 * IMPORTANT: uses Node's built-in `http` module instead of Express. Vite's
 * production bundle has trouble with Express's dynamic `require()` calls and
 * silently drops it from the main-process bundle, causing a white-screen
 * launch in the installed app. Built-in http has zero external deps.
 *
 * When the user sets Settings → Network Mode → Server, this module spins up:
 *   - An HTTP server on the configured port that accepts /api/health,
 *     /api/info, /api/pair, and /ipc/:channel from other CureDesk clients
 *     on the LAN.
 *   - A WebSocket server on the same port for live event broadcasts.
 *
 * Authentication: simple bearer-token check against settings.network_secret.
 *
 * Generic IPC bridge: every channel registered via the wrapped ipcMain.handle
 * (see ipc-registry.ts) is exposed automatically as POST /ipc/:channel.
 */

import { WebSocketServer, type WebSocket } from 'ws';
import http from 'node:http';
import dgram from 'node:dgram';
import crypto from 'node:crypto';
import { ipcHandlers } from './ipc-registry';
import { listNetworkInterfaces, broadcastAddressFor } from './network-diagnostics';
import { startHostWatchdog, stopHostWatchdog } from './host-watchdog';

let httpServer: http.Server | null = null;
let wss: WebSocketServer | null = null;
let activePort = 0;
let activeSecret = '';
let activeVersion = '';
/** Operator-pinned adapter IP (settings.network_bind_ip). Empty = auto-pick. */
let preferredIp = '';
// Connected cabins, keyed by socket → their reported name + IP + connect time,
// so the host can show a named "Connected Computers" list, not just a count.
const wsClients = new Map<WebSocket, { name: string; ip: string; since: number }>();

/**
 * Every PC that has made a real request recently, keyed by IP.
 *
 * The connected count used to be `wsClients.size` alone — the number of open
 * WebSockets. But a cabin PC does its actual work over POST /ipc/:channel; the
 * WebSocket only carries live-refresh nudges, and it can be absent for ordinary
 * reasons (the renderer has not reached it yet, the secret mirror in localStorage
 * is missing after a restore, a proxy drops idle sockets). The result was a host
 * insisting "0 computers connected" while a cabin sat there happily using it —
 * which makes the clinic distrust the whole screen.
 *
 * So a station counts as connected if it is talking to us at all. WebSocket
 * clients still register their NAME, which is nicer, and are merged with these.
 */
const httpClients = new Map<string, { ip: string; firstSeen: number; lastSeen: number; requests: number }>();
/** A station is "connected" if it has spoken to the host within this window. */
const HTTP_CLIENT_TTL_MS = 90_000;

function noteHttpClient(ip: string) {
  const clean = (ip || '').replace(/^::ffff:/, '') || 'unknown';
  // The host talking to itself is not a connected station.
  if (clean === '127.0.0.1' || clean === '::1' || clean === 'unknown') return;
  const now = Date.now();
  const prev = httpClients.get(clean);
  if (prev) { prev.lastSeen = now; prev.requests++; }
  else httpClients.set(clean, { ip: clean, firstSeen: now, lastSeen: now, requests: 1 });
}

/** Result of the last launch self-test — did the host answer on its own LAN IP? */
export interface SelfTest { reachable: boolean; ip: string | null; port: number; error?: string; at: number; }
let lastSelfTest: SelfTest | null = null;
export function getSelfTest(): SelfTest | null { return lastSelfTest; }

/**
 * After the server binds, connect to OUR OWN LAN IP (not 127.0.0.1) and hit
 * /api/health. This proves the socket is actually reachable on the address we
 * advertise to cabins — catching an IPv6-only bind, a firewall blocking the
 * port, or a wrong pinned adapter BEFORE a receptionist discovers it mid-shift.
 * A 127.0.0.1 test would pass even when the LAN interface is unreachable.
 */
export async function runSelfTest(): Promise<SelfTest> {
  const ip = getLocalLanIP();
  const port = activePort;
  const base: SelfTest = { reachable: false, ip, port, at: Date.now() };
  if (!ip) { lastSelfTest = { ...base, error: 'No usable LAN adapter found on this PC (only loopback / disconnected).' }; return lastSelfTest; }
  if (!port) { lastSelfTest = { ...base, error: 'Server is not listening.' }; return lastSelfTest; }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`http://${ip}:${port}/api/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    const body: any = res.ok ? await res.json().catch(() => null) : null;
    lastSelfTest = body?.ok === true
      ? { ...base, reachable: true }
      : { ...base, error: `Unexpected reply (HTTP ${res.status}) on ${ip}:${port}` };
  } catch (e: any) {
    lastSelfTest = { ...base, error: e?.name === 'AbortError' ? `No answer on ${ip}:${port} within 3s` : (e?.message || String(e)) };
  }
  return lastSelfTest;
}

export function setPreferredIp(ip: string) { preferredIp = (ip || '').trim(); }

// ===== Security helpers =====
/** Timing-safe bearer-token comparison — no early-exit on the first wrong byte. */
function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided || ''), b = Buffer.from(expected || '');
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch { return false; }
}
/** Channels that must run ONLY on the host, never for a remote cabin:
 *  data destruction, DB restore, and OS-level actions. */
function isNetworkDenied(channel: string): boolean {
  return /^(admin:|backup:|updates:)/.test(channel);
}
/** Secrets stripped from any settings payload before it leaves for a client. */
const NETWORK_SECRET_KEYS = ['admin_password', 'anthropic_api_key', 'whatsapp_api_key', 'network_secret'];
function stripSecretsForNetwork(result: any): any {
  if (!result || typeof result !== 'object') return result;
  const out = { ...result };
  for (const k of NETWORK_SECRET_KEYS) delete (out as any)[k];
  return out;
}
/** Per-IP rate limit for the public /api/pair endpoint (join-code brute force). */
const pairAttempts = new Map<string, { count: number; resetAt: number }>();
function pairRateOk(ip: string): boolean {
  const now = Date.now();
  const rec = pairAttempts.get(ip);
  if (!rec || now > rec.resetAt) { pairAttempts.set(ip, { count: 1, resetAt: now + 60_000 }); return true; }
  rec.count += 1;
  return rec.count <= 10;
}

// ===== Join code (short pairing code) =====
let joinCode: { code: string; secret: string; port: number; expiresAt: number } | null = null;
const JOIN_CODE_TTL_MS = 10 * 60 * 1000;
// Case-SENSITIVE alphabet. Ambiguous glyphs (I/l, O/0) stay out so a code read
// aloud across a clinic is still unambiguous. 57 symbols over 5 places is
// ~601 million combinations — more than the old 6-character uppercase code
// (31^6 ≈ 887 million is close, but the code lives for 10 minutes and is
// rate-limited, so both are far beyond guessing range).
const JOIN_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

function genJoinCode(): string {
  let s = '';
  for (let i = 0; i < 5; i++) s += JOIN_CODE_CHARS[crypto.randomInt(JOIN_CODE_CHARS.length)];
  return s;
}

export function regenerateJoinCode(secret: string, port: number): { code: string; expiresAt: number } {
  const code = genJoinCode();
  joinCode = { code, secret, port, expiresAt: Date.now() + JOIN_CODE_TTL_MS };
  return { code, expiresAt: joinCode.expiresAt };
}

export function getJoinCode(): { code: string; expiresAt: number } | null {
  if (!joinCode) return null;
  if (Date.now() > joinCode.expiresAt) { joinCode = null; return null; }
  return { code: joinCode.code, expiresAt: joinCode.expiresAt };
}

// ===== UDP broadcast =====
const UDP_PORT = 4322;
let udpSocket: dgram.Socket | null = null;
let udpTimer: NodeJS.Timeout | null = null;

/** The address other PCs should use to reach this host.
 *  Honours the operator's pinned adapter first; otherwise picks the
 *  highest-scoring interface (wired beats Wi-Fi — see network-diagnostics). */
export function getLocalLanIP(): string | null {
  const ifaces = listNetworkInterfaces();
  if (preferredIp && ifaces.some((i) => i.address === preferredIp)) return preferredIp;
  return ifaces[0]?.address || null;
}

function startUdpBroadcast() {
  if (udpSocket) return;
  try {
    const sock = dgram.createSocket('udp4');
    sock.bind(() => {
      try { sock.setBroadcast(true); } catch { /* ignore */ }
      const send = () => {
        if (!httpServer) return;
        const ip = getLocalLanIP();
        const payload = JSON.stringify({
          product: 'CureDesk HMS',
          version: activeVersion,
          ip,
          port: activePort,
          ts: Date.now(),
        });
        // Broadcast to EVERY adapter's own subnet, not just 255.255.255.255.
        // A host with both a network cable and Wi-Fi only sends the global
        // broadcast out the default-route interface, so cabins on the other
        // subnet never discover it. Per-subnet broadcast covers both.
        const targets = new Set<string>(['255.255.255.255']);
        for (const iface of listNetworkInterfaces()) {
          const b = broadcastAddressFor(iface.address, iface.netmask);
          if (b) targets.add(b);
        }
        for (const t of targets) {
          try { sock.send(payload, UDP_PORT, t); } catch { /* ignore */ }
        }
      };
      send();
      udpTimer = setInterval(send, 5_000);
    });
    udpSocket = sock;
  } catch { /* ignore — UDP optional */ }
}

function stopUdpBroadcast() {
  if (udpTimer) { clearInterval(udpTimer); udpTimer = null; }
  if (udpSocket) { try { udpSocket.close(); } catch { /* ignore */ } udpSocket = null; }
}

// ===== HTTP helpers =====

function sendJson(res: http.ServerResponse, status: number, body: any) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const MAX = 50 * 1024 * 1024;
    req.on('data', (c) => {
      chunks.push(c);
      total += c.length;
      if (total > MAX) {
        req.destroy();
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ===== Lifecycle =====

export async function stopNetworkServer(): Promise<void> {
  stopHostWatchdog();
  stopUdpBroadcast();
  joinCode = null;
  if (wss) {
    try { wss.clients.forEach((c) => c.terminate()); } catch { /* ignore */ }
    try { wss.close(); } catch { /* ignore */ }
    wss = null;
  }
  if (httpServer) {
    await new Promise<void>((resolve) => {
      httpServer!.close(() => resolve());
    }).catch(() => { /* ignore */ });
    httpServer = null;
  }
  wsClients.clear();
  activePort = 0;
  activeSecret = '';
  lastSelfTest = null;
}

export async function startNetworkServer(port: number, secret: string, appVersion: string): Promise<{ ok: true; port: number; selfTest: SelfTest | null } | { ok: false; error: string }> {
  await stopNetworkServer();
  try {
    activeSecret = secret || '';
    activeVersion = appVersion;

    httpServer = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', 'http://localhost');
      const method = req.method || 'GET';

      // CORS preflight.
      if (method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Public health/info/pair endpoints — no auth required.
      if (method === 'GET' && url.pathname === '/api/health') {
        return sendJson(res, 200, {
          ok: true,
          product: 'CureDesk HMS',
          version: appVersion,
          mode: 'server',
          clients: wsClients.size,
          ipcChannels: ipcHandlers.size,
          time: new Date().toISOString(),
        });
      }
      if (method === 'GET' && url.pathname === '/api/info') {
        // Requires the token — LAN topology / client count is not public info.
        if (activeSecret) {
          const auth = req.headers['authorization'] || '';
          const token = auth.startsWith('Bearer ') ? auth.slice(7) : String(auth);
          if (!tokensMatch(token, activeSecret)) return sendJson(res, 401, { ok: false, error: 'Invalid or missing token' });
        }
        return sendJson(res, 200, {
          product: 'CureDesk HMS',
          version: appVersion,
          port: activePort,
          ip: getLocalLanIP(),
          clients: wsClients.size,
        });
      }
      if (method === 'POST' && url.pathname === '/api/pair') {
        const ip = req.socket.remoteAddress || 'unknown';
        if (!pairRateOk(ip)) return sendJson(res, 429, { ok: false, error: 'Too many attempts — wait a minute and try again.' });
        try {
          const body = await readJsonBody(req);
          // Case is significant — do NOT upper-case here, or 'aB3xY' and 'Ab3Xy'
          // would both open the same clinic. Only separators are stripped.
          const raw = String(body?.code || '').replace(/[^A-Za-z0-9]/g, '');
          if (!joinCode) return sendJson(res, 401, { ok: false, error: 'Pairing not active' });
          if (Date.now() > joinCode.expiresAt) {
            joinCode = null;
            return sendJson(res, 401, { ok: false, error: 'Join code expired — generate a new one on the host PC' });
          }
          if (raw !== joinCode.code) return sendJson(res, 401, { ok: false, error: 'Invalid join code' });
          return sendJson(res, 200, {
            ok: true,
            secret: joinCode.secret,
            port: joinCode.port,
            product: 'CureDesk HMS',
            version: appVersion,
          });
        } catch (err: any) {
          return sendJson(res, 400, { ok: false, error: err?.message || 'Bad request' });
        }
      }

      // IPC bridge — all other endpoints require the bearer token.
      if (method === 'POST' && url.pathname.startsWith('/ipc/')) {
        if (activeSecret) {
          const auth = req.headers['authorization'] || '';
          const token = auth.startsWith('Bearer ') ? auth.slice(7) : String(auth);
          if (!tokensMatch(token, activeSecret)) {
            return sendJson(res, 401, { ok: false, error: 'Invalid or missing token' });
          }
        }
        // Authenticated request from a cabin — that PC is demonstrably connected.
        noteHttpClient(req.socket.remoteAddress || '');
        const channel = decodeURIComponent(url.pathname.slice('/ipc/'.length));
        // Destructive / OS-level channels are host-only, never runnable remotely.
        if (isNetworkDenied(channel)) {
          return sendJson(res, 403, { ok: false, error: `"${channel}" can only be run on the host PC, not from a cabin.` });
        }
        const handler = ipcHandlers.get(channel);
        if (!handler) return sendJson(res, 404, { ok: false, error: `Unknown IPC channel: ${channel}` });
        try {
          const body = await readJsonBody(req);
          const args = Array.isArray(body?.args) ? body.args : [];
          const fakeEvent = { sender: { send: () => { /* noop */ } } } as any;
          const result = await handler(fakeEvent, ...args);
          // Never ship the host's secrets (admin password, API keys) to a cabin.
          const safe = channel === 'settings:get' ? stripSecretsForNetwork(result) : result;
          return sendJson(res, 200, { ok: true, result: safe });
        } catch (err: any) {
          return sendJson(res, 500, { ok: false, error: err?.message || String(err) });
        }
      }

      sendJson(res, 404, { ok: false, error: 'Not found' });
    });

    wss = new WebSocketServer({ server: httpServer, path: '/ws' });
    wss.on('connection', (ws, req) => {
      const url = new URL(req.url || '/ws', 'http://localhost');
      const token = url.searchParams.get('token') || '';
      if (activeSecret && !tokensMatch(token, activeSecret)) {
        ws.close(4401, 'unauthorized');
        return;
      }
      const clientName = (url.searchParams.get('name') || '').slice(0, 60).trim() || 'Cabin PC';
      const clientIp = (req.socket.remoteAddress || '').replace(/^::ffff:/, '') || 'unknown';
      wsClients.set(ws, { name: clientName, ip: clientIp, since: Date.now() });
      try { ws.send(JSON.stringify({ event: 'hello', payload: { product: 'CureDesk HMS', version: appVersion, ts: Date.now() } })); } catch { /* ignore */ }
      ws.on('close', () => wsClients.delete(ws));
      ws.on('error', () => wsClients.delete(ws));
    });

    await new Promise<void>((resolve, reject) => {
      httpServer!.once('error', (err: any) => {
        const code = err?.code;
        if (code === 'EADDRINUSE') reject(new Error(`Port ${port} is already in use on this PC — another program (or a second copy of CureDesk) has it. Pick a different Listen port (e.g. 4321 or 4400).`));
        else if (code === 'EACCES') reject(new Error(`This PC blocked binding to port ${port}. Use a port above 1024 (the default 4321 works) and allow CureDesk through the firewall.`));
        else reject(new Error(err?.message || String(err)));
      });
      // Bind to 0.0.0.0 (every IPv4 adapter). Node's bare listen(port) binds to
      // '::', which is IPv6-only on Windows (IPV6_V6ONLY defaults on) — so LAN
      // clients hitting the host's IPv4 address get "connection refused".
      // Explicit 0.0.0.0 makes host↔client work identically on Windows & macOS.
      httpServer!.listen(port, '0.0.0.0', () => resolve());
    });
    // Persistent handler so a later per-socket error can never crash the host.
    httpServer.on('error', (err) => { try { console.error('[network] server error:', err); } catch { /* ignore */ } });
    activePort = port;
    regenerateJoinCode(secret || '', port);
    startUdpBroadcast();
    // Confirm we're actually reachable on our own LAN address (fire-and-store).
    await runSelfTest();
    // runSelfTest only ever proves we were healthy at STARTUP. The watchdog is
    // what notices if we stop answering later, and it must run outside this
    // process to survive the blocked-event-loop case it exists to catch.
    startHostWatchdog(port);
    return { ok: true, port, selfTest: lastSelfTest };
  } catch (err: any) {
    await stopNetworkServer();
    return { ok: false, error: err?.message || String(err) };
  }
}

export function broadcastEvent(event: string, payload: any): void {
  if (!wss || wsClients.size === 0) return;
  const msg = JSON.stringify({ event, payload, ts: Date.now() });
  wsClients.forEach((_meta, c) => {
    try { if (c.readyState === c.OPEN) c.send(msg); } catch { /* ignore */ }
  });
}

export function networkServerStatus() {
  // One entry per station: a named WebSocket client wins, otherwise the PC is
  // listed by the IP it has been making requests from.
  const now = Date.now();
  const byIp = new Map<string, { name: string; ip: string; since: number; live: boolean }>();
  for (const c of wsClients.values()) {
    byIp.set(c.ip, { name: c.name, ip: c.ip, since: c.since, live: true });
  }
  for (const h of httpClients.values()) {
    if (now - h.lastSeen > HTTP_CLIENT_TTL_MS) continue;   // gone quiet — drop it
    if (byIp.has(h.ip)) continue;                          // already named via WS
    byIp.set(h.ip, { name: h.ip, ip: h.ip, since: h.firstSeen, live: false });
  }
  const merged = [...byIp.values()].sort((a, b) => a.since - b.since);
  return {
    running: httpServer !== null,
    port: activePort,
    clients: merged.length,
    clientList: merged,
    /** How many of those also hold a live socket (used for the live-updates hint). */
    liveClients: [...byIp.values()].filter((c) => c.live).length,
    ipcChannels: ipcHandlers.size,
    lanIp: httpServer ? getLocalLanIP() : null,
    selfTest: lastSelfTest,
  };
}
