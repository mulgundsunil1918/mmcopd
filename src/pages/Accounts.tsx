/**
 * Accounts — the clinic’s MONEY, in one place (owner, 2026-10-29: Accounts = rupees; Analytics = people, visits and time).
 * Overview · Money in (what came in) · Money out (vouchers) · Staff and salaries · Day book · Profit and loss.
 * The old Accounts page is now "Money in"; the Analytics finance, module P&L, receivables and pharmacy profit views moved here — nothing was deleted.
 */
import { useSearchParams } from 'react-router-dom';
import { Wallet, ArrowDownToLine, ArrowUpFromLine, Users, BookOpen, Scale, LayoutDashboard } from 'lucide-react';
import { PageHelp } from '../components/PageHelp';
import { Feature, SettingsLink, useFeature } from '../components/Feature';
import { cn } from '../lib/utils';
import { OverviewTab } from './accounts/Overview';
import { MoneyInTab } from './accounts/MoneyIn';
import { MoneyOutTab } from './accounts/MoneyOut';
import { StaffTab } from './accounts/Staff';
import { DayBookTab } from './accounts/DayBook';
import { ProfitLossTab } from './accounts/ProfitLoss';
import { MoneyLocked, useMoneyAccess } from './accounts/shared';

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, feature: 'accounts.tab.overview' },
  { id: 'in', label: 'Money in', icon: ArrowDownToLine, feature: 'accounts.tab.in' },
  { id: 'out', label: 'Money out', icon: ArrowUpFromLine, feature: 'accounts.tab.out' },
  { id: 'staff', label: 'Staff and salaries', icon: Users, feature: 'accounts.tab.staff' },
  { id: 'daybook', label: 'Day book', icon: BookOpen, feature: 'accounts.tab.daybook' },
  { id: 'pnl', label: 'Profit and loss', icon: Scale, feature: 'accounts.tab.pnl' },
] as const;

export function Accounts() {
  const [params, setParams] = useSearchParams();
  const { ready, can, pw, unlock } = useMoneyAccess();          // salaries, vouchers and profit are for people allowed to raise vouchers (or with the admin password)
  const wrong = ready && !can && !!pw;
  const on = Object.fromEntries(TABS.map((t) => [t.id, useFeature(t.feature)])) as Record<string, boolean>;   // eslint-disable-line react-hooks/rules-of-hooks
  const visible = TABS.filter((t) => on[t.id]);
  const asked = params.get('tab') || 'overview';
  const tab = visible.find((t) => t.id === asked)?.id ?? visible[0]?.id;
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100 inline-flex items-center gap-1.5"><Wallet className="w-5 h-5 text-teal-600" /> Accounts<PageHelp page="accounts" /></h1>
          <p className="text-xs text-gray-500 dark:text-slate-400">The clinic’s money: what came in, what was paid out, salaries, the day book and profit.</p>
        </div>
        <SettingsLink tab="accounts" group="Vouchers, cash and who may raise them" />
      </div>
      <div className="flex flex-wrap gap-1 border-b border-gray-200 dark:border-slate-700">
        {visible.map((t) => (
          <button key={t.id} onClick={() => setParams({ tab: t.id })}
            className={cn('inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition',
              tab === t.id ? 'border-blue-600 text-blue-700 dark:text-blue-300' : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-slate-200')}>
            <t.icon className="w-4 h-4" /> {t.label}</button>
        ))}
      </div>
      {!tab && <div className="text-sm text-gray-500">Every Accounts tab is switched off in Settings → Accounts &amp; Analytics.</div>}
      {tab === 'overview' && (!ready ? null : can ? <OverviewTab /> : <MoneyLocked what="The overview" onUnlock={unlock} wrong={wrong} />)}
      {tab === 'in' && <MoneyInWithMore />}
      {tab === 'out' && (!ready ? null : can ? <MoneyOutTab /> : <MoneyLocked what="Money out" onUnlock={unlock} wrong={wrong} />)}
      {tab === 'staff' && <StaffTab money={can} />}
      {tab === 'daybook' && <DayBookTab />}
      {tab === 'pnl' && (!ready ? null : can ? <ProfitLossTab /> : <MoneyLocked what="Profit and loss" onUnlock={unlock} wrong={wrong} />)}
    </div>
  );
}

import { DiscountsSection, ReceivablesSection, UnbilledWorkSection } from '../components/analytics/Receivables';
import { localISO } from '../lib/localDate';
import { todayISO } from '../lib/utils';
/** Money in = the old Accounts page, plus the receivables, unbilled-work and discount views that used to sit in Analytics → Finance. */
function MoneyInWithMore() {
  const to = todayISO(); const d = new Date(); d.setDate(d.getDate() - 29); const from = localISO(d);
  return (
    <div className="space-y-5">
      <MoneyInTab />
      <Feature id="accounts.in.receivables"><div className="space-y-5"><ReceivablesSection /><UnbilledWorkSection /><DiscountsSection from={from} to={to} /></div></Feature>
    </div>
  );
}
