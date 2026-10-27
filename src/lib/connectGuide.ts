/**
 * Connecting the clinic's computers — everything the step-by-step guide says, in ONE place: how the computers can be joined (a cable to the router or a switch,
 * Wi-Fi, or one cable straight between two computers), the Windows settings every computer needs, what to buy, and the printable checklist.
 *
 * The Setup guide, Settings → Computers & staff, the Help page and the printed checklist all read from here, so they can never disagree. It is plain data and
 * small functions (no screens, no Electron) so a test can hold the content to its rules — for example, that a shopping link is only ever a plain Amazon.in
 * search, and that the two addresses given for a direct cable really are on one network.
 *
 * Why Windows settings at all: CureDesk's computers talk to each other over the clinic's own network (nothing goes over the internet). Almost every
 * "the other computer can't find the main one" is a Windows setting — the network marked Public, the firewall asked once and answered "Cancel", the main
 * computer asleep — not a CureDesk fault. The guide walks through each, with the exact clicks.
 */

/** How a computer reaches the others. */
export type Connection = 'cable' | 'wifi' | 'direct';
export const CONNECTION_IDS: readonly Connection[] = ['cable', 'wifi', 'direct'];

export interface ConnectionInfo {
  id: Connection;
  title: string;
  /** One short tag shown on the card ("Recommended"). */
  tag: string;
  good: string[];
  watch: string[];
}

export const CONNECTIONS: readonly ConnectionInfo[] = [
  {
    id: 'cable', title: 'Network cable to the router or a switch', tag: 'Recommended',
    good: [
      'The most reliable — it does not drop out or slow down.',
      'Best for the main computer, which everyone else depends on.',
      'Any number of computers: add a switch when the router runs out of sockets.',
    ],
    watch: [
      'One cable from each computer to the router or switch.',
      'Each computer needs a network (LAN) socket — a laptop without one needs a USB-to-LAN adapter.',
    ],
  },
  {
    id: 'wifi', title: 'Wi-Fi', tag: 'No wires',
    good: [
      'No cables to run — easy for laptops and far rooms.',
      'Nothing to buy if the clinic already has a Wi-Fi router.',
    ],
    watch: [
      'Can drop out or slow down when the signal is weak.',
      'Keep the main computer on a cable if you can; use Wi-Fi for the others.',
      'Every computer must join the same clinic Wi-Fi — not a “Guest” network.',
    ],
  },
  {
    id: 'direct', title: 'One cable straight between two computers', tag: 'Only two computers',
    good: [
      'No router or switch needed.',
      'Private and fast — nothing else shares the cable.',
    ],
    watch: [
      'Exactly two computers. A third one later needs a router or switch.',
      'Both need a network (LAN) socket.',
      'With no router, each computer needs a fixed address — the steps show exactly what to type.',
    ],
  },
];

export const connectionInfo = (id: Connection) => CONNECTIONS.find((c) => c.id === id)!;

