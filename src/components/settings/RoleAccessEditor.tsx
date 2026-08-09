import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Loader2, RotateCcw, Save } from 'lucide-react';
import { useToast } from '../../hooks/useToast';
import { cn } from '../../lib/utils';
import type { Role } from '../../hooks/useAuth';
import { ACCESS_MODULES, ASSIGNABLE_ROLES, parseRoleAccess } from '../../lib/accessModules';

/**
 * Admin-only editor for the role → module access matrix. Tick which staff roles
 * can open each module; the sidebar honours it immediately after saving. Admin
 * always sees everything, and Users & Settings stay admin-only (not shown here),
 * so an admin can never lock themselves out.
 */
export function RoleAccessEditor() {
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });

  // Build the working matrix: overrides where set, else the module's defaults.
  const initial = useMemo(() => {
    const overrides = parseRoleAccess(settings?.role_access_json);
    const m: Record<string, Set<Role>> = {};
    for (const mod of ACCESS_MODULES) {
      const roles = Array.isArray(overrides[mod.path]) ? overrides[mod.path] : mod.defaults;
      m[mod.path] = new Set(roles);
    }
    return m;
  }, [settings?.role_access_json]);

  const [matrix, setMatrix] = useState<Record<string, Set<Role>>>(initial);
  // Re-sync when settings load/change and the user hasn't started editing.
  const [dirty, setDirty] = useState(false);
  const view = dirty ? matrix : initial;

  const toggle = (path: string, role: Role) => {
    const base = dirty ? matrix : initial;
    const next: Record<string, Set<Role>> = {};
    for (const k of Object.keys(base)) next[k] = new Set(base[k]);
    if (next[path].has(role)) next[path].delete(role); else next[path].add(role);
    setMatrix(next);
    setDirty(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      const out: Record<string, Role[]> = {};
      for (const mod of ACCESS_MODULES) out[mod.path] = [...view[mod.path]];
      await window.electronAPI.settings.save({ role_access_json: JSON.stringify(out) });
      qc.invalidateQueries({ queryKey: ['settings'] });
      setDirty(false);
      toast('Access saved — the sidebar updates for each role', 'success');
    } catch (e: any) { toast(e?.message || 'Could not save', 'error'); }
    finally { setBusy(false); }
  };

  const resetDefaults = async () => {
    setBusy(true);
    try {
      await window.electronAPI.settings.save({ role_access_json: '' });
      qc.invalidateQueries({ queryKey: ['settings'] });
      setDirty(false);
      toast('Reset to the built-in defaults', 'info');
    } catch (e: any) { toast(e?.message || 'Could not reset', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-indigo-500" /> Role-Based Access</div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5 max-w-2xl">
            Decide which staff roles can open each module. Changes apply the moment you save. <b>Admin</b> always sees
            everything; <b>Users &amp; Settings</b> stay admin-only so you can never lock yourself out.
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost text-xs" disabled={busy} onClick={resetDefaults} title="Restore built-in defaults"><RotateCcw className="w-3.5 h-3.5" /> Reset</button>
          <button className="btn-primary text-xs" disabled={busy || !dirty} onClick={save}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save access</button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
        <table className="w-full text-[12px] min-w-[640px]">
          <thead>
            <tr className="bg-gray-50 dark:bg-slate-800/60 text-left">
              <th className="p-2.5 font-semibold text-gray-700 dark:text-slate-200 sticky left-0 bg-gray-50 dark:bg-slate-800/60">Module</th>
              {ASSIGNABLE_ROLES.map((r) => (
                <th key={r.role} className="p-2.5 text-center font-semibold text-gray-600 dark:text-slate-300 whitespace-nowrap">{r.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ACCESS_MODULES.map((mod, i) => (
              <tr key={mod.path} className={cn('border-t border-gray-100 dark:border-slate-800', i % 2 ? 'bg-gray-50/40 dark:bg-slate-800/20' : '')}>
                <td className="p-2.5 font-medium text-gray-900 dark:text-slate-100 whitespace-nowrap sticky left-0 bg-inherit">{mod.label}</td>
                {ASSIGNABLE_ROLES.map((r) => {
                  const on = view[mod.path]?.has(r.role);
                  return (
                    <td key={r.role} className="p-2 text-center">
                      <button
                        onClick={() => toggle(mod.path, r.role)}
                        aria-pressed={on}
                        className={cn('w-6 h-6 rounded-md border-2 inline-flex items-center justify-center transition',
                          on ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300 dark:border-slate-600 text-transparent hover:border-emerald-400')}
                        title={`${on ? 'Remove' : 'Give'} ${r.label} access to ${mod.label}`}
                      >
                        <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[11px] text-gray-400">Tip: a role with no ticks anywhere will sign in but see an empty sidebar — give at least Reception or their own module.</div>
    </div>
  );
}
