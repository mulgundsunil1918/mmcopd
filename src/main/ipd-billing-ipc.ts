/**
 * IPD and billing IPC handlers.
 *
 * Deliberately a separate module rather than more lines in main/ipc.ts, which
 * is already ~3.7k lines covering every domain.
 *
 * Error policy (per project instruction): every failure returns a specific,
 * actionable message naming what was being attempted and why it failed. No
 * silent catch, no blank result — a clinic hitting a problem at the counter
 * should be able to read the message and know what to do.
 */

import { ipcMain } from 'electron';
import type Database from 'better-sqlite3';
import { getDb } from '../db/db';
import { getAllSettings } from '../db/settings';
import { logAudit } from './auth';
import { broadcastEvent } from './network-server';
import { computeBill, money, discountCapForRole, type BillLineInput } from './billing-engine';
import { nextIpNumber, nextBillNumber } from '../db/ids';

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: string };

const fail = (error: string): Err => ({ ok: false, error });

/** Narrow a value to a positive integer id, or explain precisely what arrived. */
function requireId(value: unknown, label: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${label} must be a positive whole number, received ${JSON.stringify(value)}.`);
  }
  return n;
}

function requireText(value: unknown, label: string, max = 500): string {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) throw new Error(`${label} is required and cannot be blank.`);
  if (s.length > max) throw new Error(`${label} is too long (${s.length} characters, maximum ${max}).`);
  return s;
}

/** Today in local time as YYYY-MM-DD — the accrual key. */
function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// =====================================================================
// Bill helpers
// =====================================================================

/**
 * The open bill for an admission, created on first use.
 *
 * An IPD stay accrues onto ONE bill until discharge, so charges from the ward,
 * pharmacy and lab all land in the same place and can be previewed at any time.
 */
function getOrCreateAdmissionBill(db: Database.Database, admissionId: number): number {
  const adm = db
    .prepare('SELECT id, patient_id, bill_id FROM ip_admissions WHERE id=?')
    .get(admissionId) as { id: number; patient_id: number; bill_id: number | null } | undefined;
  if (!adm) {
    throw new Error(`Admission #${admissionId} was not found. It may have been deleted.`);
  }
  if (adm.bill_id) {
    const exists = db.prepare('SELECT id FROM bills WHERE id=?').get(adm.bill_id);
    if (exists) return adm.bill_id;
    // Bill row vanished (older purge path); fall through and make a new one.
  }

  const s = getAllSettings(db);
  const billNumber = nextBillNumber(db, s.invoice_prefix || 'INV');
  const info = db
    .prepare(
      `INSERT INTO bills (bill_number, appointment_id, patient_id, items_json, subtotal,
                          discount, discount_type, total, payment_mode, status, bill_type, admission_id)
       VALUES (?, NULL, ?, '[]', 0, 0, 'flat', 0, 'Pending', 'open', 'ipd', ?)`
    )
    .run(billNumber, adm.patient_id, admissionId);
  const billId = Number(info.lastInsertRowid);
  db.prepare('UPDATE ip_admissions SET bill_id=? WHERE id=?').run(billId, admissionId);
  return billId;
}

/** Recompute and persist a bill's totals from its current lines. */
function recalcBill(db: Database.Database, billId: number) {
  const bill = db
    .prepare('SELECT id, discount, discount_type, status FROM bills WHERE id=?')
    .get(billId) as { id: number; discount: number; discount_type: 'flat' | 'percent'; status: string } | undefined;
  if (!bill) throw new Error(`Cannot recalculate: bill #${billId} was not found.`);

  const rows = db
    .prepare('SELECT id, description, qty, rate, amount, gst_rate, is_taxable FROM bill_items WHERE bill_id=? ORDER BY id')
    .all(billId) as any[];

  const s = getAllSettings(db);
  const totals = computeBill(
    rows.map((r) => ({
      description: r.description,
      qty: r.qty,
      rate: r.rate,
      amount: r.amount,
      gst_rate: r.gst_rate,
      is_taxable: !!r.is_taxable,
    })),
    {
      discount: bill.discount,
      discount_type: bill.discount_type,
      gstEnabled: s.gst_enabled,
      roundOff: s.bill_round_off,
    }
  );

  // Persist the per-line tax split so the printed invoice matches to the paisa.
  const updLine = db.prepare('UPDATE bill_items SET cgst=?, sgst=? WHERE id=?');
  totals.lines.forEach((l, i) => updLine.run(l.cgst, l.sgst, rows[i].id));

  db.prepare(
    `UPDATE bills SET subtotal=?, total=?, taxable_total=?, exempt_total=?,
       cgst_total=?, sgst_total=?, round_off=?, is_tax_invoice=? WHERE id=?`
  ).run(
    totals.subtotal, totals.total, totals.taxableTotal, totals.exemptTotal,
    totals.cgstTotal, totals.sgstTotal, totals.roundOff, totals.isTaxInvoice ? 1 : 0, billId
  );

  return totals;
}

