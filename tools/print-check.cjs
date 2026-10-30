// Print-pagination harness: drives the REAL renderer (the demo build) inside Electron's Chromium,
// opens a printable screen, and runs printToPDF with the same @page rules the app uses, then reports
// the page count — so "one page of content prints as 2-3 sheets" is something you can MEASURE.
//
//   1. start the demo:   npx vite --config vite.demo.config.ts --port 5199 --host 127.0.0.1
//   2. run a scenario:   node_modules/.bin/electron tools/print-check.cjs <scenario> <outDir>
//        scenarios: billing-invoice | pharmacy-receipt | lab-bill | services-bill | services-bill-long
//                   opd-slip | radiology-report | radiology-bill | connect-checklist | connect-checklist-setup | route-only | eval
//   env: TAG=<suffix for the pdf name>, DEMO_URL, SETTINGS_JSON=<file with a settings patch, e.g. a wide
//        logo + lh_style:"banner">, HASH / WAIT (route-only), EVAL (eval).
//
// Expected page counts: every bill / receipt / report = 1, the 45-line bill = 2, the OPD slip = 2, the connect checklist = 2.
//
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const BASE = process.env.DEMO_URL || 'http://127.0.0.1:5199/demo.html';
const scenario = process.argv[2] || 'billing-invoice';
const OUT = process.argv[3] || process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function countPages(buf) {
  const s = buf.toString('latin1');
  const m = s.match(/\/Type\s*\/Page[^s]/g);
  return m ? m.length : 0;
}

// Click the first element matching `sel` whose text contains `text`.
const CLICK = (sel, text) => `(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => (e.textContent||'').trim().includes(${JSON.stringify(text)})); if (!el) return false; el.click(); return true; })()`;
const HAS_TEXT = (text) => `document.body.innerText.includes(${JSON.stringify(text)})`;

async function waitFor(win, code, label, timeout = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if (await win.webContents.executeJavaScript(code, true)) return true; } catch {}
    await sleep(250);
  }
  throw new Error('timeout waiting for: ' + label);
}


// Boot the demo once, optionally inject settings (env SETTINGS_JSON, e.g. a wide logo +
// lh_* letterhead options), then navigate by hash. Same-document navigation keeps the
// in-memory mock state, so injected settings and created records persist across scenarios.
let booted = false;
async function open(win, hash) {
  if (!booted) {
    await win.loadURL(BASE);
    await sleep(2500);
    if (process.env.SETTINGS_JSON) {
      const patch = fs.readFileSync(process.env.SETTINGS_JSON, 'utf8');
      await win.webContents.executeJavaScript(`window.electronAPI.settings.save(${patch})`, true);
      await win.webContents.executeJavaScript(`location.hash='#/lab'`, true);
      await sleep(6500);            // let react-query's 5s staleTime lapse so settings refetch
    }
    booted = true;
  }
  await win.webContents.executeJavaScript(`location.hash=${JSON.stringify(hash)}`, true);
  await sleep(1200);
}

