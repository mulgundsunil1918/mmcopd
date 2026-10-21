/**
 * Mock window.electronAPI for the GitHub Pages demo build.
 *
 * Implements the same shape as src/preload.ts but backed entirely by the
 * static dataset in demo-data.ts. Mutations are kept in-memory (so the UI
 * still feels responsive — add a patient, see it in the list) but vanish
 * on page reload, which is fine for a showcase.
 *
 * Anything missing falls through to a no-op stub so the renderer doesn't
 * crash if it calls something we haven't bothered to mock.
 */

import {
  DEMO_SETTINGS, DEMO_DOCTORS, DEMO_PATIENTS, DEMO_APPOINTMENTS, DEMO_BILLS,
  DEMO_DRUG_MASTER, DEMO_BATCHES, DEMO_WHOLESALERS, DEMO_PURCHASES,
  DEMO_PHARMACY_SALES, DEMO_DISPENSING, DEMO_CONSULTATIONS, DEMO_RX_ITEMS,
} from './demo-data';
import { LAB_CATALOG } from '../data/lab-catalog';
import { demoPriceHistory, demoProfitReport, demoSupplierReport, demoValuation, makeDemoPurchaseStore } from './demo-pharmacy-finance';
import { demoCounterSales, demoPortal, demoReceivables } from './demo-portal';
import { RADIOLOGY_CATALOG, modalityOf } from '../data/radiology-catalog';

/**
 * Injected by vite.demo.config.ts from package.json at build time, so the
 * showcase always reports the version it was built from rather than a literal
 * someone forgot to bump.
 */
declare const __DEMO_VERSION__: string;
const DEMO_VERSION = typeof __DEMO_VERSION__ === 'string' ? __DEMO_VERSION__ : 'demo';

// Full lab catalog for the demo, priced by department so the showcase looks real.
const DEMO_LAB_PRICE: Record<string, number> = {
  haematology: 200, biochemistry: 300, serology: 450, microbiology: 350,
  clinical_pathology: 150, histopathology: 900, radiology: 700,
};
const labTests = LAB_CATALOG.map((t, i) => ({
  id: i + 1, name: t.name, price: DEMO_LAB_PRICE[t.category] ?? 300,
  sample_type: t.sample_type ?? null, ref_range: t.ref_range ?? null,
  unit: t.unit ?? null, category: t.category, is_active: 1,
}));

// Mutable copies — UI mutations land here.
const settings = { ...DEMO_SETTINGS };
let doctors = [...DEMO_DOCTORS];
let patients = [...DEMO_PATIENTS];
let appointments = [...DEMO_APPOINTMENTS];
let bills = [...DEMO_BILLS];
let drugMaster = [...DEMO_DRUG_MASTER];
let batches = [...DEMO_BATCHES];
let wholesalers = [...DEMO_WHOLESALERS];
let purchases = [...DEMO_PURCHASES];
let pharmSales = [...DEMO_PHARMACY_SALES];
// Purchase bills with lines + supplier payments (the finance screens read these).
const purchaseStore = makeDemoPurchaseStore(DEMO_PURCHASES, () => wholesalers, () => drugMaster, () => batches, (b) => { batches = b; });
let dispensing = [...DEMO_DISPENSING];
let consultations = [...DEMO_CONSULTATIONS];
let rxItems = [...DEMO_RX_ITEMS];

// A few lab orders so the Laboratory screen and its printouts have something to show.
const labOrders: any[] = [0, 1, 2].map((i) => {
  const p: any = patients[i] ?? patients[0];
  const d: any = doctors[i % doctors.length];
  return {
    id: i + 1, order_number: `LAB-20261020-00${i + 1}`, appointment_id: null,
    patient_id: p.id, doctor_id: d.id,
    status: i === 0 ? 'ordered' : i === 1 ? 'sample_collected' : 'reported',
    notes: null, ordered_at: new Date(Date.now() - i * 3_600_000).toISOString().slice(0, 19).replace('T', ' '),
    patient_name: `${p.first_name} ${p.last_name}`, patient_uhid: p.uhid, doctor_name: d.name,
  };
});
// ---- Radiology demo data: a priced catalogue and a few orders in different states ----
const DEMO_RAD_PRICE: Record<string, number> = {
  xray: 300, contrast: 1500, usg: 800, doppler: 1800, ct: 3500, mri: 6500, mammography: 1500, dexa: 1200, cardiac: 500, other: 600,
};
let radTests: any[] = RADIOLOGY_CATALOG.map((t, i) => ({
  id: i + 1, name: t.name, modality: t.modality, price: DEMO_RAD_PRICE[t.modality] ?? 500, is_active: 1,
  created_at: '2026-01-01 09:00:00',
}));
const dbTime = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString().slice(0, 19).replace('T', ' ');
let radOrders: any[] = [];
let radItems: any[] = [];
(function seedRadiology() {
  const mk = (n: number, patientIdx: number, status: string, minsAgo: number, testNames: string[], extra: any = {}) => {
    const p: any = patients[patientIdx] ?? patients[0];
    const d: any = doctors[patientIdx % doctors.length];
    const id = n;
    radOrders.push({
      id, order_number: `RAD-20261020-000${n}`, appointment_id: null, patient_id: p.id, doctor_id: d.id,
      referred_by: extra.referred_by ?? null, clinical_info: extra.clinical_info ?? null, status,
      ordered_at: dbTime(minsAgo), performed_at: status !== 'ordered' ? new Date(Date.now() - (minsAgo - 20) * 60_000).toISOString() : null,
      reported_at: status === 'reported' ? new Date(Date.now() - (minsAgo - 45) * 60_000).toISOString() : null,
      reported_by: status === 'reported' ? 'Dr. R. Iyer' : null, notes: null,
    });
    let total = 0;
    testNames.forEach((name, i) => {
      const t = radTests.find((x) => x.name === name) ?? radTests[0];
      total += t.price;
      radItems.push({
        id: n * 10 + i, order_id: id, test_id: t.id, test_name: t.name, modality: t.modality, price: t.price,
        findings: status === 'reported' ? (i === 0 ? 'Both lung fields are clear. Cardiac silhouette and mediastinum are normal. Costophrenic angles are sharp. Bony thorax is unremarkable.' : 'Liver is mildly enlarged with increased echogenicity. No focal lesion. Gallbladder, CBD, spleen and both kidneys are normal.') : null,
        impression: status === 'reported' ? (i === 0 ? 'Normal chest radiograph.' : 'Grade I fatty liver.') : null,
        is_abnormal: status === 'reported' && i === 1 ? 1 : 0,
      });
    });
    // its bill
    const paid = extra.paid ? total : 0;
    bills = [...bills, {
      id: 8000 + n, bill_number: `INV/2026-27/90${n}`, appointment_id: null, patient_id: p.id, doctor_id: d.id,
      items_json: JSON.stringify(testNames.map((name) => { const t = radTests.find((x) => x.name === name) ?? radTests[0]; return { description: t.name, qty: 1, rate: t.price, amount: t.price }; })),
      subtotal: total, discount: 0, discount_type: 'flat', total, payment_mode: paid ? 'Cash' : 'Pending',
      bill_kind: 'radiology', bill_type: 'radiology', radiology_order_id: id, amount_paid: paid, status: paid ? 'paid' : 'unpaid',
      created_at: new Date(Date.now() - minsAgo * 60_000).toISOString(), patient_name: `${p.first_name} ${p.last_name}`, patient_uhid: p.uhid, doctor_name: d.name,
    } as any];
  };
  mk(1, 1, 'ordered', 25, ['X-Ray Chest PA View', 'X-Ray Knee Joint'], { referred_by: 'Ramesh Kumar', clinical_info: 'Fall from stairs, right knee pain, ? fracture', paid: true });
  mk(2, 2, 'done', 90, ['USG Whole Abdomen'], { clinical_info: 'Upper abdominal pain for 3 days' });
  mk(3, 3, 'reported', 240, ['X-Ray Chest PA View', 'USG Abdomen & Pelvis'], { referred_by: 'Meena Shetty', paid: true });
  mk(4, 0, 'ordered', 10, ['CT Brain (Plain)'], { clinical_info: 'Head injury, headache, vomiting' });
})();
const radRow = (o: any) => {
  const p: any = patients.find((x: any) => x.id === o.patient_id) ?? {};
  const d: any = doctors.find((x: any) => x.id === o.doctor_id);
  const items = radItems.filter((i) => i.order_id === o.id);
  const bill: any = bills.find((b: any) => b.radiology_order_id === o.id);
  return {
    ...o, patient_name: `${p.first_name} ${p.last_name}`, patient_uhid: p.uhid, patient_dob: p.dob, patient_gender: p.gender, patient_phone: p.phone,
    doctor_name: d?.name ?? null, test_names: items.map((i) => i.test_name).join('\u001f'),
    total: items.reduce((s, i) => s + i.price, 0),
    bill_id: bill?.id ?? null, bill_number: bill?.bill_number ?? null, bill_total: bill?.total ?? null, bill_paid: bill?.amount_paid ?? null, bill_status: bill?.status ?? null,
  };
};
const radDetail = (id: number) => { const o = radOrders.find((x) => x.id === id); return o ? { ...radRow(o), items: radItems.filter((i) => i.order_id === id) } : null; };
const radSyncBill = (orderId: number) => {
  const items = radItems.filter((i) => i.order_id === orderId && i.price > 0);
  const total = items.reduce((s, i) => s + i.price, 0);
  bills = bills.map((b: any) => b.radiology_order_id === orderId && !(b.amount_paid > 0)
    ? { ...b, subtotal: total, total, items_json: JSON.stringify(items.map((i) => ({ description: i.test_name, qty: 1, rate: i.price, amount: i.price }))) }
    : b);
};

