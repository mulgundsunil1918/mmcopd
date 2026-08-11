// CureDesk HMS — vendor licence-key generator (local UI).
//
// Run:  npm run keygen   (then open http://localhost:4599)
//
// A tiny local web app that mirrors the website's plan selector: tick the base +
// add-ons, enter the clinic name, (optionally) the clinic's Machine ID and the
// validity, and it signs a licence code with license-keys/private.pem. The
// private key NEVER leaves this machine — that's why this is a local tool, not a
// hosted page. Zero dependencies (Node built-ins only).
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { sign, randomUUID } from 'node:crypto';

const PORT = parseInt(process.env.PORT || '4599', 10);
const CONTACT = { phone: '8073935006', email: 'mulgundsunil@gmail.com' };

let PRIV;
try { PRIV = readFileSync('license-keys/private.pem', 'utf8'); }
catch { console.error('FATAL: run this from the repo root — license-keys/private.pem not found.'); process.exit(1); }

// Base bundle is always included; add-ons map to licence modules.
const BASE = ['reception', 'opd', 'peds', 'analytics'];
const PRICES = { lab: 999, pharmacy: 1999, ipd: 4999, whatsapp_basic: 999, whatsapp_pro: 1999 };

function buildModules(d) {
  const m = new Set(BASE);
  if (d.lab) m.add('lab');
  if (d.pharmacy) m.add('pharmacy');
  if (d.ipd) m.add('ipd');
  if (d.wa === 'basic') m.add('whatsapp');
  if (d.wa === 'pro') { m.add('whatsapp'); m.add('whatsapp_pro'); }
  return [...m];
}

function signLicence(d) {
  const modules = buildModules(d);
  const days = Math.max(1, parseInt(d.days, 10) || 365);
  const now = new Date();
  const expires = new Date(now.getTime() + days * 86_400_000);
  const payload = {
    v: 1, license_id: 'LIC-' + randomUUID().slice(0, 8).toUpperCase(),
    clinic: String(d.clinic || '').trim(), customer: String(d.customer || '').trim(),
    edition: d.edition || 'custom', modules,
    issued_at: now.toISOString(), expires_at: expires.toISOString(),
    hardware_id: String(d.machineId || '').trim(), contact: CONTACT,
  };
  const pStr = JSON.stringify(payload);
  const s = sign(null, Buffer.from(pStr, 'utf8'), PRIV).toString('base64');
  const token = Buffer.from(JSON.stringify({ p: pStr, s })).toString('base64');
  let total = 8999;
  if (d.lab) total += PRICES.lab;
  if (d.pharmacy) total += PRICES.pharmacy;
  if (d.ipd) total += PRICES.ipd;
  if (d.wa === 'basic') total += PRICES.whatsapp_basic;
  if (d.wa === 'pro') total += PRICES.whatsapp_pro;
  return { token, modules, expires_at: payload.expires_at, license_id: payload.license_id, total, bound: !!payload.hardware_id };
}

