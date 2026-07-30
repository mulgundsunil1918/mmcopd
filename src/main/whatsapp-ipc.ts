// WhatsApp Platform IPC handlers — Phase 1
// Registers: wa:connect, wa:health, wa:disconnect, wa:account, wa:accounts
//            wa:templates, wa:syncTemplates, wa:automationRules, wa:setRule
//            wa:queueStats, wa:queueSend, wa:messages, wa:conversations
//            wa:webhookVerify, wa:webhookIngest, wa:processQueue

import { ipcMain } from 'electron';
import type Database from 'better-sqlite3';
import { getDb } from '../db/db';
import { checkHealth, listTemplates, sendTemplate } from '../services/whatsapp/meta-api';
import { processQueue } from '../services/whatsapp/queue-worker';
import type {
  WaConnectInput,
  WaAccount,
  WaTemplate,
  WaAutomationRule,
  WaQueueStats,
  WaConversation,
  WaMessage,
} from '../types/whatsapp';

// Simple XOR-based obfuscation — keeps token out of plaintext in SQLite.
// Not encryption; SQLite file itself must be protected by OS ACLs.
function obscure(token: string): string {
  const key = 'CureDesk-WA-v1';
  return Buffer.from(
    token.split('').map((c, i) => c.charCodeAt(0) ^ key.charCodeAt(i % key.length)).join(',')
  ).toString('base64');
}
function reveal(enc: string): string {
  const key = 'CureDesk-WA-v1';
  return Buffer.from(enc, 'base64')
    .toString()
    .split(',')
    .map((n, i) => String.fromCharCode(parseInt(n) ^ key.charCodeAt(i % key.length)))
    .join('');
}

