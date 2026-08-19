/**
 * Sample / demo data generator for evaluating the app (esp. Analytics) on a fresh
 * install. Creates ~50 patients with realistic cross-module activity — OPD visits
 * + consultations + bills, pharmacy sales, lab orders, and IPD admissions across
 * wards — spread over the last ~120 days so every chart has something to show.
 *
 * This is NOT seeded automatically into a clinic install; it runs only when the
 * user clicks "Load sample data" in Settings. Everything it writes is normal data
 * (removable via the reset tools), just clearly fictional.
 */
import type Database from 'better-sqlite3';
import { PHARMACY_CATALOG } from '../data/pharmacy-catalog';

const FIRST_M = ['Ramesh', 'Suresh', 'Mahesh', 'Basavaraj', 'Shivaraj', 'Ganesh', 'Prakash', 'Manjunath', 'Vittal', 'Naveen', 'Arjun', 'Kiran', 'Anil', 'Sunil', 'Veerappa', 'Praveen', 'Santosh', 'Mallikarjun', 'Nagaraj', 'Chandru'];
const FIRST_F = ['Sangeeta', 'Kavita', 'Sunita', 'Yamuna', 'Geeta', 'Indira', 'Rekha', 'Shanta', 'Vidya', 'Padma', 'Bhagya', 'Anitha', 'Rohini', 'Lakshmi', 'Saraswati', 'Mahadevi', 'Roopa', 'Shweta', 'Divya', 'Meena'];
const LAST = ['Kulkarni', 'Patil', 'Desai', 'Hegde', 'Naik', 'Math', 'Doddamath', 'Hiremath', 'Annigeri', 'Naregal', 'Ronad', 'Lakshmeshwar', 'Madiwalar', 'Pujari', 'Kamatar', 'Hubballi', 'Shetty', 'Angadi', 'Badiger', 'Gadag'];
const PLACES = ['Gadag', 'Betageri', 'Shantipur', 'Lakshmeshwar', 'Ron', 'Naregal', 'Shirhatti', 'Hubballi', 'Dharwad', 'Annigeri'];
const BLOOD = ['O+', 'A+', 'B+', 'AB+', 'O-', 'B-', 'A-'];
const PAY = ['Cash', 'UPI', 'Card'];

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const randInt = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** A datetime `d` days ago (with a plausible clinic-hours time), SQLite format. */
function dtDaysAgo(days: number): { date: string; time: string; dt: string } {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const hh = randInt(9, 19), mm = pick([0, 10, 15, 20, 30, 40, 45, 50]);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { date, time: `${pad(hh)}:${pad(mm)}`, dt: `${date} ${pad(hh)}:${pad(mm)}:00` };
}
function dobForAge(age: number): string {
  const y = new Date().getFullYear() - age;
  return `${y}-${pad(randInt(1, 12))}-${pad(randInt(1, 28))}`;
}

