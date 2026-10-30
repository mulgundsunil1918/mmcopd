/** Staff and salaries: who is paid what, advances still to recover, and (for people whose days are kept) a month of attendance that suggests the salary. */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { VoucherDialog, type VoucherPreset } from '../../components/accounts/VoucherDialog';
import { VoucherPrint } from '../../components/accounts/VoucherPrint';
import { HelpTip } from '../../components/HelpTip';
import { SettingsLink } from '../../components/Feature';
import { ATTENDANCE, daysInMonth } from '../../lib/accountsRules';
import { todayISO } from '../../lib/utils';
import { getMoneyPw, inr, MUTED } from './shared';
import type { VoucherRow } from '../../main/accounts';

const ORDER = [null, 'present', 'absent', 'half_day', 'paid_leave', 'unpaid_leave', 'weekly_off'] as const;
const SHORT: Record<string, string> = { present: 'P', absent: 'A', half_day: '½', paid_leave: 'PL', unpaid_leave: 'UL', weekly_off: 'WO' };
const COLOR: Record<string, string> = {
  present: 'bg-emerald-100 text-emerald-800', absent: 'bg-rose-100 text-rose-800', half_day: 'bg-amber-100 text-amber-800',
  paid_leave: 'bg-sky-100 text-sky-800', unpaid_leave: 'bg-orange-100 text-orange-800', weekly_off: 'bg-gray-200 text-gray-700',
};

export function StaffTab({ money = true }: { money?: boolean }) {
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const { data: staff = [] } = useQuery({ queryKey: ['acct-staff', month], queryFn: () => window.electronAPI.accounts.staff(month, getMoneyPw()) });
  const [dlg, setDlg] = useState<VoucherPreset | null>(null);
  const [print, setPrint] = useState<VoucherRow | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const active = staff.filter((s) => s.is_active); const gone = staff.filter((s) => !s.is_active);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2"><input type="month" className="input w-auto" value={month} onChange={(e) => setMonth(e.target.value)} />
          <HelpTip title="Staff and salaries">Pay a salary with a voucher. If someone’s attendance is kept, the salary is suggested from the days they were absent or on unpaid leave; days nobody marked are not cut. An advance is recovered by adding it as the deduction on their salary voucher.</HelpTip></div>
        <SettingsLink tab="accounts" group="Staff and salaries" label="Add or change staff" />
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-200 dark:border-slate-700">
            <th className="p-3">Name</th><th>Job</th>{money && <><th className="text-right">Monthly pay</th><th className="text-right">Paid in {month}</th><th className="text-right">Advance to recover</th></>}<th></th></tr></thead>
          <tbody>
            {active.map((s) => (
              <tr key={s.id} className="border-b border-gray-100 dark:border-slate-800">
                <td className="p-3 font-medium">{s.name}</td><td className="text-gray-600 dark:text-slate-400">{s.job}</td>
                {money && <><td className="text-right tabular-nums">{inr(s.monthly_salary)}</td>
                <td className={`text-right tabular-nums ${s.paid_this_month > 0 ? 'text-emerald-700' : 'text-gray-400'}`}>{s.paid_this_month > 0 ? inr(s.paid_this_month) : 'not yet'}</td>
                <td className={`text-right tabular-nums ${s.advance_open > 0 ? 'text-amber-700 font-medium' : 'text-gray-400'}`}>{s.advance_open > 0 ? inr(s.advance_open) : '—'}</td></>}
                <td className="text-right whitespace-nowrap p-3 space-x-3">
                  {s.keep_attendance ? <button className="text-blue-600 hover:underline" onClick={() => setOpen(open === s.id ? null : s.id)}>Attendance</button> : null}
                  {money && <button className="text-blue-600 hover:underline" onClick={() => setDlg({ type: 'advance', payee_ref: String(s.id), payee_name: s.name, lockType: true })}>Advance</button>}
                  {money && <button className="btn-primary py-1 px-3" onClick={() => setDlg({ type: 'staff_salary', payee_ref: String(s.id), payee_name: s.name, lockType: true, month })}>Pay salary</button>}
                </td>
              </tr>
            ))}
            {active.length === 0 && <tr><td colSpan={money ? 6 : 3} className="p-6 text-center text-gray-500">No staff yet. Add them in Settings → Accounts &amp; Analytics.</td></tr>}
          </tbody>
        </table>
      </div>
      {open !== null && <AttendanceGrid key={`${open}-${month}`} staffId={open} month={month} name={staff.find((s) => s.id === open)?.name || ''} money={money} />}
      {gone.length > 0 && <div className={MUTED}>No longer working here: {gone.map((s) => s.name).join(', ')}</div>}
      <VoucherDialog open={!!dlg} onClose={() => setDlg(null)} preset={dlg || {}} onDone={(v) => setPrint(v)} />
      {print && <VoucherPrint voucher={print} onClose={() => setPrint(null)} />}
    </div>
  );
}

function AttendanceGrid({ staffId, month, name, money }: { staffId: number; month: string; name: string; money: boolean }) {
  const qc = useQueryClient();
  const { data: marks = [] } = useQuery({ queryKey: ['acct-attendance', staffId, month], queryFn: () => window.electronAPI.accounts.attendance(staffId, month) });
  const { data: sug } = useQuery({ queryKey: ['acct-salary', String(staffId), month, marks.length, marks.map((m) => m.status).join()], queryFn: () => window.electronAPI.accounts.salarySuggestion(staffId, month, getMoneyPw()), enabled: money });
  const by = new Map(marks.map((m) => [m.day, m.status]));
  const cycle = async (day: string) => {
    const cur = by.get(day) ?? null; const next = ORDER[(ORDER.indexOf(cur as any) + 1) % ORDER.length];
    await window.electronAPI.accounts.setAttendance(staffId, day, next);
    qc.invalidateQueries({ queryKey: ['acct-attendance', staffId, month] }); qc.invalidateQueries({ queryKey: ['acct-salary'] });
  };
  const n = daysInMonth(month);
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between"><div className="font-semibold text-sm">{name} — attendance, {month}</div>
        {money && sug && <div className="text-sm">Suggested salary <b>{inr(sug.amount)}</b> <span className={MUTED}>({sug.cutDays} day(s) not paid)</span></div>}</div>
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: n }, (_, i) => { const day = `${month}-${String(i + 1).padStart(2, '0')}`; const st = by.get(day);
          return <button key={day} onClick={() => cycle(day)} title={st ? ATTENDANCE.find((a) => a.id === st)?.label : 'Not marked — click to mark'}
            className={`w-11 h-12 rounded-lg border border-gray-200 dark:border-slate-700 text-center text-[11px] leading-tight ${st ? COLOR[st] : 'bg-white dark:bg-slate-900 text-gray-400'}`}>
            <div>{i + 1}</div><div className="font-bold text-xs">{st ? SHORT[st] : '·'}</div></button>; })}
      </div>
      <div className={MUTED}>Click a day to mark it: {ATTENDANCE.map((a) => `${SHORT[a.id]} ${a.label}`).join(' · ')}. Click again to move on; the last click clears it.</div>
    </div>
  );
}