function addLine(db: Database.Database, billId: number, line: BillLineInput, by?: string): number {
  const amount = money(line.amount !== undefined ? line.amount : (line.qty || 1) * (line.rate || 0));
  try {
    const info = db
      .prepare(
        `INSERT INTO bill_items (bill_id, charge_head_id, description, qty, rate, amount,
                                 hsn_sac, gst_rate, is_taxable, source, source_ref_id, accrual_date, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        billId, line.charge_head_id ?? null, line.description,
        line.qty ?? 1, line.rate ?? 0, amount,
        line.hsn_sac ?? null, line.gst_rate ?? 0, line.is_taxable ? 1 : 0,
        line.source ?? 'manual', line.source_ref_id ?? null, line.accrual_date ?? null, by ?? null
      );
    return Number(info.lastInsertRowid);
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (msg.includes('idx_bill_items_accrual_once')) {
      // The partial unique index caught a repeat post — expected, not an error.
      throw new Error(
        `"${line.description}" has already been charged for ${line.accrual_date}. ` +
        `Automatic charges post once per day; edit the existing line instead of adding another.`
      );
    }
    throw new Error(`Could not add "${line.description}" to bill #${billId}: ${msg}`);
  }
}

// =====================================================================

export function registerIpdBillingIpc() {
  const db = () => getDb();

  // ---------- Wards ----------
  ipcMain.handle('wards:list', (_e, includeInactive = false) => {
    const where = includeInactive ? '' : 'WHERE w.is_active=1';
    return db()
      .prepare(
        `SELECT w.*,
                (SELECT COUNT(*) FROM beds b WHERE b.ward_id=w.id AND b.is_active=1) AS bed_count,
                (SELECT COUNT(*) FROM beds b WHERE b.ward_id=w.id AND b.is_active=1 AND b.status='occupied') AS occupied_count
         FROM wards w ${where} ORDER BY w.sort_order, w.name`
      )
      .all();
  });

  ipcMain.handle('wards:save', (_e, input: any) => {
    try {
      const name = requireText(input?.name, 'Ward name', 60);
      const rate = Number(input?.per_day_rate ?? 0);
      if (!Number.isFinite(rate) || rate < 0) {
        return fail(`Bed charge per day must be zero or more, received ${JSON.stringify(input?.per_day_rate)}.`);
      }
      const d = db();
      if (input?.id) {
        const id = requireId(input.id, 'Ward id');
        d.prepare(
          `UPDATE wards SET name=?, ward_type=?, per_day_rate=?, nursing_per_day=?, colour=?, sort_order=?, is_active=? WHERE id=?`
        ).run(name, input.ward_type ?? 'general', rate, Number(input.nursing_per_day ?? 0),
              input.colour ?? null, Number(input.sort_order ?? 0), input.is_active === false ? 0 : 1, id);
        return { ok: true, id };
      }
      const info = d.prepare(
        `INSERT INTO wards (name, ward_type, per_day_rate, nursing_per_day, colour, sort_order) VALUES (?,?,?,?,?,?)`
      ).run(name, input.ward_type ?? 'general', rate, Number(input.nursing_per_day ?? 0),
            input.colour ?? null, Number(input.sort_order ?? 0));
      return { ok: true, id: Number(info.lastInsertRowid) };
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('UNIQUE') && msg.includes('wards.name')) {
        return fail(`A ward named "${input?.name}" already exists. Ward names must be unique.`);
      }
      return fail(`Could not save ward: ${msg}`);
    }
  });

  ipcMain.handle('wards:delete', (_e, wardId: number) => {
    try {
      const id = requireId(wardId, 'Ward id');
      const live = (db().prepare(
        `SELECT COUNT(*) AS c FROM ip_admissions a JOIN beds b ON b.id=a.bed_id
         WHERE b.ward_id=? AND a.status='admitted'`
      ).get(id) as { c: number }).c;
      if (live > 0) {
        return fail(`Cannot delete this ward: ${live} patient(s) are still admitted in it. Discharge or transfer them first.`);
      }
      db().prepare('UPDATE wards SET is_active=0 WHERE id=?').run(id);
      return { ok: true };
    } catch (err: any) {
      return fail(`Could not delete ward: ${err?.message || String(err)}`);
    }
  });

  // ---------- Beds ----------
  /** Colour-coded ward map: every bed with its current occupant, if any. */
  ipcMain.handle('beds:map', () => {
    return db()
      .prepare(
        `SELECT b.id, b.ward_id, b.bed_number, b.status, b.notes,
                w.name AS ward_name, w.ward_type, w.colour AS ward_colour, w.per_day_rate,
                a.id AS admission_id, a.admission_number, a.admitted_at,
                (p.first_name || ' ' || p.last_name) AS patient_name, p.uhid AS patient_uhid,
                d.name AS doctor_name
         FROM beds b
         JOIN wards w ON w.id = b.ward_id
         LEFT JOIN ip_admissions a ON a.bed_id = b.id AND a.status='admitted'
         LEFT JOIN patients p ON p.id = a.patient_id
         LEFT JOIN doctors d ON d.id = a.admission_doctor_id
         WHERE b.is_active=1 AND w.is_active=1
         ORDER BY w.sort_order, w.name, b.bed_number`
      )
      .all();
  });

  ipcMain.handle('beds:save', (_e, input: any) => {
    try {
      const wardId = requireId(input?.ward_id, 'Ward');
      const bedNumber = requireText(input?.bed_number, 'Bed number', 20);
      const d = db();
      if (!d.prepare('SELECT id FROM wards WHERE id=?').get(wardId)) {
        return fail(`Ward #${wardId} was not found. Create the ward before adding beds to it.`);
      }
      if (input?.id) {
        const id = requireId(input.id, 'Bed id');
        d.prepare('UPDATE beds SET ward_id=?, bed_number=?, notes=?, is_active=? WHERE id=?')
          .run(wardId, bedNumber, input.notes ?? null, input.is_active === false ? 0 : 1, id);
        return { ok: true, id };
      }
      const info = d.prepare('INSERT INTO beds (ward_id, bed_number, notes) VALUES (?,?,?)')
        .run(wardId, bedNumber, input.notes ?? null);
      return { ok: true, id: Number(info.lastInsertRowid) };
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('UNIQUE')) {
        return fail(`Bed "${input?.bed_number}" already exists in this ward. Bed numbers must be unique within a ward.`);
      }
      return fail(`Could not save bed: ${msg}`);
    }
  });

  /** free / occupied / reserved / cleaning / blocked — drives the map colours. */
  ipcMain.handle('beds:setStatus', (_e, bedId: number, status: string) => {
    const allowed = ['free', 'occupied', 'reserved', 'cleaning', 'blocked'];
    try {
      const id = requireId(bedId, 'Bed id');
      if (!allowed.includes(status)) {
        return fail(`"${status}" is not a valid bed status. Use one of: ${allowed.join(', ')}.`);
      }
      const d = db();
      const occupied = d.prepare(`SELECT id FROM ip_admissions WHERE bed_id=? AND status='admitted'`).get(id);
      if (occupied && status !== 'occupied') {
        return fail(`This bed has a patient in it and cannot be marked "${status}". Discharge or transfer the patient first.`);
      }
      d.prepare('UPDATE beds SET status=? WHERE id=?').run(status, id);
      broadcastEvent('ip:bedStatus', { bedId: id, status });
      return { ok: true };
    } catch (err: any) {
      return fail(`Could not change bed status: ${err?.message || String(err)}`);
    }
  });

  // ---------- Charge heads ----------
  ipcMain.handle('chargeHeads:list', (_e, appliesTo?: 'opd' | 'ipd') => {
    const where = appliesTo ? `WHERE is_active=1 AND applies_to IN (?, 'both')` : 'WHERE is_active=1';
    const params = appliesTo ? [appliesTo] : [];
    return db().prepare(`SELECT * FROM charge_heads ${where} ORDER BY sort_order, name`).all(...params);
  });

  ipcMain.handle('chargeHeads:save', (_e, input: any) => {
    try {
      const name = requireText(input?.name, 'Charge name', 80);
      const rate = Number(input?.default_rate ?? 0);
      if (!Number.isFinite(rate) || rate < 0) {
        return fail(`Default rate must be zero or more, received ${JSON.stringify(input?.default_rate)}.`);
      }
      const gst = Number(input?.gst_rate ?? 0);
      if (!Number.isFinite(gst) || gst < 0 || gst > 28) {
        return fail(`GST rate must be between 0 and 28 percent, received ${JSON.stringify(input?.gst_rate)}.`);
      }
      const d = db();
      if (input?.id) {
        const id = requireId(input.id, 'Charge head id');
        d.prepare(
          `UPDATE charge_heads SET name=?, category=?, colour=?, default_rate=?, hsn_sac=?,
             gst_rate=?, is_taxable=?, applies_to=?, sort_order=?, is_active=? WHERE id=?`
        ).run(name, input.category ?? 'other', input.colour ?? null, rate, input.hsn_sac ?? null,
              gst, input.is_taxable ? 1 : 0, input.applies_to ?? 'both',
              Number(input.sort_order ?? 0), input.is_active === false ? 0 : 1, id);
        return { ok: true, id };
      }
      const info = d.prepare(
        `INSERT INTO charge_heads (name, category, colour, default_rate, hsn_sac, gst_rate, is_taxable, applies_to, sort_order)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(name, input.category ?? 'other', input.colour ?? null, rate, input.hsn_sac ?? null,
            gst, input.is_taxable ? 1 : 0, input.applies_to ?? 'both', Number(input.sort_order ?? 0));
      return { ok: true, id: Number(info.lastInsertRowid) };
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('UNIQUE')) {
        return fail(`A charge named "${input?.name}" already exists in category "${input?.category ?? 'other'}".`);
      }
      return fail(`Could not save charge head: ${msg}`);
    }
  });

  // ---------- Admission ----------
  ipcMain.handle('ip:admitV2', (_e, input: any) => {
    const d = db();
    try {
      const patientId = requireId(input?.patient_id, 'Patient');
      const bedId = requireId(input?.bed_id, 'Bed');

      if (!d.prepare('SELECT id FROM patients WHERE id=?').get(patientId)) {
        return fail(`Patient #${patientId} was not found. They may have been deleted.`);
      }
      const bed = d.prepare(
        'SELECT b.id, b.status, b.bed_number, w.id AS ward_id, w.name AS ward_name FROM beds b JOIN wards w ON w.id=b.ward_id WHERE b.id=?'
      ).get(bedId) as any;
      if (!bed) return fail(`Bed #${bedId} was not found.`);
      if (bed.status === 'blocked' || bed.status === 'cleaning') {
        return fail(`Bed ${bed.ward_name} / ${bed.bed_number} is marked "${bed.status}" and cannot take a patient yet.`);
      }

      const openAdm = d.prepare(`SELECT admission_number FROM ip_admissions WHERE patient_id=? AND status='admitted'`).get(patientId) as any;
      if (openAdm) {
        return fail(`This patient is already admitted under ${openAdm.admission_number}. Discharge that admission before admitting again.`);
      }

      const s = getAllSettings(d);
      let admissionId = 0;
      let admissionNumber = '';

      const tx = d.transaction(() => {
        admissionNumber = nextIpNumber(d, s.ip_number_prefix || 'IP');
        const info = d.prepare(
          `INSERT INTO ip_admissions
             (admission_number, patient_id, admission_doctor_id, bed_id, ward_id, ward, bed_number,
              admission_type, provisional_diagnosis, attendant_name, attendant_phone, attendant_relation,
              is_mlc, admission_notes, status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'admitted')`
        ).run(
          admissionNumber, patientId, input.admission_doctor_id ?? null, bedId, bed.ward_id,
          bed.ward_name, bed.bed_number, input.admission_type ?? 'planned',
          input.provisional_diagnosis ?? null, input.attendant_name ?? null,
          input.attendant_phone ?? null, input.attendant_relation ?? null,
          input.is_mlc ? 1 : 0, input.admission_notes ?? null
        );
        admissionId = Number(info.lastInsertRowid);
        d.prepare(`UPDATE beds SET status='occupied' WHERE id=?`).run(bedId);

        if (input.is_mlc) {
          d.prepare(
            `INSERT INTO mlc_register (admission_id, patient_id, police_station, brought_by, brought_by_phone,
                                       incident_type, incident_at, incident_place, injury_description)
             VALUES (?,?,?,?,?,?,?,?,?)`
          ).run(admissionId, patientId, input.mlc?.police_station ?? null, input.mlc?.brought_by ?? null,
                input.mlc?.brought_by_phone ?? null, input.mlc?.incident_type ?? null,
                input.mlc?.incident_at ?? null, input.mlc?.incident_place ?? null,
                input.mlc?.injury_description ?? null);
        }

        const advance = Number(input.advance_amount ?? 0);
        if (advance > 0) {
          if (!s.ipd_advance_enabled) {
            throw new Error('Advance collection is switched off in Settings → IPD, but an advance amount was supplied.');
          }
          d.prepare(
            `INSERT INTO advances (patient_id, admission_id, amount, payment_mode, received_by, notes)
             VALUES (?,?,?,?,?,?)`
          ).run(patientId, admissionId, advance, input.advance_mode ?? 'Cash',
                input.performed_by ?? null, 'Collected at admission');
        }

        getOrCreateAdmissionBill(d, admissionId);
      });

      tx();
      logAudit(d, null, 'ip_admitted', 'ip_admissions', admissionId,
        `${admissionNumber} → ${bed.ward_name}/${bed.bed_number}`);
      broadcastEvent('ip:admitted', { admissionId, bedId });
      return { ok: true, id: admissionId, admission_number: admissionNumber };
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('idx_bed_single_active_admission')) {
        return fail(`That bed was taken by another station a moment ago. Refresh the ward map and pick a free bed.`);
      }
      return fail(`Admission failed: ${msg}`);
    }
  });

  // ---------- Transfer ----------
  ipcMain.handle('ip:transfer', (_e, admissionId: number, toBedId: number, reason?: string, by?: string) => {
    const d = db();
    try {
      const aid = requireId(admissionId, 'Admission');
      const bid = requireId(toBedId, 'Destination bed');
      const adm = d.prepare('SELECT id, bed_id, status, admission_number FROM ip_admissions WHERE id=?').get(aid) as any;
      if (!adm) return fail(`Admission #${aid} was not found.`);
      if (adm.status !== 'admitted') {
        return fail(`${adm.admission_number} is no longer admitted (status "${adm.status}"), so the patient cannot be transferred.`);
      }
      if (adm.bed_id === bid) return fail('The patient is already in that bed.');

      const bed = d.prepare(
        'SELECT b.id, b.status, b.bed_number, w.id AS ward_id, w.name AS ward_name FROM beds b JOIN wards w ON w.id=b.ward_id WHERE b.id=?'
      ).get(bid) as any;
      if (!bed) return fail(`Destination bed #${bid} was not found.`);
      if (bed.status !== 'free' && bed.status !== 'reserved') {
        return fail(`Bed ${bed.ward_name} / ${bed.bed_number} is "${bed.status}" and is not available.`);
      }

      const tx = d.transaction(() => {
        d.prepare(
          `INSERT INTO bed_transfers (admission_id, from_bed_id, to_bed_id, reason, transferred_by) VALUES (?,?,?,?,?)`
        ).run(aid, adm.bed_id, bid, reason ?? null, by ?? null);
        if (adm.bed_id) d.prepare(`UPDATE beds SET status='cleaning' WHERE id=?`).run(adm.bed_id);
        d.prepare(`UPDATE beds SET status='occupied' WHERE id=?`).run(bid);
        d.prepare('UPDATE ip_admissions SET bed_id=?, ward_id=?, ward=?, bed_number=? WHERE id=?')
          .run(bid, bed.ward_id, bed.ward_name, bed.bed_number, aid);
      });
      tx();

      logAudit(d, null, 'ip_transferred', 'ip_admissions', aid, `→ ${bed.ward_name}/${bed.bed_number}`);
      broadcastEvent('ip:transferred', { admissionId: aid, toBedId: bid });
      return { ok: true };
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (msg.includes('idx_bed_single_active_admission')) {
        return fail('That bed was taken by another station a moment ago. Refresh the ward map and pick another.');
      }
      return fail(`Transfer failed: ${msg}`);
    }
  });

  // ---------- Discharge ----------
  const OUTCOMES = ['discharged', 'lama', 'dama', 'death', 'referred', 'absconded'];

  ipcMain.handle('ip:dischargeV2', (_e, admissionId: number, input: any) => {
    const d = db();
    try {
      const aid = requireId(admissionId, 'Admission');
      const outcome = String(input?.outcome ?? '');
      if (!OUTCOMES.includes(outcome)) {
        return fail(`"${outcome}" is not a valid outcome. Use one of: ${OUTCOMES.join(', ')}.`);
      }
      const adm = d.prepare('SELECT id, bed_id, status, admission_number FROM ip_admissions WHERE id=?').get(aid) as any;
      if (!adm) return fail(`Admission #${aid} was not found.`);
      if (adm.status !== 'admitted') {
        return fail(`${adm.admission_number} is already closed (status "${adm.status}").`);
      }
      if (outcome === 'death' && !input?.death_at) {
        return fail('Date and time of death are required when recording a death.');
      }
      if ((outcome === 'lama' || outcome === 'dama') && !input?.outcome_notes) {
        return fail('A reason is required for LAMA and DAMA, since the patient is leaving against medical advice.');
      }
      if (outcome === 'referred' && !input?.referred_to) {
        return fail('Please record which hospital or facility the patient is being referred to.');
      }

      const now = new Date().toISOString();
      const tx = d.transaction(() => {
        d.prepare(
          `UPDATE ip_admissions SET status='discharged', outcome=?, outcome_notes=?, discharged_at=?,
             death_at=?, death_cause=?, referred_to=?, risk_explained_by=?,
             discharge_diagnosis=?, condition_at_discharge=?, treatment_given=?,
             investigation_findings=?, operative_notes=?, discharge_medications_json=?,
             followup_plan=?, discharge_doctor_id=?, discharge_summary=?
           WHERE id=?`
        ).run(
          outcome, input.outcome_notes ?? null, now,
          input.death_at ?? null, input.death_cause ?? null, input.referred_to ?? null,
          input.risk_explained_by ?? null, input.discharge_diagnosis ?? null,
          input.condition_at_discharge ?? null, input.treatment_given ?? null,
          input.investigation_findings ?? null, input.operative_notes ?? null,
          input.discharge_medications_json ?? null, input.followup_plan ?? null,
          input.discharge_doctor_id ?? null, input.discharge_summary ?? null, aid
        );
        // Free the bed in the same transaction, so an outcome can never leave a
        // bed marked occupied with nobody in it.
        if (adm.bed_id) d.prepare(`UPDATE beds SET status='cleaning' WHERE id=?`).run(adm.bed_id);
      });
      tx();

      logAudit(d, null, 'ip_discharged', 'ip_admissions', aid, `${adm.admission_number} · ${outcome}`);
      broadcastEvent('ip:discharged', { admissionId: aid, outcome });
      return { ok: true, outcome };
    } catch (err: any) {
      return fail(`Discharge failed: ${err?.message || String(err)}`);
    }
  });

  // ---------- Clinical records ----------
  const clinical: [string, string, string[]][] = [
    ['ip:vitals', 'ip_vitals', ['temperature', 'pulse', 'respiration', 'bp_systolic', 'bp_diastolic', 'spo2', 'pain_score', 'notes', 'recorded_by']],
    ['ip:progressNote', 'ip_progress_notes', ['doctor_id', 'note', 'recorded_by']],
    ['ip:nursingNote', 'ip_nursing_notes', ['note', 'shift', 'recorded_by']],
    ['ip:intakeOutput', 'ip_intake_output', ['kind', 'route', 'volume_ml', 'notes', 'recorded_by']],
    ['ip:dietOrder', 'ip_diet_orders', ['diet_type', 'instructions', 'ordered_by']],
  ];

  for (const [channel, table, fields] of clinical) {
    ipcMain.handle(`${channel}:list`, (_e, admissionId: number) => {
      try {
        const aid = requireId(admissionId, 'Admission');
        return db().prepare(`SELECT * FROM ${table} WHERE admission_id=? ORDER BY id DESC LIMIT 500`).all(aid);
      } catch (err: any) {
        throw new Error(`Could not load ${table.replace('ip_', '').replace('_', ' ')}: ${err?.message || String(err)}`);
      }
    });

    ipcMain.handle(`${channel}:add`, (_e, admissionId: number, input: any) => {
      const d = db();
      try {
        const aid = requireId(admissionId, 'Admission');
        const adm = d.prepare('SELECT id, status, admission_number FROM ip_admissions WHERE id=?').get(aid) as any;
        if (!adm) return fail(`Admission #${aid} was not found.`);
        if (adm.status !== 'admitted') {
          return fail(`${adm.admission_number} is discharged — clinical entries can only be added while the patient is admitted.`);
        }
        const cols = fields.filter((f) => input?.[f] !== undefined && input?.[f] !== null);
        if (cols.length === 0) {
          return fail(`Nothing to save — provide at least one of: ${fields.join(', ')}.`);
        }
        const info = d.prepare(
          `INSERT INTO ${table} (admission_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`
        ).run(aid, ...cols.map((c) => input[c]));
        broadcastEvent('ip:clinicalUpdated', { admissionId: aid, table });
        return { ok: true, id: Number(info.lastInsertRowid) };
      } catch (err: any) {
        const msg = String(err?.message || err);
        if (msg.includes('CHECK constraint failed')) {
          return fail(`One of the values is not allowed for this record type: ${msg}`);
        }
        return fail(`Could not save the entry: ${msg}`);
      }
    });
  }

  // ---------- Bill: preview / add / finalise ----------
  /** Running bill for an admission — "what's the bill till now". */
  ipcMain.handle('bill:previewAdmission', (_e, admissionId: number) => {
    const d = db();
    try {
      const aid = requireId(admissionId, 'Admission');
      const billId = getOrCreateAdmissionBill(d, aid);
      const totals = recalcBill(d, billId);
      const items = d.prepare(
        `SELECT bi.*, ch.name AS charge_head_name, ch.category, ch.colour
         FROM bill_items bi LEFT JOIN charge_heads ch ON ch.id = bi.charge_head_id
         WHERE bi.bill_id=? ORDER BY bi.id`
      ).all(billId);
      const advances = d.prepare(
        'SELECT COALESCE(SUM(amount - refunded_amount), 0) AS a FROM advances WHERE admission_id=?'
      ).get(aid) as { a: number };
      const paid = d.prepare(
        'SELECT COALESCE(SUM(amount), 0) AS p FROM bill_payments WHERE bill_id=?'
      ).get(billId) as { p: number };
      const bill = d.prepare('SELECT * FROM bills WHERE id=?').get(billId);
      return {
        ok: true, bill, items, totals,
        advanceAvailable: money(advances.a),
        amountPaid: money(paid.p),
        balanceDue: money(totals.total - advances.a - paid.p),
      };
    } catch (err: any) {
      return fail(`Could not build the bill preview: ${err?.message || String(err)}`);
    }
  });

  ipcMain.handle('bill:addItem', (_e, billId: number, line: any, by?: string) => {
    const d = db();
    try {
      const bid = requireId(billId, 'Bill');
      const bill = d.prepare('SELECT id, status FROM bills WHERE id=?').get(bid) as any;
      if (!bill) return fail(`Bill #${bid} was not found.`);
      if (bill.status === 'cancelled') return fail('This bill has been cancelled and cannot be changed.');
      if (bill.status === 'paid') {
        return fail('This bill is already settled. Raise a new bill, or cancel this one and re-issue it.');
      }
      requireText(line?.description, 'Item description', 200);
      const id = addLine(d, bid, line, by);
      const totals = recalcBill(d, bid);
      broadcastEvent('bill:updated', { billId: bid });
      return { ok: true, id, totals };
    } catch (err: any) {
      return fail(err?.message || String(err));
    }
  });

  ipcMain.handle('bill:removeItem', (_e, itemId: number) => {
    const d = db();
    try {
      const iid = requireId(itemId, 'Bill item');
      const row = d.prepare('SELECT bill_id FROM bill_items WHERE id=?').get(iid) as any;
      if (!row) return fail(`Bill line #${iid} was not found — it may already have been removed.`);
      const bill = d.prepare('SELECT status FROM bills WHERE id=?').get(row.bill_id) as any;
      if (bill?.status === 'paid' || bill?.status === 'cancelled') {
        return fail(`Cannot change a bill that is "${bill.status}".`);
      }
      d.prepare('DELETE FROM bill_items WHERE id=?').run(iid);
      const totals = recalcBill(d, row.bill_id);
      broadcastEvent('bill:updated', { billId: row.bill_id });
      return { ok: true, totals };
    } catch (err: any) {
      return fail(`Could not remove the line: ${err?.message || String(err)}`);
    }
  });

  /** Apply a discount, enforcing the per-role cap from Settings. */
  ipcMain.handle('bill:setDiscount', (_e, billId: number, discount: number, type: 'flat' | 'percent', role: string, reason?: string, by?: string) => {
    const d = db();
    try {
      const bid = requireId(billId, 'Bill');
      const s = getAllSettings(d);
      const amount = Number(discount);
      if (!Number.isFinite(amount) || amount < 0) {
        return fail(`Discount must be zero or more, received ${JSON.stringify(discount)}.`);
      }
      if (s.discount_require_reason && amount > 0 && !reason) {
        return fail('A reason is required for every discount. Settings → Billing → Discounts controls this.');
      }
      const bill = d.prepare('SELECT id, subtotal, status FROM bills WHERE id=?').get(bid) as any;
      if (!bill) return fail(`Bill #${bid} was not found.`);
      if (bill.status === 'paid' || bill.status === 'cancelled') {
        return fail(`Cannot discount a bill that is "${bill.status}".`);
      }

      const cap = discountCapForRole(s.discount_caps_json, role);
      const asPercent = type === 'percent' ? amount : (bill.subtotal > 0 ? (amount / bill.subtotal) * 100 : 0);
      if (asPercent > cap) {
        return fail(
          `This discount is ${asPercent.toFixed(1)}% but the "${role}" role is limited to ${cap}%. ` +
          `Ask an administrator, or raise the limit in Settings → Billing → Discounts.`
        );
      }

      d.prepare('UPDATE bills SET discount=?, discount_type=?, discount_reason=?, discount_by=? WHERE id=?')
        .run(amount, type, reason ?? null, by ?? null, bid);
      const totals = recalcBill(d, bid);
      logAudit(d, null, 'bill_discounted', 'bills', bid, `${amount} ${type} by ${role}${reason ? ' · ' + reason : ''}`);
      return { ok: true, totals };
    } catch (err: any) {
      return fail(`Could not apply the discount: ${err?.message || String(err)}`);
    }
  });

  ipcMain.handle('bill:pay', (_e, billId: number, amount: number, mode: string, by?: string) => {
    const d = db();
    try {
      const bid = requireId(billId, 'Bill');
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        return fail(`Payment amount must be greater than zero, received ${JSON.stringify(amount)}.`);
      }
      const bill = d.prepare('SELECT id, total, status FROM bills WHERE id=?').get(bid) as any;
      if (!bill) return fail(`Bill #${bid} was not found.`);
      if (bill.status === 'cancelled') return fail('This bill has been cancelled and cannot take a payment.');

      const tx = d.transaction(() => {
        d.prepare('INSERT INTO bill_payments (bill_id, amount, payment_mode, received_by) VALUES (?,?,?,?)')
          .run(bid, amt, mode || 'Cash', by ?? null);
        const paid = (d.prepare('SELECT COALESCE(SUM(amount),0) AS p FROM bill_payments WHERE bill_id=?').get(bid) as any).p;
        const adv = (d.prepare('SELECT COALESCE(SUM(amount - refunded_amount),0) AS a FROM advances WHERE admission_id=(SELECT admission_id FROM bills WHERE id=?)').get(bid) as any).a || 0;
        const settled = paid + adv >= bill.total - 0.01;
        d.prepare('UPDATE bills SET amount_paid=?, status=?, paid_at=COALESCE(paid_at, ?) WHERE id=?')
          .run(money(paid), settled ? 'paid' : 'part_paid', new Date().toISOString(), bid);
      });
      tx();
      broadcastEvent('bill:updated', { billId: bid });
      return { ok: true };
    } catch (err: any) {
      return fail(`Could not record the payment: ${err?.message || String(err)}`);
    }
  });

  // ---------- Analytics ----------
  /**
   * IPD and billing metrics for a date range. IPD had zero analytics before;
   * this powers the new dashboard section.
   */
  ipcMain.handle('analytics:ipd', (_e, from: string, to: string) => {
    const d = db();
    try {
      const range = [from, to];

      const occupancy = d.prepare(
        `SELECT
           (SELECT COUNT(*) FROM beds WHERE is_active=1) AS total_beds,
           (SELECT COUNT(*) FROM beds WHERE is_active=1 AND status='occupied') AS occupied_beds`
      ).get() as { total_beds: number; occupied_beds: number };

      const admissions = d.prepare(
        `SELECT COUNT(*) AS c FROM ip_admissions WHERE date(admitted_at) BETWEEN ? AND ?`
      ).get(...range) as { c: number };

      const discharges = d.prepare(
        `SELECT COUNT(*) AS c FROM ip_admissions WHERE discharged_at IS NOT NULL AND date(discharged_at) BETWEEN ? AND ?`
      ).get(...range) as { c: number };

      // Average length of stay for admissions discharged in range, in days.
      const alos = d.prepare(
        `SELECT AVG(julianday(discharged_at) - julianday(admitted_at)) AS d
         FROM ip_admissions WHERE discharged_at IS NOT NULL AND date(discharged_at) BETWEEN ? AND ?`
      ).get(...range) as { d: number | null };

      // Outcome mix — the LAMA/DAMA/death breakdown for quality indicators.
      const outcomes = d.prepare(
        `SELECT COALESCE(outcome, 'in_progress') AS outcome, COUNT(*) AS count
         FROM ip_admissions
         WHERE (discharged_at IS NOT NULL AND date(discharged_at) BETWEEN ? AND ?)
            OR (discharged_at IS NULL AND date(admitted_at) BETWEEN ? AND ?)
         GROUP BY outcome`
      ).all(from, to, from, to) as { outcome: string; count: number }[];

      const totalClosed = outcomes.filter((o) => o.outcome !== 'in_progress').reduce((s, o) => s + o.count, 0);
      const deaths = outcomes.find((o) => o.outcome === 'death')?.count ?? 0;
      const lamas = (outcomes.find((o) => o.outcome === 'lama')?.count ?? 0) + (outcomes.find((o) => o.outcome === 'dama')?.count ?? 0);

      const byDoctor = d.prepare(
        `SELECT COALESCE(dr.name, 'Unassigned') AS doctor, COUNT(*) AS admissions,
                AVG(CASE WHEN a.discharged_at IS NOT NULL THEN julianday(a.discharged_at) - julianday(a.admitted_at) END) AS alos
         FROM ip_admissions a LEFT JOIN doctors dr ON dr.id = a.admission_doctor_id
         WHERE date(a.admitted_at) BETWEEN ? AND ?
         GROUP BY a.admission_doctor_id ORDER BY admissions DESC`
      ).all(...range) as any[];

      const byWard = d.prepare(
        `SELECT COALESCE(w.name, a.ward, 'Unknown') AS ward, COUNT(*) AS admissions
         FROM ip_admissions a LEFT JOIN wards w ON w.id = a.ward_id
         WHERE date(a.admitted_at) BETWEEN ? AND ?
         GROUP BY ward ORDER BY admissions DESC`
      ).all(...range) as any[];

      const revenue = d.prepare(
        `SELECT COALESCE(SUM(total), 0) AS total FROM bills
         WHERE bill_type='ipd' AND status != 'cancelled' AND date(created_at) BETWEEN ? AND ?`
      ).get(...range) as { total: number };

      return {
        ok: true,
        occupancyPct: occupancy.total_beds ? Math.round((occupancy.occupied_beds / occupancy.total_beds) * 100) : 0,
        totalBeds: occupancy.total_beds,
        occupiedBeds: occupancy.occupied_beds,
        admissions: admissions.c,
        discharges: discharges.c,
        alosDays: alos.d ? Math.round(alos.d * 10) / 10 : 0,
        outcomes,
        mortalityRate: totalClosed ? Math.round((deaths / totalClosed) * 1000) / 10 : 0,
        lamaRate: totalClosed ? Math.round((lamas / totalClosed) * 1000) / 10 : 0,
        byDoctor,
        byWard,
        ipdRevenue: money(revenue.total),
      };
    } catch (err: any) {
      return fail(`Could not build IPD analytics: ${err?.message || String(err)}`);
    }
  });

  ipcMain.handle('analytics:billing', (_e, from: string, to: string) => {
    const d = db();
    try {
      const range = [from, to];

      const collections = d.prepare(
        `SELECT payment_mode, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
         FROM bill_payments WHERE date(received_at) BETWEEN ? AND ? GROUP BY payment_mode`
      ).all(...range) as any[];

      const outstanding = d.prepare(
        `SELECT COALESCE(SUM(total - amount_paid - advance_adjusted), 0) AS due
         FROM bills WHERE status IN ('open','part_paid','finalised') AND status != 'cancelled'`
      ).get() as { due: number };

      const gst = d.prepare(
        `SELECT COALESCE(SUM(cgst_total), 0) AS cgst, COALESCE(SUM(sgst_total), 0) AS sgst,
                COALESCE(SUM(taxable_total), 0) AS taxable, COALESCE(SUM(exempt_total), 0) AS exempt
         FROM bills WHERE is_tax_invoice=1 AND status != 'cancelled' AND date(created_at) BETWEEN ? AND ?`
      ).get(...range) as any;

      // Section-wise revenue from the charge-head category on each line.
      const bySection = d.prepare(
        `SELECT COALESCE(ch.category, 'other') AS category, COALESCE(SUM(bi.amount), 0) AS total
         FROM bill_items bi
         JOIN bills b ON b.id = bi.bill_id
         LEFT JOIN charge_heads ch ON ch.id = bi.charge_head_id
         WHERE b.status != 'cancelled' AND date(b.created_at) BETWEEN ? AND ?
         GROUP BY ch.category ORDER BY total DESC`
      ).all(...range) as any[];

      return {
        ok: true,
        collections,
        totalCollected: money(collections.reduce((s, c) => s + c.total, 0)),
        outstanding: money(outstanding.due),
        gst: { cgst: money(gst.cgst), sgst: money(gst.sgst), total: money(gst.cgst + gst.sgst), taxable: money(gst.taxable), exempt: money(gst.exempt) },
        bySection,
      };
    } catch (err: any) {
      return fail(`Could not build billing analytics: ${err?.message || String(err)}`);
    }
  });

  // ---------- Advances ----------
  ipcMain.handle('advances:refund', (_e, advanceId: number, amount: number, reason: string, by?: string) => {
    const d = db();
    try {
      const id = requireId(advanceId, 'Advance');
      const amt = Number(amount);
      const adv = d.prepare('SELECT id, amount, adjusted_amount, refunded_amount FROM advances WHERE id=?').get(id) as any;
      if (!adv) return fail(`Advance receipt #${id} was not found.`);
      const available = money(adv.amount - adv.adjusted_amount - adv.refunded_amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        return fail(`Refund amount must be greater than zero, received ${JSON.stringify(amount)}.`);
      }
      if (amt > available) {
        return fail(`Only ₹${available} is available to refund on this receipt (₹${adv.adjusted_amount} already adjusted against the bill, ₹${adv.refunded_amount} already refunded).`);
      }
      if (!reason) return fail('Please record why the advance is being refunded.');

      d.prepare('UPDATE advances SET refunded_amount=refunded_amount+?, refunded_at=?, refunded_by=?, refund_reason=? WHERE id=?')
        .run(amt, new Date().toISOString(), by ?? null, reason, id);
      logAudit(d, null, 'advance_refunded', 'advances', id, `₹${amt} · ${reason}`);
      return { ok: true, refunded: amt, remaining: money(available - amt) };
    } catch (err: any) {
      return fail(`Could not process the refund: ${err?.message || String(err)}`);
    }
  });
}
