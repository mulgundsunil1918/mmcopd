/**
 * The pieces of the "how many computers" answer, shared by the first-start Setup guide and Settings → Computers & staff, so the same question looks and
 * behaves the same in both (owner, 2026-10-27: "whatever I tell should be in both Settings and the starting setup screen").
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Monitor, Network, Lock, Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ROUTE_MODULE } from '../../lib/licenseModules';
import { canSwitchReceptionOff, receptionCan, withReceptionAccess, RECEPTION_SCREENS, type ComputersMode } from '../../lib/computers';
import { useLicensedModules } from '../../hooks/useLicensedModules';
import { useToast } from '../../hooks/useToast';

/** One sentence the Setup screen must always carry. */
export function ChangeLaterNote() {
  return (
    <div className="text-[12px] text-gray-600 dark:text-slate-300 rounded-lg bg-blue-50 dark:bg-blue-900/15 border border-blue-100 dark:border-blue-900/50 px-3 py-2">
      <b>You can change this later</b> — in <b>Settings → Computers &amp; staff</b>, at any time.
    </div>
  );
}

/** "One computer" / "More than one computer" — two big cards. */
export function ModeChoice({ value, onChange, disabled, disabledWhy }: {
  value: ComputersMode; onChange: (m: ComputersMode) => void; disabled?: boolean; disabledWhy?: string;
}) {
  const card = (m: ComputersMode, icon: React.ReactNode, title: string, lines: string[]) => (
    <button type="button" disabled={disabled} onClick={() => onChange(m)} aria-pressed={value === m}
      className={cn('text-left rounded-xl border-2 p-4 transition disabled:opacity-60 disabled:cursor-not-allowed',
        value === m ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-slate-700 hover:border-blue-400')}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={cn('w-8 h-8 rounded-lg flex items-center justify-center', value === m ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300')}>{icon}</span>
        <span className="text-[14px] font-bold text-gray-900 dark:text-slate-100">{title}</span>
        {value === m && <Check className="w-4 h-4 text-blue-600 ml-auto" />}
      </div>
      <ul className="text-[12px] text-gray-600 dark:text-slate-300 space-y-1 list-disc pl-5">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
    </button>
  );
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {card('single', <Monitor className="w-4 h-4" />, 'One computer', [
          'This computer opens as Reception — nobody has to sign in.',
          'Settings, Users & Access and deleting are locked behind the admin password.',
          'You choose what Reception can open.',
        ])}
        {card('multi', <Network className="w-4 h-4" />, 'More than one computer', [
          'One main computer holds the clinic’s data; the others connect to it by cable or Wi-Fi.',
          'Everyone signs in with their own login.',
          'The admin can sign in on any computer. Only the main computer changes clinic Settings.',
        ])}
      </div>
      {disabled && disabledWhy && <div className="text-[12px] text-amber-800 dark:text-amber-200 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 flex items-start gap-2"><Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" /><span>{disabledWhy}</span></div>}
    </div>
  );
}

/**
 * "What can Reception do?" — one switch per screen, the Reception column of the role matrix. A change is reported at once (the parent saves it), so
 * nothing is lost by closing the page. Screens the clinic has no licence for are not listed (they would be hidden anyway).
 */
export function ReceptionAccessList({ roleAccessJson, onToggle, disabled }: {
  roleAccessJson: string | null | undefined; onToggle: (path: string, on: boolean) => void; disabled?: boolean;
}) {
  const { has } = useLicensedModules();
  const shown = RECEPTION_SCREENS.filter((m) => !ROUTE_MODULE[m.path] || has(ROUTE_MODULE[m.path]));
  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
        <div className="flex items-center gap-2 py-1 text-[13px] text-gray-500 dark:text-slate-400">
          <span className="w-9 h-5 rounded-full bg-emerald-500/60 relative shrink-0"><span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-white" /></span>
          Reception <span className="text-[10px] uppercase tracking-wide">always on</span>
        </div>
        {shown.map((m) => {
          const on = receptionCan(m.path, roleAccessJson);
          const can = canSwitchReceptionOff(m.path);
          return (
            <button key={m.path} type="button" disabled={disabled || !can} aria-pressed={on} onClick={() => onToggle(m.path, !on)}
              className="flex items-center gap-2 py-1 text-left text-[13px] text-gray-900 dark:text-slate-100 disabled:opacity-60" title={`${on ? 'Reception can open' : 'Reception cannot open'} ${m.label}`}>
              <span className={cn('w-9 h-5 rounded-full relative shrink-0 transition', on ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-slate-600')}>
                <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all', on ? 'right-0.5' : 'left-0.5')} />
              </span>
              {m.label}
            </button>
          );
        })}
      </div>
      <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-2">
        Switched off = the screen disappears from Reception&rsquo;s menu. The administrator always sees everything. Settings, Users &amp; Access and deleting stay behind the admin password whatever is chosen here.
      </div>
    </div>
  );
}

/** Reception's discount limit at the pharmacy counter (a one-computer clinic). Blank = no limit. */
export function SharedDeskDiscountBox({ value, onChange, disabled }: { value: number | null | undefined; onChange: (v: number | null) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <label className="text-[13px] text-gray-900 dark:text-slate-100">Most Reception may take off a medicine sale at the counter</label>
      <input type="number" min={0} max={100} step="0.5" className="input w-24" placeholder="no limit" disabled={disabled}
        value={value ?? ''} onChange={(e) => { const raw = e.target.value.trim(); const n = Number(raw); onChange(raw === '' || !Number.isFinite(n) ? null : Math.max(0, Math.min(100, n))); }} />
      <span className="text-[12px] text-gray-500">% — leave blank for no limit</span>
    </div>
  );
}

/**
 * The saved role-access text as the Reception list sees it, and the one thing it does: switch Reception on or off for a screen. Each switch is saved at
 * once, one after the other (two quick clicks never overwrite each other), and what another editor saves meanwhile (the role matrix) is picked up.
 */
export function useReceptionAccess() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const [json, setJson] = useState('');
  const latest = useRef('');
  const pending = useRef(0);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const savedJson = settings ? (settings.role_access_json || '') : null;
  useEffect(() => {
    if (savedJson === null || pending.current > 0) return;
    if (savedJson !== latest.current) { latest.current = savedJson; setJson(savedJson); }
  }, [savedJson]);
  const toggle = (path: string, on: boolean) => {
    const next = withReceptionAccess(latest.current, path, on);
    if (next === latest.current) return;
    latest.current = next; setJson(next);
    pending.current += 1;
    chain.current = chain.current.then(async () => {
      try { await window.electronAPI.settings.save({ role_access_json: next }); await qc.invalidateQueries({ queryKey: ['settings'] }); }
      catch (e: any) { toast(e?.message || 'Could not save', 'error'); }
      finally { pending.current -= 1; }
    });
  };
  return { json, toggle, ready: savedJson !== null };
}
