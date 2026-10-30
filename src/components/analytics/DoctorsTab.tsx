/**
 * Analytics → Doctors: how each doctor is doing, day by day — and what each is owed.
 * Visits are counted three ways (owner’s words): New patient (new to THIS doctor), Free follow-up, Paid repeat visit.
 * Statistics go by billing; earnings go by what was collected. Money (and the Pay button) is shown only to people allowed to raise vouchers.
 */
import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HandCoins, Lock } from 'lucide-react';
import { Feature, SettingsLink } from '../Feature';
import { HelpTip } from '../HelpTip';
import { VoucherDialog, type VoucherPreset } from '../accounts/VoucherDialog';
import { VoucherPrint } from '../accounts/VoucherPrint';
import { dayLabel, inr, MUTED, STATUS_BADGE, STATUS_LABEL, Tile, usePeriod, usePermissions } from '../../pages/accounts/shared';
import { PAY_BASES } from '../../lib/accountsRules';
import { fmtDate } from '../../lib/utils';
import type { VoucherRow } from '../../main/accounts';

export function DoctorsTab(_: { from: string; to: string }) {
  const { range, ui } = usePeriod('today');
  const [doctorId, setDoctorId] = useState<number | ''>('');
  const [pw, setPw] = useState(''); const [pwDraft, setPwDraft] = useState('');
  const { data: perm } = usePermissions(pw || undefined);
  const { data: doctors = [] } = useQuery({ queryKey: ['doctors-all'], queryFn: () => window.electronAPI.doctors.list(false) });
  const q = useQuery({
    queryKey: ['acct-doctor-days', range.from, range.to, doctorId, pw],
    queryFn: () => window.electronAPI.accounts.doctorDays({ from: range.from, to: range.to, doctorId: doctorId || undefined }, pw || undefined),
  });
  const data = q.data; const money = !!data?.money; const canPay = money && !!perm?.can_raise;
  const [dlg, setDlg] = useState<VoucherPreset | null>(null);
  const [print, setPrint] = useState<VoucherRow | null>(null);
  const [openRow, setOpenRow] = useState('');
  const nameOf = useMemo(() => new Map(doctors.map((d) => [d.id, d.name])), [doctors]);
  const rows = useMemo(() => [...(data?.days ?? [])].filter((d) => d.visits || d.billed || d.earned || d.paid).sort((a, b) => b.day.localeCompare(a.day) || (nameOf.get(a.doctor_id) || '').localeCompare(nameOf.get(b.doctor_id) || '')), [data, nameOf]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">{ui}
          <select className="input w-auto py-1" value={doctorId} onChange={(e) => setDoctorId(e.target.value ? Number(e.target.value) : '')} aria-label="Doctor">
            <option value="">All doctors</option>{doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
        <span className="inline-flex items-center gap-3">
          <HelpTip title="How visits are counted" align="right">
            <b>New patient</b> — the first time this patient is seen by this doctor (a small note says how many were also the clinic’s very first visit).<br />
            <b>Free follow-up</b> — a repeat visit inside the free follow-up period (courtesy ones are counted here and shown as “of them courtesy”).<br />
            <b>Paid repeat visit</b> — a repeat visit outside that period, which is billed.<br />
            A repeat visit with no bill yet is shown as <b>not billed yet</b>. Statistics follow billing; <b>earned</b> follows only what has been collected.</HelpTip>
          <SettingsLink tab="doctors" group="Pay and Cuts" label="Pay and cuts" />
        </span>
      </div>

      {data && !money && (
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50 px-3 py-2 text-xs flex flex-wrap items-center gap-3">
          <Lock className="w-3.5 h-3.5 text-gray-500" /><span>Money is shown only to people allowed to raise vouchers.</span>
          <input type="password" className="input w-44 py-1" placeholder="Admin password" value={pwDraft} onChange={(e) => setPwDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setPw(pwDraft)} autoComplete="off" />
          <button className="btn-secondary py-1" onClick={() => setPw(pwDraft)}>Show money</button></div>
      )}

      <Feature id="analytics.doctors.cards">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(data?.doctors ?? []).map((d) => (
            <div key={d.doctor_id} className="card p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div><div className="font-semibold text-gray-900 dark:text-slate-100">{d.name}</div>
                  <div className={MUTED}>{d.visits} visit{d.visits === 1 ? '' : 's'}{money && d.basis ? ` · ${PAY_BASES.find((b) => b.id === d.basis)?.label ?? ''}` : ''}</div></div>
                {canPay && d.balance > 0 && <button className="btn-primary py-1 px-3" onClick={() => setDlg({ type: 'doctor_payment', lockType: true, payee_ref: String(d.doctor_id), payee_name: d.name, period_from: range.from, period_to: range.to })}><HandCoins className="w-4 h-4" /> Pay</button>}
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 py-2"><div className="text-lg font-bold text-blue-800 dark:text-blue-200">{d.new_patient}</div><div className="text-[10px] uppercase text-blue-700/80 dark:text-blue-300/80">New patient</div></div>
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 py-2"><div className="text-lg font-bold text-emerald-800 dark:text-emerald-200">{d.free_followup}</div><div className="text-[10px] uppercase text-emerald-700/80 dark:text-emerald-300/80">Free follow-up</div></div>
                <div className="rounded-lg bg-violet-50 dark:bg-violet-900/20 py-2"><div className="text-lg font-bold text-violet-800 dark:text-violet-200">{d.paid_repeat}</div><div className="text-[10px] uppercase text-violet-700/80 dark:text-violet-300/80">Paid repeat visit</div></div>
              </div>
              <div className={MUTED}>
                {d.new_first_ever > 0 ? `${d.new_first_ever} of the new patients were first-ever at the clinic. ` : ''}
                {d.free_courtesy > 0 ? `${d.free_courtesy} free follow-up${d.free_courtesy === 1 ? ' was a courtesy one. ' : 's were courtesy ones. '}` : ''}
                {d.not_billed > 0 ? `${d.not_billed} repeat visit${d.not_billed === 1 ? '' : 's'} not billed yet.` : ''}
              </div>
              <Feature id="analytics.doctors.money">
                {money && (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm border-t border-gray-100 dark:border-slate-800 pt-2">
                    <span className={MUTED}>Billed</span><span className="text-right tabular-nums">{inr(d.billed)}</span>
                    <span className={MUTED}>Collected</span><span className="text-right tabular-nums">{inr(d.collected)}</span>
                    <span className={MUTED}>Earned</span><span className="text-right tabular-nums font-medium">{inr(d.earned)}</span>
                    <span className={MUTED}>Paid</span><span className="text-right tabular-nums text-emerald-700">{inr(d.paid)}</span>
                    <span className={MUTED}>To pay</span><span className={`text-right tabular-nums font-semibold ${d.balance > 0 ? 'text-rose-700' : ''}`}>{inr(d.balance)}</span>
                  </div>
                )}
                {money && d.basis === 'by_hand' && <div className={MUTED}>No pay rule is set for this doctor. <SettingsLink tab="doctors" group="Pay and Cuts" label="Set it in Settings" /></div>}
                {money && d.cost_missing > 0 && <div className={MUTED}>{d.cost_missing} medicine sale{d.cost_missing === 1 ? ' has' : 's have'} no recorded cost, so a cut on profit leaves them out.</div>}
              </Feature>
            </div>
          ))}
          {data && data.doctors.length === 0 && <div className="card p-6 text-sm text-gray-500 md:col-span-2 xl:col-span-3">No visits in these days.</div>}
        </div>
      </Feature>

      {money && (data?.doctors.length ?? 0) > 1 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Tile label="Collected" value={inr(data!.doctors.reduce((a, d) => a + d.collected, 0))} />
          <Tile label="Earned by doctors" value={inr(data!.doctors.reduce((a, d) => a + d.earned, 0))} />
          <Tile label="Paid" value={inr(data!.doctors.reduce((a, d) => a + d.paid, 0))} tone="green" />
          <Tile label="To pay" value={inr(data!.doctors.reduce((a, d) => a + d.balance, 0))} tone="red" />
        </div>
      )}

      <Feature id="analytics.doctors.table">
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-200 dark:border-slate-700">
              <th className="p-3">Day</th><th>Doctor</th><th className="text-right">New patient</th><th className="text-right">Free follow-up</th><th className="text-right">Paid repeat</th><th className="text-right">Not billed</th>
              {money && <><th className="text-right">Billed</th><th className="text-right">Collected</th><th className="text-right">Earned</th><th>Paid?</th><th className="text-right pr-3">To pay</th></>}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={`${r.doctor_id}|${r.day}`}>
                <tr className="border-b border-gray-100 dark:border-slate-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800/50" onClick={() => setOpenRow(openRow === `${r.doctor_id}|${r.day}` ? '' : `${r.doctor_id}|${r.day}`)} title="Click to see the patients">
                  <td className="p-3 whitespace-nowrap">{openRow === `${r.doctor_id}|${r.day}` ? '▾' : '▸'} {dayLabel(r.day)}</td><td>{nameOf.get(r.doctor_id)}</td>
                  <td className="text-right tabular-nums">{r.new_patient || '—'}</td>
                  <td className="text-right tabular-nums">{r.free_followup || '—'}{r.free_courtesy > 0 && <span className={MUTED}> ({r.free_courtesy} courtesy)</span>}</td>
                  <td className="text-right tabular-nums">{r.paid_repeat || '—'}</td><td className="text-right tabular-nums text-gray-500">{r.not_billed || '—'}</td>
                  {money && <>
                    <td className="text-right tabular-nums">{inr(r.billed)}</td><td className="text-right tabular-nums">{inr(r.collected)}</td><td className="text-right tabular-nums font-medium">{inr(r.earned)}</td>
                    <td>{r.status !== 'none' && <span className={`badge border ${STATUS_BADGE[r.status]}`}>{STATUS_LABEL[r.status]}{r.vouchers.length ? ` · ${r.vouchers.join(', ')}` : ''}</span>}
                      {r.added_after_payment > 0 && <span className={MUTED + ' block'}>{inr(r.added_after_payment)} added after payment</span>}</td>
                    <td className={`text-right tabular-nums pr-3 ${r.balance > 0 ? 'text-rose-700 font-semibold' : 'text-gray-400'}`}>{r.balance > 0 ? inr(r.balance) : '—'}</td></>}
                </tr>
                {openRow === `${r.doctor_id}|${r.day}` && <tr className="bg-gray-50/70 dark:bg-slate-800/40"><td colSpan={money ? 11 : 6} className="px-6 py-3"><VisitsOf doctorId={r.doctor_id} day={r.day} pw={pw} /></td></tr>}
                </Fragment>
              ))}
              {data && rows.length === 0 && <tr><td colSpan={money ? 11 : 6} className="p-6 text-center text-gray-500">Nothing to show for {fmtDate(range.from)}{range.to !== range.from ? ` – ${fmtDate(range.to)}` : ''}.</td></tr>}
            </tbody>
          </table>
        </div>
      </Feature>
      <VoucherDialog open={!!dlg} onClose={() => setDlg(null)} preset={dlg || {}} onDone={(v) => setPrint(v)} />
      {print && <VoucherPrint voucher={print} onClose={() => setPrint(null)} />}
    </div>
  );
}

