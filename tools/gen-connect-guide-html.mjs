// Writes the "choose how to connect / Windows settings / what to buy" sections of the website's printable guide (multi-station.html) from the SAME words the app
// uses (src/lib/connectGuide.ts), so the page on the website and the guide inside CureDesk can never drift apart.
//
//   node tools/gen-connect-guide-html.mjs        (rewrites the block between the two GENERATED markers in multi-station.html)
//
// tests/e2e/connect-guide.test.ts fails if the page is missing a step title, a price-free shopping link or the direct-cable addresses.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildSync } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const bundle = buildSync({ entryPoints: [join(root, 'src/lib/connectGuide.ts')], bundle: true, format: 'esm', platform: 'node', write: false });
const code = bundle.outputFiles[0].text;
const g = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ICON = { cable: '🔌', wifi: '📶', direct: '↔️' };
const WAY = { cable: 'Cable', wifi: 'Wi-Fi', direct: 'Direct cable' };

const cards = g.CONNECTIONS.map((c) => `
    <div class="card">
      <div class="role-h">${ICON[c.id]} ${esc(c.title)}</div>
      <div class="role-h"><span class="pill ${c.id === 'cable' ? 'cabin' : 'host'}">${esc(c.tag)}</span></div>
      <ul class="plain">
${c.good.map((t) => `        <li class="ok">${esc(t)}</li>`).join('\n')}
${c.watch.map((t) => `        <li class="watch">${esc(t)}</li>`).join('\n')}
      </ul>
    </div>`).join('');

const same = (s) => JSON.stringify(s.win11) === JSON.stringify(s.win10);
const list = (a) => `<ol class="mini">${a.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>`;
const rows = g.WINDOWS_STEPS.map((s) => `
        <tr>
          <td><span class="sym">${esc(s.title)}</span><br><span class="tagline">${s.need === 'required' ? 'Needed' : 'Recommended'} · ${s.who === 'main' ? 'main computer only' : 'every computer'} · ${s.applies.map((a) => WAY[a]).join(', ')}</span></td>
          <td>${esc(s.why)}</td>
          ${same(s) ? `<td colspan="2">${list(s.win11)}${(s.commands || []).map((c) => `<div class="tagline">${esc(c.label)}</div><pre class="cmd">${esc(g.firewallCommands('cable'))}</pre><div class="tagline">For a cable straight between two computers use <code>profile=any</code> instead of <code>profile=private,domain</code>.</div>`).join('')}<div class="tagline">Same on Windows 11 and Windows 10.</div></td>` : `<td>${list(s.win11)}</td><td>${list(s.win10)}</td>`}
        </tr>`).join('');

const shop = g.SHOPPING.map((i) => `
      <li><b>${esc(i.title)}</b>${i.optional ? ' <span class="tagline">(only if you need it)</span>' : ''} — ${esc(i.why)} <a href="${g.amazonSearchUrl(i.query)}" rel="noopener" target="_blank">Search on Amazon.in</a></li>`).join('');

const html = `<!-- GENERATED:connect-guide (tools/gen-connect-guide-html.mjs — do not edit by hand) -->
  <h2><span class="n">2</span> Choose how the computers connect</h2>
  <p class="lead">The computers talk to each other over the clinic’s own network — nothing goes over the internet. Join them by <b>network cable</b> (best), by <b>Wi-Fi</b>, or — with only two computers — by <b>one cable between them</b>. They need not all connect the same way: the main computer on a cable and the others on Wi-Fi works well, as long as everyone is on the same router.</p>
  <div class="grid3">${cards}
  </div>
  <div class="note warn"><b>One cable between two computers:</b> <span class="ink">give each a fixed address — main computer <code>${g.DIRECT_ADDRESSES.main}</code>, other computer <code>${g.DIRECT_ADDRESSES.other}</code>, subnet mask <code>${g.DIRECT_ADDRESSES.mask}</code>, and leave Default gateway and DNS <b>empty</b>.</span></div>

  <h2><span class="n">3</span> Windows settings — on every computer</h2>
  <p class="lead">Almost every “the other computer can’t find the main one” is a Windows setting, not a CureDesk fault. Do these once, on each computer.</p>
  <div class="card" style="padding:6px 8px;overflow-x:auto">
    <table>
      <thead><tr><th style="width:24%">Setting</th><th style="width:25%">Why</th><th>How — Windows 11</th><th>How — Windows 10</th></tr></thead>
      <tbody>${rows}
      </tbody>
    </table>
  </div>
  <div class="note good"><b>Then check it:</b> <span class="ink">in CureDesk open <span class="path">Settings → Computers &amp; staff → Connect the computers</span> and press <b>Check this computer</b> — it looks at the cable or Wi-Fi, the Windows network type and the sleep setting, and tells you what to fix.</span></div>

  <h2><span class="n">4</span> What to buy</h2>
  <div class="card">
    <ul class="plain">${shop}
    </ul>
    <div class="tagline" style="margin-top:8px">These are plain Amazon.in searches — choose whatever make, length and price suits you, from any seller.</div>
  </div>
<!-- /GENERATED:connect-guide -->`;

const file = join(root, 'multi-station.html');
let page = readFileSync(file, 'utf8');
const start = page.indexOf('<!-- GENERATED:connect-guide');
const endMark = '<!-- /GENERATED:connect-guide -->';
const end = page.indexOf(endMark);
if (start >= 0 && end > start) page = page.slice(0, start) + html + page.slice(end + endMark.length);
else {
  // First run: put the block just before the existing "Set it up" section.
  const m = /<h2><span class="n">\d+<\/span> Set it up<\/h2>/.exec(page);
  if (!m) throw new Error('Could not find the "Set it up" section');
  const anchor = m.index;
  page = page.slice(0, anchor) + html + '\n\n  ' + page.slice(anchor);
}
writeFileSync(file, page);
console.log('multi-station.html updated:', g.WINDOWS_STEPS.length, 'Windows steps,', g.SHOPPING.length, 'shopping links');
