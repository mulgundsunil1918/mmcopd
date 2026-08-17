/**
 * THE single decision for "may this user see / open this module?".
 *
 * Before this existed the sidebar and the URL guard each made the call
 * separately, in different orders, and disagreed — so hiding a module did not
 * actually block it, and a blocked click produced one generic message that
 * pointed at a screen which often could not fix the problem.
 *
 * Both callers now use `moduleState()`. It returns not just a yes/no but the
 * REASON, so the UI can name the actual fix ("not in your plan" vs "switched off
 * for this clinic" vs "not your role").
 *
 * Order is fixed and identical for everyone:
 *   1. licence         — what the clinic bought
 *   2. clinic modules  — what this clinic switched on
 *   3. app mode        — base-bundle layout (paid add-ons are exempt)
 *   4. owner-only      — Settings / Users need the admin PIN
 *   5. role            — what this person may do
 *
 * NOTE the admin bypass runs at step 4, AFTER the module checks. Previously it
 * ran first, so a module the clinic had switched off stayed reachable by typing
 * its URL. Owner power is "open the locked screens", not "ignore the clinic's
 * own configuration".
 */
import type { Role } from '../hooks/useAuth';
import { canAnyRole } from '../hooks/useAuth';
import { effectiveRoles } from '../lib/accessModules';
import { ROUTE_MODULE, routeLicensed } from '../lib/licenseModules';

/**
 * What a computer is for. This is the layer that replaces "App Mode" in a clinic's
 * head: the PC at the pharmacy counter shows pharmacy things. Default 'everything'
 * so an upgrade is a visual non-event — nothing narrows unless a human picks it.
 */
export const STATION_ROLES = ['everything', 'reception', 'doctor', 'pharmacy', 'lab', 'ward'] as const;
export type StationRole = typeof STATION_ROLES[number];

export const STATION_LABEL: Record<StationRole, string> = {
  everything: 'Everything (one-computer clinic)',
  reception: 'Reception desk',
  doctor: 'Doctor cabin',
  pharmacy: 'Pharmacy counter',
  lab: 'Lab bench',
  ward: 'Ward station',
};

/**
 * Which routes each station shows. Owner screens (/settings, /users) are NEVER in
 * these lists — they are always reachable, behind the PIN, so no configuration can
 * remove the screen that fixes the configuration.
 */
const STATION_ROUTES: Record<Exclude<StationRole, 'everything'>, string[]> = {
  reception:  ['/reception', '/appointments', '/whatsapp', '/billing', '/miscellaneous', '/accounts', '/patient-log', '/origin', '/print-jobs', '/tpa', '/notifications', '/analytics'],
  doctor:     ['/appointments', '/doctor-select', '/patient-log', '/pediatrics', '/lab', '/ipd', '/discharge-summary', '/print-jobs', '/whatsapp'],
  pharmacy:   ['/pharmacy', '/print-jobs', '/patient-log'],
  lab:        ['/lab', '/print-jobs', '/patient-log'],
  ward:       ['/ipd', '/discharge-summary', '/patient-log', '/print-jobs', '/pediatrics'],
};

/** Does this computer's station role include this route? */
export function stationShows(path: string, station: string | undefined): boolean {
  // Help is never hidden by a station role — someone stuck on a narrowed PC must
  // always be able to read how to change it.
  if (path === '/help') return true;
  const s = (station || 'everything') as StationRole;
  if (s === 'everything' || !(s in STATION_ROUTES)) return true;
  return STATION_ROUTES[s as Exclude<StationRole, 'everything'>].includes(path);
}

export type DenyReason =
  | 'ok'
  | 'no_user'
  | 'licence'        // not in the clinic's subscription
  | 'module_off'     // switched off for this clinic in Settings
  | 'app_mode'       // this computer's mode doesn't include it
  | 'station'        // this computer is set up for a different job
  | 'owner_only'     // needs the admin PIN
  | 'role';          // this person's role doesn't include it

export interface ModuleState {
  allowed: boolean;
  reason: DenyReason;
  /** The licence module that gates this route, when the reason is 'licence'. */
  licenceModule?: string;
}

export interface AccessCtx {
  user: { role: string; id: number } | null;
  adminUnlocked: boolean;
  licensedModules: string[] | undefined;
  settings: any;
  /** Admin-customised role → module map (empty = built-in defaults). */
  overrides: Record<string, Role[]>;
  /** Built-in role defaults for this path, and whether it is an owner-only screen. */
  defaults: Role[];
  adminOnly?: boolean;
  /** App-mode set this nav item belongs to (undefined = always). */
  inCurrentMode?: boolean;
}

