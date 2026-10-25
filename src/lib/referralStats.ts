import { fromPaise, toPaise } from './pharmacyMath';

/**
 * Where patients were referred from — Google, Self, Family, a doctor's name, anything the front desk typed in the "Referral" box when booking a
 * visit — counted for Analytics → Referrals. One function for the real app (main/ipc.ts feeds it the visits) and the website demo.
 *
 * Rules:
 *   · the Referral is free text, so the same source typed in different ways is ONE source: "Google", "google " and "GOOGLE" are one;
 *     "Dr. Ramesh Kumar", "Dr Ramesh Kumar" and "Ramesh Kumar" are one. What is shown is the spelling typed most often (the latest on a tie);
 *   · a visit with no referral is counted as "not recorded", never as a source;
 *   · "new" is the patient's first visit ever (visit number 1); every later visit is "returning";
 *   · revenue is what the visit was billed (bills + pharmacy sales raised against that visit), added in paise.
 */
export interface ReferralVisit {
  id: number;
  patient_id: number;
  /** YYYY-MM-DD, the visit's own date. */
  date: string;
  /** That patient's nth visit (1 = first ever). */
  visit_number: number | null;
  referred_by: string | null;
  patient: string;
  uhid: string;
  doctor: string;
  /** Billed against this visit, ₹. */
  revenue: number;
}
export interface ReferralSource {
  name: string;
  visits: number;
  patients: number;
  newPatients: number;
  returning: number;
  revenue: number;
  /** Percent of the visits that HAVE a referral. */
  share: number;
}
export interface ReferralStats {
  from: string;
  to: string;
  totalVisits: number;
  withReferral: number;
  notRecorded: number;
  /** Most visits first. */
  sources: ReferralSource[];
  /** The (up to) five busiest sources — the columns of `months`. */
  topNames: string[];
  /** Visits with a referral per month in the period, and how many of them came from each top source. */
  months: { month: string; total: number; counts: Record<string, number> }[];
  /** The latest visits that carry a referral, newest first. */
  recent: { date: string; patient: string; uhid: string; referral: string; doctor: string }[];
}

/** The identity of a source: lower case, no full stops, one space between words, no leading "Dr". Empty = nothing was typed. */
export function referralKey(raw: string | null | undefined): string {
  return String(raw ?? '').toLowerCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim().replace(/^dr\s+/, '').trim();
}
const tidy = (raw: string) => raw.trim().replace(/\s+/g, ' ');

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split('-').map(Number);
  const [ty, tm] = to.slice(0, 7).split('-').map(Number);
  while ((y < ty || (y === ty && m <= tm)) && out.length < 120) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

export function buildReferralStats(visits: ReferralVisit[], opts: { from: string; to: string; top?: number; recent?: number }): ReferralStats {
  type Group = { spellings: Map<string, { n: number; last: string }>; visits: ReferralVisit[] };
  const groups = new Map<string, Group>();
  let notRecorded = 0;
  for (const v of visits) {
    const k = referralKey(v.referred_by);
    if (!k) { notRecorded++; continue; }
    const g: Group = groups.get(k) ?? { spellings: new Map(), visits: [] };
    const sp = tidy(String(v.referred_by));
    const cur = g.spellings.get(sp) ?? { n: 0, last: '' };
    cur.n++; if (v.date > cur.last) cur.last = v.date;
    g.spellings.set(sp, cur);
    g.visits.push(v);
    groups.set(k, g);
  }
  const withReferral = visits.length - notRecorded;
  const nameOf = (g: { spellings: Map<string, { n: number; last: string }> }) =>
    [...g.spellings.entries()].sort((a, b) => b[1].n - a[1].n || b[1].last.localeCompare(a[1].last) || a[0].localeCompare(b[0]))[0][0];

  const sources: ReferralSource[] = [...groups.values()].map((g) => {
    const isNew = (v: ReferralVisit) => (v.visit_number ?? 1) === 1;
    const revenueP = g.visits.reduce((s, v) => s + toPaise(v.revenue), 0);
    return {
      name: nameOf(g), visits: g.visits.length, patients: new Set(g.visits.map((v) => v.patient_id)).size,
      newPatients: g.visits.filter(isNew).length, returning: g.visits.filter((v) => !isNew(v)).length,
      revenue: fromPaise(revenueP), share: withReferral ? Math.round((g.visits.length / withReferral) * 1000) / 10 : 0,
    };
  }).sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name));

  const topNames = sources.slice(0, opts.top ?? 5).map((s) => s.name);
  const nameByKey = new Map<string, string>();
  for (const [k, g] of groups) nameByKey.set(k, nameOf(g));
  const monthList = monthsBetween(opts.from, opts.to);
  const months = monthList.map((month) => ({ month, total: 0, counts: Object.fromEntries(topNames.map((n) => [n, 0])) as Record<string, number> }));
  const at = new Map(months.map((m) => [m.month, m]));
  for (const [k, g] of groups) {
    const label = nameByKey.get(k)!;
    for (const v of g.visits) {
      const m = at.get(v.date.slice(0, 7));
      if (!m) continue;
      m.total++;
      if (label in m.counts) m.counts[label]++;
    }
  }
  const recent = visits
    .filter((v) => referralKey(v.referred_by))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
    .slice(0, opts.recent ?? 12)
    .map((v) => ({ date: v.date, patient: v.patient, uhid: v.uhid, referral: nameByKey.get(referralKey(v.referred_by))!, doctor: v.doctor }));

  return { from: opts.from, to: opts.to, totalVisits: visits.length, withReferral, notRecorded, sources, topNames, months, recent };
}
