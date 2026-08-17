/**
 * Backend (main-process) licence enforcement.
 *
 * The renderer already hides/blocks unlicensed modules (sidebar + RouteGuard), but
 * that's UI-only. This adds a HARD gate at the data layer: the write operations
 * that make a paid module useful (admit a patient, raise a lab order, ring up a
 * pharmacy sale, run WhatsApp-Pro automation) refuse to run unless the clinic's
 * signed licence actually includes that module. So even a bypassed UI can't use a
 * module the subscription doesn't cover.
 *
 * Deliberately permissive where it must be, to never trap a clinic out of its own app:
 *   - Dev builds (`!app.isPackaged`) — never enforced.
 *   - Base modules (reception, opd, peds, analytics) — always allowed.
 *   - Client PCs — the HOST owns the licence and these ops proxy to it, so a
 *     client's own (empty) licence must not block them.
 *   - Any error reading the licence — fail OPEN, never closed.
 * Reads/exports/backup are never gated — only the module's core writes are.
 */
import { app } from 'electron';
import { getLicenseStatus } from './license';
import { getDb } from '../../db/db';
import { getAllSettings } from '../../db/settings';

const BASE = new Set(['reception', 'opd', 'peds', 'analytics']);

export function isModuleLicensed(module: string): boolean {
  if (!app.isPackaged) return true;             // dev build — licensing not enforced
  if (BASE.has(module)) return true;            // always-included base bundle
  try {
    if (getAllSettings(getDb()).network_mode === 'client') return true; // host is authoritative
  } catch { /* fall through */ }
  try {
    return (getLicenseStatus().modules || []).includes(module);
  } catch {
    return true;                                // status read failed — fail open, never lock out
  }
}

/** Throw a clinic-friendly error if `module` isn't in the licence. Call at the top of a gated write handler. */
export function requireModule(module: string, label: string): void {
  if (!isModuleLicensed(module)) {
    throw new Error(`${label} isn’t included in your current plan. Please contact us to add the ${label} module to your licence.`);
  }
}
