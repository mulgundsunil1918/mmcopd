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

let httpServer: http.Server | null = null;
let wss: WebSocketServer | null = null;
let activePort = 0;
let activeSecret = '';
let activeVersion = '';
/** Operator-pinned adapter IP (settings.network_bind_ip). Empty = auto-pick. */
let preferredIp = '';
const wsClients = new Set<WebSocket>();

export function setPreferredIp(ip: string) { preferredIp = (ip || '').trim(); }

// ===== Join code (short pairing code) =====
let joinCode: { code: string; secret: string; port: number; expiresAt: number } | null = null;
const JOIN_CODE_TTL_MS = 10 * 60 * 1000;
const JOIN_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function genJoinCode(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += JOIN_CODE_CHARS[crypto.randomInt(JOIN_CODE_CHARS.length)];
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
}

export async function startNetworkServer(port: number, secret: string, appVersion: string): Promise<{ ok: true; port: number } | { ok: false; error: string }> {
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
        return sendJson(res, 200, {
          product: 'CureDesk HMS',
          version: appVersion,
          port: activePort,
          ip: getLocalLanIP(),
          clients: wsClients.size,
        });
      }
      if (method === 'POST' && url.pathname === '/api/pair') {
        try {
          const body = await readJsonBody(req);
          const raw = String(body?.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
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
          const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
          if (token !== activeSecret) {
            return sendJson(res, 401, { ok: false, error: 'Invalid or missing token' });
          }
        }
        const channel = decodeURIComponent(url.pathname.slice('/ipc/'.length));
        const handler = ipcHandlers.get(channel);
        if (!handler) return sendJson(res, 404, { ok: false, error: `Unknown IPC channel: ${channel}` });
        try {
          const body = await readJsonBody(req);
          const args = Array.isArray(body?.args) ? body.args : [];
          const fakeEvent = { sender: { send: () => { /* noop */ } } } as any;
          const result = await handler(fakeEvent, ...args);
          return sendJson(res, 200, { ok: true, result });
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
      if (activeSecret && token !== activeSecret) {
        ws.close(4401, 'unauthorized');
        return;
      }
      wsClients.add(ws);
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
    return { ok: true, port };
  } catch (err: any) {
    await stopNetworkServer();
    return { ok: false, error: err?.message || String(err) };
  }
}

export function broadcastEvent(event: string, payload: any): void {
  if (!wss || wsClients.size === 0) return;
  const msg = JSON.stringify({ event, payload, ts: Date.now() });
  wsClients.forEach((c) => {
    try { if (c.readyState === c.OPEN) c.send(msg); } catch { /* ignore */ }
  });
}

export function networkServerStatus() {
  return {
    running: httpServer !== null,
    port: activePort,
    clients: wsClients.size,
    ipcChannels: ipcHandlers.size,
  };
}
