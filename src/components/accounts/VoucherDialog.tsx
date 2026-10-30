/**
 * Raise a payment voucher. One form for every kind: clinic maintenance, expense, staff salary, doctor payment, advance, referral payment.
 * A doctor / referral payment shows the days still owed and settles the oldest first; whatever is not paid stays "to pay".
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../Modal';
import { HelpTip } from '../HelpTip';
import { useToast } from '../../hooks/useToast';
import { DEDUCTION_KINDS, PAY_MODES, VOUCHER_TYPES, voucherType, type PayeeKind } from '../../lib/accountsRules';
import { referralKey } from '../../lib/referralStats';
import { fmtDate } from '../../lib/utils';
import { localISO } from '../../lib/localDate';
import { getMoneyPw, inr, MUTED, usePermissions, dayLabel, rangeOf, type PeriodId } from '../../pages/accounts/shared';
import type { VoucherRow } from '../../main/accounts';

export interface VoucherPreset {
  type?: string; lockType?: boolean; payee_ref?: string; payee_name?: string; period_from?: string; period_to?: string; gross?: number; description?: string; category?: string; month?: string;
}
/** A one-time id for this form: sending the same voucher twice (a double click, a re-send) must raise ONE voucher. */
const newRef = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `v-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const L = ({ children, help, title }: { children: React.ReactNode; help?: React.ReactNode; title?: string }) => (
  <label className="label flex items-center gap-1.5">{children}{help && <HelpTip title={title}>{help}</HelpTip>}</label>
);

export function VoucherDialog({ open, onClose, preset = {}, onDone }: { open: boolean; onClose: () => void; preset?: VoucherPreset; onDone?: (v: VoucherRow) => void }) {
  const qc = useQueryClient(); const toast = useToast();
  const today = localISO(new Date());
  const [pw, setPw] = useState('');
  const { data: perm } = usePermissions(pw || undefined);
  const mk = () => ({
    type: preset.type || 'clinic_maintenance', date: today, payee_ref: preset.payee_ref || '', payee_name: preset.payee_name || '', category: preset.category || '',
    description: preset.description || '', gross: preset.gross ?? 0, deduction: 0, deduction_kind: 'tds', deduction_label: '', pay_mode: 'Cash', reference: '',
    period_from: preset.period_from || '', period_to: preset.period_to || '', month: preset.month || today.slice(0, 7),
  });
  const [f, setF] = useState(mk);
  const [ref, setRef] = useState(newRef);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (open) { setF(mk()); setRef(newRef()); setErr(''); setPw(''); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const vt = voucherType(f.type); const kind: PayeeKind = (vt?.payee ?? 'other') as PayeeKind;

  const { data: staff = [] } = useQuery({ queryKey: ['acct-staff', 'dialog', !!pw], queryFn: () => window.electronAPI.accounts.staff(undefined, pw || getMoneyPw()), enabled: open && kind === 'staff' });
  const { data: doctors = [] } = useQuery({ queryKey: ['doctors-all'], queryFn: () => window.electronAPI.doctors.list(false), enabled: open && kind === 'doctor' });
  const { data: refs = [] } = useQuery({ queryKey: ['referring-doctors-all'], queryFn: () => window.electronAPI.referringDoctors.list(false), enabled: open && kind === 'referrer' });
  const { data: cats = [] } = useQuery({ queryKey: ['acct-categories'], queryFn: () => window.electronAPI.accounts.categories(), enabled: open && kind === 'other' });

  // what is still owed to a doctor / referrer in the chosen period
  const owes = kind === 'doctor' || kind === 'referrer';
  const dueQ = useQuery({
    queryKey: ['acct-due', kind, f.payee_ref, f.period_from, f.period_to, pw],
    enabled: open && owes && !!f.payee_ref && !!f.period_from && !!f.period_to,
    queryFn: async () => {
      if (kind === 'doctor') { const r = await window.electronAPI.accounts.doctorDays({ from: f.period_from, to: f.period_to, doctorId: Number(f.payee_ref) }, pw || undefined); return r.days.filter((d) => d.balance > 0.004).map((d) => ({ day: d.day, due: d.balance })); }
      const r = await window.electronAPI.accounts.referrerDays({ from: f.period_from, to: f.period_to }, pw || undefined); return r.days.filter((d) => d.key === f.payee_ref && d.balance > 0.004).map((d) => ({ day: d.day, due: d.balance }));
    },
  });
  const due = dueQ.data ?? [];
  // Which of the owed days are being paid. Every day is ticked to begin with; untick a day (or tick only some) to pay for days that are not next to each other.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => { setPicked(new Set((dueQ.data ?? []).map((d) => d.day))); }, [dueQ.data]);
  const dueTotal = Math.round(due.filter((d) => picked.has(d.day)).reduce((a, d) => a + d.due, 0) * 100) / 100;
  const nothingPicked = owes && due.length > 0 && picked.size === 0;
  const flip = (day: string) => setPicked((cur) => { const n = new Set(cur); if (n.has(day)) n.delete(day); else n.add(day); return n; });
  useEffect(() => { if (open && owes && dueQ.data && preset.gross === undefined) set({ gross: dueTotal }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [dueTotal, open]);
  const quick: { id: PeriodId; label: string }[] = [{ id: 'today', label: 'Today' }, { id: 'yesterday', label: 'Yesterday' }, { id: 'week', label: 'This week' }, { id: 'month', label: 'This month' }, { id: 'lastmonth', label: 'Last month' }];

  const sugg = useQuery({ queryKey: ['acct-salary', f.payee_ref, f.month], enabled: open && f.type === 'staff_salary' && !!f.payee_ref, queryFn: () => window.electronAPI.accounts.salarySuggestion(Number(f.payee_ref), f.month, pw || getMoneyPw()) });
  const person = useMemo(() => staff.find((s) => String(s.id) === f.payee_ref), [staff, f.payee_ref]);
  const net = Math.max(0, (Number(f.gross) || 0) - (Number(f.deduction) || 0));
  const needPw = !!perm && !perm.can_raise;

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const month = f.type === 'staff_salary';
      const [y, m] = f.month.split('-').map(Number);
      const r = await window.electronAPI.accounts.createVoucher({
        type: f.type, date: f.date, payee_kind: kind, payee_ref: f.payee_ref || null, payee_name: f.payee_name, category: f.category || (vt?.id === 'clinic_maintenance' ? 'Clinic maintenance' : null),
        description: f.description || (month ? `Salary for ${f.month}` : ''), gross: Number(f.gross) || 0, deduction: Number(f.deduction) || 0,
        deduction_kind: Number(f.deduction) > 0 ? f.deduction_kind : null, deduction_label: Number(f.deduction) > 0 ? (f.deduction_label || DEDUCTION_KINDS.find((d) => d.id === f.deduction_kind)?.label || '') : null,
        pay_mode: f.pay_mode, reference: f.reference || null,
        period_from: month ? `${f.month}-01` : f.period_from || null, period_to: month ? `${f.month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` : f.period_to || null, client_ref: ref,
        days: owes && due.length > 0 ? due.filter((d) => picked.has(d.day)).map((d) => d.day) : undefined,
      }, pw || undefined);
      if (!r.ok) { setErr(r.error); return; }
      toast(`${r.voucher.voucher_no} raised`);
      if ('unused' in r && r.unused > 0) toast(`${inr(r.unused)} was more than was due — it is recorded as paid in advance.`);
      for (const k of ['acct-money-out', 'acct-staff', 'acct-doctor-days', 'acct-referrer-days', 'acct-daybook', 'acct-pnl', 'acct-overview', 'acct-due']) qc.invalidateQueries({ queryKey: [k] });
      onDone?.(r.voucher); onClose();
    } catch (e: any) { setErr(e?.message || 'Could not save the voucher.'); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={vt ? `New voucher — ${vt.label}` : 'New voucher'} size="lg">
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div><L help="What kind of payment this is. Each kind has its own numbers (CM-0001, SAL-0001 …).">Voucher for</L>
            <select className="input" disabled={preset.lockType} value={f.type} onChange={(e) => set({ type: e.target.value, payee_ref: '', payee_name: '', category: '' })}>
              {VOUCHER_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
          <div><L>Date</L><input type="date" className="input" value={f.date} onChange={(e) => set({ date: e.target.value })} /></div>
          <div><L help="How the money left the clinic. For a cheque or bank transfer, add its number below.">Paid by</L>
            <select className="input" value={f.pay_mode} onChange={(e) => set({ pay_mode: e.target.value })}>{PAY_MODES.map((m) => <option key={m}>{m}</option>)}</select></div>
        </div>
        {vt && <div className={MUTED}>{vt.hint}</div>}

        <div className="grid grid-cols-2 gap-3">
          {kind === 'staff' && <div><L>Staff member</L>
            <select className="input" value={f.payee_ref} onChange={(e) => { const s = staff.find((x) => String(x.id) === e.target.value); set({ payee_ref: e.target.value, payee_name: s?.name || '' }); }}>
              <option value="">Choose…</option>{staff.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.name}{s.job ? ` — ${s.job}` : ''}</option>)}</select></div>}
          {kind === 'doctor' && <div><L>Doctor</L>
            <select className="input" value={f.payee_ref} onChange={(e) => { const d = doctors.find((x) => String(x.id) === e.target.value); set({ payee_ref: e.target.value, payee_name: d?.name || '' }); }}>
              <option value="">Choose…</option>{doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>}
          {kind === 'referrer' && <div><L>Referring doctor</L>
            <input className="input" list="acct-refs" value={f.payee_name} placeholder="Type or choose" onChange={(e) => set({ payee_name: e.target.value, payee_ref: referralKey(e.target.value) })} />
            <datalist id="acct-refs">{refs.map((r) => <option key={r.id} value={r.name} />)}</datalist></div>}
          {kind === 'other' && <div><L>Paid to</L><input className="input" value={f.payee_name} placeholder="Shop, person or company" onChange={(e) => set({ payee_name: e.target.value })} /></div>}
          {kind === 'other' && <div><L help="The heading this cost goes under in Profit and loss. Add your own in Settings → Accounts & Analytics.">Heading</L>
            <select className="input" value={f.category || (f.type === 'clinic_maintenance' ? 'Clinic maintenance' : '')} onChange={(e) => set({ category: e.target.value })}>
              <option value="">Other</option>{cats.filter((c) => c.is_active).map((c) => <option key={c.id}>{c.name}</option>)}</select></div>}
          {f.type === 'staff_salary' && <div><L>Salary for</L><input type="month" className="input" value={f.month} onChange={(e) => set({ month: e.target.value })} /></div>}
        </div>

        {(kind === 'other' || f.type === 'advance') && (
          <div><L help="What it was for, for example “hand wash” or “bulb for room 2”. It prints on the voucher.">What it was for</L><input className="input" value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder={f.type === 'advance' ? 'Advance against salary' : 'e.g. Hand wash'} /></div>
        )}

        {f.type === 'staff_salary' && f.payee_ref && sugg.data && (
          <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-3 text-sm flex items-center justify-between gap-3">
            <div>Monthly pay <b>{inr(sugg.data.monthly)}</b>{sugg.data.keep_attendance ? <> · {sugg.data.cutDays} day(s) not paid → suggested <b>{inr(sugg.data.amount)}</b></> : ' · attendance is not kept for this person'}
              {(person?.advance_open ?? 0) > 0 && <div className="text-amber-700 dark:text-amber-300">Open advance: {inr(person!.advance_open)} — you can recover it below.</div>}</div>
            <button type="button" className="btn-secondary" onClick={() => set({ gross: sugg.data!.amount })}>Use {inr(sugg.data.amount)}</button>
          </div>
        )}

        {owes && (
          <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <L help="Pay for one day, a week, a month, or any days you like — even days that are not next to each other (tick only those below). The amount you pay settles the OLDEST ticked day first; anything not covered stays “to pay”.">Days being paid</L>
              {quick.map((q) => <button key={q.id} type="button" className="px-2 py-0.5 rounded-full text-xs border border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-800"
                onClick={() => { const r = rangeOf(q.id, { from: f.period_from, to: f.period_to }); set({ period_from: r.from, period_to: r.to }); }}>{q.label}</button>)}
              <span className="inline-flex items-center gap-1.5 ml-1"><input type="date" className="input w-auto py-1" value={f.period_from} onChange={(e) => set({ period_from: e.target.value })} /><span className={MUTED}>to</span>
                <input type="date" className="input w-auto py-1" value={f.period_to} onChange={(e) => set({ period_to: e.target.value })} /></span>
            </div>
            {!f.payee_ref ? <div className={MUTED}>Choose who is being paid.</div> : dueQ.isLoading ? <div className={MUTED}>Working out what is due…</div> : due.length === 0 ? <div className={MUTED}>Nothing is due for these days.</div> : (
              <>
                <div className="max-h-32 overflow-auto text-xs grid grid-cols-2 gap-x-6 gap-y-0.5">{due.map((d) => (
                  <label key={d.day} className="flex items-center justify-between gap-2 cursor-pointer"><span className="inline-flex items-center gap-1.5"><input type="checkbox" checked={picked.has(d.day)} onChange={() => flip(d.day)} />{dayLabel(d.day)}</span><span className="tabular-nums">{inr(d.due)}</span></label>))}</div>
                <div className="flex items-center justify-between text-sm"><span>{picked.size === due.length ? 'Due in total' : `Due for the ${picked.size} ticked day${picked.size === 1 ? '' : 's'}`} <b>{inr(dueTotal)}</b></span>
                  <span className="text-xs space-x-3"><button type="button" className="text-blue-600 hover:underline" onClick={() => setPicked(new Set(due.map((d) => d.day)))}>Tick all</button><button type="button" className="text-blue-600 hover:underline" onClick={() => setPicked(new Set())}>Tick none</button><button type="button" className="text-blue-600 hover:underline" onClick={() => set({ gross: dueTotal })}>Pay all of it</button></span></div>
              </>)}
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          <div><L help={owes ? 'How much is being paid now. If it is less than what is due, the rest stays “to pay”.' : 'The full amount, before any deduction.'}>Amount</L>
            <input className="input" inputMode="decimal" value={f.gross || ''} onChange={(e) => set({ gross: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })} placeholder="₹" /></div>
          <div><L help="Money kept back from this payment — tax deducted at source, or an advance being recovered. The amount paid out is the amount less this. Profit and loss counts the full amount as the cost; when you later deposit held-back tax with the government, raise an Expense under the heading “TDS deposit” and it is left out of the cost (it was already counted).">Deduction (optional)</L>
            <input className="input" inputMode="decimal" value={f.deduction || ''} onChange={(e) => set({ deduction: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })} placeholder="₹ 0" /></div>
          {f.deduction > 0 ? <div><L>Deduction is</L><select className="input" value={f.deduction_kind} onChange={(e) => set({ deduction_kind: e.target.value })}>{DEDUCTION_KINDS.filter((d) => d.id !== 'none').map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select></div>
            : <div><L>Cheque / reference no.</L><input className="input" value={f.reference} onChange={(e) => set({ reference: e.target.value })} placeholder="optional" /></div>}
        </div>
        <div className="flex items-center justify-between rounded-lg bg-gray-50 dark:bg-slate-800 px-3 py-2 text-sm"><span>Paid out</span><b className="text-lg tabular-nums">{inr(net)}</b></div>

        {needPw && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 p-3">
            <div className="text-xs text-amber-900 dark:text-amber-200 mb-1">{perm?.reason || 'Raising vouchers is not allowed for your role.'} Type the admin password to continue.</div>
            <input type="password" className="input max-w-xs" placeholder="Admin password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" />
          </div>
        )}
        {err && <div className="text-sm text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/20 rounded-lg px-3 py-2">{err}</div>}
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || !f.gross || nothingPicked || (needPw && !pw)} onClick={submit}>{busy ? 'Saving…' : 'Raise voucher'}</button></div>
        {f.type !== 'doctor_payment' && f.date !== today && <div className={MUTED}>Dated {fmtDate(f.date)}.</div>}
      </div>
    </Modal>
  );
}
