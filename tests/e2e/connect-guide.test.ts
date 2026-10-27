// "Connect your computers" — the step-by-step guide (cable to a router or switch, Wi-Fi, or one cable straight between two computers), the Windows settings
// every computer needs, what to buy, and the "Check this computer" button. Owner, 2026-10-27: "keep the proper tutorial and setup screens … help users onboard
// multi users properly — the Windows settings, what to enable, setting up a network, for both Wi-Fi and cable". Rules proved here:
//   - the guide's content: every way of connecting has its own Windows steps, every step has plain reasons and clicks for Windows 11 AND 10, the two addresses
//     given for a direct cable are on ONE network and are numbers CureDesk does not ignore;
//   - shopping links are only plain Amazon.in SEARCHES (nothing else can be opened through them), and the Windows buttons open only the pages listed;
//   - what the app may open (the allowlist) — the old entries still work, the new ones are exact, anything else is refused;
//   - "Check this computer": made-up facts in, plain results out — cable vs Wi-Fi vs direct, "connected but no address", Public network, sleep, server running;
//   - the Windows answers are read defensively: output that cannot be understood is "unknown", never "all fine" and never "all wrong".
import fs from 'node:fs';
import path from 'node:path';
import { boot } from './harness';
import { ok, eq, section, finish } from './lib';
import {
  CONNECTIONS, CONNECTION_IDS, DIRECT_ADDRESSES, SHOPPING, WINDOWS_STEPS, WIN_PAGE_URI, GUIDE_STEPS, amazonSearchUrl, shoppingFor, windowsStepsFor,
  firewallCommands, parseConnection, WIN_SHORT,
} from '../../src/lib/connectGuide';
import { assessComputer, summarizeCheck, usableAdapters, type AdapterFact, type NetFacts } from '../../src/lib/connectCheck';
import { isAllowedExternalUrl } from '../../src/main/external-url';
import { parseConnectionProfiles, readConnectionProfiles, readFirewallRule, gatherNetFacts, firewallRuleName } from '../../src/main/network-facts';
import { describeAdapters, listNetworkInterfaces, broadcastAddressFor } from '../../src/main/network-diagnostics';

boot();
const root = fs.existsSync(path.join(process.cwd(), 'tests', 'e2e')) ? process.cwd() : path.resolve(__dirname, '..');

const adapter = (over: Partial<AdapterFact> = {}): AdapterFact => ({ name: 'Ethernet', address: '192.168.1.20', kind: 'wired', apipa: false, virtual: false, ...over });
const facts = (over: Partial<NetFacts> = {}): NetFacts => ({ platform: 'win32', adapters: [adapter()], profiles: [{ alias: 'Ethernet', category: 'private' }], power: null, hosting: null, lanIp: null, firewallRule: null, ...over });
const rowOf = (rows: ReturnType<typeof assessComputer>, id: string) => rows.find((r) => r.id === id);

