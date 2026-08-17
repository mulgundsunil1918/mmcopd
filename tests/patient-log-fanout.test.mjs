// Verify the patient-log query returns ONE row per visit even when a visit
// carries several bills — the duplicate-row bug from the screenshot.
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE patients (id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT, uhid TEXT,
    dob TEXT, gender TEXT, phone TEXT, blood_group TEXT, created_at TEXT);
  CREATE TABLE doctors (id INTEGER PRIMARY KEY, name TEXT, specialty TEXT, room_number TEXT);
  CREATE TABLE appointments (id INTEGER PRIMARY KEY, patient_id INT, doctor_id INT,
    appointment_date TEXT, appointment_time TEXT, token_number INT, status TEXT);
  CREATE TABLE bills (id INTEGER PRIMARY KEY, appointment_id INT, total REAL,
    payment_mode TEXT, bill_number TEXT);

  INSERT INTO patients VALUES (1,'Krishna','B','PT-20260817-0001','2024-09-17','Male','9008416897',NULL,'2026-08-17');
  INSERT INTO doctors  VALUES (1,'Dr. Sunil Mulgund','Pediatrics','1');
  -- ONE visit
  INSERT INTO appointments VALUES (1,1,1,'2026-08-17','17:43',1,'Ready for Print');
  -- ...carrying TWO bills, exactly as in the screenshot
  INSERT INTO bills VALUES (1,1,0.0,'Cash','B-1');
  INSERT INTO bills VALUES (2,1,300.0,'Pending','B-2');
  -- a second visit with NO bill at all, to prove LEFT JOIN still yields it
  INSERT INTO appointments VALUES (2,1,1,'2026-08-17','18:10',2,'Waiting');
`);

const sql = (extra) => `
  SELECT a.*, (p.first_name || ' ' || p.last_name) as patient_name,
    ${extra}
  FROM appointments a
  JOIN patients p ON p.id = a.patient_id
  JOIN doctors d ON d.id = a.doctor_id
  LEFT JOIN bills b ON b.appointment_id = a.id
  WHERE a.appointment_date >= '2026-08-01' AND a.appointment_date <= '2026-08-31'
  ${extra.includes('GROUP') ? '' : ''}`;

const OLD = db.prepare(`
  SELECT a.id, a.token_number, b.total as bill_total, b.payment_mode
  FROM appointments a
  JOIN patients p ON p.id=a.patient_id JOIN doctors d ON d.id=a.doctor_id
  LEFT JOIN bills b ON b.appointment_id=a.id
  WHERE a.appointment_date='2026-08-17'`).all();

const NEW = db.prepare(`
  SELECT a.id, a.token_number,
         SUM(b.total) as bill_total, COUNT(b.id) as bill_count,
         MAX(b.id) as latest_bill_id, b.payment_mode as bill_payment_mode, b.bill_number
  FROM appointments a
  JOIN patients p ON p.id=a.patient_id JOIN doctors d ON d.id=a.doctor_id
  LEFT JOIN bills b ON b.appointment_id=a.id
  WHERE a.appointment_date='2026-08-17'
  GROUP BY a.id
  ORDER BY a.appointment_date DESC, a.appointment_time ASC`).all();

let pass = true;
const check = (name, cond, detail) => {
  if (!cond) pass = false;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

console.log(`\nBEFORE (joined per bill): ${OLD.length} rows for 2 visits`);
OLD.forEach(r => console.log(`    visit ${r.id} token#${r.token_number}  ₹${r.bill_total ?? 0} ${r.payment_mode ?? ''}`));
console.log(`\nAFTER  (grouped per visit): ${NEW.length} rows`);
NEW.forEach(r => console.log(`    visit ${r.id} token#${r.token_number}  ₹${r.bill_total ?? 0} ${r.bill_payment_mode ?? '—'} (${r.bill_count} bill/s)`));

console.log('\nassertions:');
check('old query duplicated the visit', OLD.length === 3, `${OLD.length} rows`);
check('new query returns one row per visit', NEW.length === 2, `${NEW.length} rows`);
const v1 = NEW.find(r => r.id === 1);
check('the two bills are summed onto the visit', v1.bill_total === 300, `₹${v1.bill_total}`);
check('bill_count reports both bills', v1.bill_count === 2);
check('payment mode comes from the LATEST bill', v1.bill_payment_mode === 'Pending', v1.bill_payment_mode);
check('bill_number matches that same latest bill', v1.bill_number === 'B-2', v1.bill_number);
const v2 = NEW.find(r => r.id === 2);
check('a visit with no bill is still listed', !!v2);
check('unbilled visit has no phantom money', v2.bill_total === null && v2.bill_count === 0);
check('revenue total is unchanged by the fix',
  NEW.reduce((s, r) => s + Number(r.bill_total || 0), 0) === OLD.reduce((s, r) => s + Number(r.bill_total || 0), 0),
  '₹300 both ways');

console.log(pass ? '\nALL PASS' : '\nFAILURES ABOVE');
process.exit(pass ? 0 : 1);
