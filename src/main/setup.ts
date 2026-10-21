/**
 * First-run setup guide — where a freshly installed clinic stands.
 *
 * The guide itself (clinic details, doctors, fees, staff logins, pharmacy, wards) is a set of screens in the app; what
 * this file decides is only WHEN it should appear and what has been done, so it behaves the same on every start:
 *
 *   - A clinic that already has data (an upgrade, a restored backup, any clinic that has been used) is never shown the
 *     guide: the first time it is asked, that is recorded as "done" for good.
 *   - A genuinely fresh install is shown the guide until it is finished or skipped. Closing the app half-way brings it
 *     back on the next start; each step that was saved or skipped is remembered.
 *   - Skipping is always allowed — except for the one thing nothing works without: the CLINIC NAME. Until it is entered,
 *     the guide cannot be skipped or finished (it prints on every bill, slip and report).
 *   - A PC that joins another as a client never shows it: the main PC holds the clinic's details.
 *
 * Plain functions over a better-sqlite3 handle (no Electron) so each rule can be tested on a real database. The state is a
 * single JSON value in the settings table (key `setup_wizard`), not part of the Settings type, so it is backed up and
 * restored with everything else and never reaches the settings screens.
 */

import type Database from 'better-sqlite3';

export const SETUP_STEPS = ['clinic', 'doctors', 'fees', 'staff', 'pharmacy', 'inpatient'] as const;
export type SetupStepKey = (typeof SETUP_STEPS)[number];
export type SetupStepState = 'todo' | 'done' | 'skipped';
export type SetupGuideStatus = 'pending' | 'skipped' | 'done';

const KEY = 'setup_wizard';

interface Stored {
  status: SetupGuideStatus;
  /** Why it was settled: a clinic that already had data, or the person finishing / skipping it. */
  origin: 'fresh' | 'existing-clinic';
  steps: Partial<Record<SetupStepKey, 'done' | 'skipped'>>;
  /** After a skip: the person asked not to be reminded again. */
  reminder_off?: boolean;
  updated_at: string;
}

export interface SetupStatus {
  /** Show the first-run guide now. */
  show: boolean;
  status: SetupGuideStatus;
  /** The clinic name has been entered (read raw — the app's "CureDesk HMS" stand-in does not count). */
  clinic_named: boolean;
  clinic_name: string;
  /** True for a clinic that already had data when the guide was first looked at (never shown the guide). */
  existing_clinic: boolean;
  steps: Record<SetupStepKey, SetupStepState>;
  /** Show the slim "setup is not finished" reminder (the guide was skipped and not every step is done). */
  reminder: boolean;
}

const now = () => new Date().toISOString();

function rawClinicName(db: Database.Database): string {
  const r = db.prepare("SELECT value FROM settings WHERE key='clinic_name'").get() as { value: string } | undefined;
  return String(r?.value ?? '').trim();
}

function networkMode(db: Database.Database): string {
  const r = db.prepare("SELECT value FROM settings WHERE key='network_mode'").get() as { value: string } | undefined;
  return String(r?.value ?? 'local');
}

/** Anything that shows the clinic has been used: people, visits, money, stock. */
function hasActivity(db: Database.Database): boolean {
  const n = (db.prepare(`
    SELECT (SELECT COUNT(*) FROM patients) + (SELECT COUNT(*) FROM doctors) + (SELECT COUNT(*) FROM appointments)
         + (SELECT COUNT(*) FROM bills) + (SELECT COUNT(*) FROM pharmacy_sales) + (SELECT COUNT(*) FROM ip_admissions) AS n
  `).get() as { n: number }).n;
  return n > 0;
}

function load(db: Database.Database): Stored | null {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(KEY) as { value: string } | undefined;
  if (!r) return null;
  try {
    const v = JSON.parse(r.value);
    if (v && (v.status === 'pending' || v.status === 'skipped' || v.status === 'done')) {
      return { status: v.status, origin: v.origin === 'existing-clinic' ? 'existing-clinic' : 'fresh', steps: v.steps && typeof v.steps === 'object' ? v.steps : {}, reminder_off: !!v.reminder_off, updated_at: String(v.updated_at ?? '') };
    }
  } catch { /* a damaged value is treated as never started */ }
  return null;
}

