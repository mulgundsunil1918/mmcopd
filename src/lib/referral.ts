/**
 * Referrals are free text: Google, Self, Family, a doctor's name… and they print exactly as typed.
 *
 * Older versions stored a referring doctor's name WITHOUT "Dr." and added "Dr. " in front on every screen and print. When those
 * names are carried over, the "Dr. " those screens used to add is written into the stored name once, so what a clinic already sees
 * and prints stays word for word the same (see bakeDrIntoReferrals in db/migrations.ts). A name that already starts with "Dr" is left as it is.
 */
export const startsWithDr = (name: string): boolean => /^dr\.?\s/i.test(name.trim());

/** The name as the older versions displayed it. */
export function legacyReferralName(name: string): string {
  const t = name.trim();
  return t === '' || startsWithDr(t) ? name : `Dr. ${t}`;
}
