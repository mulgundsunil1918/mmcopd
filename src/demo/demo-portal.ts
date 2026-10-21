/**
 * Demo-only stand-ins for the billing portal, receivables, counter-sales and "Cost not recorded" channels. The real
 * thing is main/billing-portal.ts and main/pharmacy-finance.ts running against SQLite; here the same shapes are built
 * from the demo's in-memory stores so the showcase screens show believable, internally consistent figures.
 * Nothing here ships in the app.
 */
import type { CounterSalesResult } from '../lib/pharmacyReports';
import type { PatientPortal, PortalLine, PortalTodo, Receivables } from '../lib/billingPortal';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const dbTime = (daysAgo: number, hour = 11) => {
  const d = new Date(Date.now() - daysAgo * 86_400_000); d.setHours(hour, 5, 0, 0);
  return d.toISOString().slice(0, 19).replace('T', ' ');
};
const localDay = (daysAgo: number) => {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

type Stores = { patients: any[]; bills: any[]; pharmSales: any[]; appointments: any[]; doctors: any[] };

/** One extra, believable open item per patient so the portal's "to collect" and "can be billed" areas have something to show. */
function demoExtras(p: any, s: Stores): { lines: PortalLine[]; todo: PortalTodo[] } {
  const lines: PortalLine[] = [];
  const todo: PortalTodo[] = [];
  const k = Number(p.id) % 3;
  if (k === 0) {
    lines.push({
      key: 'bill:demo-lab', source: 'bill', kind: 'lab', number: `INV-DEMO-L${p.id}`, date: dbTime(2),
      title: 'Laboratory', detail: 'CBC · Blood sugar (fasting) · Lipid profile', doctor_name: null,
      total: 800, paid: 300, advance: 0, due: 500, status: 'part_paid', payment_mode: 'Pending',
      bill_id: 100000 + Number(p.id), sale_id: null, admission_id: null, running: false, counter_sale: false,
    });
    todo.push({
      key: 'due:bill:demo-lab', kind: 'bill_due', title: `Laboratory · INV-DEMO-L${p.id}`, detail: 'Part-paid — billed 800.00, received 300.00',
      date: dbTime(2), date_is_local: false, amount: null, due: 500, appointment_id: null, order_id: null, bill_id: 100000 + Number(p.id), admission_id: null,
    });
  } else if (k === 1) {
    todo.push({
      key: 'lab:demo', kind: 'lab_unbilled', title: 'Lab order LAB-DEMO-001 not billed', detail: 'Thyroid profile (TSH) · HbA1c',
      date: dbTime(1), date_is_local: false, amount: 950, due: null, appointment_id: null, order_id: 1, bill_id: null, admission_id: null,
    });
  }
  const appt = s.appointments.find((a: any) => a.patient_id === p.id && !s.bills.some((b: any) => b.appointment_id === a.id));
  if (appt) {
    const d = s.doctors.find((x: any) => x.id === appt.doctor_id);
    todo.push({
      key: `visit:${appt.id}`, kind: 'consultation_unbilled', title: `Consultation not billed — ${d?.name ?? 'Doctor'}`,
      detail: `Token #${appt.token_number} · ${appt.appointment_time} · ${appt.status}`, date: appt.appointment_date, date_is_local: true,
      amount: d?.default_fee ?? 500, due: null, appointment_id: appt.id, order_id: null, bill_id: null, admission_id: null,
    });
  }
  return { lines, todo };
}

export function demoPortal(patientId: number, s: Stores): PatientPortal {
  const p = s.patients.find((x) => x.id === patientId) ?? s.patients[0];
  const history: PortalLine[] = [];
  for (const b of s.bills.filter((x: any) => x.patient_id === p.id)) {
    const total = r2(b.total);
    const d = s.doctors.find((x: any) => x.id === b.doctor_id) ?? s.doctors.find((x: any) => x.id === s.appointments.find((a: any) => a.id === b.appointment_id)?.doctor_id);
    let detail = '';
    try { detail = (JSON.parse(b.items_json || '[]') as any[]).map((l) => l.description).join(' · '); } catch { /* ignore */ }
    history.push({
      key: `bill:${b.id}`, source: 'bill', kind: b.bill_type === 'lab' ? 'lab' : b.bill_type === 'radiology' ? 'radiology' : 'consultation',
      number: b.bill_number, date: b.created_at, title: b.bill_type === 'lab' ? 'Laboratory' : b.bill_type === 'radiology' ? 'Radiology' : 'Consultation',
      detail, doctor_name: d?.name ?? null, total, paid: total, advance: 0, due: 0, status: 'paid', payment_mode: b.payment_mode ?? 'Cash',
      bill_id: b.id, sale_id: null, admission_id: null, running: false, counter_sale: false,
    });
  }
  for (const sale of s.pharmSales.filter((x: any) => x.patient_id === p.id)) {
    history.push({
      key: `sale:${sale.id}`, source: 'pharmacy_sale', kind: 'pharmacy', number: sale.sale_number, date: sale.created_at, title: 'Pharmacy',
      detail: 'Medicines at the counter', doctor_name: null, total: r2(sale.total), paid: r2(sale.total), advance: 0, due: 0, status: 'paid',
      payment_mode: sale.payment_mode ?? 'Cash', bill_id: null, sale_id: sale.id, admission_id: null, running: false, counter_sale: true,
    });
  }
  const extra = demoExtras(p, s);
  history.push(...extra.lines);
  history.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const live = history.filter((h) => h.status !== 'cancelled');
  const sum = (f: (h: PortalLine) => number) => r2(live.reduce((a, h) => a + f(h), 0));
  return {
    patient: { id: p.id, uhid: p.uhid, name: `${p.first_name} ${p.last_name}`.trim(), phone: p.phone ?? null, dob: p.dob ?? null, gender: p.gender ?? null, address: p.address ?? null },
    summary: {
      billed: sum((h) => h.total), received: sum((h) => h.paid + h.advance), outstanding: sum((h) => h.due), credit_held: 0,
      bills: live.filter((h) => h.source === 'bill').length, pharmacy_sales: live.filter((h) => h.source === 'pharmacy_sale').length,
      to_bill_count: extra.todo.filter((t) => t.kind !== 'bill_due').length,
    },
    todo: extra.todo,
    history,
  };
}

export function demoReceivables(s: Stores): Receivables {
  const owing = s.patients.filter((p: any) => Number(p.id) % 3 === 0).slice(0, 8);
  const rows = owing.map((p: any, i: number) => ({
    patient_id: p.id as number | null, name: `${p.first_name} ${p.last_name}`, uhid: p.uhid as string | null,
    bills: 1 + (i % 2), due: 500 + i * 340, oldest_days: 2 + i * 9,
  }));
  const total = rows.reduce((a, r) => a + r.due, 0);
  const bucket = (lo: number, hi: number, label: string) => {
    const m = rows.filter((r) => r.oldest_days >= lo && r.oldest_days <= hi);
    return { label, bills: m.reduce((a, r) => a + r.bills, 0), due: m.reduce((a, r) => a + r.due, 0) };
  };
  return {
    total_due: total, bills_due: rows.reduce((a, r) => a + r.bills, 0), patients_due: rows.length,
    by_kind: [
      { kind: 'ipd', label: 'In-patient bill', bills: 2, due: Math.round(total * 0.5) },
      { kind: 'lab', label: 'Laboratory', bills: 3, due: Math.round(total * 0.3) },
      { kind: 'radiology', label: 'Radiology', bills: 1, due: total - Math.round(total * 0.5) - Math.round(total * 0.3) },
    ],
    by_patient: rows.sort((a, b) => b.due - a.due),
    aging: [bucket(0, 7, '0–7 days'), bucket(8, 30, '8–30 days'), bucket(31, 90, '31–90 days'), bucket(91, 9999, 'Over 90 days')],
  };
}

export function demoCounterSales(f: any, s: Stores): CounterSalesResult {
  const scope = f?.scope ?? 'all';
  let rows = s.pharmSales.map((x: any) => {
    const pt = s.patients.find((p: any) => p.id === x.patient_id);
    return {
      id: x.id, sale_number: x.sale_number, created_at: x.created_at ?? dbTime(1), subtotal: x.subtotal ?? x.total, discount: x.discount ?? 0, total: x.total,
      payment_mode: x.payment_mode ?? 'Cash', sold_by: x.sold_by ?? null, patient_id: x.patient_id ?? null,
      patient_name: pt ? `${pt.first_name} ${pt.last_name}` : null, patient_uhid: pt?.uhid ?? null,
      customer_name: x.customer_name ?? (pt ? null : (Number(x.id) % 2 ? 'Meena' : null)), item_count: 2,
    };
  });
  if (scope === 'patient') rows = rows.filter((x) => x.patient_id);
  else if (scope === 'guest') rows = rows.filter((x) => !x.patient_id);
  if (f?.q) { const q = String(f.q).toLowerCase(); rows = rows.filter((x) => `${x.patient_name ?? ''} ${x.patient_uhid ?? ''} ${x.customer_name ?? ''} ${x.sale_number}`.toLowerCase().includes(q)); }
  const byMode = new Map<string, { count: number; total: number }>();
  for (const x of rows) { const m = byMode.get(x.payment_mode) ?? { count: 0, total: 0 }; m.count++; m.total += x.total; byMode.set(x.payment_mode, m); }
  return {
    rows,
    totals: {
      count: rows.length, total: r2(rows.reduce((a, x) => a + x.total, 0)), discount: r2(rows.reduce((a, x) => a + x.discount, 0)),
      by_mode: [...byMode.entries()].map(([mode, v]) => ({ mode, count: v.count, total: r2(v.total) })),
    },
  };
}

export { localDay };