export function registerWhatsAppIpc() {
  const db = () => getDb();

  // ── Connect a new WhatsApp Business number ──────────────────────────────
  ipcMain.handle('wa:connect', async (_e, input: WaConnectInput) => {
    const health = await checkHealth({ phone_number_id: input.phone_number_id, access_token: input.access_token });
    if (!health.ok) return { ok: false, error: health.error };

    const token = obscure(input.access_token);
    const verifyToken = crypto.randomUUID();
    const d = db();
    const existing = d.prepare(`SELECT id FROM wa_accounts WHERE phone_number_id = ?`).get(input.phone_number_id) as { id: number } | undefined;

    if (existing) {
      d.prepare(
        `UPDATE wa_accounts SET waba_id=?, display_name=?, phone_number=?, access_token_enc=?,
         status='connected', last_health_check=datetime('now'), updated_at=datetime('now')
         WHERE phone_number_id=?`
      ).run(input.waba_id, input.display_name || health.display_name, input.phone_number || health.phone_number, token, input.phone_number_id);
      return { ok: true, id: existing.id };
    }

    const result = d.prepare(
      `INSERT INTO wa_accounts (phone_number_id, waba_id, display_name, phone_number, access_token_enc,
       webhook_verify_token, status, last_health_check)
       VALUES (?, ?, ?, ?, ?, ?, 'connected', datetime('now'))`
    ).run(input.phone_number_id, input.waba_id, input.display_name || health.display_name, input.phone_number || health.phone_number, token, verifyToken);
    return { ok: true, id: result.lastInsertRowid };
  });

  // ── Health check ────────────────────────────────────────────────────────
  ipcMain.handle('wa:health', async (_e, accountId: number) => {
    const acct = db().prepare(`SELECT phone_number_id, access_token_enc FROM wa_accounts WHERE id = ?`).get(accountId) as { phone_number_id: string; access_token_enc: string } | undefined;
    if (!acct) return { ok: false, error: 'Account not found' };
    const result = await checkHealth({ phone_number_id: acct.phone_number_id, access_token: reveal(acct.access_token_enc) });
    if (result.ok) {
      db().prepare(`UPDATE wa_accounts SET status='connected', last_health_check=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(accountId);
    } else {
      db().prepare(`UPDATE wa_accounts SET status='error', updated_at=datetime('now') WHERE id=?`).run(accountId);
    }
    return result;
  });

  // ── Disconnect ──────────────────────────────────────────────────────────
  ipcMain.handle('wa:disconnect', (_e, accountId: number) => {
    db().prepare(`UPDATE wa_accounts SET status='disconnected', updated_at=datetime('now') WHERE id=?`).run(accountId);
    return { ok: true };
  });

  // ── Get single account ──────────────────────────────────────────────────
  ipcMain.handle('wa:account', (_e, accountId: number) => {
    return db().prepare(`SELECT id, phone_number_id, waba_id, display_name, phone_number, webhook_verify_token, status, last_health_check, created_at, updated_at FROM wa_accounts WHERE id=?`).get(accountId) as WaAccount | undefined;
  });

  // ── List accounts ───────────────────────────────────────────────────────
  ipcMain.handle('wa:accounts', () => {
    return db().prepare(`SELECT id, phone_number_id, waba_id, display_name, phone_number, webhook_verify_token, status, last_health_check, created_at, updated_at FROM wa_accounts ORDER BY id`).all() as WaAccount[];
  });

  // ── List templates (from DB) ────────────────────────────────────────────
  ipcMain.handle('wa:templates', (_e, accountId: number) => {
    const rows = db().prepare(`SELECT * FROM wa_templates WHERE account_id=? ORDER BY name`).all(accountId) as Array<Record<string, unknown> & { components: string; is_active: number }>;
    return rows.map(r => ({ ...r, components: JSON.parse((r.components as string) ?? '[]'), is_active: Boolean(r.is_active) }));
  });

  // ── Sync templates from Meta ────────────────────────────────────────────
  ipcMain.handle('wa:syncTemplates', async (_e, accountId: number) => {
    const acct = db().prepare(`SELECT waba_id, access_token_enc FROM wa_accounts WHERE id=?`).get(accountId) as { waba_id: string; access_token_enc: string } | undefined;
    if (!acct) return { ok: false, error: 'Account not found' };
    try {
      const templates = await listTemplates(acct.waba_id, reveal(acct.access_token_enc));
      const upsert = db().prepare(
        `INSERT INTO wa_templates (account_id, name, category, language, status, components, meta_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, name) DO UPDATE SET
           category=excluded.category, language=excluded.language, status=excluded.status,
           components=excluded.components, meta_id=excluded.meta_id, updated_at=datetime('now')`
      );
      const tx = db().transaction(() => {
        for (const t of templates) {
          upsert.run(accountId, t.name, t.category, t.language, t.status, JSON.stringify(t.components), t.id);
        }
      });
      tx();
      return { ok: true, synced: templates.length };
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Automation rules ────────────────────────────────────────────────────
  ipcMain.handle('wa:automationRules', (_e, accountId: number) => {
    return db().prepare(`SELECT * FROM wa_automation_rules WHERE account_id=? ORDER BY trigger`).all(accountId) as WaAutomationRule[];
  });

  ipcMain.handle('wa:setRule', (_e, accountId: number, trigger: string, patch: Partial<WaAutomationRule>) => {
    const existing = db().prepare(`SELECT id FROM wa_automation_rules WHERE account_id=? AND trigger=?`).get(accountId, trigger) as { id: number } | undefined;
    if (existing) {
      const sets = Object.keys(patch).map(k => `${k}=?`).join(', ');
      db().prepare(`UPDATE wa_automation_rules SET ${sets} WHERE id=?`).run(...Object.values(patch), existing.id);
    } else {
      db().prepare(
        `INSERT INTO wa_automation_rules (account_id, trigger, template_name, is_enabled, delay_minutes, extra_config)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(accountId, trigger, patch.template_name ?? '', patch.is_enabled ? 1 : 0, patch.delay_minutes ?? 0, patch.extra_config ? JSON.stringify(patch.extra_config) : null);
    }
    return { ok: true };
  });

  // ── Queue stats ─────────────────────────────────────────────────────────
  ipcMain.handle('wa:queueStats', (_e, accountId: number) => {
    const d = db();
    const today = new Date().toISOString().slice(0, 10);
    const pending = (d.prepare(`SELECT COUNT(*) as c FROM wa_message_queue WHERE account_id=? AND status='pending'`).get(accountId) as { c: number }).c;
    const sent = (d.prepare(`SELECT COUNT(*) as c FROM wa_message_queue WHERE account_id=? AND status='sent' AND date(sent_at)=?`).get(accountId, today) as { c: number }).c;
    const failed = (d.prepare(`SELECT COUNT(*) as c FROM wa_message_queue WHERE account_id=? AND status='failed' AND date(created_at)=?`).get(accountId, today) as { c: number }).c;
    return { pending, sent_today: sent, failed_today: failed, total_today: sent + failed } as WaQueueStats;
  });

  // ── Manual enqueue (send now) ───────────────────────────────────────────
  ipcMain.handle('wa:queueSend', (_e, accountId: number, toPhone: string, templateName: string, vars: Record<string, string>, patientId?: number, appointmentId?: number) => {
    db().prepare(
      `INSERT INTO wa_message_queue (account_id, to_phone, patient_id, appointment_id, template_name, template_vars, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`
    ).run(accountId, toPhone, patientId ?? null, appointmentId ?? null, templateName, JSON.stringify(vars));
    return { ok: true };
  });

  // ── Trigger queue flush immediately ────────────────────────────────────
  ipcMain.handle('wa:processQueue', async (_e, accountId?: number) => {
    await processQueue(db());
    return { ok: true };
  });

  // ── Messages for a conversation ─────────────────────────────────────────
  ipcMain.handle('wa:messages', (_e, accountId: number, conversationId: number, limit = 80) => {
    const rows = db().prepare(
      `SELECT * FROM wa_messages WHERE account_id=? AND conversation_id=? ORDER BY timestamp ASC LIMIT ?`
    ).all(accountId, conversationId, limit) as WaMessage[];
    return rows;
  });

  // ── Conversations list with last-message preview ────────────────────────
  ipcMain.handle('wa:conversations', (_e, accountId: number, status = 'open') => {
    return db().prepare(
      `SELECT c.*,
              p.first_name || ' ' || p.last_name as patient_name,
              p.phone as patient_phone,
              (SELECT content FROM wa_messages WHERE conversation_id=c.id ORDER BY timestamp DESC LIMIT 1) as last_msg_content,
              (SELECT direction FROM wa_messages WHERE conversation_id=c.id ORDER BY timestamp DESC LIMIT 1) as last_msg_direction,
              (SELECT COUNT(*) FROM wa_messages WHERE conversation_id=c.id AND direction='inbound' AND status='delivered') as unread_count
       FROM wa_conversations c
       LEFT JOIN patients p ON p.id = c.patient_id
       WHERE c.account_id=? AND c.status=?
       ORDER BY c.last_message_at DESC`
    ).all(accountId, status);
  });

  // ── Send plain text reply (24-hour service window) ─────────────────────
  ipcMain.handle('wa:sendText', async (_e, accountId: number, conversationId: number, text: string) => {
    const d = db();
    const acct = d.prepare(`SELECT phone_number_id, access_token_enc FROM wa_accounts WHERE id=?`).get(accountId) as { phone_number_id: string; access_token_enc: string } | undefined;
    const conv = d.prepare(`SELECT phone FROM wa_conversations WHERE id=?`).get(conversationId) as { phone: string } | undefined;
    if (!acct || !conv) return { ok: false, error: 'Account or conversation not found' };

    const { sendText } = await import('../services/whatsapp/meta-api');
    const result = await sendText(acct.phone_number_id, reveal(acct.access_token_enc), conv.phone, text);
    if (result.ok) {
      d.prepare(
        `INSERT INTO wa_messages (account_id, wam_id, conversation_id, direction, message_type, content, status, timestamp)
         VALUES (?, ?, ?, 'outbound', 'text', ?, 'sent', datetime('now'))`
      ).run(accountId, result.wam_id ?? null, conversationId, JSON.stringify({ text }));
      d.prepare(`UPDATE wa_conversations SET last_message_at=datetime('now') WHERE id=?`).run(conversationId);
    }
    return result;
  });

  // ── Mark conversation resolved / reopen ────────────────────────────────
  ipcMain.handle('wa:resolveConversation', (_e, conversationId: number, status: 'open' | 'resolved') => {
    db().prepare(`UPDATE wa_conversations SET status=? WHERE id=?`).run(status, conversationId);
    return { ok: true };
  });

  // ── Webhook verification (for relay server) ────────────────────────────
  ipcMain.handle('wa:webhookToken', (_e, accountId: number) => {
    const acct = db().prepare(`SELECT webhook_verify_token FROM wa_accounts WHERE id=?`).get(accountId) as { webhook_verify_token: string } | undefined;
    return acct?.webhook_verify_token ?? null;
  });

  // ── Ingest webhook events polled from relay server ──────────────────────
  ipcMain.handle('wa:ingestWebhookEvents', (_e, accountId: number, events: Array<{ event_type: string; payload: unknown }>) => {
    const insert = db().prepare(
      `INSERT INTO wa_webhook_events (account_id, event_type, payload, processed) VALUES (?, ?, ?, 0)`
    );
    const tx = db().transaction(() => {
      for (const ev of events) {
        insert.run(accountId, ev.event_type, JSON.stringify(ev.payload));
      }
    });
    tx();
    processWebhookEvents(db());
    return { ok: true, ingested: events.length };
  });

  // ── Campaigns ──────────────────────────────────────────────────────────────
  ipcMain.handle('wa:campaigns', (_e, accountId: number) => {
    return db().prepare(
      `SELECT * FROM wa_campaigns WHERE account_id=? ORDER BY created_at DESC`
    ).all(accountId);
  });

  ipcMain.handle('wa:campaignCreate', (_e, accountId: number, input: {
    name: string; template_name: string; template_vars?: Record<string, string>;
    segment: string; segment_config?: Record<string, unknown>; scheduled_at?: string;
  }) => {
    const result = db().prepare(
      `INSERT INTO wa_campaigns (account_id, name, template_name, template_vars, segment, segment_config, scheduled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      accountId, input.name, input.template_name,
      input.template_vars ? JSON.stringify(input.template_vars) : null,
      input.segment,
      input.segment_config ? JSON.stringify(input.segment_config) : null,
      input.scheduled_at ?? null
    );
    return { ok: true, id: result.lastInsertRowid };
  });

  ipcMain.handle('wa:campaignDelete', (_e, campaignId: number) => {
    db().prepare(`DELETE FROM wa_campaigns WHERE id=? AND status='draft'`).run(campaignId);
    return { ok: true };
  });

  ipcMain.handle('wa:campaignPreview', (_e, accountId: number, segment: string) => {
    return buildSegmentPatients(db(), segment);
  });

  ipcMain.handle('wa:campaignLaunch', async (_e, campaignId: number) => {
    const d = db();
    const campaign = d.prepare(`SELECT * FROM wa_campaigns WHERE id=?`).get(campaignId) as any;
    if (!campaign) return { ok: false, error: 'Campaign not found' };
    if (campaign.status !== 'draft') return { ok: false, error: 'Campaign already launched' };

    const patients = buildSegmentPatients(d, campaign.segment);
    if (patients.length === 0) return { ok: false, error: 'No patients match this segment' };

    // Populate recipients
    const ins = d.prepare(
      `INSERT INTO wa_campaign_recipients (campaign_id, patient_id, phone, patient_name) VALUES (?,?,?,?)`
    );
    const tx = d.transaction(() => {
      for (const p of patients) ins.run(campaignId, p.id, normalizePhone(p.phone), p.name);
    });
    tx();

    d.prepare(
      `UPDATE wa_campaigns SET status='running', total_count=?, started_at=datetime('now'), updated_at=datetime('now') WHERE id=?`
    ).run(patients.length, campaignId);

    // Run async in background — don't await to avoid blocking IPC
    sendCampaignBatch(campaignId).catch((e) => console.error('[WA campaign]', e));
    return { ok: true, total: patients.length };
  });

  ipcMain.handle('wa:campaignRecipients', (_e, campaignId: number) => {
    return db().prepare(
      `SELECT * FROM wa_campaign_recipients WHERE campaign_id=? ORDER BY created_at DESC LIMIT 200`
    ).all(campaignId);
  });

  // ── Relay server URL & secret (stored in settings table) ─────────────────
  ipcMain.handle('wa:relayConfig', () => {
    const d = db();
    const get = (k: string) => (d.prepare(`SELECT value FROM settings WHERE key=?`).get(k) as { value: string } | undefined)?.value ?? '';
    return { url: get('wa_relay_url'), secret: get('wa_relay_secret') };
  });
  ipcMain.handle('wa:setRelayConfig', (_e, url: string, secret: string) => {
    const d = db();
    const upsert = d.prepare(`INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
    upsert.run('wa_relay_url', url);
    upsert.run('wa_relay_secret', secret);
    return { ok: true };
  });
}

// ── Process unprocessed webhook events (status updates, inbound messages) ──
function processWebhookEvents(db: Database.Database) {
  const events = db.prepare(
    `SELECT id, account_id, event_type, payload FROM wa_webhook_events WHERE processed=0 LIMIT 50`
  ).all() as Array<{ id: number; account_id: number; event_type: string; payload: string }>;

  const markDone = db.prepare(`UPDATE wa_webhook_events SET processed=1 WHERE id=?`);
  const updateMsgStatus = db.prepare(
    `UPDATE wa_messages SET status=? WHERE wam_id=?`
  );

  for (const ev of events) {
    try {
      const payload = JSON.parse(ev.payload);
      if (ev.event_type === 'message_status') {
        const wam_id = payload?.id;
        const status = payload?.status;
        if (wam_id && status) updateMsgStatus.run(status, wam_id);
      } else if (ev.event_type === 'inbound_message') {
        handleInboundMessage(db, ev.account_id, payload);
      }
    } catch (e) {
      console.error('[WA webhook] process error', e);
    }
    markDone.run(ev.id);
  }
}

// ── Campaign helpers ──────────────────────────────────────────────────────────

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  return digits;
}

interface PatientRow { id: number; phone: string; name: string }

function buildSegmentPatients(db: Database.Database, segment: string): PatientRow[] {
  const base = `SELECT p.id, p.phone,
    (p.first_name || ' ' || p.last_name) as name
    FROM patients p`;

  const queries: Record<string, string> = {
    all: `${base} WHERE p.phone != '' ORDER BY p.id`,
    visited_last_30d: `${base}
      JOIN appointments a ON a.patient_id=p.id
      WHERE a.appointment_date >= date('now', '-30 days') AND p.phone != ''
      GROUP BY p.id ORDER BY MAX(a.appointment_date) DESC`,
    visited_last_90d: `${base}
      JOIN appointments a ON a.patient_id=p.id
      WHERE a.appointment_date >= date('now', '-90 days') AND p.phone != ''
      GROUP BY p.id ORDER BY MAX(a.appointment_date) DESC`,
    followup_due_7d: `${base}
      JOIN consultations c ON c.patient_id=p.id
      WHERE c.follow_up_date BETWEEN date('now') AND date('now', '+7 days')
        AND p.phone != ''
      GROUP BY p.id`,
    birthday_this_month: `${base}
      WHERE substr(p.dob, 6, 2) = strftime('%m', 'now')
        AND p.phone != ''`,
    no_visit_90d: `${base}
      WHERE p.id NOT IN (
        SELECT DISTINCT patient_id FROM appointments
        WHERE appointment_date >= date('now', '-90 days')
      ) AND p.phone != ''`,
  };

  const sql = queries[segment] ?? queries.all;
  return db.prepare(sql).all() as PatientRow[];
}

/** Send campaign messages in batches of 10, 1s between batches. */
async function sendCampaignBatch(campaignId: number): Promise<void> {
  const d = getDb();
  const campaign = d.prepare(`SELECT * FROM wa_campaigns WHERE id=?`).get(campaignId) as any;
  if (!campaign) return;

  const acct = d.prepare(
    `SELECT phone_number_id, access_token_enc FROM wa_accounts WHERE id=?`
  ).get(campaign.account_id) as { phone_number_id: string; access_token_enc: string } | undefined;
  if (!acct) return;

  const { sendTemplate } = await import('../services/whatsapp/meta-api');

  let vars: Record<string, string> = {};
  try { if (campaign.template_vars) vars = JSON.parse(campaign.template_vars); } catch { /* ok */ }

  const bodyParams = Object.entries(vars)
    .filter(([k]) => !isNaN(Number(k)))
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, v]) => ({ type: 'text', text: v }));
  const components = bodyParams.length ? [{ type: 'body' as const, parameters: bodyParams }] : undefined;

  const pending = d.prepare(
    `SELECT * FROM wa_campaign_recipients WHERE campaign_id=? AND status='pending' LIMIT 500`
  ).all(campaignId) as any[];

  const updateRecip = d.prepare(
    `UPDATE wa_campaign_recipients SET status=?, wam_id=?, error=?, sent_at=? WHERE id=?`
  );
  const updateCampaign = d.prepare(
    `UPDATE wa_campaigns SET sent_count=sent_count+?, failed_count=failed_count+?, updated_at=datetime('now') WHERE id=?`
  );

  const BATCH = 10;
  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    let batchSent = 0, batchFailed = 0;
    for (const r of batch) {
      // Per-recipient: personalise {{1}} with patient name if no override
      const perVars = { ...vars };
      if (!perVars['1'] && r.patient_name) perVars['1'] = r.patient_name;
      const perParams = Object.entries(perVars)
        .filter(([k]) => !isNaN(Number(k)))
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, v]) => ({ type: 'text', text: v }));
      const perComps = perParams.length ? [{ type: 'body' as const, parameters: perParams }] : components;

      const result = await sendTemplate(
        acct.phone_number_id, reveal(acct.access_token_enc),
        r.phone, campaign.template_name, vars.lang ?? 'en', perComps
      );
      if (result.ok) {
        updateRecip.run('sent', result.wam_id ?? null, null, new Date().toISOString(), r.id);
        batchSent++;
      } else {
        updateRecip.run('failed', null, result.error ?? 'unknown', null, r.id);
        batchFailed++;
      }
    }
    updateCampaign.run(batchSent, batchFailed, campaignId);
    if (i + BATCH < pending.length) await new Promise((r) => setTimeout(r, 1000));
  }

  // Mark completed
  const camp = d.prepare(`SELECT total_count, sent_count, failed_count FROM wa_campaigns WHERE id=?`).get(campaignId) as any;
  if (camp && (camp.sent_count + camp.failed_count) >= camp.total_count) {
    d.prepare(`UPDATE wa_campaigns SET status='completed', completed_at=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(campaignId);
  }
}

/** Poll the relay server for new webhook events and ingest them. Called from main.ts every 60s. */
export async function pollRelayServer(): Promise<void> {
  const d = getDb();
  const get = (k: string) => (d.prepare(`SELECT value FROM settings WHERE key=?`).get(k) as { value: string } | undefined)?.value ?? '';
  const relayUrl = get('wa_relay_url');
  const secret   = get('wa_relay_secret');
  if (!relayUrl) return;

  const accounts = d.prepare(`SELECT id, phone_number_id FROM wa_accounts WHERE status='connected'`).all() as { id: number; phone_number_id: string }[];
  if (accounts.length === 0) return;

  for (const acct of accounts) {
    const lastSince = (() => {
      const row = d.prepare(`SELECT value FROM settings WHERE key=?`).get(`wa_relay_since_${acct.id}`) as { value: string } | undefined;
      return parseInt(row?.value || '0', 10);
    })();

    try {
      const headers: Record<string, string> = { 'Accept': 'application/json' };
      if (secret) headers['x-poll-secret'] = secret;
      const res = await fetch(`${relayUrl}/poll/${acct.phone_number_id}?since=${lastSince}`, { headers });
      if (!res.ok) continue;
      const data = await res.json() as { events: Array<{ type: string; payload: unknown; ts: number }>; server_ts: number };

      if (data.events.length > 0) {
        const insert = d.prepare(`INSERT INTO wa_webhook_events (account_id, event_type, payload, processed) VALUES (?,?,?,0)`);
        const tx = d.transaction(() => {
          for (const ev of data.events) insert.run(acct.id, ev.type, JSON.stringify(ev.payload));
        });
        tx();
        processWebhookEvents(d);
      }

      // Advance the since cursor to the latest event's timestamp
      const maxTs = data.events.reduce((m, e) => Math.max(m, e.ts), lastSince);
      d.prepare(`INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
       .run(`wa_relay_since_${acct.id}`, String(maxTs));
    } catch (e) {
      console.warn('[WA relay poll]', acct.phone_number_id, e);
    }
  }
}

function handleInboundMessage(db: Database.Database, accountId: number, msg: Record<string, unknown>) {
  const from = String(msg.from ?? '');
  if (!from) return;

  // Upsert conversation
  db.prepare(
    `INSERT INTO wa_conversations (account_id, phone, status, last_message_at)
     VALUES (?, ?, 'open', datetime('now'))
     ON CONFLICT(account_id, phone) DO UPDATE SET last_message_at=datetime('now'), status='open'`
  ).run(accountId, from);

  const conv = db.prepare(`SELECT id FROM wa_conversations WHERE account_id=? AND phone=?`).get(accountId, from) as { id: number };

  // Store the message
  db.prepare(
    `INSERT INTO wa_messages (account_id, wam_id, conversation_id, direction, message_type, content, status, timestamp)
     VALUES (?, ?, ?, 'inbound', ?, ?, 'delivered', datetime('now'))`
  ).run(
    accountId,
    msg.id ?? null,
    conv.id,
    msg.type ?? 'text',
    JSON.stringify(msg)
  );
}