/** Analytics → Referrals: what each outside referrer earned (by the clinic’s rule), was paid, and is still owed — with a Pay button. */
export function ReferrerPayCard({ from, to }: { from: string; to: string }) {
  const [pw, setPw] = useState('');
  const { data: perm } = usePermissions(pw || undefined);
  const q = useQuery({ queryKey: ['acct-referrer-days', from, to, pw], queryFn: () => window.electronAPI.accounts.referrerDays({ from, to }, pw || undefined) });
  const [dlg, setDlg] = useState<VoucherPreset | null>(null);
  const [print, setPrint] = useState<VoucherRow | null>(null);
  const money = !!q.data?.money; const list = (q.data?.referrers ?? []).filter((r) => !money || r.earned > 0 || r.paid > 0);
  if (!q.data || !money || list.length === 0) return null;
  return (
    <section className="card p-4 space-y-2">
      <div className="flex items-center justify-between"><div className="text-sm font-semibold flex items-center gap-1.5">What referrers earned
        <HelpTip title="Referrers' cut">Worked out from the clinic’s rule for each referring doctor, on the money actually collected from the patients they sent. Pay one with a Referral payment voucher.</HelpTip></div>
        <SettingsLink tab="doctors" group="Pay and Cuts" label="Referrer rules" /></div>
      <table className="w-full text-sm"><thead><tr className="text-left text-[11px] uppercase text-gray-500"><th className="py-1">Referrer</th><th className="text-right">Visits</th><th className="text-right">Collected</th><th className="text-right">Earned</th><th className="text-right">Paid</th><th className="text-right">To pay</th><th></th></tr></thead>
        <tbody>{list.map((r) => (
          <tr key={r.key} className="border-t border-gray-100 dark:border-slate-800"><td className="py-1.5">{r.name}</td><td className="text-right tabular-nums">{r.visits}</td><td className="text-right tabular-nums">{inr(r.collected)}</td>
            <td className="text-right tabular-nums">{inr(r.earned)}</td><td className="text-right tabular-nums text-emerald-700">{inr(r.paid)}</td><td className={`text-right tabular-nums ${r.balance > 0 ? 'text-rose-700 font-semibold' : ''}`}>{inr(r.balance)}</td>
            <td className="text-right">{perm?.can_raise && r.balance > 0 && <button className="btn-primary py-0.5 px-2" onClick={() => setDlg({ type: 'referral_payment', lockType: true, payee_ref: r.key, payee_name: r.name, period_from: from, period_to: to })}>Pay</button>}</td></tr>))}</tbody></table>
      <VoucherDialog open={!!dlg} onClose={() => setDlg(null)} preset={dlg || {}} onDone={(v) => setPrint(v)} />
      {print && <VoucherPrint voucher={print} onClose={() => setPrint(null)} />}
    </section>
  );
}

