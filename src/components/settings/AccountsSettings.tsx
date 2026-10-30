/**
 * Settings screens for money: the Accounts & Analytics tab (staff, expense heads, voucher numbering, opening cash, who may raise / cancel vouchers),
 * each doctor's "Pay and cuts" card, and the "What to show" switches that any tab can carry (src/lib/features.ts is the one list).
 * Everything here saves what it shows; nothing is deleted — a head or a staff member is switched off, never erased.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save } from 'lucide-react';
import { HelpTip } from '../HelpTip';
import { useToast } from '../../hooks/useToast';
import {
  ACCT_ROLES, CUT_STREAMS, PART_MONTH, PAY_BASES, VOUCHER_TYPES, cleanDoctorRules, cleanReferrerRule, defaultDoctorRules, defaultReferrerRule,
  parseAcctSettings, parsePayRules, type AcctSettings, type CutStream, type DoctorPayRules, type PayRules, type ReferrerRule,
} from '../../lib/accountsRules';
import { featuresOfTab, parseSwitches, withSwitch } from '../../lib/features';
import { referralKey } from '../../lib/referralStats';
import { localISO } from '../../lib/localDate';
import type { SettingsTabId } from '../../lib/settingsMap';

const box = 'rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3';
const muted = 'text-[11px] text-gray-500 dark:text-slate-400';
const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });

function Lbl({ children, help, title }: { children: React.ReactNode; help?: React.ReactNode; title?: string }) {
  return (
    <label className="label flex items-center gap-1.5">{children}{help && <HelpTip title={title}>{help}</HelpTip>}</label>
  );
}
/** A number that can be cleared and retyped without the box forcing a 0 back in. */
function Num({ value, onChange, prefix, suffix, placeholder, className = '' }: { value: number; onChange: (n: number) => void; prefix?: string; suffix?: string; placeholder?: string; className?: string }) {
  const [t, setT] = useState(value ? String(value) : '');
  useEffect(() => { if ((t === '' ? 0 : Number(t)) !== value) setT(value ? String(value) : ''); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [value]);
  return (
    <div className={`relative ${className}`}>
      {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">{prefix}</span>}
      <input className="input" style={{ paddingLeft: prefix ? 24 : undefined, paddingRight: suffix ? 28 : undefined }} inputMode="decimal" placeholder={placeholder}
        value={t} onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, ''); setT(v); onChange(v === '' || v === '.' ? 0 : Number(v)); }} />
      {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">{suffix}</span>}
    </div>
  );
}
const Check = ({ checked, onChange, children }: { checked: boolean; onChange: (b: boolean) => void; children: React.ReactNode }) => (
  <label className="inline-flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200 cursor-pointer"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{children}</label>
);

