/**
 * Switchboard helpers: hide a screen part the clinic switched off, and link a page to the Settings that control it.
 *
 * `<Feature id="accounts.tab.daybook">…</Feature>` draws its children unless Settings → "What to show" switched that id off (src/lib/features.ts is
 * the one list). `<SettingsLink>` is the small "Settings" hyperlink every page carries; it opens Settings on the right tab and group (a person who
 * is not the admin is asked for the admin password by Settings itself, as for any other way in).
 */
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Settings as SettingsIcon } from 'lucide-react';
import { featureOn } from '../lib/features';
import { rememberSettingsTab, type SettingsTabId } from '../lib/settingsMap';

export function useFeature(id: string): boolean {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  return featureOn(settings, id);
}

export function Feature({ id, children }: { id: string; children: React.ReactNode }) {
  return useFeature(id) ? <>{children}</> : null;
}

/** sessionStorage key: the Settings group to scroll to when Settings opens (set by SettingsLink, read and cleared by the Settings page). */
export const SETTINGS_GROUP_KEY = 'caredesk:settings-group';

export function SettingsLink({ tab, group, label = 'Settings', title }: { tab: SettingsTabId; group?: string; label?: string; title?: string }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => {
        rememberSettingsTab(tab);
        try { if (group) sessionStorage.setItem(SETTINGS_GROUP_KEY, group); else sessionStorage.removeItem(SETTINGS_GROUP_KEY); } catch { /* Settings then opens at the top of the tab */ }
        navigate('/settings');
      }}
      title={title || 'Open the Settings that control this screen'}
      className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline print:hidden"
    >
      <SettingsIcon className="w-3 h-3" /> {label}
    </button>
  );
}

/** A small "see it in Accounts / Analytics" link used where a page keeps ONE figure and the full picture lives elsewhere. */
export function SeeMore({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)} className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline print:hidden">
      {label} →
    </button>
  );
}

/**
 * A rupee figure on a page whose job is not money (Analytics, Patient Log …): ONE small number and a link to where the full picture lives.
 * (Owner, 2026-10-29: every number has one home — rupees are in Accounts.)
 */
export function RupeeFigure({ label, value, sub, to = '/accounts?tab=in', where = 'Accounts' }: { label: string; value: string; sub?: string; to?: string; where?: string }) {
  return (
    <div className="card px-3 py-2.5 flex flex-col gap-0.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">{label}</div>
      <div className="text-sm font-semibold tabular-nums text-gray-800 dark:text-slate-200">{value}</div>
      {sub && <div className="text-[10px] text-gray-500 dark:text-slate-400">{sub}</div>}
      <SeeMore to={to} label={`see it in ${where}`} />
    </div>
  );
}

/** The box around one optional form field (its label and its input). Settings → What to show can hide it; what was already saved is never touched. */
export function FieldBox({ id, className, children }: { id: string; className?: string; children: React.ReactNode }) {
  return useFeature(id) ? <div className={className}>{children}</div> : null;
}
