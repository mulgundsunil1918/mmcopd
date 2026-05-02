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
import { ipcHandlers } from './ipc-registry';

let httpServer: http.Server | null = null;
let wss: WebSocketServer | null = null;
let activePort = 0;
const wsClients = new Set<WebSocket>();

/** Stop any running network server. Safe to call repeatedly. */
export async function stopNetworkServer(): Promise<void> {
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
