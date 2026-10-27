/**
 * The "?" help popups (src/components/HelpTip.tsx), driven with REAL mouse and keyboard events inside the app's own engine (Electron / Chromium).
 *
 * Why this exists: the popup sits inside a <label>. When its cross removed the popup, Chromium 130 (Electron 33) no longer found the clicked button inside
 * the label, took the click for a click on the label itself and handed it to the "?" - which opened the popup again, so "the cross does nothing". A newer
 * Chrome does not do this, so a browser check or a unit test cannot see it. This script can.
 *
 * Run (from the project folder; needs the demo page served and a desktop session):
 *   npx vite --config vite.demo.config.ts --port 5199 --host 127.0.0.1 &
 *   npx electron tests/ui/helptip-popup.cjs
 * Prints RESULT {...}; "failed" must be []. It uses a throw-away user-data folder and never touches CureDesk's own data.
 */
const { app, BrowserWindow } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'helptip-test-')));
const URL = process.env.TEST_URL || 'http://127.0.0.1:5199/demo.html#/pharmacy';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1300, height: 900, show: true, x: 20, y: 20, webPreferences: { backgroundThrottling: false } });
  win.showInactive();
  const wc = win.webContents;
  wc.focus();
  const js = (code) => wc.executeJavaScript(code, true);
  const click = async (x, y) => {
    wc.sendInputEvent({ type: 'mouseMove', x, y }); await sleep(60);
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); await sleep(70);
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 }); await sleep(350);
  };
  const key = async (keyCode) => { wc.sendInputEvent({ type: 'keyDown', keyCode }); await sleep(40); wc.sendInputEvent({ type: 'keyUp', keyCode }); await sleep(300); };
  const POP = `[...document.querySelectorAll('div')].find(d=>d.className.toString().includes('z-[300]')&&d.textContent.includes('Extra units the dealer gives you free'))`;
  const isOpen = () => js(`!!(${POP})`);
  const helpPos = () => js(`(()=>{const b=[...document.querySelectorAll('button[aria-label="What is Free quantity?"]')][0]; const r=b.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)};})()`);
  const crossPos = () => js(`(()=>{const p=${POP}; if(!p) return null; const r=p.querySelector('button[aria-label="Close"]').getBoundingClientRect(); return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)};})()`);
  const textPos = () => js(`(()=>{const p=${POP}; if(!p) return null; const t=[...p.querySelectorAll('div')].find(d=>d.textContent.startsWith('Extra units')&&d.children.length>=1); const el=p.querySelector('p, div.space-y-1\\\\.5 > *') || t; const r=el.getBoundingClientRect(); return {x:Math.round(r.left+40), y:Math.round(r.top+r.height/2)};})()`);
  const open = async () => { const p = await helpPos(); await click(p.x, p.y); return isOpen(); };
  const out = { chromium: process.versions.chrome, electron: process.versions.electron, checks: {} };
  const rec = (name, ok) => { out.checks[name] = ok; };
  try {
    await wc.loadURL(URL); await sleep(2500);
    await js(`(async()=>{
      const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
      const x=[...document.querySelectorAll('button')].find(b=>b.querySelector('svg.lucide-x')&&b.closest('div')?.textContent.includes('DEMO MODE')); if(x) x.click();
      [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Purchases').click(); await wait(700);
      [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Import bill').click(); await wait(800);
      const btn=(t)=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===t);
      btn('Next').click(); await wait(400); btn('Next').click(); await wait(600);
      [...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('Manans — tax invoice')).click(); await wait(1600);
      document.querySelectorAll('button[aria-label="What is Free quantity?"]')[0].scrollIntoView({block:'center'}); await wait(300);
    })()`);

    // A. the cross closes it
    rec('A1 clicking ? opens the popup', await open());
    let c = await crossPos(); await click(c.x, c.y);
    rec('A2 clicking the cross closes it', !(await isOpen()));
    // F. and again (repeatable)
    rec('F1 opens again', await open());
    c = await crossPos(); await click(c.x, c.y);
    rec('F2 the cross closes it a second time', !(await isOpen()));
    // B. clicking the explanation's own text does not shut it
    rec('B1 opens', await open());
    const t = await textPos(); await click(t.x, t.y);
    rec('B2 a click on the popup text leaves it open', await isOpen());
    // D. the ? again closes it
    const h = await helpPos(); await click(h.x, h.y);
    rec('D clicking the ? again closes it', !(await isOpen()));
    // C. outside click closes
    rec('C1 opens', await open());
    const o = await js(`(()=>{const e=[...document.querySelectorAll('h2')].find(h=>h.textContent.includes('Import a supplier')); const r=e.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)};})()`);
    await click(o.x, o.y);
    rec('C2 clicking outside the box closes it', !(await isOpen()));
    // E. Escape closes
    rec('E1 opens', await open());
    await key('Escape');
    rec('E2 Escape closes it', !(await isOpen()));
  } catch (e) {
    out.error = String(e && e.stack || e);
  }
  const failed = Object.entries(out.checks).filter(([, v]) => !v).map(([k]) => k);
  out.failed = failed;
  console.log('RESULT ' + JSON.stringify(out, null, 1));
  app.exit(0);
});
