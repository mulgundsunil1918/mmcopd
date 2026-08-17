// Outbound WhatsApp message queue processor.
// Runs in main process. Called via setInterval every 60s, also on startup.
// Picks up pending items from wa_message_queue, sends via Meta API, updates status.

import type Database from 'better-sqlite3';
import { reveal } from './token';
import { sendTemplate } from './meta-api';

const MAX_ATTEMPTS = 3;

interface QueueRow {
  id: number;
  account_id: number;
  to_phone: string;
  template_name: string;
  template_vars: string | null;
  attempts: number;
  phone_number_id: string;
  access_token_enc: string;
}

export async function processQueue(db: Database.Database): Promise<void> {
  // Pull up to 20 pending/failed-retryable items
  const rows = (db
    .prepare(
      `SELECT q.id, q.account_id, q.to_phone, q.template_name, q.template_vars,
              q.attempts, a.phone_number_id, a.access_token_enc
       FROM wa_message_queue q
       JOIN wa_accounts a ON a.id = q.account_id
       WHERE q.status = 'pending'
         AND q.attempts < ?
         AND q.scheduled_at <= datetime('now')
         AND a.status = 'connected'
       ORDER BY q.scheduled_at
       LIMIT 20`
    )
    .all(MAX_ATTEMPTS)) as QueueRow[];

  const updateStatus = db.prepare(
    `UPDATE wa_message_queue SET status = ?, attempts = attempts + 1, last_error = ?, sent_at = ? WHERE id = ?`
  );
  const logMessage = db.prepare(
    `INSERT INTO wa_messages (account_id, wam_id, patient_id, direction, message_type, content, status, timestamp)
     SELECT account_id, ?, patient_id, 'outbound', 'template', ?, 'sent', datetime('now')
     FROM wa_message_queue WHERE id = ?`
  );

  for (const row of rows) {
    let vars: Record<string, string> = {};
    try {
      if (row.template_vars) vars = JSON.parse(row.template_vars);
    } catch {
      // malformed vars — send without components
    }

    // Build body components from flat vars object: {1: "val", 2: "val"} → parameters
    const bodyParams = Object.entries(vars)
      .filter(([k]) => !isNaN(Number(k)))
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, v]) => ({ type: 'text', text: v }));

    const components = bodyParams.length
      ? [{ type: 'body' as const, parameters: bodyParams }]
      : undefined;

    const result = await sendTemplate(
      row.phone_number_id,
      // reveal(): the column stores an OBFUSCATED token. Passing it raw meant
      // every queued and scheduled message authenticated with gibberish and was
      // rejected by Meta — silently, since the failure looked like a send error.
      reveal(row.access_token_enc),
      row.to_phone,
      row.template_name,
      vars.lang ?? 'en',
      components
    );

    if (result.ok) {
      updateStatus.run('sent', null, new Date().toISOString(), row.id);
      logMessage.run(result.wam_id ?? null, JSON.stringify({ template: row.template_name, vars }), row.id);
    } else {
      const isFinal = row.attempts + 1 >= MAX_ATTEMPTS;
      updateStatus.run(isFinal ? 'failed' : 'pending', result.error ?? null, null, row.id);
    }
  }
}