(async () => {
  // ============================================================================================================
  section('1 · the three ways of connecting');
  eq(JSON.stringify(CONNECTIONS.map((c) => c.id)), JSON.stringify(['cable', 'wifi', 'direct']), 'cable to a router or switch, Wi-Fi, and one cable straight between two computers');
  ok(CONNECTIONS[0].tag === 'Recommended', 'the cable is the recommended one');
  ok(CONNECTIONS.every((c) => c.good.length >= 2 && c.watch.length >= 2), 'each says what is good and what to watch');
  eq(parseConnection('wifi'), 'wifi', 'a saved choice is read back');
  eq(parseConnection('banana'), '', '…an odd value is "not chosen"');
  eq(parseConnection(null), '', '…and nothing is "not chosen"');

  // ============================================================================================================
  section('2 · the addresses for a direct cable');
  const [a1, a2] = [DIRECT_ADDRESSES.main.split('.').map(Number), DIRECT_ADDRESSES.other.split('.').map(Number)];
  ok(a1.length === 4 && a2.length === 4 && a1.every((n) => n >= 0 && n <= 255) && a2.every((n) => n >= 0 && n <= 255), 'both are real addresses');
  ok(a1.slice(0, 3).join('.') === a2.slice(0, 3).join('.') && a1[3] !== a2[3], 'they are on ONE network (same first three numbers) and are different');
  eq(DIRECT_ADDRESSES.mask, '255.255.255.0', 'the mask makes that one network');
  eq(broadcastAddressFor(DIRECT_ADDRESSES.main, DIRECT_ADDRESSES.mask), '192.168.77.255', 'CureDesk\'s finder broadcast reaches both from that network');
  // CureDesk ignores virtual / self-assigned ranges when it picks its address; the direct-cable addresses must NOT be among them.
  const ignored = (ip: string) => { const p = ip.split('.').map(Number); return (p[0] === 169 && p[1] === 254) || (p[0] === 192 && p[1] === 168 && p[2] === 56) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || (p[0] === 198 && (p[1] === 18 || p[1] === 19)); };
  ok(!ignored(DIRECT_ADDRESSES.main) && !ignored(DIRECT_ADDRESSES.other), 'neither is in a range CureDesk ignores (VirtualBox, Docker, self-assigned, VPN)');
  ok(![0, 1, 2, 29, 31, 50, 68, 137, 56].includes(a1[2]), 'and the network is not a router factory default (192.168.0/1/2/29/31/50/68.x) or Windows connection sharing (137)');
  // The same test, on the real function: a wired adapter at that address is usable and wired-first.
  ok(usableAdapters(facts({ adapters: [adapter({ address: DIRECT_ADDRESSES.main })] })).length === 1, 'a cable with the direct address counts as a usable adapter');

  // ============================================================================================================
  section('3 · Windows steps — complete and in plain words');
  for (const c of CONNECTION_IDS) {
    const steps = windowsStepsFor(c);
    ok(steps.length >= 5, `${c}: ${steps.length} Windows steps`);
    ok(steps.some((s) => s.id === 'firewall' && s.need === 'required'), `${c}: the firewall question is a required step`);
    ok(steps.some((s) => s.id === 'sleep' && s.who === 'main'), `${c}: "never sleep" is there, for the main computer`);
  }
  ok(windowsStepsFor('cable').some((s) => s.id === 'profile') && windowsStepsFor('wifi').some((s) => s.id === 'profile'), 'cable and Wi-Fi both say: set the network to Private');
  ok(!windowsStepsFor('direct').some((s) => s.id === 'profile'), 'a direct cable does not (Windows cannot change an "Unidentified network")');
  ok(windowsStepsFor('direct').some((s) => s.id === 'address-direct' && s.need === 'required' && s.who === 'every'), 'a direct cable REQUIRES a fixed address on every computer');
  ok(!windowsStepsFor('cable').some((s) => s.id === 'address-direct') && windowsStepsFor('cable').some((s) => s.id === 'address' && s.need === 'recommended'), 'cable: a fixed address for the main computer is only recommended');
  ok(windowsStepsFor('wifi').some((s) => s.id === 'wifi-join') && !windowsStepsFor('cable').some((s) => s.id === 'wifi-join'), 'Wi-Fi has its own "join the same Wi-Fi" step; a cable does not');
  const direct = windowsStepsFor('direct').find((s) => s.id === 'address-direct')!;
  ok(direct.win11.join(' ').includes(DIRECT_ADDRESSES.main) && direct.win11.join(' ').includes(DIRECT_ADDRESSES.other), 'the direct-cable step shows both addresses');
  ok(/EMPTY/.test(direct.win11.join(' ')), '…and says to leave the gateway and DNS empty (a second gateway would take the internet away from the Wi-Fi)');
  ok(new Set(WINDOWS_STEPS.map((s) => s.id)).size === WINDOWS_STEPS.length, 'step ids are unique');
  for (const s of WINDOWS_STEPS) {
    ok(s.title.length > 5 && s.why.length > 30 && s.win11.length >= 2 && s.win10.length >= 2 && s.applies.length >= 1, `"${s.title}": has a reason and clicks for Windows 11 and 10`);
    ok(![...s.win11, ...s.win10, s.why, s.title].some((t) => /[{}]|undefined|\[object/.test(t)), `"${s.title}": no stray code in the words`);
  }
  ok(WINDOWS_STEPS.every((s) => (WIN_SHORT[s.id] ?? '').length > 25 && WIN_SHORT[s.id].length < 170), 'every step also has a one-line version for the printed checklist');
  eq(Object.keys(WIN_SHORT).length, WINDOWS_STEPS.length, '…and no one-liner is left without a step');
  eq(JSON.stringify(Object.keys(WIN_PAGE_URI).sort()), JSON.stringify(['ethernet', 'network', 'power', 'security', 'time', 'wifi']), 'six Windows pages have a button');
  ok(WINDOWS_STEPS.every((s) => !s.open || s.open.page in WIN_PAGE_URI), 'every button opens a page that is listed');
  ok(Object.values(WIN_PAGE_URI).every((u) => /^ms-settings:[a-z-]+$/.test(u)), 'and they are all plain ms-settings: addresses');

  // The two lines for the firewall, by hand.
  const fw = firewallCommands('cable');
  ok(/protocol=TCP localport=4321 profile=private,domain/.test(fw) && /protocol=UDP localport=4322 profile=private,domain/.test(fw), 'firewall commands: the server port (4321) and the finder port (4322), private and domain networks');
  ok(/profile=any/.test(firewallCommands('direct')) && !/profile=any/.test(fw), '…a direct cable allows every network type (Windows calls that cable "public")');
  ok(/localport=5000/.test(firewallCommands('cable', 5000)), '…and follows a changed port');

  // ============================================================================================================
  section('4 · what to buy — plain Amazon.in searches');
  ok(SHOPPING.length >= 5, `${SHOPPING.length} things, each with a reason`);
  for (const i of SHOPPING) {
    const u = amazonSearchUrl(i.query);
    ok(/^https:\/\/www\.amazon\.in\/s\?k=[A-Za-z0-9+%.-]+$/.test(u), `${i.title}: ${u}`);
    ok(!/tag=|ref=|\/dp\/|linkCode|creative/.test(u), `${i.title}: no affiliate tag, no product, no tracking`);
    ok(isAllowedExternalUrl(u), `${i.title}: the app may open it`);
    ok(i.why.length > 40, `${i.title}: says what it is for`);
  }
  eq(amazonSearchUrl('  cat6   lan cable '), 'https://www.amazon.in/s?k=cat6+lan+cable', 'a search is tidied (spaces become +)');
  eq(amazonSearchUrl('a&b=c d'), 'https://www.amazon.in/s?k=a%26b%3Dc+d', 'and cannot smuggle in another parameter');
  ok(shoppingFor('cable').some((i) => i.id === 'cable') && shoppingFor('cable').some((i) => i.id === 'switch') && !shoppingFor('cable').some((i) => i.id === 'usb-wifi'), 'cable: cable + switch, no Wi-Fi adapter');
  ok(shoppingFor('wifi').some((i) => i.id === 'router') && !shoppingFor('wifi').some((i) => i.id === 'switch'), 'Wi-Fi: a router, no switch');
  ok(shoppingFor('direct').some((i) => i.id === 'cable') && !shoppingFor('direct').some((i) => i.id === 'switch' || i.id === 'router'), 'direct: one cable, no router or switch');
  ok(CONNECTION_IDS.every((c) => shoppingFor(c).some((i) => i.id === 'ups')), 'a UPS is suggested for all of them');
  ok(SHOPPING.filter((i) => !i.optional).every((i) => i.for.length >= 1), 'what is not optional says who needs it');

  // ============================================================================================================
  section('5 · what the app may open');
  for (const ok1 of ['https://wa.me/919999999999?text=Hello%20there', 'tel:+919999999999', 'mailto:help@curedesk.co.in', 'https://curedesk.co.in/multi-station.html', 'https://chatgpt.com/', 'https://www.amazon.in/s?k=lan+cable', ...Object.values(WIN_PAGE_URI)]) {
    ok(isAllowedExternalUrl(ok1), `allowed: ${ok1.slice(0, 60)}`);
  }
  for (const bad of ['https://www.amazon.in/dp/B0ABC12345', 'https://www.amazon.in/', 'https://amazon.in/s?k=x', 'https://www.amazon.in.evil.com/s?k=x', 'https://evil.com/?u=https://www.amazon.in/s?k=x',
    'ms-settings:privacy', 'ms-settings:', 'ms-settings:network-status/../x', 'ms-settings:network-status extra', 'file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'cmd:/c calc',
    'https://www.amazon.in/s?k=x y', 'https://www.amazon.in/s?k=x\nhttps://evil.com', '', 'http://curedesk.co.in/', 'data:text/html,hi', 'ms-settings:network-status\u0000']) {
    ok(!isAllowedExternalUrl(bad), `refused: ${JSON.stringify(bad).slice(0, 70)}`);
  }
  ok(!isAllowedExternalUrl(undefined) && !isAllowedExternalUrl(42) && !isAllowedExternalUrl(null), 'refused: not a text at all');
  ok(isAllowedExternalUrl('HTTPS://WA.ME/91999'), 'the older entries still match whatever the capital letters');

  // ============================================================================================================
  section('6 · the facts: what Windows said, read defensively');
  eq(JSON.stringify(parseConnectionProfiles('{"Alias":"Ethernet","Category":"Private"}')), JSON.stringify([{ alias: 'Ethernet', category: 'private' }]), 'one network (PowerShell prints a single object)');
  eq(JSON.stringify(parseConnectionProfiles('[{"Alias":"Ethernet","Category":"Public"},{"Alias":"Wi-Fi","Category":"DomainAuthenticated"}]')), JSON.stringify([{ alias: 'Ethernet', category: 'public' }, { alias: 'Wi-Fi', category: 'domain' }]), 'two networks');
  eq(JSON.stringify(parseConnectionProfiles('\uFEFF{"Alias":"Wi-Fi","Category":"public"}\r\n')), JSON.stringify([{ alias: 'Wi-Fi', category: 'public' }]), 'a byte-order mark and a trailing newline are fine');
  eq(JSON.stringify(parseConnectionProfiles('{"Alias":"Lan","Category":"Weird"}')), JSON.stringify([{ alias: 'Lan', category: 'unknown' }]), 'an odd type is "unknown"');
  eq(JSON.stringify(parseConnectionProfiles('')), '[]', 'Windows reported no connected network = an empty list');
  eq(JSON.stringify(parseConnectionProfiles('   \r\n')), '[]', '…also when it printed only blanks');
  for (const bad of ['Get-NetConnectionProfile : The term is not recognized', '{not json', '[1,2]', '{"Category":"Private"}', '[null]', 'null']) {
    eq(parseConnectionProfiles(bad), null, `not understood → unknown, never "no networks": ${bad.slice(0, 40)}`);
  }
  eq(parseConnectionProfiles(null), null, 'PowerShell could not run → unknown');
  eq(await readConnectionProfiles('darwin', async () => { throw new Error('must not run'); }), null, 'not Windows: not asked at all');
  eq(JSON.stringify(await readConnectionProfiles('win32', async (script) => (/Get-NetConnectionProfile/.test(script) && /ConvertTo-Json/.test(script) ? '{"Alias":"Ethernet","Category":"Public"}' : null))), JSON.stringify([{ alias: 'Ethernet', category: 'public' }]), 'on Windows the right question is asked');
  eq(await readConnectionProfiles('win32', async () => null), null, '…and a failed call is unknown');
  eq(await readFirewallRule(4321, 'darwin', async () => { throw new Error('must not run'); }), null, 'the firewall rule is not asked on a Mac');
  let asked: string[] = [];
  eq(await readFirewallRule(4321, 'win32', async (file, args) => { asked = [file, ...args]; return true; }), true, 'Windows says the rule exists → true');
  eq(asked.join(' '), `netsh advfirewall firewall show rule name=${firewallRuleName(4321)}`, '…by the name CureDesk gives its own rule');
  eq(await readFirewallRule(4321, 'win32', async () => false), false, 'Windows says there is no such rule → false');
  eq(await readFirewallRule(4321, 'win32', async () => null), null, 'netsh could not run → unknown');
  ok(fs.readFileSync(path.join(root, 'src', 'main', 'network-discovery.ts'), 'utf8').includes('`CureDesk HMS (port ${port})`') && firewallRuleName(4321) === 'CureDesk HMS (port 4321)', 'that is really the name the app gives its rule');

  const real = describeAdapters();
  ok(Array.isArray(real) && real.every((a) => typeof a.name === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(a.address) && typeof a.apipa === 'boolean' && typeof a.virtual === 'boolean'), `this computer's adapters are described (${real.length})`);
  ok(listNetworkInterfaces().every((u) => real.some((a) => a.address === u.address && !a.apipa && !a.virtual)), 'every adapter CureDesk uses is one the check calls usable (the two never disagree)');
  const gathered = await gatherNetFacts({
    platform: 'win32', hosting: { running: true, port: 4321, clients: 2 }, lanIp: '192.168.1.20',
    adapters: () => [adapter()], readPower: async () => ({ known: true, sleepsOnAC: true, sleepAfterMinutes: 15, preventionActive: false }),
    runScript: async () => '{"Alias":"Ethernet","Category":"Private"}', runProgram: async () => true,
  });
  ok(gathered.platform === 'win32' && gathered.adapters.length === 1 && gathered.profiles?.[0].category === 'private' && gathered.power?.sleepAfterMinutes === 15 && gathered.hosting?.clients === 2 && gathered.firewallRule === true && gathered.lanIp === '192.168.1.20', 'on the main computer every fact is gathered');
  const gathered2 = await gatherNetFacts({ platform: 'win32', hosting: null, lanIp: null, adapters: () => [], readPower: async () => { throw new Error('must not be asked'); }, runScript: async () => null, runProgram: async () => { throw new Error('must not be asked'); } });
  ok(gathered2.power === null && gathered2.firewallRule === null && gathered2.profiles === null && gathered2.hosting === null, 'on another computer neither the sleep setting nor the firewall rule is asked, and a failed PowerShell is "unknown"');
  const gathered3 = await gatherNetFacts({ platform: 'win32', hosting: { running: true, port: 4321, clients: 0 }, lanIp: null, adapters: () => [], readPower: async () => { throw new Error('boom'); }, runScript: async () => '', runProgram: async () => null });
  ok(gathered3.power === null && gathered3.profiles?.length === 0 && gathered3.firewallRule === null, 'a failing power check is "not known", never a crash');

  // ============================================================================================================
  section('7 · Check this computer — cable, Wi-Fi, direct');
  const wifiA = adapter({ name: 'Wi-Fi', address: '192.168.1.33', kind: 'wireless' });
  const apipaA = adapter({ name: 'Ethernet', address: '169.254.12.9', apipa: true });
  const profile = (alias: string, category: 'public' | 'private' | 'domain') => [{ alias, category }];

  let rows = assessComputer(facts(), { choice: 'cable', here: 'alone' });
  eq(rowOf(rows, 'connection')?.status, 'ok', 'cable chosen and a cable is in: fine');
  ok(/cable/i.test(rowOf(rows, 'connection')!.title), '…and it says "cable"');
  eq(rowOf(rows, 'profile')?.status, 'ok', 'Windows network Private: fine');
  eq(summarizeCheck(rows).level, 'ok', '…the headline is "ready"');

  rows = assessComputer(facts({ adapters: [wifiA], profiles: profile('Wi-Fi', 'private') }), { choice: 'cable', here: 'alone' });
  eq(rowOf(rows, 'connection')?.status, 'warn', 'cable chosen but only Wi-Fi is on: a warning (it still works)');
  eq(rowOf(rows, 'connection')?.step, 'plug', '…pointing at the "plug it in" step');

  rows = assessComputer(facts({ adapters: [adapter(), wifiA], profiles: profile('Ethernet', 'private') }), { choice: 'wifi', here: 'alone' });
  eq(rowOf(rows, 'connection')?.status, 'ok', 'Wi-Fi chosen and Wi-Fi is on: fine');
  ok(/prefers the cable/.test(rowOf(rows, 'connection')!.detail), '…and it notes the cable is preferred when both are on');
  rows = assessComputer(facts({ adapters: [adapter()] }), { choice: 'wifi', here: 'alone' });
  eq(rowOf(rows, 'connection')?.status, 'info', 'Wi-Fi chosen but a cable is in: fine, even better');

  rows = assessComputer(facts({ adapters: [adapter()] }), { choice: '', here: 'alone' });
  eq(rowOf(rows, 'connection')?.status, 'ok', 'nothing chosen: it just says what it found');
  ok(/network cable/.test(rowOf(rows, 'connection')!.title), '…"Connected by a network cable"');

  rows = assessComputer(facts({ adapters: [], profiles: [] }), { choice: 'cable', here: 'alone' });
  eq(rowOf(rows, 'connection')?.status, 'bad', 'no adapter at all: not connected');
  eq(summarizeCheck(rows).level, 'bad', '…the headline says something needs fixing');
  rows = assessComputer(facts({ adapters: [apipaA], profiles: [] }), { choice: 'cable', here: 'alone' });
  eq(rowOf(rows, 'connection')?.status, 'bad', 'a self-made address on a cable to a router: the router is not handing out addresses');
  eq(rowOf(rows, 'connection')?.step, 'plug', '…check the cable and the router');
  rows = assessComputer(facts({ adapters: [apipaA], profiles: [] }), { choice: 'direct', here: 'alone' });
  eq(rowOf(rows, 'connection')?.step, 'address-direct', 'the same on a direct cable: give each computer its fixed address');
  ok(rowOf(rows, 'connection')!.fix!.includes(DIRECT_ADDRESSES.main) && rowOf(rows, 'connection')!.fix!.includes(DIRECT_ADDRESSES.other), '…and the fix shows both addresses');
  rows = assessComputer(facts({ adapters: [adapter({ name: 'vEthernet (Default Switch)', address: '169.254.2.2', apipa: true, virtual: true })], profiles: [] }), { choice: 'cable', here: 'alone' });
  ok(/not connected to any network/.test(rowOf(rows, 'connection')!.title), 'a virtual adapter with a self-made address is not mistaken for a cable that has no address');

  rows = assessComputer(facts({ adapters: [adapter({ address: DIRECT_ADDRESSES.main })], profiles: profile('Ethernet', 'public') }), { choice: 'direct', here: 'main', hosting: { running: true, port: 4321, clients: 0 } } as any);
  eq(rowOf(rows, 'connection')?.status, 'ok', 'direct cable with the direct address: fine');
  eq(rowOf(rows, 'profile')?.status, 'info', '…and Windows calling it "Public" is normal, not an error');
  rows = assessComputer(facts({ adapters: [adapter({ address: '192.168.1.20' })], profiles: [] }), { choice: 'direct', here: 'alone' });
  eq(rowOf(rows, 'connection')?.status, 'warn', 'direct chosen but the cable has a router address: a warning');
  rows = assessComputer(facts({ adapters: [wifiA], profiles: [] }), { choice: 'direct', here: 'alone' });
  eq(rowOf(rows, 'connection')?.status, 'warn', 'direct chosen but no cable: a warning');

  rows = assessComputer(facts({ profiles: profile('Ethernet', 'public') }), { choice: 'cable', here: 'alone' });
  eq(rowOf(rows, 'profile')?.status, 'bad', 'a Public network on a cable to a router: bad — Windows blocks the other computers');
  eq(rowOf(rows, 'profile')?.step, 'profile', '…pointing at "Set the network to Private"');
  rows = assessComputer(facts({ adapters: [adapter(), wifiA], profiles: [{ alias: 'Ethernet', category: 'private' }, { alias: 'Wi-Fi', category: 'public' }] }), { choice: 'cable', here: 'alone' });
  eq(rowOf(rows, 'profile')?.status, 'bad', 'two networks, one Public: bad');
  rows = assessComputer(facts({ profiles: [{ alias: 'Ethernet', category: 'private' }, { alias: 'Mobile Hotspot', category: 'public' }] }), { choice: 'cable', here: 'alone' });
  eq(rowOf(rows, 'profile')?.status, 'ok', 'a Public network on an adapter nobody uses (a hotspot) is not this computer\'s problem');
  rows = assessComputer(facts({ profiles: null }), { choice: 'cable', here: 'alone' });
  eq(rowOf(rows, 'profile')?.status, 'info', 'Windows did not answer: said so, not guessed');
  rows = assessComputer(facts({ profiles: [] }), { choice: 'cable', here: 'alone' });
  ok(!rowOf(rows, 'profile'), 'no connected network reported: no row (the connection row already says it)');
  rows = assessComputer(facts({ platform: 'darwin', profiles: null }), { choice: 'cable', here: 'alone' });
  ok(!rowOf(rows, 'profile'), 'not Windows: the Windows network type is not asked');
  rows = assessComputer(facts({ profiles: [{ alias: 'Local Area Connection', category: 'public' }] }), { choice: 'cable', here: 'alone' });
  eq(rowOf(rows, 'profile')?.status, 'bad', 'a connection name that matches no adapter is still looked at (all of them)');

  // The main computer.
  const main = (over: Partial<NetFacts> = {}) => assessComputer(facts({ hosting: { running: true, port: 4321, clients: 0 }, lanIp: '192.168.1.20', power: { known: true, sleepsOnAC: false, sleepAfterMinutes: 0, preventionActive: false }, ...over }), { choice: 'cable', here: 'main' });
  rows = main();
  eq(rowOf(rows, 'server')?.status, 'ok', 'main computer: the server is running');
  ok(rowOf(rows, 'server')!.detail.includes('192.168.1.20'), '…and the address to give the others is shown');
  eq(rowOf(rows, 'sleep')?.status, 'ok', '…it never sleeps');
  eq(rowOf(rows, 'others')?.status, 'info', '…no other computer yet is information, not an error');
  eq(rowOf(rows, 'firewall')?.status, 'info', '…and the firewall is a reminder (nothing can prove it yet)');
  eq(summarizeCheck(rows).level, 'ok', '…the headline is still "ready"');
  rows = main({ firewallRule: true });
  eq(rowOf(rows, 'firewall')?.status, 'ok', 'CureDesk\'s own firewall rule found: the firewall is fine');
  rows = main({ hosting: { running: true, port: 4321, clients: 3 } });
  eq(rowOf(rows, 'others')?.status, 'ok', 'three computers connected: proof the network works');
  ok(/3 other computers are connected/.test(rowOf(rows, 'others')!.title), '…"3 other computers are connected"');
  ok(!rowOf(rows, 'firewall'), '…and no firewall reminder is needed');
  rows = main({ hosting: { running: true, port: 4321, clients: 1 } });
  ok(/1 other computer is connected/.test(rowOf(rows, 'others')!.title), 'one: "1 other computer is connected"');
  rows = main({ hosting: { running: false, port: 4321, clients: 0 } });
  eq(rowOf(rows, 'server')?.status, 'bad', 'the server is not running: bad');
  ok(!rowOf(rows, 'others'), '…and nothing is said about other computers');
  rows = main({ power: { known: true, sleepsOnAC: true, sleepAfterMinutes: 30, preventionActive: false } });
  eq(rowOf(rows, 'sleep')?.status, 'warn', 'Windows set to sleep after 30 minutes: a warning…');
  eq(rowOf(rows, 'sleep')?.action, 'disable-sleep', '…with the "never sleep" button');
  rows = main({ power: { known: true, sleepsOnAC: true, sleepAfterMinutes: 30, preventionActive: true } });
  eq(rowOf(rows, 'sleep')?.status, 'info', 'CureDesk is keeping it awake: information, still offering to set Windows too');
  rows = main({ power: { known: false, sleepsOnAC: false, sleepAfterMinutes: 0, preventionActive: false } });
  ok(!rowOf(rows, 'sleep'), 'sleep setting unreadable: no row');
  rows = main({ power: null });
  ok(!rowOf(rows, 'sleep'), 'sleep not asked: no row');
  rows = assessComputer(facts({ hosting: null }), { choice: 'cable', here: 'other' });
  ok(!rowOf(rows, 'sleep') && !rowOf(rows, 'server') && !rowOf(rows, 'others'), 'an extra computer is only checked for its own connection and network type');
  const s1 = summarizeCheck(assessComputer(facts({ adapters: [wifiA], profiles: profile('Wi-Fi', 'private') }), { choice: 'cable', here: 'alone' }));
  eq(s1.level, 'warn', 'one warning: the headline asks to look at one thing');
  eq(s1.headline, 'One thing to look at', '…in those words');
  const s2 = summarizeCheck(assessComputer(facts({ profiles: profile('Ethernet', 'public'), adapters: [apipaA] }), { choice: 'cable', here: 'alone' }));
  eq(s2.level, 'bad', 'a bad row makes it "needs fixing"');
  ok(rows.every((r) => r.title.length > 3 && r.detail.length > 3 && !/undefined|\[object/.test(r.title + r.detail + (r.fix ?? ''))), 'no row shows stray code');

  // ============================================================================================================
  section('7b · the website\'s printable guide says the same (tools/gen-connect-guide-html.mjs writes it from these words)');
  const site = fs.readFileSync(path.join(root, 'multi-station.html'), 'utf8');
  const plainSite = site.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  ok(site.includes('<!-- GENERATED:connect-guide') && site.includes('<!-- /GENERATED:connect-guide -->'), 'the page has its generated block');
  ok(CONNECTIONS.every((c) => plainSite.includes(c.title)), 'all three ways of connecting are on the page');
  ok(WINDOWS_STEPS.every((s) => plainSite.includes(s.title)), 'every Windows step is on the page — if this fails, run: node tools/gen-connect-guide-html.mjs');
  ok(WINDOWS_STEPS.every((s) => s.win11.every((t) => plainSite.includes(t))), '…with its Windows 11 clicks');
  ok(WINDOWS_STEPS.every((s) => s.win10.every((t) => plainSite.includes(t))), '…and its Windows 10 clicks');
  ok(plainSite.includes(DIRECT_ADDRESSES.main) && plainSite.includes(DIRECT_ADDRESSES.other) && plainSite.includes(DIRECT_ADDRESSES.mask), 'the direct-cable addresses are on the page');
  ok(plainSite.includes(firewallCommands('cable').split('\n')[0]) && plainSite.includes(firewallCommands('cable').split('\n')[1]), 'the two firewall commands are on the page');
  ok(SHOPPING.every((i) => site.includes(`href="${amazonSearchUrl(i.query)}"`)), 'every shopping item has its plain Amazon.in search link');
  ok(!/amazon\.in[^"']*tag=/.test(site), 'and no affiliate tag anywhere on the page');
  ok(!/6-character/.test(site) && /5-character|5 letters and numbers/.test(site), 'the join code is described as it really is (5 characters)');
  ok(!/Settings → Network Mode/.test(plainSite), 'no path to a Settings page that has moved');

  // ============================================================================================================
  section('8 · the guide\'s steps');
  eq(JSON.stringify(GUIDE_STEPS.map((s) => s.id)), JSON.stringify(['choose', 'buy', 'plug', 'windows', 'main', 'others', 'check', 'people']), 'eight steps, in the order a person does them');
  ok(GUIDE_STEPS.every((s) => s.title.length > 5 && s.blurb.length > 20), 'each has a title and a line saying what it is');

  // ============================================================================================================
  section('9 · the connection choice is saved with the computer');
  const { call } = await import('./harness');
  eq((await call('settings:get')).network_connection, '', 'a fresh computer has not chosen');
  await call('settings:save', { network_connection: 'wifi' });
  eq((await call('settings:get')).network_connection, 'wifi', 'the choice is saved and read back');
  await call('settings:save', { network_connection: 'banana' });
  eq((await call('settings:get')).network_connection, '', 'an unreadable value is "not chosen"');
  await call('settings:save', { network_connection: 'direct' });
  eq((await call('settings:get')).network_connection, 'direct', 'and "direct" is kept too');
  const client = fs.readFileSync(path.join(root, 'src', 'main', 'network-client.ts'), 'utf8');
  ok(/STATION_LOCAL_KEYS = new Set\(\[[^\]]*'network_connection'/s.test(client), 'it stays on THIS computer when this is an extra computer (each computer is connected its own way)');
  ok(/'network:checkComputer'/.test(client), 'and "Check this computer" always looks at this computer, never at the main one');

  finish();
})().catch((e) => { console.error('SUITE CRASHED', e); process.exit(1); });
