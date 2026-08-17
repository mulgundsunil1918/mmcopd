import { Navigate, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert, Lock, CreditCard, PowerOff, Monitor } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { ACCESS_MODULES, parseRoleAccess } from '../lib/accessModules';
import { moduleState, explainDenial, type DenyReason } from '../lib/moduleAccess';
import type { AppMode } from '../types';

/**
 * Hard URL guard. Even if someone types a module's URL directly they're bounced
 * unless it survives every access check — and when it doesn't, the screen names
 * the ACTUAL reason and the fix, instead of one generic "ask an admin" that
 * often pointed at a screen which couldn't help.
 *
 * The decision itself lives in lib/moduleAccess.ts and is shared with the
 * sidebar, so what you can SEE and what you can OPEN can never disagree again.
 */

/** App-mode membership per route — mirrors the sidebar's NAV table. */
const PHARMACY_MODES = new Set<AppMode>(['reception_pharmacy', 'reception_pharmacy_doctor', 'reception_pharmacy_doctor_lab', 'full']);
const DOCTOR_MODES = new Set<AppMode>(['reception_doctor', 'reception_pharmacy_doctor', 'reception_pharmacy_doctor_lab', 'full']);
const LAB_MODES = new Set<AppMode>(['reception_pharmacy_doctor_lab', 'full']);
const IPD_MODES = new Set<AppMode>(['full']);
const ROUTE_MODES: Record<string, Set<AppMode>> = {
  '/doctor-select': DOCTOR_MODES,
  '/lab': LAB_MODES,
  '/pharmacy': PHARMACY_MODES,
  '/ipd': IPD_MODES,
  '/discharge-summary': IPD_MODES,
};

export function useAccessGuard() {
  const { user, adminUnlocked } = useAuth();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { data: license } = useQuery({ queryKey: ['license'], queryFn: () => window.electronAPI.license.status(), staleTime: 60_000 });
  const overrides = parseRoleAccess(settings?.role_access_json);
  const currentMode = (settings?.app_mode || 'reception_pharmacy_doctor') as AppMode;

  const stateFor = (path: string) => {
    const mod = ACCESS_MODULES.find((m) => m.path === path);
    const modes = ROUTE_MODES[path];
    return moduleState(path, {
      user: user as any,
      adminUnlocked,
      licensedModules: license?.modules,
      settings,
      overrides,
      // Unlisted sub-routes stay permissive: everyone is allowed by default.
      defaults: mod?.defaults ?? (['receptionist', 'doctor', 'nurse', 'ward_incharge', 'lab_tech', 'pharmacist'] as any),
      adminOnly: path === '/users' || path === '/settings',
      inCurrentMode: modes ? modes.has(currentMode) : true,
    });
  };

  const canAccess = (path: string): boolean => stateFor(path).allowed;

  const firstAllowed = (): string | null => {
    for (const m of ACCESS_MODULES) if (canAccess(m.path)) return m.path;
    return null;
  };

  return { canAccess, stateFor, firstAllowed, ready: !!settings };
}

const REASON_ICON: Record<DenyReason, any> = {
  ok: ShieldAlert, no_user: ShieldAlert, licence: CreditCard,
  module_off: PowerOff, app_mode: Monitor, station: Monitor, owner_only: Lock, role: ShieldAlert,
};

/** Wrap a route element: renders it only if the current user may open `path`. */
export function Guard({ path, children }: { path: string; children: React.ReactNode }) {
  const { stateFor, firstAllowed, ready } = useAccessGuard();
  const { user, adminUnlocked } = useAuth();
  const navigate = useNavigate();
  if (!ready) return null;              // wait for settings before deciding (avoids a flash-bounce)

  const st = stateFor(path);
  if (st.allowed) return <>{children}</>;

  // Only silently redirect when the person simply lacks the ROLE for a screen
  // they navigated to by accident. Every other reason is explained in place —
  // teleporting someone away from a licence or switched-off problem hides the
  // very information they need.
  if (st.reason === 'role') {
    const dest = firstAllowed();
    if (dest && dest !== path) return <Navigate to={dest} replace />;
  }

  const label = ACCESS_MODULES.find((m) => m.path === path)?.label;
  const isOwner = user?.role === 'admin' || adminUnlocked;
  const info = explainDenial(st.reason, { isOwner, label });
  const Icon = REASON_ICON[st.reason] || ShieldAlert;

  return (
    <div className="p-10 max-w-md mx-auto text-center">
      <Icon className="w-10 h-10 mx-auto text-amber-500 mb-3" />
      <div className="text-[15px] font-semibold text-gray-900 dark:text-slate-100">{info.title}</div>
      <div className="text-[12px] text-gray-500 dark:text-slate-400 mt-1 leading-relaxed">{info.body}</div>
      {info.cta && (
        <button className="btn-primary mt-4 text-xs" onClick={() => navigate(info.cta!.to)}>
          {info.cta.label}
        </button>
      )}
    </div>
  );
}
