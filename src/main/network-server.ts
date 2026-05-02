/**
 * Network server for multi-station deployments (Option C — proper client-server).
 *
 * When the user sets Settings → Network Mode → Server, this module spins up:
 *   - An Express HTTP server on the configured port that accepts /api/health
 *     and /ipc/:channel from other CureDesk clients on the LAN.
 *   - A WebSocket server on the same port for live event broadcasts (queue
 *     status, new bookings, prescription saves, etc.) so client stations get
 *     real-time updates without polling.
 *
 * Authentication: simple bearer-token check against settings.network_secret.
 * Anyone on the LAN with the right token can call any IPC channel — for
 * a small in-clinic deployment this matches the trust model of "everyone
 * sitting in front of a CureDesk station is a clinic staff member".
 *
 * Generic IPC bridge: every channel registered via the wrapped registerHandler
 * helper in src/main/ipc-registry.ts is exposed automatically as
 *   POST /ipc/:channel
 *   body: { args: [...] }
 * so we don't have to hand-port 50+ endpoints. The same handler runs in both
 * local IPC mode AND remote HTTP mode — single source of truth.
 */

import express, { type Request, type Response } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import http from 'node:http';
import dgram from 'node:dgram';
import os from 'node:os';
import { ipcHandlers } from './ipc-registry';

let httpServer: http.Server | null = null;
let wss: WebSocketServer | null = null;
let activePort = 0;
const wsClients = new Set<WebSocket>();

// Join-code pairing — short-lived 6-char code that maps to the current secret
// so a client only has to type "7K3P-QM" once instead of an IP + port + secret.
let joinCode: { code: string; secret: string; port: number; expiresAt: number } | null = null;
const JOIN_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const JOIN_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/L/O/0/1 — easier to read aloud

function genJoinCode(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += JOIN_CODE_CHARS[Math.floor(Math.random() * JOIN_CODE_CHARS.length)];
  return s; // e.g. "7K3PQM" — UI shows "7K3P-QM"
}

/** Mint (or refresh) the active join code. Called when Server mode boots and on demand. */
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

// UDP broadcast (server side) — every 5s announce ourselves on the LAN so
// client PCs can auto-discover without typing an IP.
const UDP_PORT = 4322;
let udpSocket: dgram.Socket | null = null;
let udpTimer: NodeJS.Timeout | null = null;

/** Best-effort lookup of the LAN IP address (skip 127.0.0.1, virtual adapters). */
export function getLocalLanIP(): string | null {
  const nets = os.networkInterfaces();
  // Prefer non-virtual adapters; rank by typical home/clinic Wi-Fi/Ethernet.
  const candidates: string[] = [];
  for (const [name, infos] of Object.entries(nets)) {
    for (const info of infos || []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      // Skip Hyper-V / VMware / WSL adapters by name heuristic.
      if (/(virtual|vmware|hyper|loopback|docker)/i.test(name)) continue;
      candidates.push(info.address);
    }
  }
  return candidates[0] || null;
}