function save(db: Database.Database, s: Stored) {
  s.updated_at = now();
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(KEY, JSON.stringify(s));
}

function stepMap(s: Stored | null): Record<SetupStepKey, SetupStepState> {
  const out = {} as Record<SetupStepKey, SetupStepState>;
  for (const k of SETUP_STEPS) out[k] = s?.steps?.[k] ?? 'todo';
  return out;
}

/**
 * Where the guide stands. Asking is safe at any time: the only thing it ever writes is the one-time note made the first
 * time it is asked — "this clinic already has data, it is done" (what keeps an upgraded clinic from ever being shown the
 * guide) or "this clinic is fresh" (what keeps a half-finished guide from being mistaken for an old clinic).
 */
export function setupStatus(db: Database.Database): SetupStatus {
  const named = rawClinicName(db);
  let stored = load(db);

  if (networkMode(db) === 'client') {
    // An extra PC borrows the main PC's clinic; its own database is not the clinic's.
    return { show: false, status: 'done', clinic_named: true, clinic_name: named, existing_clinic: false, steps: stepMap(stored), reminder: false };
  }
  if (!stored) {
    // The first look settles it for good: a clinic with data is done; an empty one is fresh and stays "pending" from now
    // on — so a doctor or patient added half-way through the guide can never make it look like an existing clinic.
    stored = hasActivity(db)
      ? { status: 'done', origin: 'existing-clinic', steps: {}, updated_at: now() }
      : { status: 'pending', origin: 'fresh', steps: {}, updated_at: now() };
    save(db, stored);
  }
  const status: SetupGuideStatus = stored.status;
  const steps = stepMap(stored);
  const incomplete = SETUP_STEPS.some((k) => steps[k] !== 'done');
  return {
    show: status === 'pending',
    status,
    clinic_named: named.length > 0,
    clinic_name: named,
    existing_clinic: stored.origin === 'existing-clinic',
    steps,
    // A skipped guide leaves a gentle reminder until every step is done or the person says to stop.
    reminder: status === 'skipped' && incomplete && !stored.reminder_off,
  };
}

/** Remember that a step was saved or skipped (the guide resumes from here after a restart). */
export function markSetupStep(db: Database.Database, step: string, outcome: 'done' | 'skipped'): SetupStatus {
  if (!(SETUP_STEPS as readonly string[]).includes(step)) throw new Error(`"${step}" is not a setup step.`);
  if (outcome !== 'done' && outcome !== 'skipped') throw new Error('A step is either done or skipped.');
  const cur = load(db) ?? { status: 'pending' as SetupGuideStatus, origin: 'fresh' as const, steps: {}, updated_at: now() };
  // A step already saved is never downgraded to "skipped" by pressing skip on a later visit.
  if (!(cur.steps[step as SetupStepKey] === 'done' && outcome === 'skipped')) cur.steps[step as SetupStepKey] = outcome;
  save(db, cur);
  return setupStatus(db);
}

/**
 * Settle the guide, or open it again.
 *   'done' / 'skipped' — need the clinic name; nothing else is ever required.
 *   'pending'          — open it again from Settings (what was saved is kept).
 *   'done' + stop_reminders — "I will do the rest myself".
 */
export function setSetupStatus(db: Database.Database, status: string, opts: { stop_reminders?: boolean } = {}): SetupStatus {
  if (status !== 'pending' && status !== 'skipped' && status !== 'done') throw new Error('Setup can be pending, skipped or done.');
  if ((status === 'skipped' || status === 'done') && !rawClinicName(db)) {
    throw new Error('Enter the clinic name first — it prints on every bill, slip and report, and the software cannot be used without it.');
  }
  const cur = load(db) ?? { status: 'pending' as SetupGuideStatus, origin: 'fresh' as const, steps: {}, updated_at: now() };
  cur.status = status;
  if (opts.stop_reminders) cur.reminder_off = true;
  if (status === 'pending') cur.reminder_off = false;
  save(db, cur);
  return setupStatus(db);
}
