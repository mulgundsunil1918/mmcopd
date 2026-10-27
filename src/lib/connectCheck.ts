/**
 * "Check this computer" — turns what the main process finds out about THIS computer (its network adapters, the Windows network type, its sleep setting, whether
 * CureDesk's server is running) into a short list of plain-language results: what is fine, what to look at, what is wrong and which step of the guide fixes it.
 *
 * Plain functions with no screen and no Electron, so every rule can be tested with made-up facts. The facts are gathered in main/network-facts.ts.
 *
 * What it can NOT see from one computer, and does not pretend to: whether ANOTHER computer can reach this one (that is the other computer's check) and whether
 * the Windows Firewall lets it through. For the main computer the proof is simple — an "n computers connected" line — and until then it says what to do.
 */
import { DIRECT_ADDRESSES, connectionInfo, type Connection } from './connectGuide';

export type AdapterKind = 'wired' | 'wireless' | 'other';

export interface AdapterFact {
  name: string;
  address: string;
  kind: AdapterKind;
  /** 169.254.x.x — Windows gave itself an address because nothing handed one out (a cable with no router, or a router that is off). */
  apipa: boolean;
  /** A virtual or host-only adapter (VirtualBox, Docker, VPN …) that CureDesk ignores. */
  virtual: boolean;
}

export interface ProfileFact {
  /** The connection's name in Windows ("Ethernet", "Wi-Fi") — the same name the adapter has. */
  alias: string;
  category: 'public' | 'private' | 'domain' | 'unknown';
}

export interface NetFacts {
  platform: string;
  adapters: AdapterFact[];
  /** The Windows network type of each connected network; null = could not be read (not Windows, or Windows did not answer). */
  profiles: ProfileFact[] | null;
  /** The sleep setting; null = not asked. */
  power: { known: boolean; sleepsOnAC: boolean; sleepAfterMinutes: number; preventionActive: boolean } | null;
  /** Only on the main computer: is its server running, on which port, and how many other computers are connected. */
  hosting: { running: boolean; port: number; clients: number } | null;
  /** The address other computers should use for this one. */
  lanIp: string | null;
  /** Windows only, main computer only: is the Windows Firewall rule CureDesk adds for its port there? true = yes; false = no (the Windows question may have been answered instead); null = not asked / could not be read. */
  firewallRule: boolean | null;
}

export type CheckStatus = 'ok' | 'info' | 'warn' | 'bad';

export interface CheckRow {
  id: 'connection' | 'profile' | 'sleep' | 'server' | 'others' | 'firewall';
  status: CheckStatus;
  title: string;
  detail: string;
  /** What to do, when something is not right. */
  fix?: string;
  /** The guide step (a Windows step id or 'plug' / 'main' / 'others') that explains the fix. */
  step?: string;
  /** A button the screen may offer next to the row. */
  action?: 'disable-sleep';
}

export interface CheckCtx {
  /** How this computer is connected, as the person chose it ('' = not chosen). */
  choice: Connection | '';
  /** The only computer, the main one, or an extra one. */
  here: 'alone' | 'main' | 'other';
}

const isDirectAddress = (a: string) => a === DIRECT_ADDRESSES.main || a === DIRECT_ADDRESSES.other;

/** Adapters CureDesk can actually use (it ignores virtual and self-assigned ones). */
export const usableAdapters = (f: NetFacts) => f.adapters.filter((a) => !a.apipa && !a.virtual);

