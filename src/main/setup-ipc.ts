/**
 * First-run setup guide IPC — the thin layer over main/setup.ts.
 *
 * `setup:status` is a read. The two writes carry a write verb in their name (`mark…`, `set…`) so an expired licence
 * blocks them like any other change. The guide's actual data (clinic details, doctors, fees, staff, wards) is saved
 * through the same channels the Settings screens use, so there is exactly one way each thing is stored and checked.
 */

import { ipcMain } from 'electron';
import { getDb } from '../db/db';
import { actor } from './ipc';
import { logAudit } from './auth';
import * as setup from './setup';

export function registerSetupIpc() {
  ipcMain.handle('setup:status', () => setup.setupStatus(getDb()));

  ipcMain.handle('setup:markStep', (_e, step: string, outcome: 'done' | 'skipped') => {
    try { return { ok: true as const, status: setup.markSetupStep(getDb(), step, outcome) }; }
    catch (e: any) { return { ok: false as const, error: e?.message || 'Could not remember that step.' }; }
  });

  ipcMain.handle('setup:setStatus', (_e, status: string, opts?: { stop_reminders?: boolean }) => {
    try {
      const r = setup.setSetupStatus(getDb(), status, opts || {});
      try { logAudit(getDb(), actor(), 'setup.guide', 'settings', 0, JSON.stringify({ status, stop_reminders: !!opts?.stop_reminders })); } catch { /* the audit must never block work */ }
      return { ok: true as const, status: r };
    } catch (e: any) {
      return { ok: false as const, error: e?.message || 'Could not update the setup guide.' };
    }
  });
}
