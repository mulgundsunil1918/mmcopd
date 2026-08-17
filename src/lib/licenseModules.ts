/**
 * Maps each gated route to the licence module that unlocks it. Reception / OPD
 * (registration, appointments, consultation, billing, patient log…) is the base
 * and is never gated. A route not listed here is always available (Settings,
 * Users, core).  The licensed-module list comes from the signed licence.
 */
// Only the PAID add-ons are licence-gated. The base bundle — Reception, OPD,
// Pediatrics (free for paediatricians), Analytics, Billing — is included in every
// plan and never gated. Paid add-ons: Laboratory, Pharmacy, IPD, WhatsApp.
// The /whatsapp route is the unified **Communication** hub. It unlocks for ANY
// WhatsApp plan ('whatsapp'): Basic clinics get Module 1 (click-to-send); Pro
// clinics ('whatsapp_pro') additionally unlock Module 2 (automation → AiSensy),
// which the hub gates internally.
export const ROUTE_MODULE: Record<string, string> = {
  '/lab': 'lab',
  '/pharmacy': 'pharmacy',
  '/ipd': 'ipd',
  '/discharge-summary': 'ipd',
  '/whatsapp': 'whatsapp',
};

/**
 * True if `path` is permitted by the licensed module set. When the licence
 * hasn't loaded yet (`undefined`) we allow it — never hide/lock on an unknown
 * state, to avoid flicker and never trap a clinic out of its own screens.
 */
export function routeLicensed(path: string, licensedModules: string[] | undefined): boolean {
  const mod = ROUTE_MODULE[path];
  if (!mod) return true;                // base / unmapped route
  if (!licensedModules) return true;    // not loaded yet
  return licensedModules.includes(mod);
}