// ─────────────────────────────────────────── What to show ───────────────────────────────────────────
/** One switch per catalogue entry of this tab. Off = hidden on screen only; nothing is deleted. Saves as you click. */
export function WhatToShow({ tab }: { tab: SettingsTabId }) {
  const qc = useQueryClient(); const toast = useToast(); const { data: settings } = useSettings();
  const list = featuresOfTab(tab);
  if (!list.length || !settings) return null;
  const off = parseSwitches(settings.feature_switches_json);
  const groups = [...new Set(list.map((f) => f.group))];
  const flip = async (id: string, on: boolean) => {
    try { await window.electronAPI.settings.save({ feature_switches_json: withSwitch(settings.feature_switches_json, id, on) }); await qc.refetchQueries({ queryKey: ['settings'] }); }
    catch (e: any) { toast(e?.message || 'Could not save', 'error'); }
  };
  return (
    <div className={box} data-testid="what-to-show">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-slate-100">What to show
        <HelpTip title="What to show">Untick anything you do not use and it disappears from the screen. Nothing is deleted — the information is still stored and comes back the moment you tick it again.</HelpTip>
      </div>
      {groups.map((g) => (
        <div key={g}>
          <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1">{g}</div>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
            {list.filter((f) => f.group === g).map((f) => (
              <div key={f.id} className="flex items-center gap-1.5">
                <Check checked={off[f.id] !== false} onChange={(b) => flip(f.id, b)}>{f.label}</Check>
                <span className={muted + ' hidden md:inline'}>· {f.where}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────── Accounts & Analytics tab ───────────────────────────────────────────
export function AccountsSettingsTab() {
  return (
    <>
      <Group title="Staff and salaries" subtitle="Everyone the clinic pays a salary to. Attendance is optional — tick it for the people whose days you want to mark.">
        <StaffEditor />
      </Group>
      <Group title="Expense heads" subtitle="The headings an expense voucher can go under, and the profit and loss groups its costs by.">
        <CategoryEditor />
      </Group>
      <Group title="Vouchers, cash and who may raise them" subtitle="Voucher numbers, the cash in hand to start counting from, and which roles may raise or cancel a voucher.">
        <VoucherSettings />
      </Group>
      <Group title="What to show" subtitle="Switch off any Accounts or Analytics screen, tab or chart you do not use. Nothing is deleted.">
        <WhatToShow tab="accounts" />
      </Group>
    </>
  );
}
function Group({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2" data-settings-group={title}>
      <div className="px-1">
        <div className="text-[11px] font-bold uppercase tracking-widest text-blue-700 dark:text-blue-300">{title}</div>
        <div className={muted}>{subtitle}</div>
      </div>
      {children}
    </div>
  );
}

function StaffEditor() {
  const qc = useQueryClient(); const toast = useToast();
  const { data: staff = [] } = useQuery({ queryKey: ['acct-staff', 'settings'], queryFn: () => window.electronAPI.accounts.staff(undefined, undefined, true) });
  const blank = { name: '', job: '', monthly_salary: 0, keep_attendance: false };
  const [add, setAdd] = useState(blank);
  const save = async (s: any) => {
    const r = await window.electronAPI.accounts.saveStaff(s);
    if (!r.ok) { toast(r.error, 'error'); return false; }
    await qc.invalidateQueries({ queryKey: ['acct-staff'] }); toast('Saved'); return true;
  };
  return (
    <div className={box}>
      {staff.length === 0 && <div className={muted}>No staff added yet.</div>}
      {staff.map((s) => <StaffRow key={s.id} s={s} onSave={save} />)}
      <div className="border-t border-gray-100 dark:border-slate-800 pt-3 grid grid-cols-12 gap-2 items-end">
        <div className="col-span-3"><Lbl>New staff member</Lbl><input className="input" placeholder="Name" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} /></div>
        <div className="col-span-3"><Lbl>Job</Lbl><input className="input" placeholder="e.g. Nurse, Helper" value={add.job} onChange={(e) => setAdd({ ...add, job: e.target.value })} /></div>
        <div className="col-span-2"><Lbl help="What this person is paid for a full month.">Monthly salary</Lbl><Num prefix="₹" value={add.monthly_salary} onChange={(n) => setAdd({ ...add, monthly_salary: n })} /></div>
        <div className="col-span-2 pb-2"><Check checked={add.keep_attendance} onChange={(b) => setAdd({ ...add, keep_attendance: b })}>Keep attendance</Check></div>
        <div className="col-span-2"><button className="btn-primary w-full" disabled={!add.name.trim()} onClick={async () => { if (await save({ ...add, is_active: true })) setAdd(blank); }}><Plus className="w-4 h-4" /> Add</button></div>
      </div>
    </div>
  );
}
function StaffRow({ s, onSave }: { s: any; onSave: (s: any) => Promise<boolean> }) {
  const [d, setD] = useState({ name: s.name, job: s.job || '', monthly_salary: s.monthly_salary, keep_attendance: !!s.keep_attendance, is_active: !!s.is_active });
  const dirty = d.name !== s.name || d.job !== (s.job || '') || d.monthly_salary !== s.monthly_salary || d.keep_attendance !== !!s.keep_attendance || d.is_active !== !!s.is_active;
  return (
    <div className={`grid grid-cols-12 gap-2 items-center ${d.is_active ? '' : 'opacity-60'}`}>
      <input className="input col-span-3" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} aria-label="Name" />
      <input className="input col-span-3" value={d.job} onChange={(e) => setD({ ...d, job: e.target.value })} aria-label="Job" />
      <Num className="col-span-2" prefix="₹" value={d.monthly_salary} onChange={(n) => setD({ ...d, monthly_salary: n })} />
      <div className="col-span-2 flex flex-col gap-0.5">
        <Check checked={d.keep_attendance} onChange={(b) => setD({ ...d, keep_attendance: b })}>Attendance</Check>
        <Check checked={d.is_active} onChange={(b) => setD({ ...d, is_active: b })}>Working here</Check>
      </div>
      <div className="col-span-2">{dirty && <button className="btn-primary w-full" onClick={() => onSave({ id: s.id, ...d })}><Save className="w-4 h-4" /> Save</button>}</div>
    </div>
  );
}

function CategoryEditor() {
  const qc = useQueryClient(); const toast = useToast();
  const { data: cats = [] } = useQuery({ queryKey: ['acct-categories'], queryFn: () => window.electronAPI.accounts.categories() });
  const [name, setName] = useState('');
  const act = async (c: any) => { const r = await window.electronAPI.accounts.saveCategory(c); if (!r.ok) toast(r.error, 'error'); else { setName(''); qc.invalidateQueries({ queryKey: ['acct-categories'] }); } };
  return (
    <div className={box}>
      <div className="flex flex-wrap gap-2">
        {cats.map((c) => (
          <button key={c.id} onClick={() => act({ id: c.id, is_active: !c.is_active })} title={c.is_active ? 'Click to stop offering this head' : 'Click to offer this head again'}
            className={`badge border ${c.is_active ? 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-200 dark:border-blue-800' : 'bg-gray-100 text-gray-500 border-gray-200 line-through dark:bg-slate-800 dark:border-slate-700'}`}>{c.name}</button>
        ))}
      </div>
      <div className="flex gap-2 max-w-md">
        <input className="input" placeholder="Add your own head, e.g. Pest control" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && act({ name })} />
        <button className="btn-secondary" disabled={!name.trim()} onClick={() => act({ name })}><Plus className="w-4 h-4" /> Add</button>
      </div>
      <div className={muted}>Click a head to switch it off (it is only hidden from the list — old vouchers keep it).</div>
    </div>
  );
}

function VoucherSettings() {
  const qc = useQueryClient(); const toast = useToast(); const { data: settings } = useSettings();
  const [a, setA] = useState<AcctSettings | null>(null);
  useEffect(() => { if (settings && !a) setA(parseAcctSettings(settings.acct_settings_json)); }, [settings, a]);
  if (!a || !settings) return null;
  const saved = JSON.stringify(parseAcctSettings(settings.acct_settings_json)) !== JSON.stringify(a);
  const setRaise = (role: string, patch: Partial<{ allowed: boolean; limit: number | null }>) => setA({ ...a, raise: { ...a.raise, [role]: { ...(a.raise[role] ?? { allowed: false, limit: null }), ...patch } } });
  const save = async () => {
    const out = { ...a, opening_date: a.opening_date || (a.opening_cash ? localISO(new Date()) : '') };      // cash typed without a day is the cash counted today
    await window.electronAPI.settings.save({ acct_settings_json: JSON.stringify(out) }); setA(out); await qc.refetchQueries({ queryKey: ['settings'] }); toast('Saved'); };
  return (
    <div className={box}>
      <div>
        <div className="text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">Voucher numbers
          <HelpTip title="Voucher numbers">Each kind of voucher counts on its own (CM-0001, CM-0002 …). You may change the letters in front; the running number carries on and a number is never used twice.</HelpTip></div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {VOUCHER_TYPES.map((t) => (
            <div key={t.id}><Lbl>{t.label}</Lbl>
              <input className="input uppercase" maxLength={6} placeholder={t.prefix} value={a.prefixes[t.id] ?? ''} onChange={(e) => setA({ ...a, prefixes: { ...a.prefixes, [t.id]: e.target.value } })} /></div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 max-w-md">
        <div><Lbl title="Cash in hand" help="The cash the clinic held on the day below. The Day book counts cash in and out from that day, so each day opens with what the day before closed with.">Cash in hand</Lbl><Num prefix="₹" value={a.opening_cash} onChange={(n) => setA({ ...a, opening_cash: n })} /></div>
        <div><Lbl>…on</Lbl><input type="date" className="input" value={a.opening_date} onChange={(e) => setA({ ...a, opening_date: e.target.value })} /></div>
      </div>
      <div>
        <div className="text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">Who may raise and cancel vouchers
          <HelpTip title="Who may raise vouchers">The admin always may. Tick a role to let it raise vouchers (and see what each doctor has earned); give an amount to cap one voucher, or leave it blank for no cap. Anyone else can still raise one by typing the admin password.</HelpTip></div>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase text-gray-500"><th className="py-1">Role</th><th>May raise</th><th>Largest voucher</th><th>May cancel</th></tr></thead>
          <tbody>
            {ACCT_ROLES.map((r) => (
              <tr key={r.role} className="border-t border-gray-100 dark:border-slate-800">
                <td className="py-1.5">{r.label}</td>
                <td><input type="checkbox" checked={!!a.raise[r.role]?.allowed} onChange={(e) => setRaise(r.role, { allowed: e.target.checked })} /></td>
                <td><Num className="w-32" prefix="₹" placeholder="no cap" value={a.raise[r.role]?.limit ?? 0} onChange={(n) => setRaise(r.role, { limit: n > 0 ? n : null })} /></td>
                <td><input type="checkbox" checked={a.cancel.includes(r.role)} onChange={(e) => setA({ ...a, cancel: e.target.checked ? [...a.cancel, r.role] : a.cancel.filter((x) => x !== r.role) })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end"><button className="btn-primary" disabled={!saved} onClick={save}><Save className="w-4 h-4" /> Save</button></div>
    </div>
  );
}

// ─────────────────────────────────────────── Doctors: pay and cuts ───────────────────────────────────────────
export function DoctorPayAndCuts() {
  const qc = useQueryClient(); const toast = useToast(); const { data: settings } = useSettings();
  const { data: doctors = [] } = useQuery({ queryKey: ['doctors-all'], queryFn: () => window.electronAPI.doctors.list(false) });
  const { data: refs = [] } = useQuery({ queryKey: ['referring-doctors-all'], queryFn: () => window.electronAPI.referringDoctors.list(false) });
  const [rules, setRules] = useState<PayRules | null>(null);
  const [open, setOpen] = useState<string>('');
  useEffect(() => { if (settings && !rules) setRules(parsePayRules(settings.pay_rules_json)); }, [settings, rules]);
  if (!rules || !settings) return null;
  const dirty = JSON.stringify(parsePayRules(settings.pay_rules_json)) !== JSON.stringify(rules);
  const save = async () => { await window.electronAPI.settings.save({ pay_rules_json: JSON.stringify(rules) }); await qc.refetchQueries({ queryKey: ['settings'] }); toast('Saved'); };
  return (
    <div className={box}>
      <div className={muted}>For each doctor, how the clinic works out what they are owed. It feeds Analytics → Doctors, where you see what each doctor earned and pay them with a voucher.</div>
      {doctors.map((d) => {
        const id = String(d.id); const r = rules.doctors[id] ?? defaultDoctorRules();
        return (
          <div key={id} className="rounded-lg border border-gray-200 dark:border-slate-700">
            <button type="button" className="w-full flex items-center justify-between px-3 py-2 text-left" onClick={() => setOpen(open === id ? '' : id)}>
              <span className="font-medium text-sm">{d.name}</span>
              <span className={muted}>{PAY_BASES.find((b) => b.id === r.basis)?.label}{CUT_STREAMS.some((c) => r.cuts[c.id].mode !== 'off') ? ' + cuts' : ''} ▾</span>
            </button>
            {open === id && <DoctorRulesForm rules={r} onChange={(nr) => setRules({ ...rules, doctors: { ...rules.doctors, [id]: nr } })} />}
          </div>
        );
      })}
      <div className="rounded-lg border border-gray-200 dark:border-slate-700">
        <button type="button" className="w-full flex items-center justify-between px-3 py-2 text-left" onClick={() => setOpen(open === 'refs' ? '' : 'refs')}>
          <span className="font-medium text-sm flex items-center gap-1.5">Outside referring doctors
            <HelpTip title="Referrers' cut">What the clinic gives an outside doctor who refers patients. Set one rule for all referrers, and (if you like) a different rule for one of them. Their earnings appear in Analytics → Referrals, where you pay them with a Referral payment voucher.</HelpTip></span>
          <span className={muted}>{rules.referrer_default.mode === 'off' ? 'No cut' : rules.referrer_default.mode === 'percent' ? `${rules.referrer_default.value}%` : `₹${rules.referrer_default.value} a visit`} ▾</span>
        </button>
        {open === 'refs' && (
          <div className="px-3 pb-3 space-y-3">
            <div><div className="text-xs font-semibold mb-1">For every referrer</div>
              <ReferrerForm rule={rules.referrer_default} onChange={(nr) => setRules({ ...rules, referrer_default: nr })} /></div>
            {refs.map((rf) => {
              const key = referralKey(rf.name); const own = rules.referrers[key];
              return (
                <div key={rf.id} className="border-t border-gray-100 dark:border-slate-800 pt-2">
                  <Check checked={!!own} onChange={(b) => { const next = { ...rules.referrers }; if (b) next[key] = { ...rules.referrer_default }; else delete next[key]; setRules({ ...rules, referrers: next }); }}>A different rule for {rf.name}</Check>
                  {own && <div className="mt-2"><ReferrerForm rule={own} onChange={(nr) => setRules({ ...rules, referrers: { ...rules.referrers, [key]: nr } })} /></div>}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="flex justify-end"><button className="btn-primary" disabled={!dirty} onClick={save}><Save className="w-4 h-4" /> Save pay and cuts</button></div>
    </div>
  );
}

function DoctorRulesForm({ rules, onChange }: { rules: DoctorPayRules; onChange: (r: DoctorPayRules) => void }) {
  const set = (patch: Partial<DoctorPayRules>) => onChange(cleanDoctorRulesLoose({ ...rules, ...patch }));
  const b = rules.basis; const usesMonthly = b === 'fixed_monthly' || b === 'fixed_plus_percent'; const usesPercent = b === 'percent_of_fees' || b === 'percent_of_revenue' || b === 'fixed_plus_percent';
  return (
    <div className="px-3 pb-3 space-y-4">
      <div className="max-w-xs"><Lbl title="Count pay from" help="Pay is worked out only for days from this date on, so old visits do not turn into money owed the day you set a rule. Leave it blank to count every day.">Count pay from</Lbl>
        <input type="date" className="input" value={rules.since} onChange={(e) => set({ since: e.target.value })} /></div>
      <div className="grid md:grid-cols-3 gap-3">
        <div><Lbl title="How the doctor is paid" help={<>The clinic decides. <b>{PAY_BASES.find((x) => x.id === b)?.label}</b>: {PAY_BASES.find((x) => x.id === b)?.hint}</>}>How the doctor is paid</Lbl>
          <select className="input" value={b} onChange={(e) => set({ basis: e.target.value as any })}>{PAY_BASES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></div>
        {usesMonthly && <div><Lbl help="The amount for a whole month.">Monthly amount</Lbl><Num prefix="₹" value={rules.monthly} onChange={(n) => set({ monthly: n })} /></div>}
        {usesMonthly && <div><Lbl title="Part of a month" help={<>What is owed when only some days of a month are counted. {PART_MONTH.map((p) => <div key={p.id}><b>{p.label}:</b> {p.hint}</div>)}</>}>Part of a month</Lbl>
          <select className="input" value={rules.part_month} onChange={(e) => set({ part_month: e.target.value as any })}>{PART_MONTH.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>}
        {b === 'per_visit' && <div><Lbl help="Paid for every visit — new, free follow-up or paid repeat.">Amount per visit</Lbl><Num prefix="₹" value={rules.per_visit} onChange={(n) => set({ per_visit: n })} /></div>}
        {usesPercent && <div><Lbl help={b === 'percent_of_fees' ? 'A share of the consultation fees collected from this doctor’s patients.' : 'A share of what this doctor brings in — you choose what counts below.'}>Percentage</Lbl><Num suffix="%" value={rules.percent} onChange={(n) => set({ percent: n })} /></div>}
      </div>
      {b === 'per_visit_type' && (
        <div className="grid grid-cols-3 gap-3 max-w-xl">
          {([['new', 'New patient'], ['free', 'Free follow-up'], ['paid', 'Paid repeat visit']] as const).map(([k, l]) => (
            <div key={k}><Lbl help="Paid for each visit of this kind.">{l}</Lbl><Num prefix="₹" value={rules.per_type[k]} onChange={(n) => set({ per_type: { ...rules.per_type, [k]: n } })} /></div>
          ))}
        </div>
      )}
      {(b === 'percent_of_revenue' || b === 'fixed_plus_percent') && (
        <div><Lbl help="Tick what counts as this doctor’s revenue. A share is taken only of what has been collected, before GST.">What counts as the doctor’s revenue</Lbl>
          <div className="flex flex-wrap gap-x-5 gap-y-1">{(['consultation', 'services', 'pharmacy', 'lab', 'radiology'] as const).map((k) => (
            <Check key={k} checked={rules.counts[k]} onChange={(v) => set({ counts: { ...rules.counts, [k]: v } })}>{k === 'lab' ? 'Laboratory' : k[0].toUpperCase() + k.slice(1)}</Check>))}</div></div>
      )}
      <div>
        <div className="text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">Cuts on what the doctor generates
          <HelpTip title="Cuts">An extra amount for what this doctor’s patients spend on services, medicines, tests, scans or ward visits. A percentage is taken of the amount collected (after discount, before GST); a fixed amount is paid per order, in proportion to how much of it has been collected. If you also count the same thing in “the doctor’s revenue”, the doctor is paid for it twice — pick one.</HelpTip></div>
        <div className="grid md:grid-cols-2 gap-x-6 gap-y-2">
          {CUT_STREAMS.map((c) => {
            const cut = rules.cuts[c.id as CutStream];
            return (
              <div key={c.id} className="flex items-center gap-2">
                <div className="w-44 text-sm" title={c.hint}>{c.label}</div>
                <select className="input w-28" value={cut.mode} onChange={(e) => set({ cuts: { ...rules.cuts, [c.id]: { ...cut, mode: e.target.value as any } } })}>
                  <option value="off">No cut</option><option value="percent">% of bill</option><option value="fixed">₹ per order</option></select>
                {cut.mode !== 'off' && <Num className="w-24" prefix={cut.mode === 'fixed' ? '₹' : undefined} suffix={cut.mode === 'percent' ? '%' : undefined} value={cut.value} onChange={(n) => set({ cuts: { ...rules.cuts, [c.id]: { ...cut, value: n } } })} />}
                {c.id === 'pharmacy' && cut.mode === 'percent' && (
                  <select className="input w-28" value={cut.base} title="What the percentage is taken of" onChange={(e) => set({ cuts: { ...rules.cuts, pharmacy: { ...cut, base: e.target.value as any } } })}>
                    <option value="bill">Sale value</option><option value="profit">Profit</option></select>)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
// the form edits freely (a half-typed number must not snap back); the saved JSON is cleaned when it is read
const cleanDoctorRulesLoose = (r: DoctorPayRules) => r;

function ReferrerForm({ rule, onChange }: { rule: ReferrerRule; onChange: (r: ReferrerRule) => void }) {
  const set = (p: Partial<ReferrerRule>) => onChange({ ...rule, ...p });
  return (
    <div className="space-y-2">
      <div className="max-w-xs"><Lbl help="Referral pay is worked out only for visits from this date on. Leave it blank to count every visit.">Count pay from</Lbl>
        <input type="date" className="input" value={rule.since} onChange={(e) => set({ since: e.target.value })} /></div>
      <div className="grid md:grid-cols-3 gap-3">
        <div><Lbl help="No cut, a percentage of what the referred patient pays, or a fixed amount for each visit.">Cut</Lbl>
          <select className="input" value={rule.mode} onChange={(e) => set({ mode: e.target.value as any })}><option value="off">No cut</option><option value="percent">% of what is collected</option><option value="fixed">₹ per visit</option></select></div>
        {rule.mode !== 'off' && <div><Lbl>{rule.mode === 'percent' ? 'Percentage' : 'Amount'}</Lbl><Num prefix={rule.mode === 'fixed' ? '₹' : undefined} suffix={rule.mode === 'percent' ? '%' : undefined} value={rule.value} onChange={(n) => set({ value: n })} /></div>}
        {rule.mode !== 'off' && <div><Lbl help="Every visit the referred patient makes, or only the first visit that came through this referrer.">Counts</Lbl>
          <select className="input" value={rule.scope} onChange={(e) => set({ scope: e.target.value as any })}><option value="every">Every visit</option><option value="first">First visit only</option></select></div>}
      </div>
      {rule.mode === 'percent' && (
        <div className="flex flex-wrap gap-x-5 gap-y-1"><span className={muted}>Taken of:</span>
          {(['consultation', 'services', 'pharmacy', 'lab', 'radiology'] as const).map((k) => (
            <Check key={k} checked={rule.on[k]} onChange={(v) => set({ on: { ...rule.on, [k]: v } })}>{k === 'lab' ? 'Laboratory' : k[0].toUpperCase() + k.slice(1)}</Check>))}</div>
      )}
    </div>
  );
}
export { cleanDoctorRules, cleanReferrerRule, defaultReferrerRule };
