/**
 * Network diagnostics for the multi-station setup.
 *
 * Two jobs:
 *   1. listNetworkInterfaces() — enumerate every usable IPv4 adapter on this PC
 *      and classify it as wired / wireless. The host PC uses this to PIN itself
 *      to the Ethernet adapter instead of whichever interface Node happened to
 *      list first (the old getLocalLanIP() behaviour), which is the single most
 *      common cause of "the cabins can't find the host" on a PC that has both
 *      Wi-Fi and a network cable plugged in.
 *   2. runDiagnostics() — a staged connectivity check that tells the user, in
 *      plain English, exactly WHICH layer is broken: config → local adapter →
 *      TCP reachability → HTTP health → auth token → WebSocket upgrade.
 *      Every failing step carries a `hint` with the actual fix.
 */

import os from 'node:os';
import net from 'node:net';

export type InterfaceKind = 'wired' | 'wireless' | 'other';

export interface NetInterface {
  name: string;
  address: string;
  netmask: string;
  cidr: string | null;
  kind: InterfaceKind;
  /** Preference score — higher wins when auto-picking. Wired beats wireless. */
  score: number;
}

/** Classify an adapter by its OS-given name. Covers Windows ("Ethernet 2",
 *  "Wi-Fi"), macOS (en0/en1 + the friendly names), and Linux (eth0, enp3s0,
 *  wlan0, wlp2s0). Unknown names fall back to 'other' and score below wired. */
function classify(name: string): InterfaceKind {
  const n = name.toLowerCase();
  if (/(wi-?fi|wlan|wl[po]|airport|wireless|802\.11)/.test(n)) return 'wireless';
  if (/(ethernet|eth\d|en[opsx]?\d|local area connection|lan|thunderbolt bridge|usb.*lan|realtek|intel\(r\) ethernet)/.test(n)) return 'wired';
  // macOS: en0 is Wi-Fi on laptops but Ethernet on desktops/Mac minis. We can't
  // tell from the name alone, so treat bare enN as 'other' rather than guessing
  // wrong — it still shows in the picker, just without a wired/wireless badge.
  if (/^en\d+$/.test(n)) return 'other';
  return 'other';
}

function scoreOf(kind: InterfaceKind, address: string): number {
  let s = kind === 'wired' ? 100 : kind === 'other' ? 50 : 10;
  // Prefer private RFC1918 ranges typical of a clinic LAN.
  if (/^192\.168\./.test(address)) s += 5;
  else if (/^10\./.test(address)) s += 4;
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) s += 3;
  // Deprioritise link-local / APIPA — means DHCP failed.
  if (/^169\.254\./.test(address)) s -= 200;
  return s;
}

export function listNetworkInterfaces(): NetInterface[] {
  const nets = os.networkInterfaces();
  const out: NetInterface[] = [];
  for (const [name, infos] of Object.entries(nets)) {
    for (const info of infos || []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      // Skip virtual adapters — VMware/Hyper-V/Docker/VirtualBox host-only nets
      // advertise addresses that no other PC on the clinic LAN can reach.
      if (/(virtual|vmware|hyper-?v|loopback|docker|vethernet|vbox|tailscale|zerotier|utun|tun\d|tap\d)/i.test(name)) continue;
      const kind = classify(name);
      out.push({
        name,
        address: info.address,
        netmask: info.netmask,
        cidr: info.cidr ?? null,
        kind,
        score: scoreOf(kind, info.address),
      });
    }
  }
  return out.sort((a, b) => b.score - a.score || a.address.localeCompare(b.address));
}

/** Broadcast address for an interface, e.g. 192.168.1.42/255.255.255.0 →
 *  192.168.1.255. Used so UDP discovery reaches BOTH the wired and wireless
 *  subnets instead of only whichever one owns the default route. */
export function broadcastAddressFor(address: string, netmask: string): string | null {
  const a = address.split('.').map(Number);
  const m = netmask.split('.').map(Number);
  if (a.length !== 4 || m.length !== 4 || a.some(isNaN) || m.some(isNaN)) return null;
  return a.map((oct, i) => (oct & m[i]) | (~m[i] & 0xff)).join('.');
}

// ===== Staged diagnostics =====

export interface DiagStep {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  /** Plain-English fix shown under the step when it fails. */
  hint?: string;
  ms?: number;
}

export interface DiagReport {
  ok: boolean;
  ranAt: string;
  target: string;
  steps: DiagStep[];
  interfaces: NetInterface[];
}

/** Raw TCP connect test — proves the port is open and not firewalled,
 *  independent of whether the HTTP layer is healthy. */
function tcpProbe(host: string, port: number, timeoutMs = 4000): Promise<{ ok: boolean; ms: number; error?: string }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const sock = new net.Socket();
    let settled = false;
    const done = (ok: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      try { sock.destroy(); } catch { /* ignore */ }
      resolve({ ok, ms: Date.now() - started, error });
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false, 'Timed out — no response from that IP/port'));
    sock.once('error', (e: any) => done(false, e?.code || e?.message || 'Connection failed'));
    try { sock.connect(port, host); } catch (e: any) { done(false, e?.message || 'connect() threw'); }
  });
}

