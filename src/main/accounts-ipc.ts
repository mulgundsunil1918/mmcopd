/**
 * Accounts IPC — vouchers, staff, attendance, the day book, profit and loss, and the Doctors view of what each doctor earned and was paid.
 *
 * Who may do what (Settings → Accounts decides; the admin may always):
 *  - raise a voucher: roles with "may raise" ticked, up to their limit; a person who may not can still raise one with the admin password;
 *  - cancel a voucher: the roles ticked for it, or the admin password;
 *  - see a doctor's money (and press Pay): the same people who may raise vouchers — everybody else sees visit counts only.
 */
import { ipcMain } from 'electron';
import { getDb } from '../db/db';
import { actor, adminPasswordProblem, requireRole } from './ipc';
import { logAudit } from './auth';
import * as acc from './accounts';
import { mayCancel, mayRaise, maySeeDoctorMoney, type VoucherInput } from '../lib/accountsRules';
import { broadcastEvent } from './network-server';

const who = () => { const a = actor(); return { name: a?.display_name || a?.username || 'Reception desk', role: String(a?.role || 'staff') }; };
const adminOk = (pw: unknown) => typeof pw === 'string' && pw.length > 0 && adminPasswordProblem(pw) === null;
const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const range = (from: unknown, to: unknown) => {
  if (!isDay(from) || !isDay(to)) throw new Error('Choose a valid start and end day.');
  return from <= to ? { from, to } : { from: to as string, to: from as string };
};
/** Salaries, vouchers and what the clinic pays doctors are seen only by people allowed to raise vouchers (Settings → Accounts) or with the admin password. */
const MONEY_LOCKED = 'Money is shown only to people allowed to raise vouchers. Ask the admin to allow your role (Settings → Accounts & Analytics), or type the admin password.';
const moneyAllowed = (pw?: string) => adminOk(pw) || maySeeDoctorMoney(acc.readAcct(getDb()), who().role);
const needMoney = (pw?: string) => { if (!moneyAllowed(pw)) throw new Error(MONEY_LOCKED); };
const note = (event: string) => { try { broadcastEvent(event, {}); } catch { /* other computers refresh on their own */ } };