export function seedSampleData(db: Database.Database): { patients: number; bills: number; sales: number; labOrders: number; admissions: number } {
  const counts = { patients: 0, bills: 0, sales: 0, labOrders: 0, admissions: 0 };

  const tx = db.transaction(() => {
    // 1) Doctors (only if the clinic has none yet).
    let docIds = (db.prepare('SELECT id FROM doctors WHERE is_active=1').all() as { id: number }[]).map((r) => r.id);
    if (docIds.length === 0) {
      const insD = db.prepare('INSERT INTO doctors (name, specialty, room_number, default_fee) VALUES (?, ?, ?, ?)');
      const docs: [string, string, string, number][] = [
        ['Dr. A. Sharma', 'General Medicine', '101', 300],
        ['Dr. Anjali Deshpande', 'Pediatrics', '102', 350],
        ['Dr. Ravi Kulkarni', 'Orthopaedics', '103', 500],
        ['Dr. Meera Patil', 'Obstetrics & Gynaecology', '104', 400],
      ];
      docIds = docs.map((d) => Number(insD.run(...d).lastInsertRowid));
    }

    // 2) Wards + beds (only if none).
    let wards = db.prepare('SELECT id, name FROM wards WHERE is_active=1').all() as { id: number; name: string }[];
    if (wards.length === 0) {
      const insW = db.prepare('INSERT INTO wards (name, ward_type, per_day_rate, nursing_per_day, sort_order) VALUES (?, ?, ?, ?, ?)');
      const insBed = db.prepare('INSERT INTO beds (ward_id, bed_number, status) VALUES (?, ?, ?)');
      const wdefs: [string, string, number, number, number][] = [
        ['General Ward', 'general', 800, 200, 1],
        ['Semi-Private', 'semi_private', 1500, 300, 2],
        ['Private Room', 'private', 2500, 400, 3],
        ['ICU', 'icu', 5000, 800, 4],
      ];
      wards = wdefs.map((w, i) => {
        const id = Number(insW.run(...w).lastInsertRowid);
        const nBeds = w[1] === 'icu' ? 4 : 6;
        for (let b = 1; b <= nBeds; b++) insBed.run(id, `${w[0][0]}${b}`, 'free');
        return { id, name: w[0] };
      });
    }

    // Prepared statements
    const insP = db.prepare(`INSERT INTO patients (uhid, first_name, last_name, dob, gender, phone, blood_group, place, district, state, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Gadag', 'Karnataka', ?)`);
    const insA = db.prepare(`INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, token_number, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'Completed', ?)`);
    const insC = db.prepare(`INSERT INTO consultations (appointment_id, patient_id, doctor_id, history, impression, advice, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const insBill = db.prepare(`INSERT INTO bills (bill_number, appointment_id, patient_id, doctor_id, items_json, subtotal, discount, discount_type, total, payment_mode, bill_kind, paid_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, 'flat', ?, ?, ?, ?, ?)`);
    const insSale = db.prepare(`INSERT INTO pharmacy_sales (sale_number, patient_id, subtotal, discount, total, payment_mode, sold_by, created_at)
      VALUES (?, ?, ?, 0, ?, ?, 'Pharmacy', ?)`);
    const insSaleItem = db.prepare(`INSERT INTO pharmacy_sale_items (sale_id, drug_name, qty, rate, amount) VALUES (?, ?, ?, ?, ?)`);
    const insLab = db.prepare(`INSERT INTO lab_orders (order_number, patient_id, doctor_id, status, ordered_at, reported_at, notes)
      VALUES (?, ?, ?, 'reported', ?, ?, 'Sample')`);
    const insLabItem = db.prepare(`INSERT INTO lab_order_items (lab_order_id, lab_test_id, test_name, result, unit, ref_range) VALUES (?, ?, ?, ?, ?, ?)`);
    const insAdm = db.prepare(`INSERT INTO ip_admissions (admission_number, patient_id, admission_doctor_id, admitted_at, discharged_at, bed_number, ward, admission_notes, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    const labTests = db.prepare('SELECT id, name, unit, ref_range FROM lab_tests LIMIT 40').all() as { id: number; name: string; unit: string | null; ref_range: string | null }[];

    const HISTORIES = ['Fever with cold x 3 days', 'Body ache and headache', 'Cough since a week', 'Loose motions x 2 days', 'Acidity and gas', 'BP follow-up', 'Diabetes review', 'Joint pain (knee)', 'Skin rash', 'General weakness'];
    const IMPRESSIONS = ['Viral fever', 'URTI', 'Acute gastritis', 'Hypertension - controlled', 'Type 2 DM - review', 'Osteoarthritis', 'Allergic dermatitis', 'Anaemia', 'Acute bronchitis', 'Migraine'];

    let seq = 0;
    for (let i = 0; i < 50; i++) {
      const isM = Math.random() < 0.5;
      const first = isM ? pick(FIRST_M) : pick(FIRST_F);
      const last = pick(LAST);
      const age = randInt(1, 82);
      const created = dtDaysAgo(randInt(0, 150));
      const uhid = `MMC${pad(1000 + i, 4)}`;
      const phone = `9${randInt(100000000, 999999999)}`;
      const pid = Number(insP.run(uhid, first, last, dobForAge(age), isM ? 'M' : 'F', phone, pick(BLOOD), pick(PLACES), created.dt).lastInsertRowid);
      counts.patients++;

      const nVisits = randInt(1, 3);
      for (let v = 0; v < nVisits; v++) {
        seq++;
        const when = dtDaysAgo(randInt(0, 120));
        const docId = pick(docIds);
        const aid = Number(insA.run(pid, docId, when.date, when.time, randInt(1, 40), when.dt).lastInsertRowid);
        insC.run(aid, pid, docId, pick(HISTORIES), pick(IMPRESSIONS), 'Rest, fluids, medicines as advised. Review if not better.', when.dt);

        // OPD bill (consultation + sometimes a procedure)
        const fee = pick([200, 300, 350, 400, 500]);
        const items: any[] = [{ description: 'Consultation', section: 'Consultation', qty: 1, rate: fee, amount: fee }];
        if (Math.random() < 0.3) { const proc = pick([150, 250, 400]); items.push({ description: pick(['Dressing', 'Injection', 'Nebulisation', 'ECG']), section: 'Procedure', qty: 1, rate: proc, amount: proc }); }
        const total = items.reduce((s, it) => s + it.amount, 0);
        const mode = pick(PAY);
        insBill.run(`INV-${pad(seq, 5)}`, aid, pid, docId, JSON.stringify(items), total, total, mode, 'opd', when.dt, when.dt);
        counts.bills++;

        // Pharmacy sale (~45%)
        if (Math.random() < 0.45) {
          const nDrugs = randInt(1, 3);
          let subtotal = 0;
          const saleId = Number(insSale.run(`PHX-${pad(seq, 5)}`, pid, 0, 0, mode, when.dt).lastInsertRowid);
          for (let k = 0; k < nDrugs; k++) {
            const drug = pick(PHARMACY_CATALOG);
            const qty = randInt(1, 3);
            const amt = Math.round(drug.default_mrp * qty);
            insSaleItem.run(saleId, drug.name, qty, drug.default_mrp, amt);
            subtotal += amt;
          }
          db.prepare('UPDATE pharmacy_sales SET subtotal=?, total=? WHERE id=?').run(subtotal, subtotal, saleId);
          counts.sales++;
        }

        // Lab order (~25%)
        if (labTests.length && Math.random() < 0.25) {
          const loId = Number(insLab.run(`LAB-${pad(seq, 5)}`, pid, docId, when.dt, when.dt).lastInsertRowid);
          const n = randInt(1, 3);
          for (let k = 0; k < n; k++) {
            const t = pick(labTests);
            insLabItem.run(loId, t.id, t.name, String(randInt(1, 100)), t.unit || '', t.ref_range || '');
          }
          // lab bill so lab revenue shows in Modules P&L
          const labTotal = 100 * n + 50;
          insBill.run(`LABINV-${pad(seq, 5)}`, aid, pid, docId, JSON.stringify([{ description: 'Lab tests', section: 'Lab', qty: n, rate: 100, amount: labTotal }]), labTotal, labTotal, mode, 'lab', when.dt, when.dt);
          counts.labOrders++;
        }
      }
    }

    // IPD admissions (~10) across wards — some discharged, some current.
    const patientIds = (db.prepare('SELECT id FROM patients ORDER BY id DESC LIMIT 30').all() as { id: number }[]).map((r) => r.id);
    for (let i = 0; i < 10 && patientIds.length; i++) {
      seq++;
      const pid = pick(patientIds);
      const w = pick(wards);
      const admittedDays = randInt(3, 90);
      const admitted = dtDaysAgo(admittedDays);
      const discharged = Math.random() < 0.7;
      const dischDt = discharged ? dtDaysAgo(Math.max(0, admittedDays - randInt(1, 6))).dt : null;
      insAdm.run(`IP-${pad(seq, 5)}`, pid, pick(docIds), admitted.dt, dischDt, `${w.name[0]}${randInt(1, 5)}`, w.name,
        pick(['Fever for evaluation', 'Dehydration', 'Chest infection', 'Post-op observation', 'Fracture management']),
        discharged ? 'discharged' : 'admitted');
      // IPD bill for revenue
      if (discharged) {
        const days = randInt(2, 6);
        const ipTotal = days * 1200 + randInt(1000, 5000);
        insBill.run(`IPINV-${pad(seq, 5)}`, null, pid, pick(docIds), JSON.stringify([{ description: `IPD stay (${days} days)`, section: 'IPD', qty: days, rate: 1200, amount: ipTotal }]), ipTotal, ipTotal, pick(PAY), 'ipd', dischDt, dischDt);
        counts.bills++;
      }
      counts.admissions++;
    }
  });

  tx();
  return counts;
}