export async function runDiagnostics(serverUrl: string, secret: string): Promise<DiagReport> {
  const steps: DiagStep[] = [];
  const interfaces = listNetworkInterfaces();
  const push = (s: DiagStep) => { steps.push(s); return s.ok; };

  // ── 1. Config present and parseable ──────────────────────────────────────
  let url: URL | null = null;
  try {
    url = new URL((serverUrl || '').trim());
    if (!/^https?:$/.test(url.protocol)) throw new Error('Not an http(s) URL');
    push({
      id: 'config', label: 'Server address is valid', ok: true,
      detail: `${url.protocol}//${url.hostname}:${url.port || '80'}`,
    });
  } catch (e: any) {
    push({
      id: 'config', label: 'Server address is valid', ok: false,
      detail: serverUrl ? `Could not parse "${serverUrl}"` : 'No server address configured',
      hint: 'Set the host PC address as http://<host-ip>:4321 — for example http://192.168.1.5:4321. Use the join code flow to fill this in automatically.',
    });
    return { ok: false, ranAt: new Date().toISOString(), target: serverUrl, steps, interfaces };
  }

  // ── 2. This PC has a usable LAN adapter ──────────────────────────────────
  const usable = interfaces.filter((i) => !/^169\.254\./.test(i.address));
  if (usable.length === 0) {
    push({
      id: 'adapter', label: 'This PC has a network connection', ok: false,
      detail: interfaces.length ? 'Only self-assigned (169.254.x.x) addresses found' : 'No active network adapter found',
      hint: 'Plug in the network cable or connect to the clinic Wi-Fi. A 169.254.x.x address means the router did not hand out an IP — check the cable and the router.',
    });
  } else {
    const best = usable[0];
    push({
      id: 'adapter', label: 'This PC has a network connection', ok: true,
      detail: `${best.name} · ${best.address}${best.kind !== 'other' ? ` (${best.kind})` : ''}${usable.length > 1 ? ` · +${usable.length - 1} more` : ''}`,
    });
  }

  // ── 3. Same subnet sanity check ──────────────────────────────────────────
  const host = url.hostname;
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if (isIp && usable.length > 0) {
    const sameSubnet = usable.some((i) => {
      const bcast = broadcastAddressFor(i.address, i.netmask);
      const hostBcast = broadcastAddressFor(host, i.netmask);
      return bcast !== null && bcast === hostBcast;
    });
    push({
      id: 'subnet', label: 'Host PC is on the same network as this PC', ok: sameSubnet,
      detail: sameSubnet
        ? `${host} is reachable from ${usable[0].address}`
        : `${host} is not in the same range as ${usable.map((i) => i.address).join(', ')}`,
      hint: sameSubnet ? undefined
        : 'The two PCs are on different networks. Common cause: one is on Wi-Fi and the other is on the wired LAN, and the router keeps them separate (guest network or AP isolation). Put both on the same router/switch, or plug both into the same wired switch.',
    });
  }

  // ── 4. TCP port reachable ────────────────────────────────────────────────
  const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
  const tcp = await tcpProbe(host, port);
  push({
    id: 'tcp', label: `Port ${port} is open on the host PC`, ok: tcp.ok,
    detail: tcp.ok ? `Connected in ${tcp.ms} ms` : (tcp.error || 'Could not connect'),
    ms: tcp.ms,
    hint: tcp.ok ? undefined
      : 'The host PC is not accepting connections on this port. Check: (1) CureDesk is actually running on the host and set to Server mode, (2) Windows Firewall is allowing the port — re-run "Allow through firewall" on the host, (3) the IP address has not changed (DHCP may have given the host a new one — re-pair with a fresh join code).',
  });

  // ── 5. HTTP health endpoint ──────────────────────────────────────────────
  let healthOk = false;
  if (tcp.ok) {
    const t0 = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`${url.origin}/api/health`, { signal: ctrl.signal });
      clearTimeout(timer);
      const body: any = res.ok ? await res.json().catch(() => null) : null;
      healthOk = res.ok && body?.ok === true;
      push({
        id: 'health', label: 'CureDesk server is responding', ok: healthOk,
        detail: healthOk
          ? `v${body.version} · ${body.clients} client(s) connected · ${body.ipcChannels} channels`
          : `HTTP ${res.status} ${res.statusText}`,
        ms: Date.now() - t0,
        hint: healthOk ? undefined
          : 'Something is listening on that port but it is not CureDesk. Check the port number matches the host\'s "Listen port" setting (default 4321).',
      });
    } catch (e: any) {
      push({
        id: 'health', label: 'CureDesk server is responding', ok: false,
        detail: e?.name === 'AbortError' ? 'Timed out after 5s' : (e?.message || String(e)),
        hint: 'The port is open but CureDesk did not answer. Restart CureDesk on the host PC.',
      });
    }
  } else {
    push({ id: 'health', label: 'CureDesk server is responding', ok: false, detail: 'Skipped — port not reachable' });
  }

  // ── 6. Auth token accepted ───────────────────────────────────────────────
  if (healthOk) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${url.origin}/ipc/settings:get`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
        body: JSON.stringify({ args: [] }),
      });
      const ok = res.status !== 401;
      push({
        id: 'auth', label: 'Access token accepted', ok,
        detail: ok ? 'Token verified by host' : 'Host rejected the token (HTTP 401)',
        ms: Date.now() - t0,
        hint: ok ? undefined
          : 'This PC\'s saved token no longer matches the host. Click "Forget this server" below and re-pair using a fresh join code from the host PC (Settings → Network Mode → join code panel).',
      });
    } catch (e: any) {
      push({ id: 'auth', label: 'Access token accepted', ok: false, detail: e?.message || String(e) });
    }
  } else {
    push({ id: 'auth', label: 'Access token accepted', ok: false, detail: 'Skipped — server not responding' });
  }

  const ok = steps.every((s) => s.ok);
  return { ok, ranAt: new Date().toISOString(), target: url.origin, steps, interfaces };
}
