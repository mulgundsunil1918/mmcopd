// Imperative WhatsApp trigger — call from any IPC handler to fire a WA automation event.
// The scheduler handles polled triggers (reminders, birthdays); this handles push events.

import type Database from 'better-sqlite3';

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  return digits;
}

export function enqueueWaEvent(
  db: Database.Database,
  trigger: string,
  opts: {
    patientId: number;
    phone: string;
    appointmentId?: number | null;
    vars?: Record<string, string>;
  }
): void {
  const rules = db.prepare(
    `SELECT r.account_id, r.template_name
     FROM wa_automation_rules r
     JOIN wa_accounts a ON a.id = r.account_id
     WHERE r.trigger = ? AND r.is_enabled = 1 AND a.status = 'connected'`
  ).all(trigger) as { account_id: number; template_name: string }[];

  if (rules.length === 0) return;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO wa_message_queue
     (account_id, to_phone, patient_id, appointment_id, template_name, template_vars, status, scheduled_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))`
  );

  const toPhone = normalizePhone(opts.phone);

  for (const rule of rules) {
    // Deduplicate within the same day to avoid spam on repeated saves
    const exists = db.prepare(
      `SELECT 1 FROM wa_message_queue
       WHERE account_id=? AND patient_id=? AND template_name=? AND status IN ('pending','sent')
         AND date(scheduled_at)=date('now') LIMIT 1`
    ).get(rule.account_id, opts.patientId, rule.template_name);
    if (exists) continue;

    insert.run(
      rule.account_id,
      toPhone,
      opts.patientId,
      opts.appointmentId ?? null,
      rule.template_name,
      opts.vars ? JSON.stringify(opts.vars) : null
    );
  }
}
