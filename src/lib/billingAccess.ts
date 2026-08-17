/**
 * THE single answer to "may this person be shown money?".
 *
 * A clinic's ward staff and its billing staff are different people with
 * different jobs. A nurse recording vitals has no business seeing what the
 * family owes, and a doctor deciding on discharge should be deciding on
 * clinical grounds, not on a running total. So the bill panel, the Print-bill
 * button and the discharge-approval gate are all hidden from clinical roles.
 *
 * This lives in one file because the same decision is needed on the admission
 * screen and again inside the discharge modal. When it was written out twice,
 * one copy was updated and the other was not — the modal kept showing the full
 * bill to everyone.
 */

/** Roles whose job includes money. */
const BILLING_ROLES = new Set(['admin', 'manager', 'receptionist', 'ward_incharge']);

/**
 * Stations that stay clinical when the clinic runs WITHOUT logins.
 *
 * With `require_login` off, everyone shares one generic 'staff' session, so no
 * role exists to tell a nurse from the ward in-charge. The only thing left that
 * separates them is which computer they are standing at — so on a no-login
 * setup the cabin and the ward station are treated as clinical.
 */
const CLINICAL_STATIONS = new Set(['doctor', 'ward']);

export interface MoneyAccessCtx {
  /** Current session role ('staff' = the shared no-login session). */
  role: string | undefined;
  /** True once the admin password has been entered this session. */
  adminUnlocked: boolean;
  /** What this computer is set up for (Settings → This Computer). */
  stationRole: string | undefined;
}

export function canSeeMoney({ role, adminUnlocked, stationRole }: MoneyAccessCtx): boolean {
  if (adminUnlocked) return true;
  const r = String(role || '');
  // A real signed-in account is judged by its role.
  if (r && r !== 'staff') return BILLING_ROLES.has(r);
  // The shared session has no role to judge — fall back to the computer's job.
  return !CLINICAL_STATIONS.has(String(stationRole || 'everything'));
}

/** Why the bill is hidden, for the placeholder shown in its place. */
export const MONEY_HIDDEN_NOTE =
  'Billing is handled by reception, the ward in-charge or a manager. Sign in with one of those accounts to see and print the bill.';
