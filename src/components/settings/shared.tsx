/**
 * Small pieces every Settings tab uses, so the tabs look and behave the same: the explanation line under a control, a switch with its help text, the
 * Save bar of a tab, the one-line "what lives here" card at the top of a tab, and the card a tab shows while its module is not in the subscription.
 */
import { Info, Lock } from 'lucide-react';
import { cn } from '../../lib/utils';

/** A small labelled explanation shown under a control. */
export function Explain({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-1 flex gap-1.5">
      <Info className="w-3 h-3 mt-0.5 shrink-0 opacity-70" />
      <span>{children}</span>
    </div>
  );
}

/** A checkbox with a bold line and its help text underneath. */
export function AccrualToggle({ label, help, value, onChange }: {
  label: string; help: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input type="checkbox" className="mt-1" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <div>
        <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100">{label}</div>
        <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">{help}</div>
      </div>
    </label>
  );
}

/** The Save bar at the top of a tab whose switches need Save (a tab's lists — wards, catalogues — save on their own). */
export function SectionSaveBar({ note, dirty, saving, onReset, onSave }: {
  note: React.ReactNode; dirty: boolean; saving: boolean; onReset: () => void; onSave: () => void;
}) {
  // Sticks to the top of the page while the tab's long form scrolls, so Save is always in reach (the tab bar above is not sticky).
  return (
    <div className="flex items-center justify-between sticky top-0 z-10 bg-white/90 dark:bg-slate-900/90 backdrop-blur py-2 -my-2 px-1 rounded">
      <div className="text-[11px] text-gray-500 dark:text-slate-400">{note}</div>
      <div className="flex items-center gap-2">
        {dirty && <button className="btn-ghost text-xs" onClick={onReset}>Reset</button>}
        <button className="btn-primary text-xs" disabled={!dirty || saving} onClick={onSave}>
          {saving ? 'Saving…' : dirty ? 'Save changes' : 'All saved'}
        </button>
      </div>
    </div>
  );
}

/** "What lives in this tab", in one sentence, plus where closely related things are kept. */
export function TabIntro({ title, children, also }: { title: string; children: React.ReactNode; also?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-blue-100 dark:border-blue-900/50 bg-blue-50/60 dark:bg-blue-900/10 px-4 py-3">
      <div className="text-[13px] font-bold text-blue-900 dark:text-blue-100">{title}</div>
      <div className="text-[12px] text-blue-900/80 dark:text-blue-100/80 mt-0.5">{children}</div>
      {also && <div className="text-[11px] text-blue-900/70 dark:text-blue-200/70 mt-1.5">{also}</div>}
    </div>
  );
}

/** What a module's tab shows while the subscription does not include the module. */
export function LockedModule({ name, what, onOpenSubscription }: { name: string; what: string; onOpenSubscription: () => void }) {
  return (
    <div className={cn('rounded-xl border border-dashed border-gray-300 dark:border-slate-600 p-8 text-center bg-white dark:bg-slate-900')}>
      <div className="mx-auto w-10 h-10 rounded-full bg-gray-100 dark:bg-slate-800 flex items-center justify-center mb-3"><Lock className="w-5 h-5 text-gray-500" /></div>
      <div className="text-sm font-bold text-gray-900 dark:text-slate-100">{name} settings are locked</div>
      <div className="text-[12px] text-gray-600 dark:text-slate-400 mt-1 max-w-md mx-auto">
        {name} is not part of this clinic&rsquo;s subscription, so there is nothing to set up here yet. Once the {name} module is added, this tab opens with everything about {what} in one place.
      </div>
      <button className="btn-primary text-xs mt-4" onClick={onOpenSubscription}>See the subscription &amp; add a module</button>
    </div>
  );
}
