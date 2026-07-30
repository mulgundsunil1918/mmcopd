// WhatsApp automation scheduler — runs every 60s in the main process.
// Evaluates automation rules and enqueues template messages when conditions are met.

import type Database from 'better-sqlite3';

interface AutomationRow {
  id: number;
  account_id: number;
  trigger: string;
  template_name: string;
  is_enabled: number;
  delay_minutes: number;
  extra_config: string | null;
}

export function runAutomationScheduler(db: Database.Database): void {
  const rules = db
    .prepare<[], AutomationRow>(
      `SELECT r.*, a.id as acct_id FROM wa_automation_rules r
       JOIN wa_accounts a ON a.id = r.account_id
       WHERE r.is_enabled = 1 AND a.status = 'connected'`
    )
    .all();

  for (const rule of rules) {
    try {
      switch (rule.trigger) {
        case 'appointment_reminder_24h':
          enqueueReminders(db, rule, 24 * 60, 26 * 60);
          break;
        case 'appointment_reminder_1h':
          enqueueReminders(db, rule, 60, 90);
          break;
        case 'followup_reminder_3d':
          enqueueFollowupReminders(db, rule);
          break;
        case 'birthday_wish':
          enqueueBirthdayWishes(db, rule);
          break;
        case 'feedback_request':
          enqueueFeedbackRequests(db, rule);
          break;
        case 'vaccination_reminder':
          enqueueVaccinationReminders(db, rule);
          break;
        // appointment_created, appointment_completed, prescription_generated,
        // lab_report_ready, bill_generated are triggered imperatively from IPC
        // handlers rather than polled — no polling case needed here.
        default:
          break;
      }
    } catch (e) {
      console.error('[WA scheduler] rule', rule.trigger, 'error:', e);
    }
  }
}

function alreadyQueued(db: Database.Database, accountId: number, appointmentId: number | null, templateName: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM wa_message_queue
       WHERE account_id = ? AND appointment_id IS ? AND template_name = ?
         AND status IN ('pending', 'sent')
       LIMIT 1`
    )
    .get(accountId, appointmentId, templateName) as unknown;
  return !!row;
}

function enqueueReminders(
  db: Database.Database,
  rule: AutomationRow,
  windowFromMin: number,
  windowToMin: number
) {
  const rows = db
    .prepare(
      `SELECT a.id as appointment_id, a.patient_id, p.phone, p.first_name, p.last_name,
              a.appointment_date, a.appointment_time, d.name as doctor_name
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       JOIN doctors d ON d.id = a.doctor_id
       WHERE a.status NOT IN ('Cancelled', 'Completed')
         AND (julianday(a.appointment_date || ' ' || a.appointment_time) - julianday('now')) * 1440
             BETWEEN ? AND ?`
    )
    .all(windowFromMin, windowToMin) as Array<{
    appointment_id: number;
    patient_id: number;
    phone: string;
    first_name: string;
    last_name: string;
    appointment_date: string;
    appointment_time: string;
    doctor_name: string;
  }>;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO wa_message_queue
     (account_id, to_phone, patient_id, appointment_id, template_name, template_vars, status, scheduled_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))`
  );

  for (const row of rows) {
    if (alreadyQueued(db, rule.account_id, row.appointment_id, rule.template_name)) continue;
    insert.run(
      rule.account_id,
      normalizePhone(row.phone),
      row.patient_id,
      row.appointment_id,
      rule.template_name,
      JSON.stringify({
        '1': `${row.first_name} ${row.last_name}`.trim(),
        '2': row.doctor_name,
        '3': row.appointment_date,
        '4': row.appointment_time,
      })
    );
  }
}