export function registerAccountsIpc() {
  // ── who am I, and what may I do here ──
  ipcMain.handle('accounts:permissions', (_e, adminPassword?: string) => {
    const a = acc.readAcct(getDb()); const w = who(); const admin = adminOk(adminPassword);
    const r = admin ? { ok: true } : mayRaise(a, w.role);
    return {
      role: w.role, name: w.name, can_raise: r.ok, can_cancel: admin || mayCancel(a, w.role), can_see_money: admin || maySeeDoctorMoney(a, w.role),
      limit: w.role === 'admin' || admin ? null : (a.raise[w.role]?.limit ?? null), reason: r.ok ? '' : (r as any).reason || '',
    };
  });

  // ── reads ──
  ipcMain.handle('accounts:moneyOut', (_e, from: string, to: string, adminPassword?: string) => { needMoney(adminPassword); const r = range(from, to); return acc.moneyOut(getDb(), r.from, r.to); });
  ipcMain.handle('accounts:vouchers', (_e, f: { from?: string; to?: string; type?: string; status?: string; payee_kind?: string; payee_ref?: string } = {}, adminPassword?: string) => { needMoney(adminPassword); return acc.listVouchers(getDb(), f || {}); });
  ipcMain.handle('accounts:voucher', (_e, id: number, adminPassword?: string) => { needMoney(adminPassword); return acc.getVoucher(getDb(), Number(id)); });
  ipcMain.handle('accounts:dayBook', (_e, from: string, to: string) => { const r = range(from, to); return acc.dayBook(getDb(), r.from, r.to); });
  ipcMain.handle('accounts:profitLoss', (_e, from: string, to: string, adminPassword?: string) => { needMoney(adminPassword); const r = range(from, to); return acc.profitAndLoss(getDb(), r.from, r.to); });
  // Names, jobs and attendance are for everyone who opens Accounts; salaries and advances only for people who may see money. (The Settings staff editor, behind the admin password, asks for everything.)
  ipcMain.handle('accounts:staff', (_e, month?: string, adminPassword?: string, forSettings?: boolean) => {
    const rows = acc.listStaff(getDb(), month);
    return forSettings || moneyAllowed(adminPassword) ? rows : rows.map((x) => ({ ...x, monthly_salary: 0, advance_open: 0, paid_this_month: 0 }));
  });
  ipcMain.handle('accounts:attendance', (_e, staffId: number, ym: string) => acc.getAttendance(getDb(), Number(staffId), String(ym)));
  ipcMain.handle('accounts:salarySuggestion', (_e, staffId: number, ym: string, adminPassword?: string) => { needMoney(adminPassword); return acc.salarySuggestion(getDb(), Number(staffId), String(ym)); });
  ipcMain.handle('accounts:categories', () => acc.listCategories(getDb()));

  // ── doctors and referrers (money only for people who may raise vouchers) ──
  ipcMain.handle('accounts:doctorDays', (_e, f: { from: string; to: string; doctorId?: number }, adminPassword?: string) => {
    const r = range(f?.from, f?.to); const db = getDb(); const a = acc.readAcct(db);
    const money = adminOk(adminPassword) || maySeeDoctorMoney(a, who().role);
    const out = acc.doctorDays(db, { ...r, doctorId: f?.doctorId ? Number(f.doctorId) : undefined });
    if (money) return { ...out, money };
    const blank = { billed: 0, collected: 0, earned: 0, paid: 0, balance: 0, overpaid: 0, added_after_payment: 0 };
    return { money, days: out.days.map((d) => ({ ...d, ...blank, vouchers: [], status: 'none' as const })), doctors: out.doctors.map((d) => ({ ...d, ...blank, basis: '', cost_missing: 0 })) };
  });
  ipcMain.handle('accounts:referrerDays', (_e, f: { from: string; to: string }, adminPassword?: string) => {
    const r = range(f?.from, f?.to); const db = getDb(); const a = acc.readAcct(db);
    const money = adminOk(adminPassword) || maySeeDoctorMoney(a, who().role);
    const out = acc.referrerDays(db, r);
    if (money) return { ...out, money };
    return { money, days: out.days.map((d) => ({ ...d, collected: 0, earned: 0, paid: 0, balance: 0, vouchers: [], status: 'none' as const })), referrers: out.referrers.map((d) => ({ ...d, collected: 0, earned: 0, paid: 0, balance: 0 })) };
  });

  // ── patients behind the numbers ──
  ipcMain.handle('accounts:doctorVisits', (_e, f: { from: string; to: string; doctorId?: number }, adminPassword?: string) => {
    const r = range(f?.from, f?.to); const db = getDb();
    const money = moneyAllowed(adminPassword);
    const rows = acc.doctorVisits(db, { ...r, doctorId: f?.doctorId ? Number(f.doctorId) : undefined });
    return { money, visits: money ? rows : rows.map((v) => ({ ...v, billed: 0, collected: 0 })) };
  });
  ipcMain.handle('accounts:unlinked', (_e, from: string, to: string) => { const r = range(from, to); return acc.unlinkedMoney(getDb(), r.from, r.to); });

  // ── writes ──
  ipcMain.handle('accounts:createVoucher', (_e, input: VoucherInput & { client_ref?: string }, adminPassword?: string) => {
    const db = getDb(); const w = who(); const admin = adminOk(adminPassword);
    if (!admin) { const m = mayRaise(acc.readAcct(db), w.role, Number(input?.gross) || 0); if (!m.ok) return { ok: false as const, error: m.reason || 'You may not raise vouchers.' }; }
    const r = acc.createVoucher(db, input, admin && w.role !== 'admin' ? { name: `${w.name} (admin password)`, role: w.role } : w);
    if (r.ok) {
      try { logAudit(db, actor(), 'voucher_raised', 'acct_vouchers', r.voucher.id, `${r.voucher.voucher_no} · ${r.voucher.payee_name} · ₹${r.voucher.net_amount} ${r.voucher.pay_mode}`); } catch { /* the audit must never block work */ }
      note('accounts:updated');
    }
    return r;
  });
  ipcMain.handle('accounts:cancelVoucher', (_e, id: number, reason: string, adminPassword?: string) => {
    const db = getDb(); const w = who();
    if (!adminOk(adminPassword) && !mayCancel(acc.readAcct(db), w.role)) return { ok: false as const, error: 'Cancelling a voucher needs the admin (or a role the admin allowed in Settings → Accounts).' };
    const r = acc.cancelVoucher(db, Number(id), reason, w.name);
    if (r.ok) {
      try { logAudit(db, actor(), 'voucher_cancelled', 'acct_vouchers', r.voucher.id, `${r.voucher.voucher_no} · ${String(reason).slice(0, 80)}`); } catch { /* ignore */ }
      note('accounts:updated');
    }
    return r;
  });
  ipcMain.handle('accounts:saveStaff', (_e, s: any) => {
    requireRole(['manager'], 'change the staff list');
    const r = acc.saveStaff(getDb(), s || {}); if (r.ok) note('accounts:updated'); return r;
  });
  ipcMain.handle('accounts:saveCategory', (_e, c: any) => {
    requireRole(['manager'], 'change the expense heads');
    return acc.saveCategory(getDb(), c || {});
  });
  ipcMain.handle('accounts:setAttendance', (_e, staffId: number, day: string, status: string | null, note_?: string) => {
    requireRole(['receptionist', 'manager'], 'mark attendance');
    return acc.setAttendance(getDb(), Number(staffId), String(day), status || null, note_);
  });
}
