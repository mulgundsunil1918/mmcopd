/**
 * The Pharmacy tab of Settings — every pharmacy setting in ONE place (owner, 2026-10-27). Before, the pharmacy's GST switch and identity sat inside the
 * clinic's GST block, the counter discount limits inside the clinic's Discounts block, and "medicines on credit" at the top of Billing & IPD.
 * The words are the ones those places used; only the home changed. The tab is unlocked only while the subscription includes the Pharmacy module.
 */
import { HelpTip } from '../HelpTip';
import { pharmacyGstOn } from '../../lib/pharmacyGst';
import { COUNTER_DISCOUNT_ROLES, parseCounterCaps } from '../../lib/discountLimit';
import { Explain, AccrualToggle } from './shared';
import type { Settings } from '../../types';

type SetFn = <K extends keyof Settings>(k: K, v: Settings[K]) => void;

/** GST on pharmacy sales: its own switch, the name / GSTIN / licence printed on its bills, and the GST % a new medicine starts with. */
export function PharmacyGstCard({ draft, set, saved, goBilling }: { draft: Partial<Settings>; set: SetFn; saved: Settings; goBilling: () => void }) {
  // The pharmacy's own switch follows the clinic's registration box until it is touched (see lib/pharmacyGst). The clinic's box is on another tab, so it is read as SAVED.
  const pharmacyOn = pharmacyGstOn({ ...saved, ...draft } as Settings);
  const regType = saved.gst_registration_type ?? 'unregistered';
  return (
    <div className="card p-5 space-y-4">
      <div>
        <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">GST &amp; the pharmacy&rsquo;s bills</div>
        <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
          Whether pharmacy bills carry GST, the name, GSTIN and drug licence printed on them, and the GST % a new medicine starts with.
        </div>
      </div>

      <label className="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" className="mt-1" checked={pharmacyOn} disabled={regType === 'composition'}
          onChange={(e) => set('pharmacy_gst_enabled', e.target.checked as any)} />
        <div>
          <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100">Charge GST on pharmacy sales</div>
          <Explain>
            The pharmacy has its <b>own</b> GST switch — the button at the top of the Pharmacy page is the same one. On: each medicine is sold at its
            MRP with its GST inside it, and the GST on your purchases is claimed back. Off: no GST on pharmacy bills, and the GST on a purchase becomes
            part of what the stock cost. Consultation, lab and ward bills follow the registration box under Billing &amp; GST, not this one. Until you touch it, it
            follows that registration box.{regType === 'composition' ? ' (A composition dealer cannot collect GST, so it stays off.)' : ''}
          </Explain>
        </div>
      </label>

      <div className="pl-6 grid grid-cols-1 md:grid-cols-3 gap-3 border-l-2 border-emerald-200 dark:border-emerald-900">
        <div className="md:col-span-3 text-[11px] text-gray-500 dark:text-slate-400">
          If the pharmacy has its <b>own</b> GSTIN, name or drug licence (different from the clinic's), enter them here — they are printed on pharmacy bills. Leave empty to use the clinic's.
        </div>
        <div>
          <label className="label">Pharmacy GSTIN</label>
          <input className="input font-mono uppercase" maxLength={15} placeholder="same as the clinic's"
            value={draft.pharmacy_gstin || ''} onChange={(e) => set('pharmacy_gstin', e.target.value.toUpperCase() as any)} />
        </div>
        <div>
          <label className="label">Pharmacy name on bills</label>
          <input className="input" placeholder="as registered" value={draft.pharmacy_legal_name || ''} onChange={(e) => set('pharmacy_legal_name', e.target.value as any)} />
        </div>
        <div>
          <label className="label">Pharmacy drug licence no.</label>
          <input className="input" placeholder="D.L. No." value={draft.pharmacy_drug_license_no || ''} onChange={(e) => set('pharmacy_drug_license_no', e.target.value as any)} />
        </div>
      </div>

      {(saved.gst_enabled || pharmacyOn) && (
        <div className="text-[11px] text-gray-500 dark:text-slate-400 rounded-lg bg-gray-50 dark:bg-slate-800/50 px-3 py-2">
          The registration type (regular / composition), the clinic&rsquo;s GSTIN and state code are shared by the clinic&rsquo;s and the pharmacy&rsquo;s bills, so they are set once, under{' '}
          <button type="button" className="text-blue-700 dark:text-blue-300 font-semibold hover:underline" onClick={goBilling}>Billing &amp; GST</button>.
        </div>
      )}

      <div className="pt-1 border-t border-gray-100 dark:border-slate-800">
        <label className="label inline-flex items-center gap-1">GST % a NEW medicine starts with
          <HelpTip title="GST % for a new medicine"><><p>When you add a medicine to the Drug List, this is the GST % the form starts with.</p><p>The software does not pick one for you — GST depends on the medicine and on your registration. Leave it on <b>Ask me every time</b> and the form makes you choose; or choose one here and every new medicine starts with it (you can still change it on each medicine).</p></></HelpTip>
        </label>
        <select className="input w-auto" value={draft.default_drug_gst_rate === null || draft.default_drug_gst_rate === undefined ? '' : String(draft.default_drug_gst_rate)}
          onChange={(e) => set('default_drug_gst_rate', (e.target.value === '' ? null : Number(e.target.value)) as any)}>
          <option value="">Ask me every time</option>
          {[0, 5, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}
        </select>
        <Explain>You decide. Existing medicines are never changed by the software — to change many at once use Pharmacy → Drug List → <b>Set GST %</b>.</Explain>
      </div>
    </div>
  );
}

/** The most each role may take off a medicine sale at the counter, as a percent. A role left blank has no limit. */
export function PharmacyDiscountLimits({ draft, set }: { draft: Partial<Settings>; set: SetFn }) {
  const counter = parseCounterCaps(draft.pharmacy_discount_caps_json) ?? {};
  const setCounterCap = (role: string, raw: string) => {
    const next = { ...counter };
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n)) delete next[role];
    else next[role] = Math.max(0, Math.min(100, n));
    set('pharmacy_discount_caps_json', Object.keys(next).length ? JSON.stringify(next) : '');
  };
  return (
    <div className="card p-5 space-y-3">
      <div>
        <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Discount limits at the counter</div>
        <Explain>
          The most each role may take off a <b>medicine sale</b> at the pharmacy counter, as a percent of the sale. A discount above the
          limit is refused with a message. <b>Leave a role blank for no limit</b> (how the counter has always worked). It follows the
          person who is signed in, so turn on sign-in under Settings → Computers &amp; staff for it to know who is selling (on a one-computer clinic every sale is Reception’s, and the Reception limit is set there). Administrators
          are never limited. (The discount boxes on the counter and dispense screens take a percentage.)
        </Explain>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
        {COUNTER_DISCOUNT_ROLES.map((role) => (
          <div key={role} className="flex items-center gap-3">
            <div className="w-32 text-[13px] text-gray-900 dark:text-slate-100 capitalize">{role.replace('_', ' ')}</div>
            <input type="number" min={0} max={100} step="0.5" className="input w-24" placeholder="no limit"
              value={counter[role] ?? ''} onChange={(e) => setCounterCap(role, e.target.value)} />
            <span className="text-[12px] text-gray-500">% maximum</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Medicines on credit (OPD pay-later) and medicines charged to an admitted patient's bill. */
export function PharmacyCredit({ draft, set, hasIpd }: { draft: Partial<Settings>; set: SetFn; hasIpd: boolean }) {
  return (
    <div className="card p-5 space-y-4">
      <div>
        <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-1.5">Credit — let patients pay later<HelpTip title="Medicines on credit"><><p>Lets the pharmacy hand over medicines now and take the money later, for a registered patient.</p><p>What is still owed shows against the patient in Billing, in Accounts and under Analytics → Receivables, and every payment taken later is recorded with who took it and how it was paid.</p></></HelpTip></div>
        <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
          Credit appears at the pharmacy counter only while the switch below is ON. Turn it off and the option disappears from every screen (what is already owed can still be collected). Both switches are off until you turn them on.
        </div>
      </div>
      <AccrualToggle label="Allow medicines on credit (the patient pays later)"
        help="At the pharmacy counter a registered patient can take medicines and pay part now, or nothing, and the rest later. A walk-in guest can never take credit — it must be clear who owes the money."
        value={draft.pharmacy_credit_enabled ?? false} onChange={(v) => set('pharmacy_credit_enabled', v)} />
      {hasIpd && (
        <AccrualToggle label="Allow charging medicines to an admitted patient's bill"
          help="At the pharmacy counter, medicines for an in-patient can be put on that stay's running bill instead of being paid for there and then. They are priced at the selling price of the batch they come from (its MRP when no selling price was set) — the price is fixed by the system and cannot be typed over — and are collected with the rest of the bill at discharge."
          value={draft.pharmacy_ipd_charge_enabled ?? false} onChange={(v) => set('pharmacy_ipd_charge_enabled', v)} />
      )}
    </div>
  );
}
