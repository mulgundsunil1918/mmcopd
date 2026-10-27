/**
 * Screenshots of the demo in the app's OWN engine (Electron / Chromium 130), at a real 1440x900 window — the browser pane is Chrome 152 and clips wide pages.
 *
 *   npx vite --config vite.demo.config.ts --port 5199 --host 127.0.0.1 &          (serve the demo)
 *   npx electron tools/ui-shots.cjs <scenario.cjs> <outDir>                       (SHOT_UA=win makes the page believe it runs on Windows, so the
 *                                                                                  "Open Windows settings" buttons show)
 *
 * A scenario file exports an array of { file, url?, run(h) }; `url` is a hash ('#/settings'), a query+hash ('?setup#/reception') or a full http(s)/file URL.
 * h has: js(code), wait(ms), clickText(text,{sel,exact,nth}), setInput(sel,value), unlock() (demo admin password), scrollText(text), waitText(text) (case-insensitive,
 * because innerText follows CSS text-transform), scrollTop(), scrollMain(y), closeBanner(), shot(name), shotEl(name, selector), win (the BrowserWindow).
 * Prints RESULT [...]. Throw-away profile; never touches CureDesk's own data. Each scenario reloads the page, so demo state starts fresh.
 */
const { app, BrowserWindow } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'shots-')));
const scenarioPath = path.resolve(process.argv[2]);
const outDir = path.resolve(process.argv[3]);
fs.mkdirSync(outDir, { recursive: true });
const BASE = 'http://127.0.0.1:5199/demo.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 900, show: true, x: 10, y: 10, useContentSize: true, webPreferences: { backgroundThrottling: false } });
  win.showInactive();
  const wc = win.webContents;
  if (process.env.SHOT_UA === 'win') wc.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36');
  const js = (code) => wc.executeJavaScript(code, true);
  const h = {
    win,
    js,
    wait: sleep,
    clickText: async (text, { sel = 'button', exact = true, nth = 0, timeout = 4000 } = {}) => {
      const code = `(()=>{const o=${JSON.stringify({ text, sel, exact, nth })};const els=[...document.querySelectorAll(o.sel)].filter(b=>{const x=(b.textContent||'').replace(/\\s+/g,' ').trim();return o.exact? x===o.text : x.includes(o.text);});const e=els[o.nth];if(!e) return 'NOT FOUND: '+o.text;e.scrollIntoView({block:'center'});e.click();return 'ok';})()`;
      const t0 = Date.now(); let r;
      do { r = await js(code); if (r === 'ok') return r; await sleep(250); } while (Date.now() - t0 < timeout);
      throw new Error(r);
    },
    setInput: (selector, value) => js(`(()=>{const i=document.querySelector(${JSON.stringify(selector)});if(!i) return 'NOT FOUND';const set=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(i),'value').set;set.call(i,${JSON.stringify(value)});i.dispatchEvent(new Event('input',{bubbles:true}));return 'ok';})()`),
    unlock: async () => {
      await js(`(()=>{const i=document.querySelector('input[type="password"]');if(!i) return;const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'1234');i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await sleep(200);
      await js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Unlock Admin/.test(b.textContent));b&&b.click();})()`);
      await sleep(700);
    },
    scrollText: async (text, block = 'start', timeout = 4000) => {
      const code = `(()=>{const t=${JSON.stringify(text)};const all=[...document.querySelectorAll('h1,h2,h3,h4,div,span,p,button,label,summary')];const e=all.find(x=>[...x.childNodes].some(n=>n.nodeType===3&&n.textContent.replace(/\\s+/g,' ').trim().startsWith(t)));if(!e) return 'NOT FOUND: '+t;e.scrollIntoView({block:${JSON.stringify(block)}});return 'ok';})()`;
      const t0 = Date.now(); let r;
      do { r = await js(code); if (r === 'ok') return r; await sleep(250); } while (Date.now() - t0 < timeout);
      throw new Error(r);
    },
    waitText: async (text, timeout = 6000) => {
      const code = `document.body.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`;
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) { if (await js(code)) return true; await sleep(250); }
      throw new Error('text never appeared: ' + text);
    },
    scrollTop: () => js(`(()=>{document.querySelectorAll('*').forEach(e=>{if(e.scrollTop>0) e.scrollTop=0});window.scrollTo(0,0);})()`),
    scrollMain: (y) => js(`(()=>{const m=[...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+50&&['auto','scroll'].includes(getComputedStyle(e).overflowY)).sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];if(m) m.scrollTop=${y};return m?m.scrollHeight:-1;})()`),
    closeBanner: () => js(`(()=>{const x=[...document.querySelectorAll('button')].find(b=>b.querySelector('svg.lucide-x')&&b.closest('div')?.textContent.includes('DEMO MODE'));if(x) x.click();})()`),
    shotEl: async (name, selector, pad = 8) => {
      const r = await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e) return null;e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();return {x:b.left,y:b.top,w:b.width,h:b.height};})()`);
      if (!r) throw new Error('no element ' + selector);
      await sleep(350);
      const r2 = await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const b=e.getBoundingClientRect();return {x:b.left,y:b.top,w:b.width,h:b.height};})()`);
      const rect = { x: Math.max(0, Math.round(r2.x - pad)), y: Math.max(0, Math.round(r2.y - pad)), width: Math.round(r2.w + pad * 2), height: Math.round(r2.h + pad * 2) };
      const img = await wc.capturePage(rect);
      const png = path.join(outDir, name + '.png');
      fs.writeFileSync(png, img.toPNG());
      return png;
    },
    shot: async (name) => {
      await sleep(450);
      const img = await wc.capturePage();
      const png = path.join(outDir, name + '.png');
      fs.writeFileSync(png, img.toPNG());
      return png;
    },
  };
  const out = [];
  try {
    const scenario = require(scenarioPath);
    for (const s of scenario) {
      await wc.loadURL(s.url ? (/^(https?|file):/.test(s.url) ? s.url : BASE + s.url) : BASE);
      await sleep(1800);
      await h.closeBanner();
      try { const r = await s.run(h); out.push({ file: s.file, ok: true, r }); }
      catch (e) { out.push({ file: s.file, ok: false, error: String(e && e.stack || e) }); }
    }
  } catch (e) { out.push({ fatal: String(e && e.stack || e) }); }
  console.log('RESULT ' + JSON.stringify(out));
  app.quit();
});