/** The saved answer, or '' when nothing was chosen (or the saved text is not one of ours). */
export function parseConnection(v: unknown): Connection | '' {
  const s = String(v ?? '').trim();
  return (CONNECTION_IDS as readonly string[]).includes(s) ? (s as Connection) : '';
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The fixed addresses for a direct cable
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Two computers joined by one cable have no router to hand out addresses, so each is given one by hand. The numbers are chosen to be safe:
 *   - 192.168.77.x is not any router's factory address (routers use 192.168.0.x, .1.x, .29.x, .31.x, .50.x, .68.x …), so a computer that ALSO uses Wi-Fi
 *     to a router never ends up with two networks on the same numbers;
 *   - it is not the VirtualBox (192.168.56.x), Docker (172.16–31.x), Windows connection-sharing (192.168.137.x) or self-assigned (169.254.x.x) range, all of
 *     which CureDesk ignores when it looks for the computer's address.
 * No gateway and no DNS are given: this cable goes nowhere but the other computer, and a second gateway would take the internet away from the Wi-Fi.
 */
export const DIRECT_ADDRESSES = { main: '192.168.77.1', other: '192.168.77.2', mask: '255.255.255.0' } as const;

// ---------------------------------------------------------------------------------------------------------------------------------
// What to buy — plain Amazon.in SEARCH links, so people choose what they want (no seller, product or affiliate tag is pushed)
// ---------------------------------------------------------------------------------------------------------------------------------

/** A search on Amazon.in. Plain: no tag, no tracking, no product. */
export function amazonSearchUrl(query: string): string {
  const q = String(query).trim().replace(/\s+/g, ' ');
  return 'https://www.amazon.in/s?k=' + encodeURIComponent(q).replace(/%20/g, '+');
}

export interface ShopItem {
  id: string;
  title: string;
  /** What it is for, in a sentence a clinic owner can use. */
  why: string;
  /** What to type in the Amazon search box. */
  query: string;
  /** Which ways of connecting need it ('every' = all). */
  for: Connection[];
  /** Only suggested, not needed. */
  optional?: boolean;
}

export const SHOPPING: readonly ShopItem[] = [
  { id: 'cable', title: 'Network (LAN) cable, Cat6', for: ['cable', 'direct'], query: 'cat6 lan cable 10 meter',
    why: 'One for each computer, from the computer to the router or switch (for a direct cable: one cable between the two). Buy it ready-made — no crimping — and measure the route plus a metre or two spare. Any Cat5e or Cat6 cable works; no special “crossover” cable is needed.' },
  { id: 'switch', title: 'Network switch, 8-port Gigabit', for: ['cable'], query: '8 port gigabit network switch',
    why: 'Only if you have more computers than the router has LAN sockets (most routers have four). One cable goes from the router to the switch, and the computers plug into the switch.' },
  { id: 'router', title: 'Wi-Fi router, dual-band', for: ['wifi', 'cable'], optional: true, query: 'wifi router dual band',
    why: 'The box your internet comes from. Any router will do for CureDesk — a better one just gives a steadier signal. Keep it in the middle of the clinic, not in a cupboard.' },
  { id: 'ups', title: 'UPS for the main computer', for: ['cable', 'wifi', 'direct'], optional: true, query: 'ups 1kva for computer',
    why: 'A short power cut would switch off the main computer — and with it every other computer. A small UPS (also for the router and switch) gives a few minutes to carry on or shut down properly.' },
  { id: 'usb-lan', title: 'USB-to-LAN adapter, Gigabit', for: ['cable', 'direct'], optional: true, query: 'usb to lan adapter gigabit',
    why: 'Only for a laptop or small computer with no network (LAN) socket. It plugs into a USB port and gives it one.' },
  { id: 'usb-wifi', title: 'USB Wi-Fi adapter', for: ['wifi'], optional: true, query: 'usb wifi adapter dual band',
    why: 'Only for a desktop computer with no Wi-Fi of its own. Most laptops do not need one.' },
];

export const shoppingFor = (c: Connection): ShopItem[] => SHOPPING.filter((i) => i.for.includes(c));

// ---------------------------------------------------------------------------------------------------------------------------------
// The Windows settings
// ---------------------------------------------------------------------------------------------------------------------------------

/** Which page of Windows Settings a button opens (Windows only). The actual links live in main/external-url.ts — the only ones allowed. */
export type WinPage = 'network' | 'ethernet' | 'wifi' | 'power' | 'time' | 'security';
export const WIN_PAGE_URI: Record<WinPage, string> = {
  network: 'ms-settings:network-status',
  ethernet: 'ms-settings:network-ethernet',
  wifi: 'ms-settings:network-wifi',
  power: 'ms-settings:powersleep',
  time: 'ms-settings:dateandtime',
  security: 'ms-settings:windowsdefender',
};

export type WinStepId = 'wifi-join' | 'profile' | 'firewall' | 'sleep' | 'adapter' | 'address' | 'address-direct' | 'time' | 'antivirus';

export interface WinStep {
  id: WinStepId;
  title: string;
  /** Which computers it is for. */
  who: 'every' | 'main';
  need: 'required' | 'recommended';
  /** For which ways of connecting this step appears. */
  applies: Connection[];
  why: string;
  /** The clicks, for Windows 11 and Windows 10 (the same list when they are the same). */
  win11: string[];
  win10: string[];
  /** A button that opens the right page of Windows Settings. */
  open?: { page: WinPage; label: string };
  /** Something to copy-paste. */
  commands?: { label: string; text: string }[];
  /** A last word of advice. */
  note?: string;
}

/** The firewall rules by hand (only if Windows was answered "Cancel" at its question). */
export function firewallCommands(c: Connection, port = 4321): string {
  const profile = c === 'direct' ? 'any' : 'private,domain';
  return [
    `netsh advfirewall firewall add rule name="CureDesk HMS server" dir=in action=allow protocol=TCP localport=${port} profile=${profile}`,
    `netsh advfirewall firewall add rule name="CureDesk HMS finder" dir=in action=allow protocol=UDP localport=4322 profile=${profile}`,
  ].join('\n');
}

const both = (steps: string[]) => ({ win11: steps, win10: steps });
const NCPA = [
  'Press the Windows key and R together, type “ncpa.cpl” and press Enter.',
  'Right-click your connection (“Ethernet” for a cable, “Wi-Fi” for Wi-Fi) → Properties.',
  'Double-click “Internet Protocol Version 4 (TCP/IPv4)”.',
];

export const WINDOWS_STEPS: readonly WinStep[] = [
  {
    id: 'wifi-join', title: 'Join the same Wi-Fi on every computer', who: 'every', need: 'required', applies: ['wifi'],
    why: 'Computers can only see each other on the same network. A “Guest” Wi-Fi usually keeps computers apart on purpose, so do not use it.',
    ...both([
      'Click the Wi-Fi symbol at the bottom-right of the screen.',
      'Choose the clinic’s Wi-Fi — the same name on every computer.',
      'Tick “Connect automatically”, then click Connect.',
      'Two or more bars of signal at least. If the main computer is far from the router, put it on a cable instead.',
    ]),
    open: { page: 'wifi', label: 'Open Windows Wi-Fi settings' },
  },
  {
    id: 'profile', title: 'Set the network to “Private”', who: 'every', need: 'required', applies: ['cable', 'wifi'],
    why: 'Windows marks a new network “Public” and then refuses connections from other computers. “Private” tells Windows this is your own clinic network.',
    win11: [
      'Open Settings → Network & internet.',
      'Cable: click Ethernet.  Wi-Fi: click Wi-Fi, then the properties of the network you are on.',
      'Under “Network profile type” choose “Private network”.',
    ],
    win10: [
      'Open Settings → Network & Internet → Status.',
      'Under your connection (Ethernet or your Wi-Fi name) click Properties.',
      'Under “Network profile” choose “Private”.',
    ],
    open: { page: 'network', label: 'Open Windows network settings' },
    note: 'Do this on every computer, and again if you ever connect to a different network.',
  },
  {
    id: 'firewall', title: 'Allow CureDesk through the Windows Firewall', who: 'every', need: 'required', applies: ['cable', 'wifi', 'direct'],
    why: 'The Windows Firewall stops other computers from reaching CureDesk unless you allow it. Windows asks once, the first time CureDesk starts — a click on Cancel is the most common reason the computers cannot find each other.',
    ...both([
      'When Windows asks “Allow CureDesk HMS to communicate on these networks?”, tick “Private networks” and click “Allow access”.',
      'For a cable straight between two computers, also tick “Public networks” — Windows calls that cable a public network.',
      'Missed the question, or clicked Cancel? Open Windows Security → Firewall & network protection → Allow an app through firewall → Change settings → find “CureDesk HMS” and tick Private (and Public for a direct cable). Or use the two commands below: right-click the Start button → “Terminal (Admin)” or “Windows PowerShell (Admin)”, paste them, press Enter.',
    ]),
    open: { page: 'security', label: 'Open Windows Security' },
    commands: [{ label: 'Allow CureDesk by hand (paste in PowerShell run as Administrator)', text: firewallCommands('cable') }],
  },
  {
    id: 'sleep', title: 'Never let the main computer sleep', who: 'main', need: 'required', applies: ['cable', 'wifi', 'direct'],
    why: 'If the main computer goes to sleep, every other computer loses the clinic’s data at once and it looks like the network broke. The screen may still switch off — only “sleep” must be Never.',
    win11: [
      'Open Settings → System → Power & battery.',
      'Open “Screen and sleep”.',
      'Set “When plugged in, put my device to sleep after” to Never.',
    ],
    win10: [
      'Open Settings → System → Power & sleep.',
      'Under Sleep, set “When plugged in, PC goes to sleep after” to Never.',
    ],
    open: { page: 'power', label: 'Open Windows power settings' },
    note: 'CureDesk also keeps the main computer awake while it is open — but not before it has started, or after it was closed.',
  },
  {
    id: 'adapter', title: 'Stop Windows switching off the network card', who: 'main', need: 'recommended', applies: ['cable', 'wifi', 'direct'],
    why: 'To save power Windows can switch the network card off for a moment, and then the main computer looks gone to the others.',
    ...both([
      'Right-click the Start button → Device Manager.',
      'Open “Network adapters” and double-click the one you use (a cable: “Ethernet”, “GbE” or “Family Controller”; Wi-Fi: “Wireless” or “Wi-Fi”).',
      'On the Power Management tab, untick “Allow the computer to turn off this device to save power”, then OK.',
    ]),
    note: 'If the adapter has no Power Management tab, skip this step.',
  },
  {
    id: 'address', title: 'Give the main computer a fixed address', who: 'main', need: 'recommended', applies: ['cable', 'wifi'],
    why: 'The other computers find the main one by its address. A router can hand out a different one after it restarts, and then the others lose it. A fixed address never changes.',
    ...both([
      'Best way — in the router: open its settings page (usually 192.168.0.1 or 192.168.1.1; the address and password are on the sticker under the router) and look for “DHCP reservation”, “Address reservation” or “Static lease”. Reserve an address for the main computer.',
      'Or in Windows: ' + NCPA[0].replace(/^Press/, 'press'),
      NCPA[1], NCPA[2],
      'Choose “Use the following IP address”. IP address: the same first three numbers as the router with a last number nobody else uses (for a router at 192.168.1.1, use 192.168.1.200). Subnet mask: 255.255.255.0. Default gateway and DNS server: the router’s address. Click OK.',
    ]),
    note: 'Not sure? Skip it. CureDesk can find the main computer again by itself — use “Look for the main computer” under Check the connection.',
  },
  {
    id: 'address-direct', title: 'Give each computer its fixed address', who: 'every', need: 'required', applies: ['direct'],
    why: 'With one cable and no router nobody hands out addresses, so you give each computer one. Without it Windows waits a minute or more and then picks a number CureDesk cannot use.',
    ...both([
      NCPA[0], 'Right-click “Ethernet” (the one with the cable) → Properties.', NCPA[2],
      `Choose “Use the following IP address”. On the main computer type ${DIRECT_ADDRESSES.main}; on the other computer type ${DIRECT_ADDRESSES.other}. Subnet mask ${DIRECT_ADDRESSES.mask} on both.`,
      'Leave “Default gateway” and “DNS server” EMPTY on both. Click OK.',
    ]),
    note: 'These numbers are used only for this one cable. If the computers also use Wi-Fi for the internet, that keeps working.',
  },
  {
    id: 'time', title: 'Keep the date and time right on every computer', who: 'every', need: 'recommended', applies: ['cable', 'wifi', 'direct'],
    why: 'Every bill and visit is stamped with the computer’s clock. A computer with the wrong time puts its entries at the wrong time on all the others.',
    win11: ['Open Settings → Time & language → Date & time.', 'Turn on “Set time automatically” and “Set time zone automatically” (or choose India Standard Time).'],
    win10: ['Open Settings → Time & Language → Date & time.', 'Turn on “Set time automatically” and “Set time zone automatically” (or choose India Standard Time).'],
    open: { page: 'time', label: 'Open Windows date & time' },
  },
  {
    id: 'antivirus', title: 'If you use another antivirus, allow CureDesk in it', who: 'every', need: 'recommended', applies: ['cable', 'wifi', 'direct'],
    why: 'Some antivirus programs (Quick Heal, K7, Kaspersky, Norton, McAfee …) have their own firewall that blocks other computers even when the Windows settings are right.',
    ...both([
      'Open the antivirus and find its Firewall (or Network protection) settings.',
      'Add “CureDesk HMS” to the allowed (trusted) programs, and mark this network as “Home” or “Trusted”.',
    ]),
    note: 'Only the Windows Defender that comes with Windows? Nothing to do here.',
  },
];

export const windowsStepsFor = (c: Connection): WinStep[] => WINDOWS_STEPS.filter((s) => s.applies.includes(c));

/** The same steps in one line each — what the printed checklist shows next to its tick box (the screens carry the full clicks). */
export const WIN_SHORT: Record<WinStepId, string> = {
  'wifi-join': 'The same clinic Wi-Fi on every computer (not “Guest”); tick “Connect automatically”.',
  profile: 'Settings → Network & internet → your connection → Network profile type: Private.',
  firewall: 'When Windows asks about CureDesk HMS: tick Private (and Public for a direct cable) → Allow access.',
  sleep: 'Settings → System → Power → “When plugged in, sleep after”: Never.',
  adapter: 'Device Manager → Network adapters → your adapter → Power Management → untick “Allow the computer to turn off this device”.',
  address: 'Best: reserve an address for the main computer in the router. Or set a fixed address in Windows (optional).',
  'address-direct': `Fixed addresses — main computer ${DIRECT_ADDRESSES.main}, other computer ${DIRECT_ADDRESSES.other}, mask ${DIRECT_ADDRESSES.mask}; gateway and DNS empty.`,
  time: 'Settings → Time & language → Date & time → “Set time automatically”: On.',
  antivirus: 'Another antivirus besides Windows? Add CureDesk HMS to its allowed programs.',
};

// ---------------------------------------------------------------------------------------------------------------------------------
// The guide's steps (titles, in order) — what the numbered list and the printed checklist show
// ---------------------------------------------------------------------------------------------------------------------------------

export interface GuideStep { id: string; title: string; blurb: string }

export const GUIDE_STEPS: readonly GuideStep[] = [
  { id: 'choose', title: 'Choose how the computers will connect', blurb: 'A cable to the router or a switch, Wi-Fi, or one cable between two computers.' },
  { id: 'buy', title: 'What you need', blurb: 'The cables and boxes for your choice — with links to search for them.' },
  { id: 'plug', title: 'Plug it in', blurb: 'Where each cable goes, or how every computer joins the Wi-Fi.' },
  { id: 'windows', title: 'Windows settings on every computer', blurb: 'The few settings that decide whether the computers can see each other.' },
  { id: 'main', title: 'Set up the main computer', blurb: 'The computer that holds the clinic’s data. Do this one first.' },
  { id: 'others', title: 'Connect each other computer', blurb: 'Install CureDesk, join the main computer with its join code, and name the computer.' },
  { id: 'check', title: 'Check the connection', blurb: 'CureDesk looks at this computer and tells you what, if anything, to fix.' },
  { id: 'people', title: 'Add the people and give each computer its job', blurb: 'Everyone signs in with their own login; each computer shows only what it is for.' },
];

/** The short cross-check printed under the checklist's boxes — what a working clinic network looks like. */
export const WORKING_SIGNS = [
  'The main computer shows “Hosting” with a green dot, and a join code.',
  'Each other computer shows the main computer’s name and a green dot.',
  'A patient registered on one computer appears on the others within a few seconds.',
];
