/**
 * Client-side network helpers for the multi-station setup:
 *   - discoverServers(): listens on UDP 4322 for ~5 seconds and returns every
 *     CureDesk server PC that's broadcasting on the LAN. The Welcome wizard
 *     uses this to show "Servers found on your network" buttons so the user
 *     doesn't have to type an IP.
 *   - pairWithCode(): trades a 6-char join code for the server's secret +
 *     port via POST /api/pair. The renderer then saves these and reloads in
 *     Network=Client mode.
 *   - addWindowsFirewallRule(): one-shot PowerShell call to allow the listen
 *     port through Windows Defender Firewall. Triggers a UAC prompt the first
 *     time the user enables Server mode — they click Allow access once and
 *     the rule persists.
 */

import dgram from 'node:dgram';
import { exec } from 'node:child_process';

const UDP_PORT = 4322;

export interface DiscoveredServer {
  ip: string;
  port: number;
  version: string;
  lastSeen: number;
}

export async function discoverServers(timeoutMs = 5_000): Promise<DiscoveredServer[]> {
  return new Promise((resolve) => {
    const found = new Map<string, DiscoveredServer>();
    let sock: dgram.Socket | null = null;
    try {
      sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    } catch {
      resolve([]);
      return;
    }
    sock.on('error', () => { try { sock?.close(); } catch { /* ignore */ } resolve([]); });
    sock.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data?.product !== 'CureDesk HMS') return;
        const ip = data.ip || rinfo.address;
        const port = Number(data.port) || 4321;
        const key = `${ip}:${port}`;
        found.set(key, { ip, port, version: data.version || '?', lastSeen: Date.now() });
      } catch { /* ignore malformed packets */ }
    });
    sock.bind(UDP_PORT, () => {
      try { sock!.setBroadcast(true); } catch { /* ignore */ }
    });
    setTimeout(() => {
      try { sock?.close(); } catch { /* ignore */ }
      resolve(Array.from(found.values()).sort((a, b) => a.ip.localeCompare(b.ip)));
    }, timeoutMs);
  });
}

export async function pairWithCode(serverUrl: string, code: string): Promise<{ ok: true; secret: string; port: number; version: string } | { ok: false; error: string }> {
  try {
    const url = serverUrl.replace(/\/+$/, '') + '/api/pair';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const json = await res.json() as any;
    if (!res.ok || !json.ok) {
      return { ok: false, error: json?.error || `HTTP ${res.status}` };
    }
    return { ok: true, secret: json.secret, port: json.port, version: json.version };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/** Add a Windows Defender Firewall inbound rule for the given TCP port. Best-effort
 *  — silent fail if PowerShell isn't available or UAC is denied. The first time
 *  this runs, Windows shows a UAC prompt; subsequent runs are silent. */
export async function addWindowsFirewallRule(port: number): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== 'win32') return { ok: false, error: 'Only supported on Windows' };
  return new Promise((resolve) => {
    const ruleName = `CureDesk HMS (port ${port})`;
    // Use netsh — works on Windows 10/11 without admin in many cases (per-user firewall).
    // If the user is on a Pro/Enterprise machine with Group Policy, may require admin.
    const cmd = `netsh advfirewall firewall show rule name="${ruleName}" >nul 2>&1 || netsh advfirewall firewall add rule name="${ruleName}" dir=in action=allow protocol=TCP localport=${port}`;
    exec(cmd, { windowsHide: true }, (err) => {
      if (err) return resolve({ ok: false, error: err.message });
      resolve({ ok: true });
    });
  });
}
