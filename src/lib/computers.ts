/**
 * How many computers a clinic runs on, and what the shared desk ("Reception") may do.
 *
 * THE MODEL (owner, 2026-10-27: "whatever I tell should be in both Settings and the starting setup screen"; first question: how many computers?):
 *
 *   ONE COMPUTER   — no sign-in. The PC opens as RECEPTION. Everything the administrator must keep to themselves (Settings, Users & Access, deleting) is locked
 *                    behind the admin password. The administrator chooses what Reception may open ("What can Reception do?").
 *   MORE THAN ONE  — one MAIN computer holds the clinic's data, the others connect to it. Everyone signs in with their own login (the administrator can sign in on
 *                    any computer); what each person may open follows their role. Only the main computer edits clinic Settings.
 *
 * The answer is the saved setting `computers_mode` ('single' | 'multi'). A clinic that never answered keeps working exactly as it did: its mode is READ from
 * what it already has (a main or extra computer = more than one; a stand-alone PC = one), so an update never changes anybody's way of working.
 *
 * Internally the shared desk keeps the session role 'staff' (it acts for the reception desk AND the doctor on one PC); only its name is "Reception".
 */
import { ACCESS_MODULES, effectiveRoles, parseRoleAccess } from './accessModules';

export type ComputersMode = 'single' | 'multi';
/** Which computer THIS one is: the only one, the main computer of several, or an extra computer joined to the main one. */
export type ThisComputer = 'alone' | 'main' | 'other';

export const RECEPTION_LABEL = 'Reception';

interface ModeSettings { computers_mode?: string | null; network_mode?: string | null }

/** The clinic's answer, or — when it never answered — what its network setting already shows. */
export function computersMode(s: ModeSettings | null | undefined): ComputersMode {
  const saved = String(s?.computers_mode ?? '').trim();
  if (saved === 'single' || saved === 'multi') return saved;
  const net = String(s?.network_mode ?? 'local');
  return net === 'server' || net === 'client' ? 'multi' : 'single';
}

export function thisComputer(s: ModeSettings | null | undefined): ThisComputer {
  const net = String(s?.network_mode ?? 'local');
  return net === 'server' ? 'main' : net === 'client' ? 'other' : 'alone';
}

/** Has the clinic ANSWERED the question (as opposed to being read from its network setting)? */
export const hasAnsweredComputers = (s: ModeSettings | null | undefined) => ['single', 'multi'].includes(String(s?.computers_mode ?? '').trim());

// ---------------------------------------------------------------------------------------------------------------------------------
// "What can Reception do?" — the Reception column of the same role matrix that Role-Based Access edits (one source of truth).
// ---------------------------------------------------------------------------------------------------------------------------------

/** The screens whose access can be switched for Reception (the Reception screen itself is always on — a desk with no front desk is nothing). */
export const RECEPTION_SCREENS = ACCESS_MODULES.filter((m) => m.path !== '/reception');

/** May Reception open this screen, given the saved role-access text? */
export function receptionCan(path: string, roleAccessJson: string | null | undefined): boolean {
  const m = ACCESS_MODULES.find((x) => x.path === path);
  if (!m) return true;
  return effectiveRoles(path, m.defaults, parseRoleAccess(roleAccessJson)).includes('receptionist');
}

/** Can Reception be switched OFF for this screen? Every screen but the Reception desk itself — a row nobody else holds is stored as ['admin'], like the role matrix does. */
export const canSwitchReceptionOff = (path: string): boolean => path !== '/reception' && ACCESS_MODULES.some((m) => m.path === path);

const sameRoles = (a: string[], b: string[]) => a.length === b.length && a.every((r) => b.includes(r));

/**
 * The saved role-access text with Reception switched on or off for ONE screen. Every other screen and every other role is left exactly as it was; a screen
 * back at its built-in roles drops out of the override (so the setting stays empty for a clinic that never changed anything). A screen nobody but the
 * administrator holds is stored as ['admin'] — an empty list would mean "no override" and quietly leave Reception on (see accessModules.effectiveRoles).
 */
export function withReceptionAccess(roleAccessJson: string | null | undefined, path: string, on: boolean): string {
  const m = ACCESS_MODULES.find((x) => x.path === path);
  if (!m || path === '/reception') return roleAccessJson ?? '';
  const overrides = parseRoleAccess(roleAccessJson);
  const cur = effectiveRoles(path, m.defaults, overrides).filter((r) => r !== 'admin');      // the administrator opens everything anyway
  if (on === cur.includes('receptionist')) return roleAccessJson ?? '';
  const next = on ? [...cur, 'receptionist'] : cur.filter((r) => r !== 'receptionist');
  if (sameRoles(next, m.defaults as string[])) delete overrides[path]; else overrides[path] = (next.length ? next : ['admin']) as any;
  return Object.keys(overrides).length ? JSON.stringify(overrides) : '';
}