const SCENARIOS = {
  // Billing page -> Billing History -> Reprint (the inline Invoice the user prints).
  'billing-invoice': async (win) => {
    await open(win, '#/billing');
    await waitFor(win, CLICK('button', 'Billing History'), 'Billing History tab');
    await waitFor(win, CLICK('button', 'Reprint'), 'Reprint button');
    await waitFor(win, HAS_TEXT('INVOICE'), 'invoice rendered');
  },
  // Pharmacy -> Sales -> a sale's receipt (overlay sheet, min-height 148mm).
  'pharmacy-receipt': async (win) => {
    await open(win, '#/pharmacy');
    await waitFor(win, `(() => { const b=[...document.querySelectorAll('button')].find(e => (e.textContent||'').trim()==='Sales'); if(!b) return false; b.click(); return true; })()`, 'Sales tab');
    await waitFor(win, `(() => { const b=[...document.querySelectorAll('button')].filter(e => (e.textContent||'').trim()==='Print'); if(!b.length) return false; b[0].click(); return true; })()`, 'row Print button');
    await waitFor(win, HAS_TEXT('Close'), 'receipt overlay');
  },
  // Lab -> first order -> Print Bill (overlay sheet, min-height 148mm).
  'lab-bill': async (win) => {
    await open(win, '#/lab');
    await waitFor(win, `(() => { const li=[...document.querySelectorAll('li')].find(e => (e.textContent||'').includes('LAB-')); if(!li) return false; li.click(); return true; })()`, 'lab order row');
    await waitFor(win, CLICK('button', 'Print Bill'), 'Print Bill button');
    await waitFor(win, HAS_TEXT('LABORATORY BILL'), 'lab bill overlay');
  },
  // Billing queue -> Quick Bill is long; use the Services page's printable bill instead.
  'bill-print': async (win) => {
    await open(win, '#/billing');
    await waitFor(win, CLICK('button', 'Billing History'), 'history tab');
    await waitFor(win, HAS_TEXT('BL-'), 'bills listed');
    // open the IPD-style BillPrint overlay by id through the exposed React tree is not possible;
    // the harness page below mounts it directly.
  },
  // Appointments -> Print on the first row -> the 2-page OPD slip (regression guard: must stay 2).
  'opd-slip': async (win) => {
    await open(win, '#/appointments');
    await sleep(2500);
    // SLIP_SECTIONS=impression,advice  keeps only those body sections (the rest are "deleted"); SLIP_PAGES=1|2 sets the layout's page count; SLIP_EXTRA_MM=120 adds one tall extra section; SLIP_HEIGHT_MM=20 sets every kept section's height; SLIP_FIT=0 switches "print on one page when it fits" off.
    if (process.env.SLIP_SECTIONS || process.env.SLIP_PAGES || process.env.SLIP_EXTRA_MM || process.env.SLIP_HEIGHT_MM || process.env.SLIP_FIT) {
      await win.webContents.executeJavaScript(`(async () => {
        const keep = ${JSON.stringify((process.env.SLIP_SECTIONS || '').split(',').filter(Boolean))}; const pages = ${Number(process.env.SLIP_PAGES || 0)};
        const list = await window.electronAPI.templates.list();
        await window.electronAPI.templates.saveAll(list.map(t => ({ ...t, sections: (keep.length ? t.sections.filter(s => keep.includes(s.key)) : t.sections).map(s => (${Number(process.env.SLIP_HEIGHT_MM || 0)} ? { ...s, height_mm: ${Number(process.env.SLIP_HEIGHT_MM || 0)} } : s)).concat(${Number(process.env.SLIP_EXTRA_MM || 0)} ? [{ key: 'plan', title: 'Plan', type: 'textarea', height_mm: ${Number(process.env.SLIP_EXTRA_MM || 0)}, printed: true }] : []), layout: { ...(t.layout || {}), ...(pages ? { pages } : {}), ...(${process.env.SLIP_FIT === '0' ? 'true' : 'false'} ? { fitOnePage: false } : {}) } })));
        return true;
      })()`, true);
    }
    // The demo has no visits "today": jump the page's date filter to a day that has some.
    await win.webContents.executeJavaScript(`(async () => {
      const all = await window.electronAPI.appointments.list({});
      const d = (all.find(a => a.status === 'Done' || a.status === 'Ready for Print') || all.find(a => a.status !== 'Cancelled') || all[0]).appointment_date;
      const inp = document.querySelector('input[type=date]');
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(inp, d); inp.dispatchEvent(new Event('input', { bubbles: true }));
      return d;
    })()`, true);
    await waitFor(win, `(() => { const b=[...document.querySelectorAll('button')].filter(e => /^(Slip|Print|Consultation)$/.test((e.textContent||'').trim())); if(!b.length) return false; b[0].click(); return true; })()`, 'row Slip button');
    await waitFor(win, HAS_TEXT('OPD Slip preview'), 'slip overlay');
    await sleep(1500);
    if (process.env.SLIP_PROBE) {       // SLIP_PROBE=1: print how full each sheet is (scrollHeight vs clientHeight) and the page count the preview claims
      console.log('PROBE', await win.webContents.executeJavaScript(`JSON.stringify({ sheets: [...document.querySelectorAll('.print-page')].map(e => [e.scrollHeight, e.clientHeight]), pill: (document.body.innerText.match(/OPD Slip preview[^\\n]*/) || [''])[0] })`, true));
    }
  },
  // Services -> a service bill -> BillPrint overlay (min-height 297mm sheet).
  'services-bill': async (win) => {
    await open(win, '#/miscellaneous');
    await waitFor(win, `(() => { const b=[...document.querySelectorAll('button')].filter(e => (e.textContent||'').trim()==='Print'); if(!b.length) return false; b[0].click(); return true; })()`, 'row Print button');
    await waitFor(win, HAS_TEXT('Authorised Signatory'), 'bill overlay');
    await sleep(800);
  },
  // Same, but the newest service bill has 45 lines -> legitimately longer than one sheet.
  'services-bill-long': async (win) => {
    await open(win, '#/billing');
    await sleep(2500);
    await win.webContents.executeJavaScript(`(async () => {
      const items = Array.from({ length: 45 }, (_, i) => ({ description: 'Service line ' + (i + 1), qty: 1, rate: 100 + i, amount: 100 + i }));
      const pts = await window.electronAPI.patients.search('a');
      await window.electronAPI.bills.create({ appointment_id: null, patient_id: pts[0].id, items, discount: 0, discount_type: 'flat', payment_mode: 'Cash', bill_kind: 'misc' });
    })()`, true);
    await win.webContents.executeJavaScript(`location.hash = '#/miscellaneous'`, true);
    await waitFor(win, `(() => { const b=[...document.querySelectorAll('button')].filter(e => (e.textContent||'').trim()==='Print'); if(!b.length) return false; b[0].click(); return true; })()`, 'row Print button');
    await waitFor(win, HAS_TEXT('Service line 45'), 'long bill overlay');
    await sleep(800);
  },
  // Radiology -> a reported order -> Print report.
  'radiology-report': async (win) => {
    await open(win, '#/radiology');
    await waitFor(win, `(() => { const b=[...document.querySelectorAll('button')].find(e => (e.textContent||'').trim()==='Reported'); if(!b) return false; b.click(); return true; })()`, 'Reported filter');
    await waitFor(win, `(() => { const li=[...document.querySelectorAll('li')].find(e => (e.textContent||'').includes('RAD-20261020-0003')); if(!li) return false; li.click(); return true; })()`, 'reported order row');
    await waitFor(win, `(() => { const b=[...document.querySelectorAll('button')].find(e => /Print report/.test(e.textContent||'') && !e.disabled); if(!b) return false; b.click(); return true; })()`, 'Print report button');
    await waitFor(win, HAS_TEXT('RADIOLOGY REPORT'), 'report overlay');
    await sleep(600);
  },
  // Radiology -> the same order -> Print bill (the standard bill sheet).
  'radiology-bill': async (win) => {
    await open(win, '#/radiology');
    await waitFor(win, `(() => { const b=[...document.querySelectorAll('button')].find(e => (e.textContent||'').trim()==='Reported'); if(!b) return false; b.click(); return true; })()`, 'Reported filter');
    await waitFor(win, `(() => { const li=[...document.querySelectorAll('li')].find(e => (e.textContent||'').includes('RAD-20261020-0003')); if(!li) return false; li.click(); return true; })()`, 'reported order row');
    await waitFor(win, `(() => { const b=[...document.querySelectorAll('button')].find(e => /Print bill/.test(e.textContent||'')); if(!b) return false; b.click(); return true; })()`, 'Print bill button');
    await waitFor(win, HAS_TEXT('Authorised Signatory'), 'bill overlay');
    await sleep(600);
  },
  // Settings -> Computers & staff -> (more than one computer) -> "Print the checklist": the two A4 sheets for setting up several computers (must stay 2).
  // CHOICE=cable|wifi|direct picks the way of connecting first (the checklist differs a little).
  'connect-checklist': async (win) => {
    await open(win, '#/settings');
    await waitFor(win, `(() => { const i=document.querySelector('input[type="password"]'); if(!i) return !!document.querySelector('button'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(i,'1234'); i.dispatchEvent(new Event('input',{bubbles:true})); const b=[...document.querySelectorAll('button')].find(b=>/Unlock Admin/.test(b.textContent)); if(!b) return false; b.click(); return true; })()`, 'unlock Settings');
    await waitFor(win, CLICK('button', 'Computers & staff'), 'Computers & staff tab');
    await waitFor(win, CLICK('button', 'More than one computer'), 'More than one computer');
    await waitFor(win, HAS_TEXT('Connect your computers'), 'the guide');
    if (process.env.CHOICE) {
      const text = { cable: 'Network cable to the router', wifi: 'Wi-Fi', direct: 'One cable straight between' }[process.env.CHOICE];
      await waitFor(win, `(() => { const b=[...document.querySelectorAll('button[role="radio"]')].find(e => (e.textContent||'').includes(${JSON.stringify(text)})); if(!b) return false; b.click(); return true; })()`, 'choose ' + process.env.CHOICE);
      await sleep(600);
    }
    await waitFor(win, CLICK('button', 'Print the checklist'), 'Print the checklist');
    await waitFor(win, HAS_TEXT('Sheet 2 of 2'), 'checklist overlay');
    await sleep(800);
  },
  // The same checklist, opened from the first-start Setup guide's own "step-by-step guide" window (needs DEMO_URL=http://127.0.0.1:5199/demo.html?setup).
  // That window sits inside a "no-print" page, so this proves the sheet still prints (must stay 2 pages, not blank).
  'connect-checklist-setup': async (win) => {
    await open(win, '#/reception');
    await waitFor(win, CLICK('button', 'More than one computer'), 'More than one computer');
    await waitFor(win, CLICK('button', 'Open the step-by-step guide'), 'Open the step-by-step guide');
    await waitFor(win, HAS_TEXT('Print the checklist'), 'the guide window');
    await waitFor(win, CLICK('button', 'Print the checklist'), 'Print the checklist');
    await waitFor(win, HAS_TEXT('Sheet 2 of 2'), 'checklist overlay');
    await sleep(800);
  },
  // Ad-hoc: run JS (env EVAL) on a route and print the result.
  'eval': async (win) => {
    await open(win, process.env.HASH || '#/billing');
    await sleep(2500);
    const out = await win.webContents.executeJavaScript(process.env.EVAL, true);
    console.log('EVAL >>>', JSON.stringify(out).slice(0, 1500));
    throw new Error('eval-only');
  },
  // Free-form: run arbitrary steps from a JSON file (used for ad-hoc checks).
  'route-only': async (win) => {
    await open(win, process.env.HASH || '#/billing');
    await sleep(Number(process.env.WAIT || 4000));
  },
};

(async () => {
  await app.whenReady();
  if (app.dock) app.dock.hide();
  const win = new BrowserWindow({ width: 1440, height: 900, show: false });
  win.webContents.on('console-message', () => {});
  try {
    await SCENARIOS[scenario](win);
    await sleep(800);
    const png = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, `${scenario}.screen.png`), png.toPNG());
    const pdf = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margins: { marginType: 'none' },
    });
    const file = path.join(OUT, `${scenario}${process.env.TAG ? '.' + process.env.TAG : ''}.pdf`);
    fs.writeFileSync(file, pdf);
    console.log(`RESULT scenario=${scenario} pages=${countPages(pdf)} bytes=${pdf.length} file=${file}`);
  } catch (e) {
    console.log('ERROR', scenario, e && e.message);
    try {
      const png = await win.webContents.capturePage();
      fs.writeFileSync(path.join(OUT, `${scenario}.error.png`), png.toPNG());
      const txt = await win.webContents.executeJavaScript('document.body.innerText.slice(0,1500)', true);
      console.log('PAGE TEXT >>>', txt.replace(/\n+/g, ' | '));
    } catch {}
  }
  app.quit();
})();