/** Is this module switched off for the clinic (Settings toggles)? */
export function moduleSwitchedOff(path: string, s: any): boolean {
  if (!s) return false;
  if (path === '/billing' && s.show_billing_module === false) return true;
  if (path === '/origin' && s.show_patient_origin === false) return true;
  if (path === '/pediatrics' && s.peds_enabled !== true) return true;
  if (path === '/tpa' && s.tpa_enabled !== true) return true;
  if (path === '/discharge-summary' && s.discharge_summary_enabled === false) return true;
  return false;
}

export function moduleState(path: string, ctx: AccessCtx): ModuleState {
  if (!ctx.user) return { allowed: false, reason: 'no_user' };

  // 1. Licence — applies to everyone, owner included. You cannot open a module
  //    the clinic has not bought.
  if (!routeLicensed(path, ctx.licensedModules)) {
    return { allowed: false, reason: 'licence', licenceModule: ROUTE_MODULE[path] };
  }

  // 2. This clinic's own on/off switches.
  if (moduleSwitchedOff(path, ctx.settings)) {
    return { allowed: false, reason: 'module_off' };
  }

  // 3. App mode shapes the BASE bundle only. A paid add-on the clinic activated
  //    must never be hidden by a layout preset — that made an activated module
  //    look like nothing had happened.
  const isPaidAddon = path in ROUTE_MODULE;
  if (!isPaidAddon && ctx.inCurrentMode === false) {
    return { allowed: false, reason: 'app_mode' };
  }

  // 3b. This computer's job. Owner screens are exempt — see STATION_ROUTES.
  if (!ctx.adminOnly && !stationShows(path, ctx.settings?.station_role)) {
    return { allowed: false, reason: 'station' };
  }

  // 4. Owner-only screens (Settings, Users). Deliberately AFTER the checks above.
  if (ctx.adminOnly) {
    return ctx.user.role === 'admin' || ctx.adminUnlocked
      ? { allowed: true, reason: 'ok' }
      : { allowed: false, reason: 'owner_only' };
  }
  // The owner may open anything that survived steps 1-3.
  if (ctx.user.role === 'admin' || ctx.adminUnlocked) return { allowed: true, reason: 'ok' };

  // 5. Role.
  return canAnyRole(ctx.user as any, effectiveRoles(path, ctx.defaults, ctx.overrides), ctx.adminUnlocked)
    ? { allowed: true, reason: 'ok' }
    : { allowed: false, reason: 'role' };
}

/** Plain-English explanation + the action that actually fixes it. */
export function explainDenial(reason: DenyReason, opts: { isOwner: boolean; label?: string }): {
  title: string; body: string; cta?: { label: string; to: string };
} {
  const what = opts.label || 'This screen';
  switch (reason) {
    case 'licence':
      return {
        title: `${what} is not in your plan`,
        body: 'This is a paid add-on. Add it to your subscription and it appears immediately — your data is untouched.',
        cta: { label: 'Open Subscription', to: '/settings' },
      };
    case 'module_off':
      return {
        title: `${what} is switched off for this clinic`,
        body: opts.isOwner
          ? 'You switched this module off in Settings. Turn it back on to use it again.'
          : 'An administrator switched this module off for the whole clinic. Ask them to turn it back on.',
        cta: opts.isOwner ? { label: 'Open Settings', to: '/settings' } : undefined,
      };
    case 'station':
      return {
        title: `${what} is not shown on this computer`,
        body: 'This computer is set up for a specific job (reception, pharmacy, lab…). Change what this computer shows in Settings → System → This Computer. It affects only this PC.',
        cta: opts.isOwner ? { label: 'Open Settings', to: '/settings' } : undefined,
      };
    case 'app_mode':
      return {
        title: `${what} is not enabled on this computer`,
        body: 'This computer is set up for a narrower job. An administrator can change what this computer shows in Settings → System → App Mode.',
        cta: opts.isOwner ? { label: 'Open Settings', to: '/settings' } : undefined,
      };
    case 'owner_only':
      return {
        title: `${what} is for the clinic owner`,
        body: 'Enter the admin password to unlock Settings, Users and other owner-only screens.',
      };
    case 'role':
      return {
        title: `${what} is not part of your role`,
        body: 'Your account does not include this screen. Ask an administrator to give your role access, or sign in with an account that has it.',
      };
    default:
      return { title: 'No access to this screen', body: 'Ask an administrator for access.' };
  }
}
