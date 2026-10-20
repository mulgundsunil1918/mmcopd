// Does it stay quick with three busy years of data? Fills a scratch database (synthetic) with ~30,000 patients,
// ~100,000 visits and bills, ~60,000 pharmacy sales, then times the handlers a clinic uses all day.
import { boot, call, getDb } from './harness';
import { ok, section, finish, note, finding } from './lib';
import { localISO } from '../../src/lib/localDate';

boot();
const db = getDb();
const today = localISO();
const iso = (daysAgo: number) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); return localISO(d); };
const utc = (daysAgo: number, h: number) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(h, (daysAgo * 7) % 60, 0, 0); return d.toISOString().slice(0, 19).replace('T', ' '); };

(async () => {
  section('building the data');
  const t0 = Date.now();
  const NP = 30000, NA = 100000, NS = 60000;
  const doctors = [1, 2, 3, 4, 5].map((i) => Number(db.prepare("INSERT INTO doctors (name, specialty, default_fee) VALUES (?, 'GP', 300)").run(`Dr. Perf ${i}`).lastInsertRowid));
  const first = ['Ravi', 'Sita', 'Mohan', 'Asha', 'Imran', 'Lakshmi', 'Gopal', 'Meena'], last = ['Kumar', 'Devi', 'Patil', 'Rao', 'Khan', 'Naik', 'Shetty', 'Hegde'];
  const insP = db.prepare("INSERT INTO patients (uhid, first_name, last_name, dob, gender, phone, place, created_at) VALUES (?, ?, ?, '1985-01-01', ?, ?, ?, ?)");
  const insA = db.prepare("INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, token_number, status, visit_number, visit_id) VALUES (?, ?, ?, ?, ?, 'Done', 1, ?)");
  const insB = db.prepare("INSERT INTO bills (bill_number, appointment_id, patient_id, items_json, subtotal, discount, total, payment_mode, status, amount_paid, bill_type, created_at) VALUES (?, ?, ?, '[]', 300, 0, 300, 'Cash', 'paid', 300, 'opd_consult', ?)");
  const insBI = db.prepare("INSERT INTO bill_items (bill_id, description, qty, rate, amount, source) VALUES (?, 'Consultation', 1, 300, 300, 'opd')");
  const sup = Number(db.prepare("INSERT INTO wholesalers (name, drug_license_no) VALUES ('Perf Supplier','DL-P')").run().lastInsertRowid);
  const drugs = db.prepare('SELECT id FROM drug_master LIMIT 60').all().map((r: any) => r.id as number);
  db.transaction(() => {
    for (let i = 0; i < NP; i++) insP.run(`PT-P-${i}`, first[i % 8], last[(i * 3) % 8] + i, i % 2 ? 'M' : 'F', `9${String(100000000 + i)}`, ['Gadag', 'Hubli', 'Mulgund'][i % 3], utc(i % 1000, 10));
    for (let i = 0; i < NA; i++) {
      const day = i % 1095; const pid = 1 + ((i * 7) % NP);
      const ai = Number(insA.run(pid, doctors[i % 5], iso(day), `${String(9 + (i % 9)).padStart(2, '0')}:${String((i * 3) % 60).padStart(2, '0')}`, 1 + (i % 120), `PT-P-${pid}/V${1 + (i % 4)}`).lastInsertRowid);
      const bi = Number(insB.run(`PB-${i}`, ai, pid, utc(day, 10 + (i % 8))).lastInsertRowid);
      insBI.run(bi);
    }
    // stock + sales
    const batchIds = drugs.map((d, k) => Number(db.prepare("INSERT INTO drug_stock_batches (drug_master_id, batch_no, expiry, qty_received, qty_remaining, purchase_price, unit_cost, mrp) VALUES (?, ?, '2031-01-01', 1000000, 1000000, 5, 5, 10)").run(d, `PERF${k}`).lastInsertRowid));
    const insS = db.prepare("INSERT INTO pharmacy_sales (sale_number, subtotal, discount, total, payment_mode, created_at) VALUES (?, 30, 0, 30, 'Cash', ?)");
    const insSI = db.prepare("INSERT INTO pharmacy_sale_items (sale_id, drug_master_id, batch_id, drug_name, qty, rate, amount) VALUES (?, ?, ?, 'x', 3, 10, 30)");
    const insR = db.prepare("INSERT INTO dispensing_register (sale_item_id, sale_id, drug_master_id, batch_id, batch_no, expiry, schedule, qty, rate, unit_cost, dispensed_at) VALUES (?, ?, ?, ?, 'PERF', '2031-01-01', 'OTC', 3, 10, 5, ?)");
    for (let i = 0; i < NS; i++) {
      const day = i % 1095; const k = i % drugs.length;
      const sid = Number(insS.run(`PS-${i}`, utc(day, 11)).lastInsertRowid);
      const si = Number(insSI.run(sid, drugs[k], batchIds[k]).lastInsertRowid);
      insR.run(si, sid, drugs[k], batchIds[k], utc(day, 11));
    }
    for (let i = 0; i < 400; i++) {
      const inv = Number(db.prepare("INSERT INTO purchase_invoices (invoice_number, wholesaler_id, invoice_date, subtotal, total, amount_paid, payment_status) VALUES (?, ?, ?, 5000, 5000, 5000, 'paid')").run(`PI-${i}`, sup, iso(i * 2)).lastInsertRowid);
      db.prepare("INSERT INTO purchase_invoice_items (invoice_id, drug_master_id, batch_no, expiry, qty_received, purchase_price, mrp, gst_rate, line_total, unit_cost) VALUES (?, ?, ?, '2031-01-01', 100, 50, 100, 0, 5000, 50)").run(inv, drugs[i % drugs.length], `PIB${i}`);
    }
  })();
  note(`inserted ${NP.toLocaleString()} patients, ${NA.toLocaleString()} visits + bills, ${NS.toLocaleString()} pharmacy sales in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  section('timing the everyday handlers (ms)');
  const rows: [string, number][] = [];
  const time = async (label: string, ch: string, ...args: any[]) => {
    const s = Date.now(); await call(ch, ...args); const ms = Date.now() - s; rows.push([label, ms]); return ms;
  };
  await time('patient search by name', 'patients:search', 'Ravi Kumar');
  await time('patient search by phone', 'patients:search', '9100012345');
  await time('patient search by UHID', 'patients:search', 'PT-P-777');
  await time("today's appointments", 'appointments:list', { date: today });
  await time('billing list, last 30 days', 'bills:list', { from: iso(30), to: today });
  await time('billing search by name', 'bills:list', { q: 'Ravi' });
  await time('patient log, 90 days', 'patients:log', { from: iso(90), to: today });
  await time('all-patients list', 'patients:allList', { q: 'Devi' });
  await time('Finance summary', 'finance:summary', {});
  await time('Analytics overview', 'analytics:overview');
  await time('Modules P&L, 1 year', 'analytics:modules', iso(365), today);
  await time('pharmacy overview, 90 days', 'analytics:pharmacyOverview', { from: iso(90), to: today });
  await time('pharmacy PROFIT, 90 days', 'analytics:pharmacyProfit', { from: iso(90), to: today });
  await time('pharmacy PROFIT, 1 year', 'analytics:pharmacyProfit', { from: iso(365), to: today });
  await time('stock value', 'analytics:pharmacyValuation');
  await time('supplier report, 1 year', 'analytics:supplierReport', { from: iso(365), to: today });
  await time('pharmacy data checks', 'analytics:pharmacyChecks');
  await time('operational report: daily collection, 1 year', 'reports:run', { kind: 'daily_collection', from: iso(365), to: today });
  await time('drug list', 'pharmacy:listDrugs', {});
  await time('stock register', 'stock:register', {});
  await time('pharmacy sales list', 'pharmacy:listSales', { from: iso(30), to: today });
  for (const [l, ms] of rows) console.log(`  ${ms < 300 ? '✓' : ms < 1000 ? '~' : '✗'} ${String(ms).padStart(5)} ms  ${l}`);
  const broken = rows.filter(([, ms]) => ms >= 3000);
  const slow = rows.filter(([, ms]) => ms >= 1000 && ms < 3000);
  const mid = rows.filter(([, ms]) => ms >= 300 && ms < 1000);
  ok(broken.length === 0, `nothing takes 3 seconds or more on three busy years of data${broken.length ? ' — TOO SLOW: ' + broken.map(([l, ms]) => `${l} (${ms} ms)`).join('; ') : ''}`);
  if (slow.length) finding(`Over a second on ~100,000 bills / 60,000 sales (a very busy three years): ${slow.map(([l, ms]) => `${l} (${ms} ms)`).join('; ')}. Fine for a normal clinic; it scans the whole bills table for each total.`);
  if (mid.length) finding(`Noticeable (0.3–1 s) at that volume: ${mid.map(([l, ms]) => `${l} (${ms} ms)`).join('; ')}`);
  finish();
})().catch((e) => { console.error('E2E CRASHED', e); process.exit(1); });