function enqueueFollowupReminders(db: Database.Database, rule: AutomationRow) {
  const rows = db
    .prepare(
      `SELECT c.id, c.patient_id, c.follow_up_date, p.phone, p.first_name, p.last_name
       FROM consultations c
       JOIN patients p ON p.id = c.patient_id
       WHERE c.follow_up_date IS NOT NULL
         AND (julianday(c.follow_up_date) - julianday('now')) BETWEEN 2.5 AND 3.5`
    )
    .all() as Array<{
    id: number;
    patient_id: number;
    follow_up_date: string;
    phone: string;
    first_name: string;
    last_name: string;
  }>;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO wa_message_queue
     (account_id, to_phone, patient_id, template_name, template_vars, status, scheduled_at)
     VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))`
  );

  for (const row of rows) {
    if (alreadyQueued(db, rule.account_id, null, rule.template_name)) continue;
    insert.run(
      rule.account_id,
      normalizePhone(row.phone),
      row.patient_id,
      rule.template_name,
      JSON.stringify({
        '1': `${row.first_name} ${row.last_name}`.trim(),
        '2': row.follow_up_date,
      })
    );
  }
}

function enqueueBirthdayWishes(db: Database.Database, rule: AutomationRow) {
  const today = new Date().toISOString().slice(5, 10); // MM-DD
  const rows = db
    .prepare(
      `SELECT id, phone, first_name, last_name FROM patients
       WHERE substr(dob, 6, 5) = ?`
    )
    .all(today) as Array<{ id: number; phone: string; first_name: string; last_name: string }>;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO wa_message_queue
     (account_id, to_phone, patient_id, template_name, template_vars, status, scheduled_at)
     VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))`
  );

  for (const row of rows) {
    if (alreadyQueued(db, rule.account_id, null, rule.template_name)) continue;
    insert.run(
      rule.account_id,
      normalizePhone(row.phone),
      row.id,
      rule.template_name,
      JSON.stringify({ '1': `${row.first_name} ${row.last_name}`.trim() })
    );
  }
}

function enqueueFeedbackRequests(db: Database.Database, rule: AutomationRow) {
  // Find appointments marked Done whose scheduled time was 2–4 hours ago
  const rows = db
    .prepare(
      `SELECT a.id as appointment_id, a.patient_id, p.phone, p.first_name, p.last_name
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       WHERE a.status = 'Done'
         AND (julianday('now') - julianday(a.appointment_date || ' ' || a.appointment_time)) * 1440 BETWEEN 120 AND 240`
    )
    .all() as Array<{ appointment_id: number; patient_id: number; phone: string; first_name: string; last_name: string }>;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO wa_message_queue
     (account_id, to_phone, patient_id, appointment_id, template_name, template_vars, status, scheduled_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))`
  );

  for (const row of rows) {
    if (alreadyQueued(db, rule.account_id, row.appointment_id, rule.template_name)) continue;
    insert.run(
      rule.account_id,
      normalizePhone(row.phone),
      row.patient_id,
      row.appointment_id,
      rule.template_name,
      JSON.stringify({ '1': `${row.first_name} ${row.last_name}`.trim() })
    );
  }
}

function enqueueVaccinationReminders(db: Database.Database, rule: AutomationRow) {
  // Find patients who received a vaccination (misc bill item containing 'vacc') 27-30 days ago
  // and remind them about their next dose.
  const rows = db.prepare(
    `SELECT DISTINCT p.id as patient_id, p.phone, p.first_name, p.last_name, b.id as bill_id
     FROM bills b
     JOIN patients p ON p.id = b.patient_id
     WHERE b.bill_kind = 'misc'
       AND (julianday('now') - julianday(b.created_at)) BETWEEN 27 AND 30
       AND lower(b.items_json) LIKE '%vacc%'`
  ).all() as Array<{ patient_id: number; phone: string; first_name: string; last_name: string; bill_id: number }>;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO wa_message_queue
     (account_id, to_phone, patient_id, template_name, template_vars, status, scheduled_at)
     VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))`
  );

  for (const row of rows) {
    if (alreadyQueued(db, rule.account_id, null, rule.template_name)) continue;
    insert.run(
      rule.account_id,
      normalizePhone(row.phone),
      row.patient_id,
      rule.template_name,
      JSON.stringify({ '1': `${row.first_name} ${row.last_name}`.trim() })
    );
  }
}

/** Normalize Indian mobile: strip non-digits, add 91 prefix if 10-digit */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  return digits;
}
