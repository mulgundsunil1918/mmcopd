/**
 * WebSocket liveness sweep for the host's connected-clients list.
 *
 * A WebSocket 'close' only fires on an ORDERLY disconnect. When a cabin PC drops
 * off hard — WiFi lost, powered off, asleep, cable pulled — the host's socket is
 * never told, and TCP will not notice for ~2 hours. Without a heartbeat the dead
 * client stayed in the connected map forever, so the host kept showing "1
 * computer connected" long after the cabin was gone.
 *
 * Kept in its own module (no electron imports) so the sweep can be exercised
 * against the real ws library in a plain-node test.
 */
import type { WebSocket, WebSocketServer } from 'ws';

export interface WsClientMeta { name: string; ip: string; since: number }

/** Mark a freshly-connected socket alive and keep it marked on each pong. */
export function trackLiveness(ws: WebSocket): void {
  (ws as any).isAlive = true;
  ws.on('pong', () => { (ws as any).isAlive = true; });
}

/**
 * One heartbeat pass. A socket that answered the previous ping is pinged again
 * and kept; one that did not is presumed gone — removed from the map and
 * terminated (not closed: a vanished peer never completes a close handshake).
 * Returns how many it evicted.
 */
export function heartbeatSweep(server: WebSocketServer, clients: Map<WebSocket, WsClientMeta>): number {
  let evicted = 0;
  server.clients.forEach((ws) => {
    if ((ws as any).isAlive === false) {
      clients.delete(ws);
      try { ws.terminate(); } catch { /* ignore */ }
      evicted++;
      return;
    }
    (ws as any).isAlive = false;
    try { ws.ping(); } catch { /* ignore */ }
  });
  return evicted;
}