const KIND_LABEL: Record<string, string> = { new_patient: 'New patient', free_followup: 'Free follow-up', paid_repeat: 'Paid repeat visit', not_billed: 'Not billed yet' };
/** The patients behind one doctor's day: who they were, what kind of visit, and what was billed and collected for each (every figure traces to a patient). */
function VisitsOf({ doctorId, day, pw }: { doctorId: number; day: string; pw: string }) {
  const { data } = useQuery({ queryKey: ['acct-doctor-visits', doctorId, day, pw], queryFn: () => window.electronAPI.accounts.doctorVisits({ from: day, to: day, doctorId }, pw || undefined) });
  if (!data) return <div className={MUTED}>Loading the patients…</div>;
  if (data.visits.length === 0) return <div className={MUTED}>No visits that day (the pay for this day is the doctor's fixed pay).</div>;
  return (
    <table className="w-full text-xs"><thead><tr className="text-left text-[10px] uppercase text-gray-500"><th className="py-1">Token</th><th>Patient</th><th>UHID</th><th>Kind of visit</th>{data.money && <><th className="text-right">Billed</th><th className="text-right">Collected</th></>}</tr></thead>
      <tbody>{data.visits.map((v) => (
        <tr key={v.appointment_id} className="border-t border-gray-100 dark:border-slate-700"><td className="py-1">{v.token ?? '—'}</td><td className="font-medium">{v.patient_name}</td><td className="font-mono">{v.uhid}</td>
          <td>{KIND_LABEL[v.kind]}{v.courtesy ? ' (courtesy)' : ''}{v.referred_by ? <span className={MUTED}> · referred by {v.referred_by}</span> : ''}</td>
          {data.money && <><td className="text-right tabular-nums">{inr(v.billed)}</td><td className="text-right tabular-nums">{inr(v.collected)}</td></>}</tr>))}</tbody></table>
  );
}