function startUdpBroadcast(version: string) {
  if (udpSocket) return;
  try {
    const sock = dgram.createSocket('udp4');
    sock.bind(() => {
      try { sock.setBroadcast(true); } catch { /* ignore */ }
      const send = () => {
        if (!httpServer) return; // Stopped before tick fired.
        const ip = getLocalLanIP();
        const payload = JSON.stringify({
          product: 'CureDesk HMS',
          version,
          ip,
          port: activePort,
          ts: Date.now(),
        });
        try { sock.send(payload, UDP_PORT, '255.255.255.255'); } catch { /* ignore */ }
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

/** Stop any running network server. Safe to call repeatedly. */
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
}

/** Start the network server on the given port. Returns the bound port. */
export async function startNetworkServer(port: number, secret: string, appVersion: string): Promise<{ ok: true; port: number } | { ok: false; error: string }> {
  await stopNetworkServer();
  try {
    const app = express();
    app.use(express.json({ limit: '50mb' }));

    // Lightweight CORS for clients on the LAN.
    app.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      next();
    });

    // Health check — used by the client's connection-status pill.
    app.get('/api/health', (_req, res) => {
      res.json({
        ok: true,
        product: 'CureDesk HMS',
        version: appVersion,
        mode: 'server',
        clients: wsClients.size,
        ipcChannels: ipcHandlers.size,
        time: new Date().toISOString(),
      });
    });

    // Public discovery info — no auth required so a client can show "Found: X" in the wizard.
    app.get('/api/info', (_req, res) => {
      res.json({
        product: 'CureDesk HMS',
        version: appVersion,
        port: activePort,
        ip: getLocalLanIP(),
        clients: wsClients.size,
      });
    });

    // Pair endpoint — client trades a 6-char join code for the connection
    // secret + port. Codes expire after 10 minutes; this endpoint is the only
    // way for a fresh client to learn the secret without typing it manually.
    app.post('/api/pair', (req, res) => {
      const raw = String(req.body?.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!joinCode) return res.status(401).json({ ok: false, error: 'Pairing not active' });
      if (Date.now() > joinCode.expiresAt) {
        joinCode = null;
        return res.status(401).json({ ok: false, error: 'Join code expired — generate a new one on the host PC' });
      }
      if (raw !== joinCode.code) return res.status(401).json({ ok: false, error: 'Invalid join code' });
      res.json({
        ok: true,
        secret: joinCode.secret,
        port: joinCode.port,
        product: 'CureDesk HMS',
        version: appVersion,
      });
    });

    // Auth gate — bearer token must match settings.network_secret. Empty
    // secret means the user explicitly opted into open access (warned in UI).
    const authGate = (req: Request, res: Response, next: () => void) => {
      if (!secret) return next();
      const auth = req.header('authorization') || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
      if (token !== secret) {
        return res.status(401).json({ ok: false, error: 'Invalid or missing token' });
      }
      next();
    };

    // Generic IPC bridge — looks up the registered handler for :channel and
    // calls it with a fake "event" plus the args from the body.
    app.post('/ipc/:channel', authGate, async (req, res) => {
      const channel = req.params.channel;
      const handler = ipcHandlers.get(channel);
      if (!handler) {
        return res.status(404).json({ ok: false, error: `Unknown IPC channel: ${channel}` });
      }
      try {
        const args = Array.isArray(req.body?.args) ? req.body.args : [];
        // Fake the IpcMainInvokeEvent — the handlers we have don't consult it.
        const fakeEvent = { sender: { send: () => { /* noop */ } } } as any;
        const result = await handler(fakeEvent, ...args);
        res.json({ ok: true, result });
      } catch (err: any) {
        res.status(500).json({ ok: false, error: err?.message || String(err) });
      }
    });

    httpServer = http.createServer(app);
    wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    wss.on('connection', (ws, req) => {
      // Auth on the WS handshake too.
      const url = new URL(req.url || '/ws', 'http://localhost');
      const token = url.searchParams.get('token') || '';
      if (secret && token !== secret) {
        ws.close(4401, 'unauthorized');
        return;
      }
      wsClients.add(ws);
      ws.send(JSON.stringify({ event: 'hello', payload: { product: 'CureDesk HMS', version: appVersion, ts: Date.now() } }));
      ws.on('close', () => wsClients.delete(ws));
      ws.on('error', () => wsClients.delete(ws));
    });

    await new Promise<void>((resolve, reject) => {
      httpServer!.once('error', reject);
      httpServer!.listen(port, () => resolve());
    });
    activePort = port;
    // Mint an initial join code so the host can immediately show it on screen.
    regenerateJoinCode(secret || '', port);
    // Start UDP discovery beacon so client wizards can auto-find this PC.
    startUdpBroadcast(appVersion);
    return { ok: true, port };
  } catch (err: any) {
    await stopNetworkServer();
    return { ok: false, error: err?.message || String(err) };
  }
}

/** Broadcast a live event to every connected client. Safe no-op if not running. */
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