const labItemsFor = (orderId: number) =>
  labTests.filter((t) => t.category !== 'radiology').slice(orderId * 3, orderId * 3 + 4).map((t, i) => ({
    id: orderId * 10 + i, lab_order_id: orderId, lab_test_id: t.id, test_name: t.name,
    result: orderId === 3 ? '12.4' : null, ref_range: t.ref_range, unit: t.unit, is_abnormal: 0, price: t.price,
  }));

const r = <T>(v: T): Promise<T> => Promise.resolve(v);
// Static "Services" bills the demo shows (also resolvable by the printable bill).
const MISC_DEMO_BILLS: any[] = [
        { id: 9001, bill_number: 'BL-9001', patient_name: 'Geeta Hosamani', patient_uhid: 'PT-20260427-0042', doctor_name: 'Dr. Priya Patil', payment_mode: 'Cash', total: 250, notes: 'Booster dose 2/3', items_json: JSON.stringify([{ description: 'Vaccination — TT booster', qty: 1, rate: 250, amount: 250 }]), created_at: new Date(Date.now() - 3 * 3600000).toISOString() },
        { id: 9002, bill_number: 'BL-9002', patient_name: 'Ramesh Mali', patient_uhid: 'PT-20260427-0041', doctor_name: 'Dr. A. Sharma', payment_mode: 'UPI', total: 300, notes: '', items_json: JSON.stringify([{ description: 'Wound dressing', qty: 1, rate: 300, amount: 300 }]), created_at: new Date(Date.now() - 86400000).toISOString() },
        { id: 9003, bill_number: 'BL-9003', patient_name: 'Anitha Kulkarni', patient_uhid: 'PT-20260427-0040', doctor_name: null, payment_mode: 'Cash', total: 150, notes: 'Acute asthma', items_json: JSON.stringify([{ description: 'Nebulization', qty: 1, rate: 150, amount: 150 }]), created_at: new Date(Date.now() - 2 * 86400000).toISOString() },
];

const noop = () => Promise.resolve();

function nextId(arr: { id: number }[]): number {
  return arr.reduce((mx, x) => Math.max(mx, x.id), 0) + 1;
}

function searchPatients(q: string): any[] {
  const needle = q.toLowerCase();
  return patients.filter((p) =>
    p.first_name.toLowerCase().includes(needle) ||
    p.last_name.toLowerCase().includes(needle) ||
    p.uhid.toLowerCase().includes(needle) ||
    p.phone.includes(needle)
  ).slice(0, 50);
}

function buildAppointmentRow(a: any): any {
  const p = patients.find((x) => x.id === a.patient_id);
  const d = doctors.find((x) => x.id === a.doctor_id);
  return {
    ...a,
    patient_name: p ? `${p.first_name} ${p.last_name}` : a.patient_name || '',
    patient_uhid: p?.uhid || a.patient_uhid,
    patient_dob: p?.dob || a.patient_dob,
    patient_gender: p?.gender || a.patient_gender,
    patient_phone: p?.phone || a.patient_phone,
    patient_blood_group: p?.blood_group ?? a.patient_blood_group,
    patient_created_at: p?.created_at || a.patient_created_at,
    doctor_name: d?.name || a.doctor_name,
    doctor_specialty: d?.specialty || a.doctor_specialty,
    doctor_room: d?.room_number || a.doctor_room,
  };
}