function connectionRow(f: NetFacts, ctx: CheckCtx): CheckRow {
  const usable = usableAdapters(f);
  const wired = usable.filter((a) => a.kind === 'wired');
  const wireless = usable.filter((a) => a.kind === 'wireless');

  if (usable.length === 0) {
    if (f.adapters.some((a) => a.apipa && !a.virtual)) {
      return ctx.choice === 'direct'
        ? { id: 'connection', status: 'bad', title: 'The cable is in, but this computer has no usable address yet',
            detail: 'Windows gave it a self-made address (starting 169.254). With a cable straight between two computers nobody hands out addresses.',
            fix: `Give each computer its fixed address: ${DIRECT_ADDRESSES.main} on the main computer, ${DIRECT_ADDRESSES.other} on the other, mask ${DIRECT_ADDRESSES.mask}.`, step: 'address-direct' }
        : { id: 'connection', status: 'bad', title: 'Connected, but nothing gave this computer an address',
            detail: 'Windows gave it a self-made address (starting 169.254). That means the cable or Wi-Fi is connected to something that is not handing out addresses.',
            fix: 'Check the cable is pushed in at both ends and the router (or switch) is switched on. On Wi-Fi, check you joined the clinic’s network. Then check again.', step: 'plug' };
    }
    return { id: 'connection', status: 'bad', title: 'This computer is not connected to any network',
      detail: 'No network cable or Wi-Fi connection was found.',
      fix: 'Plug in the network cable, or join the clinic’s Wi-Fi — then check again.', step: 'plug' };
  }

  const first = (list: AdapterFact[]) => `${list[0].name} — address ${list[0].address}`;
  const both = wired.length > 0 && wireless.length > 0;
  const bothNote = both ? ' A cable and Wi-Fi are both on; CureDesk prefers the cable, which is right.' : '';

  switch (ctx.choice) {
    case 'cable':
      if (wired.length) return { id: 'connection', status: 'ok', title: 'Connected by network cable', detail: first(wired) + '.' + bothNote };
      return { id: 'connection', status: 'warn', title: 'This computer is on Wi-Fi, not on a cable',
        detail: `You chose a network cable, but right now it is using ${first(wireless.length ? wireless : usable)}.`,
        fix: 'Plug the network cable into this computer and the router or switch — or choose “Wi-Fi” above if Wi-Fi is what you use.', step: 'plug' };
    case 'direct':
      if (wired.length && wired.some((a) => isDirectAddress(a.address))) {
        const a = wired.find((x) => isDirectAddress(x.address))!;
        return { id: 'connection', status: 'ok', title: 'Connected by the direct cable', detail: `${a.name} — fixed address ${a.address}.` };
      }
      if (wired.length) return { id: 'connection', status: 'warn', title: 'A cable is connected, but not with the direct-cable address',
        detail: `${first(wired)}. A direct cable normally uses ${DIRECT_ADDRESSES.main} (main computer) and ${DIRECT_ADDRESSES.other} (the other).`,
        fix: 'If this cable goes to a router or switch, choose “Network cable to the router” above. If it goes straight to the other computer, set the fixed address.', step: 'address-direct' };
      return { id: 'connection', status: 'warn', title: 'No cable connection found',
        detail: 'You chose a cable straight between two computers, but no network cable is connected to this computer.',
        fix: 'Plug the cable into this computer’s network socket and into the other computer’s.', step: 'plug' };
    case 'wifi':
      if (wireless.length) return { id: 'connection', status: 'ok', title: 'Connected by Wi-Fi', detail: first(wireless) + '.' + bothNote };
      return { id: 'connection', status: 'info', title: 'This computer is on a cable, which is even better than Wi-Fi',
        detail: `${first(usable)}.` };
    default: {
      const how = wired.length ? 'a network cable' : wireless.length ? 'Wi-Fi' : 'the network';
      return { id: 'connection', status: 'ok', title: `Connected by ${how}`, detail: first(wired.length ? wired : wireless.length ? wireless : usable) + '.' + bothNote };
    }
  }
}

function profileRow(f: NetFacts, ctx: CheckCtx): CheckRow | null {
  if (f.platform !== 'win32') return null;                                   // the Public / Private network type is a Windows idea
  if (f.profiles === null) {
    return { id: 'profile', status: 'info', title: 'The Windows network type could not be read',
      detail: 'Windows did not answer. This is not a fault by itself.', fix: 'Check by hand that the network is set to Private.', step: 'profile' };
  }
  if (f.profiles.length === 0) return null;
  const usable = usableAdapters(f);
  const mine = f.profiles.filter((p) => usable.some((a) => a.name.toLowerCase() === p.alias.toLowerCase()));
  const relevant = mine.length ? mine : f.profiles;                         // a connection name that does not match any adapter: look at them all
  const pub = relevant.filter((p) => p.category === 'public');
  if (pub.length === 0) return { id: 'profile', status: 'ok', title: 'Windows network type is Private', detail: relevant.map((p) => p.alias).join(', ') + '.' };
  if (ctx.choice === 'direct') {
    return { id: 'profile', status: 'info', title: 'Windows calls the direct cable a “Public” network',
      detail: 'That is normal for a cable straight between two computers — Windows cannot tell what it is joined to.',
      fix: 'Make sure “Public networks” was ticked, as well as Private, when Windows asked about the firewall.', step: 'firewall' };
  }
  return { id: 'profile', status: 'bad', title: 'Windows has this network set to “Public”',
    detail: `${pub.map((p) => p.alias).join(', ')} is “Public”. Windows blocks other computers from reaching this one on a Public network.`,
    fix: 'Change it to “Private” — it takes half a minute.', step: 'profile' };
}

