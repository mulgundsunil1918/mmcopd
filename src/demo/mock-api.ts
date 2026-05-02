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
let dispensing = [...DEMO_DISPENSING];
let consultations = [...DEMO_CONSULTATIONS];
let rxItems = [...DEMO_RX_ITEMS];

const r = <T>(v: T): Promise<T> => Promise.resolve(v);
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
      verifyPassword: (pwd: string) => r(pwd === '1918' || pwd === 'Sunil@1918'),
      isDefaultAdminPassword: () => r(true),
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
    settings: {
      get: () => r(settings),
      save: (patch: any) => { Object.assign(settings, patch); return r(settings); },
    },
    patients: {
      search: (q: string) => r(searchPatients(q || '')),
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
      knownPlaces: () => r({ places: ['Mulgund', 'Gadag', 'Lakshmeshwar'], districts: ['Gadag', 'Haveri'] }),
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
      updateStatus: (id: number, status: any) => {
        appointments = appointments.map((a) => a.id === id ? { ...a, status } : a);
        return r(buildAppointmentRow(appointments.find((a) => a.id === id)));
      },
    },
    bills: {
      create: (input: any) => {
        const id = nextId(bills);
        const total = (input.items || []).reduce((s: number, it: any) => s + (it.amount || 0), 0);
        const created: any = { id, bill_number: `BL-${String(id).padStart(4, '0')}`, ...input, subtotal: total, total, created_at: new Date().toISOString() };
        bills = [...bills, created];
        return r(created);
      },
      list: () => r(bills),
      pendingForBilling: () => r([]),
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
        doctor_name: 'Dr. Sunil', free_remaining: 2,
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
          doctor_name: input.doctor_id ? 'Dr. Sunil' : null,
          items_json: JSON.stringify([{ description: input.description, qty: 1, rate: input.amount, amount: input.amount }]),
          subtotal: input.amount, total: input.amount, payment_mode: input.payment_mode,
          notes: input.notes, bill_kind: 'misc',
          created_at: new Date().toISOString(),
        };
        bills = [...bills, created];
        return r(created);
      },
      list: () => r([
        { id: 9001, bill_number: 'BL-9001', patient_name: 'Geeta Hosamani', patient_uhid: 'PT-20260427-0042', doctor_name: 'Dr. Priya Patil', payment_mode: 'Cash', total: 250, notes: 'Booster dose 2/3', items_json: JSON.stringify([{ description: 'Vaccination — TT booster', qty: 1, rate: 250, amount: 250 }]), created_at: new Date(Date.now() - 3 * 3600000).toISOString() },
        { id: 9002, bill_number: 'BL-9002', patient_name: 'Ramesh Mali', patient_uhid: 'PT-20260427-0041', doctor_name: 'Dr. Sunil Mulgund', payment_mode: 'UPI', total: 300, notes: '', items_json: JSON.stringify([{ description: 'Wound dressing', qty: 1, rate: 300, amount: 300 }]), created_at: new Date(Date.now() - 86400000).toISOString() },
        { id: 9003, bill_number: 'BL-9003', patient_name: 'Anitha Kulkarni', patient_uhid: 'PT-20260427-0040', doctor_name: null, payment_mode: 'Cash', total: 150, notes: 'Acute asthma', items_json: JSON.stringify([{ description: 'Nebulization', qty: 1, rate: 150, amount: 150 }]), created_at: new Date(Date.now() - 2 * 86400000).toISOString() },
      ]),
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
          { doctor_name: 'Dr. Sunil Mulgund', doctor_color: '#10b981', count: 6, revenue: 1750 },
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
      listTests: () => r([]),
      listOrders: () => r([]),
      createOrder: () => r({} as any),
      updateOrderStatus: () => r({} as any),
      updateResults: () => r([]),
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
        const created: any = { id, sale_number: `PHX-${String(id).padStart(5, '0')}`, ...payload, subtotal: total, total, created_at: new Date().toISOString() };
        pharmSales = [...pharmSales, created];
        return r(created);
      },
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
      list: () => r(purchases.map((p) => ({ ...p, wholesaler_name: wholesalers.find((w) => w.id === p.wholesaler_id)?.name, wholesaler_license_no: wholesalers.find((w) => w.id === p.wholesaler_id)?.drug_license_no }))),
      get: (id: number) => r(purchases.find((p) => p.id === id) || null),
      create: () => r({} as any),
      attachScan: () => r({ ok: true }),
    },
    dispensing: { register: () => r(dispensing) },
    stock: { register: () => r(batches.map((b) => ({ ...b, days_to_expiry: Math.round((new Date(b.expiry).getTime() - Date.now()) / 86400000) }))) },
    purchasesReport: { register: () => r(purchases.map((p) => ({ ...p, wholesaler_name: wholesalers.find((w) => w.id === p.wholesaler_id)?.name, wholesaler_license_no: wholesalers.find((w) => w.id === p.wholesaler_id)?.drug_license_no, wholesaler_gstin: null, line_count: 5 }))) },
    notifications: { list: () => r([]) },
    ip: { list: () => r([]), admit: () => r({} as any), discharge: () => r({} as any) },
    app: {
      getClinicName: () => r(settings.clinic_name),
      forceQuit: noop,
      openExternal: (url: string) => { window.open(url, '_blank'); return r({ ok: true }); },
      setAutoLaunch: () => r({ ok: false, reason: 'Demo mode — no OS access.' }),
      getAutoLaunchStatus: () => r({ supported: false, isPackaged: false, registered: false, exePath: null, reason: 'Demo mode (browser).' }),
      onCloseRequested: () => () => {},
      onReminderTick: () => () => {},
      onUsbReminderTick: () => () => {},
    },
    reports: {
      run: ({ kind }: any) => {
        // Generate a tiny realistic dummy result per report kind.
        if (kind === 'daily_collection') return r(Array.from({ length: 7 }, (_, i) => ({ day: `2026-04-${20 + i}`, cash: 1200, card: 800, upi: 1500, revenue: 3500 })));
        if (kind === 'doctor_performance') return r(doctors.map((d) => ({ doctor: d.name, visits: 20 + Math.floor(Math.random() * 30), unique_patients: 18, revenue: 12000 })));
        if (kind === 'top_diagnoses') return r([{ impression: 'Acute viral URI', count: 18 }, { impression: 'Osteoarthritis', count: 11 }, { impression: 'GERD', count: 7 }]);
        if (kind === 'top_drugs') return r(drugMaster.slice(0, 8).map((d) => ({ drug_name: d.name, units: 50 + Math.floor(Math.random() * 100), revenue: 800 })));
        if (kind === 'new_patients') return r(Array.from({ length: 7 }, (_, i) => ({ day: `2026-04-${20 + i}`, count: 3 + Math.floor(Math.random() * 8) })));
        return r([]);
      },
    },
    backup: {
      now: () => r({ path: '(demo)', bundleDir: '(demo)', totalBundles: 0, documentCount: 0 }),
      nowTo: () => r({ ok: true }),
      list: () => r([]),
      open: noop,
      status: () => r({ lastBackupAt: null, lastBackupName: null, totalBackups: 0, dir: '(demo)' }),
      quitAfter: () => r({ ok: false, path: '' }),
      restore: () => r({ ok: false, error: 'Demo mode — no DB to restore.' }),
      previewRestore: () => r({ ok: false, error: 'Demo mode' }),
    },
    dialog: {
      pickFolder: () => r(null),
      pickFile: () => r(null),
    },
    updates: {
      state: () => r({ state: 'idle', appVersion: '0.3.0-demo', isPackaged: false }),
      checkNow: () => r({ ok: false, isPackaged: false }),
      installNow: () => r({ ok: false }),
      onState: () => () => {},
      onPromptInstall: () => () => {},
    },
    network: {
      status: () => r({ mode: 'local', listenPort: 4321, serverUrl: '', hasSecret: false, running: false, port: 0, clients: 0, ipcChannels: 0, appVersion: '0.3.0-demo' }),
      applyMode: () => r({ ok: true, running: false, port: 0, clients: 0, ipcChannels: 0 }),
      probe: () => r({ ok: false, error: 'Demo build — network mode not available in showcase' }),
    },
    finance: {
      summary: () => {
        const totalAll = bills.reduce((s, b) => s + b.total, 0);
        const today = totalAll * 0.04;
        return r({
          today: { total: today, delta: 0.12 },
          yesterday: { total: today * 0.85 },
          week: { total: totalAll * 0.18 },
          prevWeek: { total: totalAll * 0.16 },
          month: { total: totalAll * 0.55 },
          prevMonth: { total: totalAll * 0.5 },
          allTime: { total: totalAll },
          byDay: Array.from({ length: 14 }, (_, i) => ({ day: new Date(Date.now() - (13 - i) * 86400000).toISOString().slice(0, 10), total: 1500 + Math.floor(Math.random() * 4000) })),
          byMonth: Array.from({ length: 6 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, total: 30000 + Math.floor(Math.random() * 30000) })),
          byWeekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((wd) => ({ weekday: wd, total: 5000 + Math.floor(Math.random() * 8000) })),
          byHour: Array.from({ length: 14 }, (_, i) => ({ hour: 8 + i, total: 500 + Math.floor(Math.random() * 4000) })),
          byDoctor: doctors.map((d) => ({ doctor: d.name, count: 10 + Math.floor(Math.random() * 30), total: 5000 + Math.floor(Math.random() * 25000) })),
          byMode: [{ mode: 'Cash', total: totalAll * 0.5, count: 60 }, { mode: 'UPI', total: totalAll * 0.35, count: 30 }, { mode: 'Card', total: totalAll * 0.15, count: 10 }],
          byPlace: ['Mulgund', 'Gadag', 'Lakshmeshwar', 'Naregal', 'Annigeri'].map((p) => ({ place: p, total: 3000 + Math.floor(Math.random() * 12000) })),
          topPatients: patients.slice(0, 10).map((p, i) => ({ name: `${p.first_name} ${p.last_name}`, uhid: p.uhid, total: 5000 - i * 300 })),
        });
      },
    },
    origin: {
      summary: () => r({
        totalVisits: appointments.length,
        uniquePatients: new Set(appointments.map((a) => a.patient_id)).size,
        missingPlace: 4,
        byPlace: ['Mulgund', 'Gadag', 'Lakshmeshwar', 'Naregal', 'Annigeri', 'Hulkoti', 'Ron'].map((name) => ({ name, visits: 10 + Math.floor(Math.random() * 30), patients: 8 })),
        byDistrict: [{ name: 'Gadag', visits: 80, patients: 45 }, { name: 'Haveri', visits: 12, patients: 8 }],
        byState: [{ name: 'Karnataka', visits: 95, patients: 50 }],
      }),
    },
    analytics: {
      overview: () => r({
        asOf: new Date().toISOString(),
        todayVisits: 8, todayDone: 6, todayRevenue: 4200,
        monthRevenue: 78000, pharmacyMonthRevenue: 32000,
        totalPatients: patients.length, patientsThisMonth: 12, activeDoctors: doctors.length,
        pendingRx: 3, lowStockDrugs: 2, expiringSoonBatches: 4, expiredBatches: 0,
        freeFollowupsThisMonth: 14, relaxedFollowupsThisMonth: 3,
        registrationFeesThisMonth: 1200, registrationFeeCountThisMonth: 12,
        servicesCountThisMonth: 18, servicesRevenueThisMonth: 4250,
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
        topDrugs: drugMaster.slice(0, 8).map((d) => ({ name: d.name, units: 50, revenue: 1500, sales: 12 })),
        salesMix: [{ kind: 'Counter Sale (walk-in)', count: 18, revenue: 9000 }, { kind: 'Rx-driven (from doctor)', count: 32, revenue: 23000 }],
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