// ============================================================
//   The mock — shape mirrors src/preload.ts as closely as needed.
// ============================================================
export function createMockElectronAPI(): any {
  return {
    auth: {
      login: () => r({ id: 0, username: 'staff', role: 'staff', display_name: 'Demo', doctor_id: null }),
      createUser: () => r({} as any),
      changePassword: () => r(true),
      list: () => r([]),
      update: () => r([]),
      log: noop,
    },
    admin: {
      verifyPassword: (pwd: string) => r(pwd === '1234' || pwd === 'Sunil@1918'),
      isDefaultAdminPassword: () => r(false),
      setInitialAdminPassword: () => r({ ok: true }),
      changePassword: () => r({ ok: true }),
      resetAuditLog: () => r({ ok: true }),
      resetNotificationLog: () => r({ ok: true }),
      deletePatient: () => r({ ok: true }),
      deletePatients: () => r({ ok: true }),
      deleteAppointment: () => r({ ok: true }),
    },
    audit: {
      list: () => r([]),
    },
    // First-run guide. The showcase clinic is already set up, so the guide only appears when asked for: open the demo with
    // ?setup in the address, or press "Open the setup guide" in Settings.
    setup: (() => {
      let status: 'pending' | 'skipped' | 'done' = (() => { try { return new URLSearchParams(location.search).has('setup') ? 'pending' : 'done'; } catch { return 'done'; } })();
      const steps: Record<string, 'todo' | 'done' | 'skipped'> = { clinic: 'todo', doctors: 'todo', fees: 'todo', staff: 'todo', pharmacy: 'todo', inpatient: 'todo' };
      const snap = () => ({
        show: status === 'pending', status, clinic_named: !!(settings as any).clinic_name, clinic_name: String((settings as any).clinic_name || ''),
        existing_clinic: false, steps: { ...steps } as any, reminder: status === 'skipped' && Object.values(steps).some((x) => x !== 'done'),
      });
      return {
        status: () => r(snap()),
        markStep: (step: string, outcome: 'done' | 'skipped') => { if (!(steps[step] === 'done' && outcome === 'skipped')) steps[step] = outcome; return r({ ok: true as const, status: snap() }); },
        setStatus: (st: 'pending' | 'skipped' | 'done') => {
          if (st !== 'pending' && !(settings as any).clinic_name) return r({ ok: false as const, error: 'Enter the clinic name first — it prints on every bill, slip and report, and the software cannot be used without it.' });
          status = st; return r({ ok: true as const, status: snap() });
        },
      };
    })(),
    settings: {
      // Honour a login-requirement toggle across reloads (the mock is otherwise
      // in-memory) so the sign-in gate can be demonstrated in the showcase.
      get: () => {
        try { const m = localStorage.getItem('caredesk-require-login'); if (m !== null) (settings as any).require_login = m === '1'; } catch { /* ignore */ }
        return r(settings);
      },
      save: (patch: any) => { Object.assign(settings, patch); return r(settings); },
    },
    patients: {
      search: (q: string) => r(searchPatients(q || '')),
      allList: (f: any = {}) => {
        const q = (f.q || '').toLowerCase();
        let rows = patients.filter((p: any) => !q ||
          `${p.first_name} ${p.last_name} ${p.uhid} ${p.phone} ${p.place || ''}`.toLowerCase().includes(q));
        const s = f.sort || 'registered_desc';
        rows = rows.slice().sort((a: any, b: any) =>
          s === 'name_asc' ? `${a.first_name}`.localeCompare(b.first_name)
          : s === 'name_desc' ? `${b.first_name}`.localeCompare(a.first_name)
          : s === 'age_desc' ? String(a.dob || '').localeCompare(String(b.dob || ''))
          : s === 'age_asc' ? String(b.dob || '').localeCompare(String(a.dob || ''))
          : s === 'registered_asc' ? a.id - b.id
          : b.id - a.id);
        return r({ rows: rows.map((p: any) => ({ ...p, last_visit: null, visit_count: 0 })), total: patients.length });
      },
      list: () => r(patients.slice(0, 50)),
      get: (id: number) => r(patients.find((x) => x.id === id) || null),
      create: (input: any) => {
        const id = nextId(patients);
        const created = {
          id, uhid: `MMC-${String(id).padStart(4, '0')}`, ...input,
          created_at: new Date().toISOString(),
        };
        patients = [created, ...patients];
        return r(created);
      },
      update: (id: number, input: any) => {
        patients = patients.map((p) => p.id === id ? { ...p, ...input } : p);
        return r(patients.find((x) => x.id === id));
      },
      knownPlaces: () => r({ places: ['Shantipur', 'Gadag', 'Lakshmeshwar'], districts: ['Gadag', 'Haveri'] }),
      recentAppointments: (id: number, limit = 5) => r(appointments.filter((a) => a.patient_id === id).slice(0, limit)),
      log: (filter: any) => {
        const from = filter?.from || '';
        const to = filter?.to || '9999';
        const rows = appointments
          .filter((a) => a.appointment_date >= from && a.appointment_date <= to)
          .map(buildAppointmentRow);
        return r({
          rows,
          intel: {
            totalVisits: rows.length,
            uniquePatients: new Set(rows.map((x) => x.patient_id)).size,
            repeatVisits: 0,
            revenue: bills.filter((b) => rows.some((x) => x.id === b.appointment_id)).reduce((s, b) => s + b.total, 0),
            avgPerDay: 0,
            peakDay: '',
            byDoctor: doctors.map((d) => ({ doctor: d.name, specialty: d.specialty, count: rows.filter((x) => x.doctor_id === d.id).length })).filter((x) => x.count > 0),
            byStatus: [],
          },
        });
      },
    },
    doctors: {
      list: (activeOnly = true) => r(activeOnly ? doctors.filter((d) => d.is_active === 1) : doctors),
      get: (id: number) => r(doctors.find((x) => x.id === id)),
      create: (d: any) => { const created = { id: nextId(doctors), ...d }; doctors = [...doctors, created]; return r(created); },
      update: (id: number, d: any) => { doctors = doctors.map((x) => x.id === id ? { ...x, ...d } : x); return r(doctors.find((x) => x.id === id)); },
      dependents: () => r({ counts: { appointments: 0, consultations: 0, lab_orders: 0, ip_admissions: 0 }, total: 0 }),
      delete: (id: number) => { doctors = doctors.filter((x) => x.id !== id); return r({ ok: true, mode: 'hard_deleted', doctorName: 'Doctor' }); },
      deactivate: (id: number) => { doctors = doctors.map((x) => x.id === id ? { ...x, is_active: 0 } : x); return r({ ok: true }); },
    },
    appointments: {
      list: (filter: any = {}) => {
        let out = appointments;
        if (filter.date) out = out.filter((a) => a.appointment_date === filter.date);
        if (filter.doctor_id) out = out.filter((a) => a.doctor_id === filter.doctor_id);
        return r(out.map(buildAppointmentRow));
      },
      bookedSlots: (doctor_id: number, date: string) => r(appointments.filter((a) => a.doctor_id === doctor_id && a.appointment_date === date).map((a) => ({ appointment_time: a.appointment_time }))),
      create: (input: any) => {
        const id = nextId(appointments);
        const created: any = {
          id, ...input,
          token_number: appointments.filter((a) => a.appointment_date === input.appointment_date).length + 1,
          consultation_token: null,
          status: 'Done',
          created_at: new Date().toISOString(),
        };
        appointments = [...appointments, created];
        return r(buildAppointmentRow(created));
      },
      get: (id: number) => {
        const a = appointments.find((x) => x.id === id);
        return r(a ? buildAppointmentRow(a) : undefined);
      },
      updateStatus: (id: number, status: any) => {
        appointments = appointments.map((a) => a.id === id ? { ...a, status } : a);
        return r(buildAppointmentRow(appointments.find((a) => a.id === id)));
      },
    },
    bills: {
      create: (input: any) => {
        const id = nextId(bills);
        const total = (input.items || []).reduce((s: number, it: any) => s + (it.amount || 0), 0);
        const pt: any = patients.find((p: any) => p.id === input.patient_id);
        const created: any = {
          id, bill_number: `BL-${String(id).padStart(4, '0')}`, ...input, subtotal: total, total,
          items_json: JSON.stringify(input.items || []),
          patient_name: pt ? `${pt.first_name} ${pt.last_name}` : undefined,
          patient_uhid: pt?.uhid,
          created_at: new Date().toISOString(),
        };
        bills = [...bills, created];
        return r(created);
      },
      list: () => r(bills.map((b: any) => ({ ...b, patient_uhid: b.patient_uhid ?? patients.find((p: any) => p.id === b.patient_id)?.uhid }))),
      pendingForBilling: () => r([]),
    },
    // What the printable bill (BillPrint) loads: the bill header, its lines and totals.
    billing: {
      cancel: (billId: number, reason: string) => r({ ok: true as const, bill_number: `INV-DEMO-${billId}`, refunded: 0 }),
      patientPortal: (patientId: number) => r(demoPortal(patientId, { patients, bills, pharmSales, appointments, doctors })),
      createOrderBill: (kind: string, orderId: number) =>
        r({ ok: true, bill_id: 900000 + orderId, bill_number: `INV-DEMO-${kind === 'lab' ? 'L' : 'R'}${orderId}`, total: kind === 'lab' ? 950 : 1500 } as any),
      previewById: (id: number) => {
        const b: any = bills.find((x: any) => x.id === id) ?? MISC_DEMO_BILLS.find((x: any) => x.id === id) ?? bills[0];
        const pt: any = patients.find((p: any) => p.id === b?.patient_id) ?? patients[0];
        const lines: any[] = (() => { try { return JSON.parse(b?.items_json || '[]'); } catch { return []; } })();
        const items = lines.map((l: any, i: number) => ({
          id: i + 1, description: l.description, qty: l.qty, rate: l.rate, amount: l.amount,
          is_taxable: 0, hsn_sac: null, cgst: 0, sgst: 0,
        }));
        const subtotal = items.reduce((s: number, it: any) => s + it.amount, 0);
        return r({
          bill: {
            ...b,
            patient_name: b?.patient_name ?? `${pt.first_name} ${pt.last_name}`,
            patient_uhid: pt.uhid, patient_dob: pt.dob, patient_gender: pt.gender,
            patient_phone: pt.phone, patient_address: pt.address,
          },
          items,
          totals: {
            subtotal, discountValue: 0, exemptTotal: subtotal, taxableTotal: 0,
            cgstTotal: 0, sgstTotal: 0, roundOff: 0, total: subtotal, isTaxInvoice: false,
          },
        });
      },
      previewAdmission: () => r({ bill: null, items: [], totals: null }),
      pay: (billId: number, amount: number, mode: string) => {
        bills = bills.map((b: any) => b.id === billId ? { ...b, amount_paid: (b.amount_paid || 0) + amount, payment_mode: mode, status: (b.amount_paid || 0) + amount >= b.total - 0.01 ? 'paid' : 'part_paid' } : b);
        return r({ ok: true });
      },
    },
    followup: {
      checkEligibility: () => r({
        enabled: true, eligible: false, relaxed_eligible: false,
        free_remaining: 0, total_free: 2, valid_till: null,
        parent_appt_id: null, parent_appt_date: null,
        reason: 'no_paid_visit',
      }),
      summaryForAppointment: () => r({
        enabled: true, mode: 'today_paid' as const,
        doctor_name: 'Dr. A. Sharma', free_remaining: 2,
        valid_till: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      }),
    },
    templates: {
      list: () => r([
        { id: 1, name: 'General', specialty_hint: 'General medicine / default', sections: [
          { key: 'history', title: 'Chief Complaints / History', type: 'textarea', height_mm: 55, printed: true },
          { key: 'examination', title: 'Examination', type: 'textarea', height_mm: 60, printed: true },
          { key: 'impression', title: 'Impression / Diagnosis', type: 'textarea', height_mm: 22, printed: true },
          { key: 'advice', title: 'Advice / Prescription (Rx)', type: 'textarea', height_mm: 60, printed: true },
        ]},
      ]),
      saveAll: () => r({ ok: true }),
    },
    misc: {
      create: (input: any) => {
        const id = nextId(bills);
        const created: any = {
          id, bill_number: `BL-${String(id).padStart(4, '0')}`,
          patient_id: input.patient_id, doctor_id: input.doctor_id,
          patient_name: 'Demo Patient', patient_uhid: 'PT-DEMO-0001',
          doctor_name: input.doctor_id ? 'Dr. A. Sharma' : null,
          items_json: JSON.stringify([{ description: input.description, qty: 1, rate: input.amount, amount: input.amount }]),
          subtotal: input.amount, total: input.amount, payment_mode: input.payment_mode,
          notes: input.notes, bill_kind: 'misc',
          created_at: new Date().toISOString(),
        };
        bills = [...bills, created];
        return r(created);
      },
      list: () => r([...[...bills].filter((x: any) => x.bill_kind === 'misc').reverse(), ...MISC_DEMO_BILLS]),
      summary: () => r({
        from: '2026-04-01', to: '2026-04-27',
        count: 18, revenue: 4250,
        topServices: [
          { service: 'Vaccination', count: 6, revenue: 1500 },
          { service: 'Wound Dressing', count: 5, revenue: 1500 },
          { service: 'Nebulization', count: 4, revenue: 600 },
        ],
        byDoctor: [
          { doctor_name: 'Dr. Priya Patil', doctor_color: '#0ea5e9', count: 8, revenue: 2000 },
          { doctor_name: 'Dr. A. Sharma', doctor_color: '#10b981', count: 6, revenue: 1750 },
          { doctor_name: null, doctor_color: null, count: 4, revenue: 500 },
        ],
      }),
      trend: () => r(
        Array.from({ length: 27 }, (_, i) => {
          const d = new Date(Date.now() - (26 - i) * 86400000).toISOString().slice(0, 10);
          const count = Math.floor(Math.random() * 4);
          return { day: d, count, revenue: count * (200 + Math.floor(Math.random() * 300)) };
        }).filter((x) => x.count > 0)
      ),
    },
    consultations: {
      getByAppointment: (apptId: number) => r(consultations.find((c) => c.appointment_id === apptId) || null),
      save: () => r({ ok: true }),
    },
    rx: {
      getByAppointment: (apptId: number) => r(rxItems.filter((x) => x.appointment_id === apptId)),
      saveAll: (apptId: number, items: any[]) => {
        rxItems = rxItems.filter((x) => x.appointment_id !== apptId).concat(items.map((it, i) => ({ ...it, id: 9000 + i, appointment_id: apptId } as any)));
        return r(rxItems.filter((x) => x.appointment_id === apptId));
      },
    },
    lab: {
      listTests: (activeOnly = true) => r(activeOnly ? labTests.filter((t) => t.is_active === 1) : labTests),
      loadStandardCatalog: () => r({ ok: true, added: 0, total: labTests.length }),
      listOrders: () => r(labOrders),
      getOrderItems: (id: number) => r(labItemsFor(id)),
      createOrder: () => r({} as any),
      updateOrderStatus: () => r({} as any),
      updateResults: () => r([]),
    },
    radiology: {
      listTests: (activeOnly = true) => r(activeOnly ? radTests.filter((t) => t.is_active === 1) : radTests),
      upsertTest: (t: any) => {
        if (t.id) { radTests = radTests.map((x) => x.id === t.id ? { ...x, ...t } : x); return r({ ok: true, test: radTests.find((x) => x.id === t.id) }); }
        const id = nextId(radTests); const row = { id, modality: modalityOf(t.name || ''), price: 0, is_active: 1, created_at: dbTime(0), ...t };
        radTests = [...radTests, row]; return r({ ok: true, test: row });
      },
      bulkDeleteTests: (ids: number[]) => { radTests = radTests.filter((t) => !ids.includes(t.id)); return r({ ok: true, deleted: ids.length, deactivated: 0 }); },
      loadStandardCatalog: () => r({ ok: true, added: 0, total: radTests.length }),
      listOrders: (f: any = {}) => {
        let rows = radOrders.map(radRow);
        if (f.status === 'open') rows = rows.filter((o) => o.status === 'ordered' || o.status === 'done');
        else if (f.status) rows = rows.filter((o) => o.status === f.status);
        if (f.patient_id) rows = rows.filter((o) => o.patient_id === f.patient_id);
        if (f.q) { const n = String(f.q).toLowerCase(); rows = rows.filter((o) => `${o.patient_name} ${o.patient_uhid} ${o.order_number}`.toLowerCase().includes(n)); }
        return r(rows.sort((a, b) => b.id - a.id));
      },
      getOrder: (id: number) => r(radDetail(id)),
      createOrder: (p: any) => {
        const id = nextId(radOrders);
        const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const appt: any = p.appointment_id ? appointments.find((a) => a.id === p.appointment_id) : null;
        radOrders = [...radOrders, { id, order_number: `RAD-${day}-${String(id).padStart(4, '0')}`, appointment_id: p.appointment_id ?? null, patient_id: p.patient_id, doctor_id: p.doctor_id ?? appt?.doctor_id ?? null, referred_by: p.referred_by ?? (appt as any)?.referred_by ?? null, clinical_info: p.clinical_info ?? null, status: 'ordered', ordered_at: dbTime(0), performed_at: null, reported_at: null, reported_by: null, notes: null }];
        const rows = (p.items || []).map((it: any, i: number) => { const t = radTests.find((x) => x.id === it.test_id); return { id: id * 100 + i, order_id: id, test_id: t?.id ?? null, test_name: t?.name ?? it.test_name, modality: t?.modality ?? 'other', price: it.price ?? t?.price ?? 0, findings: null, impression: null, is_abnormal: 0 }; });
        radItems = [...radItems, ...rows];
        const total = rows.reduce((s: number, x: any) => s + x.price, 0);
        if (total > 0) {
          const pt: any = patients.find((x) => x.id === p.patient_id);
          bills = [...bills, { id: 8100 + id, bill_number: `INV/2026-27/91${id}`, appointment_id: p.appointment_id ?? null, patient_id: p.patient_id, items_json: JSON.stringify(rows.map((x: any) => ({ description: x.test_name, qty: 1, rate: x.price, amount: x.price }))), subtotal: total, discount: 0, discount_type: 'flat', total, payment_mode: 'Pending', bill_kind: 'radiology', bill_type: 'radiology', radiology_order_id: id, amount_paid: 0, status: 'unpaid', created_at: new Date().toISOString(), patient_name: pt ? `${pt.first_name} ${pt.last_name}` : '', patient_uhid: pt?.uhid } as any];
        }
        return r({ ok: true, order: radDetail(id) });
      },
      addItems: (orderId: number, items: any[]) => {
        const rows = items.map((it, i) => { const t = radTests.find((x) => x.id === it.test_id); return { id: orderId * 100 + 50 + radItems.length + i, order_id: orderId, test_id: t?.id ?? null, test_name: t?.name ?? it.test_name, modality: t?.modality ?? 'other', price: it.price ?? t?.price ?? 0, findings: null, impression: null, is_abnormal: 0 }; });
        radItems = [...radItems, ...rows]; radSyncBill(orderId);
        return r({ ok: true, added: rows.length, billChanged: true, note: 'Bill updated.', order: radDetail(orderId) });
      },
      removeItem: (orderId: number, itemId: number) => { radItems = radItems.filter((i) => i.id !== itemId); radSyncBill(orderId); return r({ ok: true, billChanged: true, note: 'Bill updated.', order: radDetail(orderId) }); },
      updateStatus: (orderId: number, status: string) => {
        radOrders = radOrders.map((o) => o.id === orderId ? { ...o, status, performed_at: o.performed_at ?? new Date().toISOString() } : o);
        return r({ ok: true, order: radDetail(orderId) });
      },
      saveReport: (orderId: number, items: any[], opts: any = {}) => {
        for (const it of items) radItems = radItems.map((x) => x.id === it.id ? { ...x, ...(it.findings !== undefined ? { findings: it.findings } : {}), ...(it.impression !== undefined ? { impression: it.impression } : {}), ...(it.is_abnormal !== undefined ? { is_abnormal: it.is_abnormal } : {}) } : x);
        if (opts.finalize) radOrders = radOrders.map((o) => o.id === orderId ? { ...o, status: 'reported', reported_at: new Date().toISOString(), reported_by: opts.reportedBy ?? o.reported_by, performed_at: o.performed_at ?? new Date().toISOString() } : o);
        else if (opts.reportedBy) radOrders = radOrders.map((o) => o.id === orderId ? { ...o, reported_by: opts.reportedBy } : o);
        return r({ ok: true, order: radDetail(orderId) });
      },
      cancelOrder: (orderId: number) => { radOrders = radOrders.map((o) => o.id === orderId ? { ...o, status: 'cancelled' } : o); bills = bills.map((b: any) => b.radiology_order_id === orderId && !(b.amount_paid > 0) ? { ...b, status: 'cancelled' } : b); return r({ ok: true, note: 'Order cancelled.', order: radDetail(orderId) }); },
    },
    pharmacy: {
      listDrugs: (filter: any = {}) => {
        let list = drugMaster;
        if (filter.activeOnly !== false) list = list.filter((d) => d.is_active === 1);
        if (filter.q) {
          const q = String(filter.q).toLowerCase();
          list = list.filter((d) => d.name.toLowerCase().includes(q) || (d.generic_name || '').toLowerCase().includes(q));
        }
        return r(list.map((d) => ({
          ...d,
          mrp: d.default_mrp,
          stock_qty: batches.filter((b) => b.drug_master_id === d.id && b.is_active === 1).reduce((s, b) => s + b.qty_remaining, 0),
          batch: batches.find((b) => b.drug_master_id === d.id)?.batch_no,
          expiry: batches.find((b) => b.drug_master_id === d.id)?.expiry,
        } as any)));
      },
      listBatches: (id: number) => r(batches.filter((b) => b.drug_master_id === id)),
      upsertDrug: (d: any) => {
        if (d.id) drugMaster = drugMaster.map((x) => x.id === d.id ? { ...x, ...d } : x);
        else { const id = nextId(drugMaster); d = { id, ...d }; drugMaster = [...drugMaster, d]; }
        return r(d);
      },
      upsertBatch: (b: any) => {
        if (b.id) batches = batches.map((x) => x.id === b.id ? { ...x, ...b } : x);
        else { const id = nextId(batches); b = { id, ...b }; batches = [...batches, b]; }
        return r(b);
      },
      bulkDeleteDrugs: () => r({ ok: true, hardDeleted: 0, softDeleted: 0, results: [] }),
      alerts: () => r({ lowStock: [], expiringSoon: batches.filter((b) => {
        const days = Math.round((new Date(b.expiry).getTime() - Date.now()) / 86400000);
        return days >= 0 && days <= 90;
      }).slice(0, 10) }),
      pendingRx: () => r(appointments.filter((a) => rxItems.some((x) => x.appointment_id === a.id)).slice(0, 10).map((a) => ({ ...buildAppointmentRow(a), rx_count: rxItems.filter((x) => x.appointment_id === a.id).length }))),
      getAppointmentRx: (id: number) => r(rxItems.filter((x) => x.appointment_id === id)),
      sell: (payload: any) => {
        const total = (payload.items || []).reduce((s: number, it: any) => s + it.qty * it.rate, 0);
        const id = nextId(pharmSales);
        // Medicines on credit: only what was paid now counts as received; the rest stays owing.
        const paidNow = payload.credit ? Math.min(total, Math.max(0, Number(payload.paid_now || 0))) : total;
        const onCredit = payload.credit && paidNow < total ? 1 : 0;
        const created: any = {
          id, sale_number: `PHX-${String(id).padStart(5, '0')}`, ...payload, subtotal: total, total,
          payment_mode: payload.ipd_admission_id ? 'IPD-bill' : onCredit && paidNow === 0 ? 'Credit' : payload.payment_mode,
          amount_paid: onCredit ? paidNow : total, on_credit: onCredit, created_at: new Date().toISOString(),
        };
        pharmSales = [...pharmSales, created];
        return r(created);
      },
      patientAdmission: (patientId: number) => r(patientId % 5 === 0
        ? { admission_id: 9000 + patientId, admission_number: `IP-DEMO-${patientId}`, ward: 'General ward', bed_number: `B${patientId % 9 + 1}`, discharge_status: 'none' }
        : null),
      payCredit: (saleId: number, p: any) => {
        const sale: any = pharmSales.find((x: any) => x.id === saleId);
        const amt = Number(p?.amount) || 0;
        if (!sale) return r({ ok: false as const, error: 'That pharmacy sale was not found. Refresh the list and try again.' });
        const due = Math.max(0, (sale.total ?? 0) - (sale.amount_paid ?? sale.total ?? 0));
        if (amt <= 0) return r({ ok: false as const, error: 'Enter an amount above zero.' });
        if (amt > due + 0.001) return r({ ok: false as const, error: `That is more than the ${due.toFixed(2)} still owed. Enter ${due.toFixed(2)} or less.` });
        pharmSales = pharmSales.map((x: any) => x.id === saleId ? { ...x, amount_paid: (x.amount_paid ?? x.total) + amt } : x);
        return r({ ok: true as const, duplicate: false, sale_id: saleId, due: Math.max(0, due - amt) });
      },
      saleDetail: (id: number) => {
        const sale: any = pharmSales.find((x: any) => x.id === id) ?? pharmSales[0];
        const pt: any = patients.find((p: any) => p.id === sale?.patient_id);
        const rows = dispensing.filter((d: any) => d.sale_id === sale?.id).slice(0, 12);
        const items = (rows.length ? rows : dispensing.slice(0, 5)).map((d: any, i: number) => {
          const m: any = drugMaster.find((x: any) => x.id === d.drug_master_id);
          return {
            id: i + 1, drug_name: m?.name ?? 'Medicine', qty: d.qty ?? 1, rate: d.rate ?? 10,
            amount: (d.qty ?? 1) * (d.rate ?? 10), drug_master_id: d.drug_master_id,
            generic_name: m?.generic_name, strength: m?.strength, form: m?.form, schedule: m?.schedule ?? 'OTC',
            batches: `${d.batch_no || 'B1'} (exp ${d.expiry || '2027-12-31'})`,
          };
        });
        const subtotal = items.reduce((s: number, it: any) => s + it.amount, 0);
        return r({
          ...sale, subtotal, total: sale?.total ?? subtotal, discount: sale?.discount ?? 0, items,
          patient_name: pt ? `${pt.first_name} ${pt.last_name}` : null, patient_uhid: pt?.uhid ?? null,
          patient_phone: pt?.phone ?? null, patient_address: pt?.address ?? null,
        });
      },
      counterSales: (f: any) => r(demoCounterSales(f || {}, { patients, bills, pharmSales, appointments, doctors })),
      costSummary: () => r({ batches: 12, units_in_stock: 640, value_in_stock: 18450, past_sale_units: 95, past_sale_slices: 31 }),
      clearManualCost: () => r({ ok: true, batches: 12, register_rows: 0 } as any),
      listSales: () => r(pharmSales.map((s) => ({ ...s, patient_name: patients.find((p) => p.id === s.patient_id)?.first_name || null, patient_uhid: patients.find((p) => p.id === s.patient_id)?.uhid || null }))),
      recordCustomSale: (payload: any) => {
        const id = nextId(pharmSales);
        const total = Math.max(0, Number(payload.total_amount || 0));
        const sn = `PHX-CUST-${String(id).padStart(4, '0')}`;
        const created: any = {
          id, sale_number: sn, patient_id: payload.patient_id ?? null,
          appointment_id: null, subtotal: total, discount: 0, total,
          payment_mode: payload.payment_mode || 'Cash', sold_by: payload.notes || null,
          created_at: new Date().toISOString(),
          patient_name: patients.find((p) => p.id === payload.patient_id)?.first_name || null,
          patient_uhid: patients.find((p) => p.id === payload.patient_id)?.uhid || null,
        };
        pharmSales = [...pharmSales, created];
        return r(created);
      },
    },
    wholesalers: {
      list: () => r(wholesalers),
      upsert: (w: any) => { if (w.id) wholesalers = wholesalers.map((x) => x.id === w.id ? { ...x, ...w } : x); else { const id = nextId(wholesalers); w = { id, ...w }; wholesalers = [...wholesalers, w]; } return r(w); },
      delete: (id: number) => { wholesalers = wholesalers.filter((x) => x.id !== id); return r({ ok: true }); },
    },
    purchases: {
      list: (filter: any) => r(purchaseStore.list(filter || {}) as any),
      get: (id: number) => r(purchaseStore.get(id) as any),
      create: (payload: any) => r(purchaseStore.create(payload) as any),
      addPayment: (id: number, p: any) => r(purchaseStore.addPayment(id, p) as any),
      attachScan: () => r({ ok: true }),
    },
    dispensing: { register: () => r(dispensing) },
    stock: { register: () => r(batches.map((b) => ({ ...b, days_to_expiry: Math.round((new Date(b.expiry).getTime() - Date.now()) / 86400000) }))) },
    purchasesReport: { register: () => r(purchaseStore.all().map((p) => ({ ...p, wholesaler_gstin: null, line_count: p.items.length })) as any) },
    notifications: { list: () => r([]) },
    ip: { list: () => r([]), admit: () => r({} as any), discharge: () => r({} as any) },
    app: {
      getClinicName: () => r(settings.clinic_name),
      forceQuit: noop,
      openExternal: (url: string) => { window.open(url, '_blank'); return r({ ok: true }); },
      // Demo runs in a real browser (secure https) where navigator.clipboard
      // works, so the renderer's copyText() helper falls through to it. Report
      // "not handled" here so the helper uses the browser clipboard path.
      copyText: (_text: string) => r({ ok: false, error: 'demo' }),
      setAutoLaunch: () => r({ ok: false, reason: 'Demo mode — no OS access.' }),
      getAutoLaunchStatus: () => r({ supported: false, isPackaged: false, registered: false, exePath: null, reason: 'Demo mode (browser).' }),
      onCloseRequested: () => () => {},
      onReminderTick: () => () => {},
      onUsbReminderTick: () => () => {},
    },
    reports: {
      run: ({ kind }: any) => {
        // Generate a tiny realistic dummy result per report kind.
        if (kind === 'daily_collection') return r(Array.from({ length: 7 }, (_, i) => ({ day: `2026-04-${20 + i}`, bills: 9, revenue: 3500, cash: 1200, card: 800, upi: 1500, pharmacy_sales: 6, pharmacy: 2100, received: 5600 })));
        if (kind === 'doctor_performance') return r(doctors.map((d) => ({ doctor: d.name, visits: 20 + Math.floor(Math.random() * 30), unique_patients: 18, revenue: 12000 })));
        if (kind === 'top_diagnoses') return r([{ impression: 'Acute viral URI', count: 18 }, { impression: 'Osteoarthritis', count: 11 }, { impression: 'GERD', count: 7 }]);
        if (kind === 'top_drugs') return r(drugMaster.slice(0, 8).map((d) => ({ drug_name: d.name, units: 50 + Math.floor(Math.random() * 100), revenue: 800 })));
        if (kind === 'new_patients') return r(Array.from({ length: 7 }, (_, i) => ({ day: `2026-04-${20 + i}`, count: 3 + Math.floor(Math.random() * 8) })));
        return r([]);
      },
    },
    license: {
      status: () => r({ state: 'dev', ok: true, readOnly: false, needsActivation: false, daysLeft: null, graceDaysLeft: null, reminder: 'none', modules: ['reception', 'opd', 'pharmacy', 'ipd', 'lab', 'peds', 'whatsapp', 'whatsapp_pro', 'analytics'], payload: { expires: '2027-08-20', edition: 'Demo', modules: ['reception', 'opd', 'pharmacy', 'ipd', 'lab', 'peds', 'whatsapp', 'whatsapp_pro', 'analytics'] }, contact: { name: '', phone: '', email: '' }, hardwareId: 'DEMO-HARDWARE-ID', message: '', onlineAvailable: false }),
      machineId: () => r('DEMO-MACHINE'),
      activate: () => r({ ok: true }),
      activateOnline: () => r({ ok: true }),
      onState: () => () => { /* no-op unsubscribe */ },
    },
    backup: {
      now: () => r({ path: '(demo)', bundleDir: '(demo)', totalBundles: 0, documentCount: 0 }),
      nowTo: () => r({ ok: true }),
      list: () => r([]),
      open: noop,
      status: () => r({ lastBackupAt: null, lastBackupName: null, totalBackups: 0, dir: '(demo)' }),
      detectCloudFolders: () => r({ ok: true, folders: [{ provider: 'Google Drive', path: '/Users/demo/Google Drive' }, { provider: 'OneDrive', path: '/Users/demo/OneDrive' }] }),
      useCloudFolder: () => r({ ok: false, error: 'Cloud backup is set up on the installed app, not the demo.' }),
      quitAfter: () => r({ ok: false, path: '' }),
      restore: () => r({ ok: false, error: 'Demo mode — no DB to restore.' }),
      previewRestore: () => r({ ok: false, error: 'Demo mode' }),
    },
    dialog: {
      pickFolder: () => r(null),
      pickFile: () => r(null),
    },
    updates: {
      state: () => r({ state: 'idle', appVersion: DEMO_VERSION, isPackaged: false }),
      checkNow: () => r({ ok: false, isPackaged: false }),
      installNow: () => r({ ok: false }),
      onState: () => () => {},
      onPromptInstall: () => () => {},
    },
    network: {
      status: () => r({ mode: 'local', listenPort: 4321, serverUrl: '', hasSecret: false, running: false, port: 0, clients: 0, ipcChannels: 0, appVersion: DEMO_VERSION }),
      applyMode: () => r({ ok: true, running: false, port: 0, clients: 0, ipcChannels: 0 }),
      probe: () => r({ ok: false, error: 'Demo build — network mode not available in showcase' }),
      joinCode: () => r({ code: null, expiresAt: null, lanIp: null, port: 0 }),
      regenJoinCode: () => r({ ok: false, error: 'Demo build — only available in installed app' }),
      discover: () => r([]),
      pair: () => r({ ok: false, error: 'Demo build — pairing only works in installed app' }),
    },
    finance: {
      summary: () => {
        const totalAll = bills.reduce((s, b) => s + b.total, 0);
        const today = totalAll * 0.04;
        const nBills = bills.length || 1;
        const maxBill = bills.reduce((m, b) => Math.max(m, b.total), 0);
        return r({
          today: { total: today, count: 8, delta: 0.12, byMode: [{ payment_mode: 'Cash', total: today * 0.55, count: 4 }, { payment_mode: 'UPI', total: today * 0.35, count: 3 }, { payment_mode: 'Card', total: today * 0.1, count: 1 }] },
          yesterday: { total: today * 0.85, count: 7 },
          week: { total: totalAll * 0.18, count: 42, delta: 0.125 },
          prevWeek: { total: totalAll * 0.16, count: 38 },
          month: { total: totalAll * 0.55, count: 180, delta: 0.1 },
          prevMonth: { total: totalAll * 0.5, count: 165 },
          allTime: { total: totalAll, count: nBills, avg: Math.round(totalAll / nBills), max: maxBill },
          range: {
            bills: { total: totalAll * 0.7, count: Math.round(nBills * 0.7) },
            pharma: { total: totalAll * 0.3, count: Math.round(nBills * 0.3) },
            pharmaSplit: { patient: { total: totalAll * 0.22, count: Math.round(nBills * 0.2) }, guest: { total: totalAll * 0.08, count: Math.round(nBills * 0.1) } },
          },
          byDay: Array.from({ length: 14 }, (_, i) => ({ day: new Date(Date.now() - (13 - i) * 86400000).toISOString().slice(0, 10), total: 1500 + Math.floor(Math.random() * 4000) })),
          byMonth: Array.from({ length: 6 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, total: 30000 + Math.floor(Math.random() * 30000) })),
          // Same shape as the real summary: wd = '0'..'6' (Sun..Sat), hr = '08'..'21'.
          byWeekday: [0, 1, 2, 3, 4, 5, 6].map((wd) => ({ wd: String(wd), total: 5000 + Math.floor(Math.random() * 8000), count: 10 + wd })),
          byHour: Array.from({ length: 14 }, (_, i) => ({ hr: String(8 + i).padStart(2, '0'), total: 500 + Math.floor(Math.random() * 4000), count: 3 + i })),
          byDoctor: doctors.map((d) => ({ doctor: d.name, count: 10 + Math.floor(Math.random() * 30), total: 5000 + Math.floor(Math.random() * 25000) })),
          byMode: [{ payment_mode: 'Cash', total: totalAll * 0.5, count: 60 }, { payment_mode: 'UPI', total: totalAll * 0.35, count: 30 }, { payment_mode: 'Card', total: totalAll * 0.15, count: 10 }],
          byPlace: ['Shantipur', 'Gadag', 'Lakshmeshwar', 'Naregal', 'Annigeri'].map((p) => ({ place: p, total: 3000 + Math.floor(Math.random() * 12000) })),
          topPatients: patients.slice(0, 10).map((p, i) => ({ name: `${p.first_name} ${p.last_name}`, uhid: p.uhid, total: 5000 - i * 300, bills: Math.max(1, 6 - Math.floor(i / 2)) })),
        });
      },
    },
    origin: {
      summary: () => r({
        totalVisits: appointments.length,
        uniquePatients: new Set(appointments.map((a) => a.patient_id)).size,
        missingPlace: 4,
        byPlace: ['Shantipur', 'Gadag', 'Lakshmeshwar', 'Naregal', 'Annigeri', 'Hulkoti', 'Ron'].map((name) => ({ name, visits: 10 + Math.floor(Math.random() * 30), patients: 8 })),
        byDistrict: [{ name: 'Gadag', visits: 80, patients: 45 }, { name: 'Haveri', visits: 12, patients: 8 }],
        byState: [{ name: 'Karnataka', visits: 95, patients: 50 }],
      }),
    },
    analytics: {
      modules: () => r({
        ok: true,
        modules: [
          { key: 'ipd', label: 'IPD (in-patient)', count: 25, revenue: 420253, collected: 336332, outstanding: 83921 },
          { key: 'pharmacy', label: 'Pharmacy', count: 45, revenue: 78098, collected: 78098, outstanding: 0 },
          { key: 'lab', label: 'Laboratory', count: 15, revenue: 10770, collected: 5660, outstanding: 5110 },
          { key: 'radiology', label: 'Radiology', count: 12, revenue: 14600, collected: 11800, outstanding: 2800 },
          { key: 'opd', label: 'OPD / Consultation', count: 20, revenue: 6979, collected: 6979, outstanding: 0 },
          { key: 'other', label: 'Other / quick bills', count: 4, revenue: 2400, collected: 1900, outstanding: 500 },
        ],
        totals: { revenue: 533100, collected: 440769, outstanding: 92331, count: 121 },
      }),
      overview: () => r({
        asOf: new Date().toISOString(),
        todayVisits: 8, todayDone: 6, todayRevenue: 4200,
        monthRevenue: 78000, pharmacyMonthRevenue: 32000, pharmacyMonthPatientRevenue: 22400, pharmacyMonthGuestRevenue: 9600,
        outstandingTotal: demoReceivables({ patients, bills, pharmSales, appointments, doctors }).total_due,
        totalPatients: patients.length, patientsThisMonth: 12, activeDoctors: doctors.length,
        pendingRx: 3, lowStockDrugs: 2, expiringSoonBatches: 4, expiredBatches: 0,
        freeFollowupsThisMonth: 14, relaxedFollowupsThisMonth: 3,
        registrationFeesThisMonth: 1200, registrationFeeCountThisMonth: 12,
        servicesCountThisMonth: 18, servicesRevenueThisMonth: 4250,
      }),
      receivables: () => r(demoReceivables({ patients, bills, pharmSales, appointments, doctors })),
      discounts: () => r({
        bills: { count: 14, value: 3120 }, pharmacy: { count: 9, value: 845 }, total_value: 3965, pct_of_gross: 4.1,
        largest: patients.slice(0, 5).map((p: any, i: number) => ({
          kind: i % 2 ? 'pharmacy' : 'bill', number: i % 2 ? `PHX-0010${i}` : `INV-2026-27/00${i + 4}`, date: '2026-10-1' + (i + 1) + ' 11:20:00',
          patient: `${p.first_name} ${p.last_name}`, uhid: p.uhid, amount: 600 - i * 90, reason: i % 2 ? null : ['Senior citizen', 'Staff family', 'Long-standing patient'][i % 3], by: i % 2 ? 'Counter' : 'Reception',
        })),
      }),
      manualPharmacy: (from: string, to: string) => r({
        from, to, bills: 7, billed: 4620, discount: 180, collected: 4120, still_owed: 500, owed_now: 740,
        by_mode: [{ mode: 'Cash', count: 4, total: 2900 }, { mode: 'UPI', count: 2, total: 1320 }, { mode: 'Pending', count: 1, total: 400 }],
        by_day: [3, 2, 1].map((d, i) => ({ day: new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10), bills: i + 2, total: 1800 - i * 520 })),
        by_customer: [{ kind: 'patient' as const, count: 5, total: 3700 }, { kind: 'walk-in' as const, count: 2, total: 920 }],
        largest: patients.slice(0, 4).map((p: any, i: number) => ({
          bill_number: `INV-2026-27/0${i + 40}`, created_at: '2026-10-1' + (i + 1) + ' 12:10:00', name: `${p.first_name} ${p.last_name}`,
          total: 1240 - i * 260, due: i === 3 ? 400 : 0, payment_mode: i === 3 ? 'Pending' : 'Cash',
        })),
      }),
      unbilled: () => r({
        days: 60,
        lab: { orders: 3, value: 2150 }, radiology: { orders: 1, value: 1500 }, visits: { count: 4, value: 2000 }, total_value: 5650,
        items: patients.slice(0, 6).map((p: any, i: number) => ({
          kind: (['lab', 'radiology', 'visit'] as const)[i % 3], patient_id: p.id, name: `${p.first_name} ${p.last_name}`, uhid: p.uhid,
          title: i % 3 === 0 ? 'Lab LAB-DEMO-00' + (i + 1) + ' · CBC · LFT' : i % 3 === 1 ? 'Radiology RAD-DEMO-00' + (i + 1) + ' · USG abdomen' : 'Visit with ' + (doctors[0]?.name ?? 'Doctor') + ' · token #' + (i + 2),
          date: i % 3 === 2 ? '2026-10-1' + (i % 9) : '2026-10-1' + (i % 9) + ' 10:30:00', date_is_local: i % 3 === 2, amount: 1500 - i * 150,
        })),
      }),
      followups: () => r({
        from: '2026-04-01', to: '2026-04-27',
        free_count: 14, relaxed_count: 3, total_waivers: 17,
        revenue_forgone_free: 7000, revenue_forgone_relaxed: 1500, revenue_forgone_total: 8500,
      }),
      demographics: () => r({
        total: patients.length,
        byGender: [{ gender: 'M', c: 28 }, { gender: 'F', c: 22 }],
        byAgeGroup: [
          { label: '< 1 yr (Infant)', c: 1 }, { label: '1-4 yrs (Toddler)', c: 3 }, { label: '5-12 yrs (Child)', c: 6 },
          { label: '13-17 yrs (Teen)', c: 4 }, { label: '18-29 yrs', c: 9 }, { label: '30-44 yrs', c: 12 },
          { label: '45-59 yrs', c: 9 }, { label: '60-74 yrs (Senior)', c: 5 }, { label: '75+ yrs (Elderly)', c: 1 },
        ],
        byBloodGroup: [{ label: 'O+', c: 18 }, { label: 'B+', c: 12 }, { label: 'A+', c: 9 }, { label: '(unknown)', c: 11 }],
        byProfession: [{ label: 'Farmer', c: 14 }, { label: 'Housewife', c: 10 }, { label: 'Driver', c: 5 }, { label: 'Teacher', c: 4 }, { label: 'Student', c: 7 }],
        newPatientsByMonth: Array.from({ length: 12 }, (_, i) => ({ month: `2025-${String(i + 1).padStart(2, '0')}`, c: 2 + Math.floor(Math.random() * 8) })),
        revenueByGender: [{ label: 'M', bills: 60, revenue: 35000 }, { label: 'F', bills: 45, revenue: 28000 }],
        revenueByAge: [{ label: '30-44 yrs', bills: 30, revenue: 18000 }, { label: '45-59 yrs', bills: 25, revenue: 15000 }, { label: '60-74 yrs (Senior)', bills: 20, revenue: 12000 }],
        revenueByProfession: [{ label: 'Farmer', bills: 30, revenue: 18000 }, { label: 'Housewife', bills: 22, revenue: 14000 }, { label: 'Teacher', bills: 12, revenue: 8000 }],
      }),
      pharmacyOverview: () => r({
        totalDispensed: 200, scheduleHCount: 80, totalRevenue: 32000, totalSales: 50,
        valuation: { skus: 115, units: 47680, at_cost: 2077863, at_mrp: 3306022, at_selling: 3306022 },
        expiredStock: { batches: 3, value: 8400 },
        lowStockCount: 30,
        topDrugs: drugMaster.slice(0, 8).map((d) => ({ name: d.name, units: 50, revenue: 1500, sales: 12 })),
        salesMix: [{ kind: 'Counter Sale (walk-in)', count: 18, revenue: 9000 }, { kind: 'Rx-driven (from doctor)', count: 32, revenue: 23000 }],
        customerMix: [{ kind: 'patient', count: 34, revenue: 22400, avg_sale: 659 }, { kind: 'guest', count: 16, revenue: 9600, avg_sale: 600 }],
        paymentMix: [{ mode: 'Cash', count: 26, revenue: 14100 }, { mode: 'UPI', count: 18, revenue: 11300 }, { mode: 'Card', count: 6, revenue: 4400 }, { mode: 'On credit', count: 3, revenue: 2200 }],
        creditSummary: { sold_count: 3, credit_value: 2200, still_owed_from_these: 1480, owed_now: 3150, sales_owing: 5, patients_owing: 4, oldest_owed_since: '2026-09-02' },
        topPatients: patients.slice(0, 6).map((p, i) => ({ patient_id: p.id, name: `${p.first_name} ${p.last_name}`, uhid: p.uhid, sales: 4 - Math.floor(i / 2), revenue: 3100 - i * 380 })),
        scheduleMix: [{ schedule: 'OTC', count: 110, units: 320 }, { schedule: 'H', count: 80, units: 220 }, { schedule: 'H1', count: 10, units: 25 }],
        lowStock: [{ name: 'Azithromycin 500mg', stock: 8, low_stock_threshold: 10 }, { name: 'Pantoprazole 40mg', stock: 6, low_stock_threshold: 10 }],
        expiringSoon: batches.filter((b) => {
          const d = Math.round((new Date(b.expiry).getTime() - Date.now()) / 86400000);
          return d >= 0 && d <= 90;
        }).slice(0, 6).map((b) => ({ drug_name: b.drug_name || 'Drug', batch_no: b.batch_no, expiry: b.expiry, qty_remaining: b.qty_remaining, days: Math.round((new Date(b.expiry).getTime() - Date.now()) / 86400000) })),
      }),
      retention: () => r({
        totalPatients: patients.length,
        window30: { eligible: 40, returned: 22, rate: 55 },
        window60: { eligible: 35, returned: 24, rate: 68.6 },
        window90: { eligible: 30, returned: 23, rate: 76.7 },
      }),
      cohort: () => {
        const months = Array.from({ length: 8 }, (_, i) => `2025-${String(i + 4).padStart(2, '0')}`);
        return r({
          cohorts: months.map((m, i) => {
            const size = 5 + Math.floor(Math.random() * 6);
            return {
              cohort_month: m,
              size,
              retention: Array.from({ length: months.length - i }, (_, off) => off === 0 ? size : Math.max(0, size - Math.floor(off * 1.5))),
            };
          }),
        });
      },
      weekdayHourHeatmap: () => {
        const out: any[] = [];
        for (let wd = 0; wd < 7; wd++) {
          for (let h = 8; h < 22; h++) {
            const peak = wd >= 1 && wd <= 5 && (h === 10 || h === 17);
            const visits = (peak ? 8 : 3) + Math.floor(Math.random() * 4);
            if (visits > 1) out.push({ weekday: wd, hour: h, visits });
          }
        }
        return r(out);
      },
      pharmacyProfit: (f: any) => r({ ok: true, report: demoProfitReport(drugMaster, batches, f.from, f.to) } as any),
      pharmacyValuation: () => r(demoValuation(batches, drugMaster)),
      supplierReport: (f: any) => r({ ok: true, report: demoSupplierReport(purchaseStore.all(), f.from, f.to) } as any),
      drugPriceHistory: (id: number) => r(demoPriceHistory(purchaseStore.all(), id)),
      pharmacyChecks: () => r([] as any),
      pharmacyBasket: () => r(Array.from({ length: 10 }, (_, i) => ({
        month: `2025-${String(i + 3).padStart(2, '0')}`,
        sales: 30 + Math.floor(Math.random() * 30),
        avg_revenue: 200 + Math.floor(Math.random() * 200),
        total_revenue: 8000 + Math.floor(Math.random() * 8000),
        avg_units: 2 + Math.random() * 3,
      }))),
    },
  };
}
