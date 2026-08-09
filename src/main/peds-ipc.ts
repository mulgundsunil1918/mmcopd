/**
 * Pediatrics IPC handlers — growth measurements and the immunisation diary.
 *
 * The centile maths lives in src/lib/peds/growth.ts (shared with the renderer);
 * the backend just persists what the doctor records. Vaccine schedules (IAP /
 * NIS) are bundled JSON from the pediaid project.
 *
 * Error policy matches the rest of the app: no silent catch, every failure
 * returns a specific message.
 */

import { ipcMain } from 'electron';
import { getDb } from '../db/db';
import { getAllSettings } from '../db/settings';
import { logAudit } from './auth';
import iapSchedule from '../data/peds/iap_schedule.json';
import nisSchedule from '../data/peds/nis_schedule.json';

const fail = (error: string) => ({ ok: false as const, error });

function reqId(v: unknown, label: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${label} must be a positive whole number, received ${JSON.stringify(v)}.`);
  return n;
}

/**
 * Flatten a bundled schedule ("At Birth" / "6,10,14 weeks" → rows) into a
 * generic list the diary can seed from. Each entry keeps its human age label;
 * a due date is computed from the child's DOB where the label parses.
 */
interface ScheduleEntry { vaccine: string; schedule_age: string; dose?: string; route?: string; site?: string; brands?: string[] }

function flattenSchedule(which: 'iap' | 'nis'): ScheduleEntry[] {
  const src: any = which === 'nis' ? nisSchedule : iapSchedule;
  const out: ScheduleEntry[] = [];
  for (const block of src?.data ?? []) {
    for (const e of block?.entries ?? []) {
      if (e?.type === 'structured' && e?.vaccine) {
        out.push({ vaccine: e.vaccine, schedule_age: block.age ?? '', dose: e.dose, route: e.route, site: e.site, brands: e.brands });
      }
    }
  }
  return out;
}

/** Best-effort due-date from an age label like "6 weeks" / "9 months" / "At Birth". */
function dueDateFromLabel(dobISO: string, label: string): string | null {
  const dob = new Date(dobISO);
  if (Number.isNaN(dob.getTime())) return null;
  const l = (label || '').toLowerCase();
  if (l.includes('birth')) return dob.toISOString().slice(0, 10);
  const weeks = /(\d+)\s*week/.exec(l);
  const months = /(\d+)\s*month/.exec(l);
  const years = /(\d+)\s*year/.exec(l);
  const d = new Date(dob);
  if (weeks) d.setDate(d.getDate() + parseInt(weeks[1], 10) * 7);
  else if (months) d.setMonth(d.getMonth() + parseInt(months[1], 10));
  else if (years) d.setFullYear(d.getFullYear() + parseInt(years[1], 10));
  else return null;
  return d.toISOString().slice(0, 10);
}

export function registerPedsIpc() {
  const db = () => getDb();

  // ---------- Growth ----------
  ipcMain.handle('peds:growthList', (_e, patientId: number) => {
    const id = reqId(patientId, 'Patient');
    return db().prepare(
      'SELECT * FROM peds_growth_measurements WHERE patient_id=? ORDER BY measured_on DESC, id DESC'
    ).all(id);
  });

  ipcMain.handle('peds:growthAdd', (_e, patientId: number, input: any) => {
    const d = db();
    try {
      const id = reqId(patientId, 'Patient');
      if (!d.prepare('SELECT id FROM patients WHERE id=?').get(id)) return fail(`Patient #${id} was not found.`);
      const anyValue = ['weight_kg', 'height_cm', 'head_circ_cm'].some((k) => Number(input?.[k]) > 0);
      if (!anyValue) return fail('Enter at least one of weight, height or head circumference.');

      const info = d.prepare(
        `INSERT INTO peds_growth_measurements
           (patient_id, measured_on, age_days, weight_kg, height_cm, head_circ_cm, bmi,
            wfa_z, lhfa_z, hcfa_z, bfa_z, wfa_c, lhfa_c, hcfa_c, bfa_c, notes, recorded_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        id, input.measured_on ?? new Date().toISOString().slice(0, 10), input.age_days ?? null,
        num(input.weight_kg), num(input.height_cm), num(input.head_circ_cm), num(input.bmi),
        num(input.wfa_z), num(input.lhfa_z), num(input.hcfa_z), num(input.bfa_z),
        num(input.wfa_c), num(input.lhfa_c), num(input.hcfa_c), num(input.bfa_c),
        input.notes ?? null, input.recorded_by ?? null
      );
      logAudit(d, null, 'peds_growth_added', 'peds_growth_measurements', Number(info.lastInsertRowid));
      return { ok: true, id: Number(info.lastInsertRowid) };
    } catch (err: any) {
      return fail(`Could not save the measurement: ${err?.message || String(err)}`);
    }
  });

  ipcMain.handle('peds:growthDelete', (_e, id: number) => {
    try {
      db().prepare('DELETE FROM peds_growth_measurements WHERE id=?').run(reqId(id, 'Measurement'));
      return { ok: true };
    } catch (err: any) {
      return fail(`Could not delete: ${err?.message || String(err)}`);
    }
  });

  // ---------- Vaccines ----------
  ipcMain.handle('peds:vaccineList', (_e, patientId: number) => {
    const id = reqId(patientId, 'Patient');
    return db().prepare(
      'SELECT * FROM peds_vaccine_records WHERE patient_id=? ORDER BY (due_date IS NULL), due_date, id'
    ).all(id);
  });

  /** Seed the diary for a child from the configured schedule (idempotent-ish:
   *  skips vaccines already present). */
  ipcMain.handle('peds:vaccineSeed', (_e, patientId: number) => {
    const d = db();
    try {
      const id = reqId(patientId, 'Patient');
      const patient = d.prepare('SELECT dob FROM patients WHERE id=?').get(id) as { dob: string } | undefined;
      if (!patient) return fail(`Patient #${id} was not found.`);

      const which = (getAllSettings(d).peds_vaccine_schedule || 'iap') as 'iap' | 'nis';
      const entries = flattenSchedule(which);
      const existing = new Set(
        (d.prepare('SELECT vaccine, schedule_age FROM peds_vaccine_records WHERE patient_id=?').all(id) as any[])
          .map((r) => `${r.vaccine}|${r.schedule_age}`)
      );

      const ins = d.prepare(
        `INSERT INTO peds_vaccine_records (patient_id, vaccine, schedule_age, due_date, status, dose, route, site)
         VALUES (?,?,?,?,?,?,?,?)`
      );
      let added = 0;
      const tx = d.transaction(() => {
        for (const e of entries) {
          if (existing.has(`${e.vaccine}|${e.schedule_age}`)) continue;
          const due = patient.dob ? dueDateFromLabel(patient.dob, e.schedule_age) : null;
          const overdue = due && due < new Date().toISOString().slice(0, 10);
          ins.run(id, e.vaccine, e.schedule_age, due, overdue ? 'overdue' : 'due', e.dose ?? null, e.route ?? null, e.site ?? null);
          added++;
        }
      });
      tx();
      return { ok: true, added, schedule: which.toUpperCase() };
    } catch (err: any) {
      return fail(`Could not build the vaccine diary: ${err?.message || String(err)}`);
    }
  });

  ipcMain.handle('peds:vaccineUpdate', (_e, recordId: number, patch: any) => {
    const d = db();
    try {
      const id = reqId(recordId, 'Vaccine record');
      const r = d.prepare('SELECT id FROM peds_vaccine_records WHERE id=?').get(id);
      if (!r) return fail(`Vaccine record #${id} was not found.`);
      const fields: string[] = [];
      const params: any[] = [];
      for (const k of ['status', 'given_date', 'brand', 'batch_no', 'dose', 'route', 'site', 'notes', 'recorded_by']) {
        if (patch?.[k] !== undefined) { fields.push(`${k}=?`); params.push(patch[k]); }
      }
      if (fields.length === 0) return fail('Nothing to update.');
      if (patch?.status === 'given' && !patch?.given_date) {
        fields.push('given_date=?'); params.push(new Date().toISOString().slice(0, 10));
      }
      params.push(id);
      d.prepare(`UPDATE peds_vaccine_records SET ${fields.join(', ')} WHERE id=?`).run(...params);
      return { ok: true };
    } catch (err: any) {
      return fail(`Could not update the vaccine: ${err?.message || String(err)}`);
    }
  });

  ipcMain.handle('peds:vaccineAddCustom', (_e, patientId: number, input: any) => {
    const d = db();
    try {
      const id = reqId(patientId, 'Patient');
      if (!input?.vaccine) return fail('Enter a vaccine name.');
      const info = d.prepare(
        `INSERT INTO peds_vaccine_records (patient_id, vaccine, schedule_age, due_date, status, dose, route, notes)
         VALUES (?,?,?,?,?,?,?,?)`
      ).run(id, input.vaccine, input.schedule_age ?? 'Custom', input.due_date ?? null,
            input.status ?? 'due', input.dose ?? null, input.route ?? null, input.notes ?? null);
      return { ok: true, id: Number(info.lastInsertRowid) };
    } catch (err: any) {
      return fail(`Could not add the vaccine: ${err?.message || String(err)}`);
    }
  });
}

function num(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) && v !== '' && v !== null ? n : null;
}