const HTML = `<!doctype html><html><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CureDesk — Licence Generator</title>
<style>
  :root{ --ink:#0f172a; --muted:#64748b; --accent:#4f46e5; --line:#e2e8f0; }
  *{ box-sizing:border-box; }
  body{ margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background:#eef2ff; color:var(--ink); padding:28px 16px; }
  .wrap{ max-width:640px; margin:0 auto; }
  h1{ font-size:22px; margin:0 0 2px; } .sub{ color:var(--muted); font-size:13px; margin:0 0 20px; }
  .card{ background:#fff; border-radius:16px; padding:20px; box-shadow:0 12px 30px -12px rgba(15,23,42,.18); }
  label.fld{ display:block; font-size:12px; font-weight:700; color:#334155; margin:12px 0 4px; }
  input[type=text],input[type=number]{ width:100%; padding:11px 12px; border:1px solid #cbd5e1; border-radius:9px; font-size:14px; font-family:inherit; }
  input:focus{ outline:none; border-color:var(--accent); box-shadow:0 0 0 3px rgba(79,70,229,.15); }
  .row{ display:flex; gap:12px; } .row>div{ flex:1; }
  .hint{ font-size:11px; color:var(--muted); margin-top:4px; }
  .addlabel{ font-size:11px; text-transform:uppercase; letter-spacing:.12em; font-weight:800; color:#94a3b8; margin:18px 0 8px; }
  .base{ border:2px solid var(--accent); background:#eef2ff; border-radius:12px; padding:13px 15px; display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
  .base .p{ font-weight:800; color:var(--accent); white-space:nowrap; text-align:right; }
  .base .p small{ display:block; font-size:10px; color:var(--muted); font-weight:600; }
  .base .d{ font-size:12px; color:#475569; margin-top:3px; }
  .mod{ border:1px solid var(--line); border-radius:11px; padding:12px 14px; display:flex; align-items:center; gap:12px; cursor:pointer; margin-bottom:8px; }
  .mod:hover{ border-color:#c7d2fe; } .mod input{ width:18px; height:18px; accent-color:var(--accent); }
  .mod .b{ flex:1; } .mod .t{ font-weight:700; font-size:14px; } .mod .d{ font-size:11.5px; color:var(--muted); }
  .mod .p{ font-weight:800; color:var(--accent); white-space:nowrap; }
  .total{ display:flex; justify-content:space-between; align-items:center; background:#0f172a; color:#fff; border-radius:11px; padding:13px 16px; margin-top:14px; }
  .total .amt{ font-size:20px; font-weight:800; } .total .amt small{ font-size:11px; opacity:.7; }
  button.gen{ width:100%; margin-top:16px; padding:14px; border:none; border-radius:11px; background:linear-gradient(135deg,#4f46e5,#2563eb); color:#fff; font-weight:800; font-size:15px; cursor:pointer; }
  button.gen:hover{ filter:brightness(1.06); } button.gen:disabled{ opacity:.5; cursor:default; }
  .out{ margin-top:16px; display:none; } .out.show{ display:block; }
  .out .meta{ font-size:12px; color:#475569; margin-bottom:8px; }
  textarea{ width:100%; height:120px; font-family:ui-monospace,Menlo,monospace; font-size:11px; padding:10px; border:1px solid #cbd5e1; border-radius:9px; resize:vertical; }
  .cpy{ margin-top:8px; padding:9px 16px; border:none; border-radius:8px; background:#4f46e5; color:#fff; font-weight:700; cursor:pointer; font-size:13px; }
  .err{ color:#dc2626; font-size:12px; margin-top:8px; }
</style></head><body><div class="wrap">
  <h1>🔑 CureDesk Licence Generator</h1>
  <p class="sub">Local &amp; signed on this machine. Pick the plan, generate the code, send it to the clinic.</p>
  <div class="card">
    <div class="row">
      <div><label class="fld">Clinic name *</label><input type="text" id="clinic" placeholder="e.g. Gadag Clinic"></div>
      <div><label class="fld">Customer (optional)</label><input type="text" id="customer" placeholder="e.g. Dr X"></div>
    </div>
    <label class="fld">Machine ID <span style="font-weight:400;color:#94a3b8">— from the clinic's Activation screen. Leave blank = works on any PC (test only).</span></label>
    <input type="text" id="machineId" placeholder="32-hex, or blank for unbound">
    <label class="fld">Validity (days)</label>
    <input type="number" id="days" value="365" min="1">

    <div class="addlabel">Plan</div>
    <div class="base">
      <div><b>🏥 Base — Reception &amp; OPD</b><div class="d">Registration · appointments · consultation + Rx · pediatrics (WHO &amp; IAP) · GST billing · analytics · multi-station · offline.</div></div>
      <div class="p">₹8,999<small>/ yr · required</small></div>
    </div>

    <div class="addlabel">Optional add-ons — tick what you need</div>
    <label class="mod"><input type="checkbox" id="lab" onchange="calc()"><span class="b"><span class="t">🧪 Laboratory</span><div class="d">170+ catalog · orders · results · report &amp; bill.</div></span><span class="p">+₹999</span></label>
    <label class="mod"><input type="checkbox" id="pharmacy" onchange="calc()"><span class="b"><span class="t">💊 Pharmacy</span><div class="d">FEFO inventory · Schedule H/H1 · purchase invoices.</div></span><span class="p">+₹1,999</span></label>
    <label class="mod"><input type="checkbox" id="ipd" onchange="calc()"><span class="b"><span class="t">🛏️ In-Patient (IPD)</span><div class="d">Beds &amp; ward care · discharge · insurance / TPA.</div></span><span class="p">+₹4,999</span></label>
    <label class="mod"><input type="checkbox" name="wa" data-wa="basic" onchange="waPick(this)"><span class="b"><span class="t">💬 WhatsApp Basic</span><div class="d">One-click messaging with name-filled templates.</div></span><span class="p">+₹999</span></label>
    <label class="mod"><input type="checkbox" name="wa" data-wa="pro" onchange="waPick(this)"><span class="b"><span class="t">📲 WhatsApp Pro</span><div class="d">Meta Cloud API — auto reminders, 2-way inbox.</div></span><span class="p">+₹1,999</span></label>

    <div class="total"><span>Annual price</span><span class="amt">₹<span id="total">8,999</span><small> / yr</small></span></div>
    <button class="gen" onclick="gen()">Generate licence code</button>
    <div class="err" id="err"></div>

    <div class="out" id="out">
      <div class="meta" id="meta"></div>
      <textarea id="code" readonly></textarea>
      <button class="cpy" onclick="copyCode()">Copy code</button>
    </div>
  </div>
</div>
<script>
  const PR = { lab:999, pharmacy:1999, wa_basic:999, wa_pro:1999, ipd:4999 };
  function waPick(el){ if(el.checked) document.querySelectorAll('input[data-wa]').forEach(x=>{ if(x!==el) x.checked=false; }); calc(); }
  function waVal(){ const el=[...document.querySelectorAll('input[data-wa]')].find(x=>x.checked); return el? el.dataset.wa : ''; }
  function calc(){
    let t=8999;
    if(document.getElementById('lab').checked) t+=PR.lab;
    if(document.getElementById('pharmacy').checked) t+=PR.pharmacy;
    if(document.getElementById('ipd').checked) t+=PR.ipd;
    const wa=waVal(); if(wa==='basic') t+=PR.wa_basic; if(wa==='pro') t+=PR.wa_pro;
    document.getElementById('total').textContent = t.toLocaleString('en-IN');
  }
  async function gen(){
    const err=document.getElementById('err'); err.textContent='';
    const clinic=document.getElementById('clinic').value.trim();
    if(!clinic){ err.textContent='Clinic name is required.'; return; }
    const body={ clinic, customer:document.getElementById('customer').value.trim(),
      machineId:document.getElementById('machineId').value.trim(), days:document.getElementById('days').value,
      lab:document.getElementById('lab').checked, pharmacy:document.getElementById('pharmacy').checked,
      ipd:document.getElementById('ipd').checked, wa:waVal() };
    try{
      const r=await fetch('/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
      const j=await r.json();
      if(!j.ok){ err.textContent=j.error||'Failed'; return; }
      document.getElementById('code').value=j.token;
      document.getElementById('meta').innerHTML='<b>'+clinic+'</b> · '+j.modules.join(', ')+'<br>Expires '+j.expires_at.slice(0,10)+' · ₹'+j.total.toLocaleString('en-IN')+'/yr · '+(j.bound?'locked to that machine':'⚠ unbound (any PC)');
      document.getElementById('out').classList.add('show');
    }catch(e){ err.textContent=String(e); }
  }
  function copyCode(){ const t=document.getElementById('code'); t.select(); document.execCommand('copy'); }
  calc();
</script></body></html>`;

createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(HTML); return;
  }
  if (req.method === 'POST' && req.url === '/generate') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      try {
        const d = JSON.parse(body || '{}');
        if (!String(d.clinic || '').trim()) throw new Error('Clinic name is required.');
        const r = signLicence(d);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ...r }));
      } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e?.message || String(e) }));
      }
    });
    return;
  }
  res.writeHead(404); res.end('not found');
}).listen(PORT, '127.0.0.1', () => {
  console.log(`\n  🔑  CureDesk Licence Generator — open  http://localhost:${PORT}\n     (local only; private key stays on this machine. Ctrl+C to stop.)\n`);
});
