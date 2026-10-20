import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrations';
import { seedIfEmpty } from '../../src/db/seed';
import { seedSampleData } from '../../src/db/sample-data';
import { parseDbDate } from '../../src/lib/utils';

let pass = 0, fail = 0;
const ok = (c: any, m: string) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };
const tz = process.env.TZ || '(system)';
const hourLocal = (utcStr: string) => parseDbDate(utcStr)!.getHours();
const fresh = () => { const db = new Database(':memory:'); db.pragma('foreign_keys = ON'); runMigrations(db); seedIfEmpty(db); return db; };

console.log(`\n== TZ=${tz} ==`);
console.log('A. fresh sample data is stored as UTC and displays inside clinic hours (09–19 local)');
{
  const db = fresh();
  seedSampleData(db);
  const pts = db.prepare("SELECT created_at FROM patients WHERE uhid GLOB 'MMC[0-9][0-9][0-9][0-9]'").all() as any[];
  ok(pts.length === 50, `50 sample patients (${pts.length})`);
  const hrs = pts.map((p) => hourLocal(p.created_at));
  ok(hrs.every((h) => h >= 9 && h <= 19), `every sample "registered" time reads 09:00–19:59 local (min ${Math.min(...hrs)}, max ${Math.max(...hrs)})`);
  const a = db.prepare("SELECT appointment_date d, appointment_time t, created_at c FROM appointments LIMIT 25").all() as any[];
  ok(a.every((x) => { const l = parseDbDate(x.c)!; const p = (n: number) => String(n).padStart(2, '0'); return `${l.getFullYear()}-${p(l.getMonth() + 1)}-${p(l.getDate())}` === x.d && `${p(l.getHours())}:${p(l.getMinutes())}` === x.t; }), 'each appointment_date/time (local) equals its created_at (UTC) read back as local');
  ok((db.prepare("SELECT value v FROM settings WHERE key='sample_times_utc'").get() as any)?.v === '1', 'new load marks itself UTC');
  runMigrations(db);
  const again = db.prepare("SELECT created_at FROM patients WHERE uhid GLOB 'MMC[0-9][0-9][0-9][0-9]'").all() as any[];
  ok(JSON.stringify(again) === JSON.stringify(pts), 'running migrations again does NOT shift them a second time');
}

console.log('B. sample data loaded by an OLDER version (local times, no flag) is repaired once');
{
  const db = fresh();
  db.prepare("DELETE FROM settings WHERE key='sample_times_utc'").run();
  // old-style rows: LOCAL 10:30 stored as if UTC
  const p = db.prepare("INSERT INTO patients (uhid, first_name, last_name, dob, gender, phone, created_at) VALUES ('MMC1001','Old','Sample','1990-01-01','M','9111111111','2026-10-01 10:30:00')").run();
  const pid = Number(p.lastInsertRowid);
  const d = Number(db.prepare("INSERT INTO doctors (name, specialty) VALUES ('Dr X','GP')").run().lastInsertRowid);
  db.prepare("INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, token_number, created_at) VALUES (?,?,?,?,?,?)").run(pid, d, '2026-10-01', '10:30', 1, '2026-10-01 10:30:00');
  db.prepare("INSERT INTO bills (bill_number, patient_id, items_json, subtotal, total, payment_mode, paid_at, created_at) VALUES ('INV-00001',?,'[]',100,100,'Cash','2026-10-01 10:35:00','2026-10-01 10:30:00')").run(pid);
  db.prepare("INSERT INTO lab_orders (order_number, patient_id, doctor_id, status, ordered_at, reported_at) VALUES ('LAB-00001',?,?, 'reported','2026-10-01 10:30:00', NULL)").run(pid, d);
  // a REAL patient with a correct UTC timestamp — must not move
  db.prepare("INSERT INTO patients (uhid, first_name, last_name, dob, gender, phone, created_at) VALUES ('PT-20261001-0001','Real','Patient','1990-01-01','F','9222222222','2026-10-01 05:00:00')").run();

  runMigrations(db);
  const sp = db.prepare("SELECT created_at c FROM patients WHERE uhid='MMC1001'").get() as any;
  const rp = db.prepare("SELECT created_at c FROM patients WHERE uhid='PT-20261001-0001'").get() as any;
  ok(parseDbDate(sp.c)!.getHours() === 10 && parseDbDate(sp.c)!.getMinutes() === 30, `old sample patient now reads 10:30 local again (stored ${sp.c} UTC)`);
  ok(rp.c === '2026-10-01 05:00:00', 'a real patient (PT-…) is untouched');
  const ap = db.prepare('SELECT created_at c FROM appointments').get() as any;
  ok(parseDbDate(ap.c)!.getHours() === 10, 'its appointment repaired');
  const b = db.prepare('SELECT created_at c, paid_at p FROM bills').get() as any;
  ok(parseDbDate(b.c)!.getHours() === 10 && parseDbDate(b.p)!.getMinutes() === 35, 'its bill (created + paid) repaired');
  const lo = db.prepare('SELECT ordered_at o, reported_at r FROM lab_orders').get() as any;
  ok(parseDbDate(lo.o)!.getHours() === 10 && lo.r === null, 'its lab order repaired; a NULL stays NULL');
  const before = sp.c;
  runMigrations(db);
  ok((db.prepare("SELECT created_at c FROM patients WHERE uhid='MMC1001'").get() as any).c === before, 'second run is a no-op (flag set)');
}

console.log('C. a clinic that never loaded sample data: nothing changes, flag still set');
{
  const db = fresh();
  db.prepare("DELETE FROM settings WHERE key='sample_times_utc'").run();
  db.prepare("INSERT INTO patients (uhid, first_name, last_name, dob, gender, phone, created_at) VALUES ('PT-20261001-0002','Real','Two','1990-01-01','F','9333333333','2026-10-01 05:00:00')").run();
  runMigrations(db);
  ok((db.prepare("SELECT created_at c FROM patients").get() as any).c === '2026-10-01 05:00:00', 'real data untouched');
  ok((db.prepare("SELECT value v FROM settings WHERE key='sample_times_utc'").get() as any)?.v === '1', 'flag recorded so it never runs again');
}
console.log(`  → ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