function sleepRow(f: NetFacts): CheckRow | null {
  if (!f.power || !f.power.known) return null;
  if (!f.power.sleepsOnAC) return { id: 'sleep', status: 'ok', title: 'This computer never goes to sleep', detail: 'Windows is set to stay awake while plugged in — right for the main computer.' };
  const mins = f.power.sleepAfterMinutes;
  const after = `after ${mins} minute${mins === 1 ? '' : 's'}`;
  if (f.power.preventionActive) {
    return { id: 'sleep', status: 'info', title: 'CureDesk is keeping this computer awake',
      detail: `While CureDesk is open the computer will not sleep. Windows itself is still set to sleep ${after}, which matters before CureDesk starts or after it is closed.`,
      fix: 'Set Windows to “Never” sleep as well.', step: 'sleep', action: 'disable-sleep' };
  }
  return { id: 'sleep', status: 'warn', title: `This computer goes to sleep ${after}`,
    detail: 'When the main computer sleeps, every other computer loses the clinic’s data at once.',
    fix: 'Set sleep to “Never” (the screen can still switch off).', step: 'sleep', action: 'disable-sleep' };
}

function serverRows(f: NetFacts): CheckRow[] {
  const h = f.hosting;
  if (!h) return [];
  const rows: CheckRow[] = [];
  if (!h.running) {
    rows.push({ id: 'server', status: 'bad', title: 'The main computer is not serving the others',
      detail: `Nothing is listening on port ${h.port} on this computer.`,
      fix: 'Keep CureDesk open on this computer; if it still says so, open Settings → Computers & staff → Connecting the Computers and press “Re-check”.', step: 'main' });
    return rows;
  }
  rows.push({ id: 'server', status: 'ok', title: 'The main computer is running',
    detail: f.lanIp ? `Other computers connect to ${f.lanIp} (port ${h.port}).` : `Listening on port ${h.port}.` });
  if (f.platform === 'win32' && f.firewallRule === true) {
    rows.push({ id: 'firewall', status: 'ok', title: 'The Windows Firewall lets other computers in', detail: `CureDesk’s own firewall rule for port ${h.port} is in place.` });
  }
  if (h.clients > 0) {
    rows.push({ id: 'others', status: 'ok', title: `${h.clients} other computer${h.clients === 1 ? ' is' : 's are'} connected`, detail: 'The network between them works.' });
  } else {
    rows.push({ id: 'others', status: 'info', title: 'No other computer has connected yet',
      detail: 'That is normal until you connect one. On the other computer, choose “This computer joins a clinic that is already set up” and use the join code from this computer.', step: 'others' });
    if (f.platform === 'win32' && f.firewallRule !== true) {
      rows.push({ id: 'firewall', status: 'info', title: 'Windows Firewall — checked by the first computer that connects',
        detail: 'This computer cannot test the firewall from the inside. If the other computer cannot connect, the Firewall question was probably answered “Cancel”.',
        fix: 'Allow CureDesk through the Windows Firewall (step “Windows settings”).', step: 'firewall' });
    }
  }
  return rows;
}

/** The results, in the order a person should read them. */
export function assessComputer(f: NetFacts, ctx: CheckCtx): CheckRow[] {
  const rows: CheckRow[] = [connectionRow(f, ctx)];
  const p = profileRow(f, ctx); if (p) rows.push(p);
  if (ctx.here === 'main') {
    const s = sleepRow(f); if (s) rows.push(s);
    rows.push(...serverRows(f));
  }
  return rows;
}

export interface CheckSummary { level: 'ok' | 'warn' | 'bad'; bad: number; warn: number; headline: string }

export function summarizeCheck(rows: CheckRow[]): CheckSummary {
  const bad = rows.filter((r) => r.status === 'bad').length;
  const warn = rows.filter((r) => r.status === 'warn').length;
  if (bad > 0) return { level: 'bad', bad, warn, headline: bad === 1 ? 'One thing needs fixing' : `${bad} things need fixing` };
  if (warn > 0) return { level: 'warn', bad, warn, headline: warn === 1 ? 'One thing to look at' : `${warn} things to look at` };
  return { level: 'ok', bad, warn, headline: 'This computer is ready' };
}

/** A line saying what the person chose, for the results panel. */
export const describeChoice = (c: Connection | ''): string => (c ? connectionInfo(c).title : 'not chosen yet');
