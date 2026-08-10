import { Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { useAuth, canAnyRole } from '../hooks/useAuth';
import { ACCESS_MODULES, parseRoleAccess, effectiveRoles } from '../lib/accessModules';
import { routeLicensed } from '../lib/licenseModules';

/**
 * Hard URL guard. Even if someone types a module's URL directly, they're bounced
 * unless their role is allowed it — using the SAME Role-Based Access matrix the
 * sidebar honours. Admin sees everything; Users & Settings are admin-only. A
 * blocked user is redirected to the first module they CAN open (never a loop,
 * since that destination is itself allowed).
 */
export function useAccessGuard() {
  const { user, adminUnlocked } = useAuth();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { data: license } = useQuery({ queryKey: ['license'], queryFn: () => window.electronAPI.license.status(), staleTime: 60_000 });
  const licensedModules = license?.modules;
  const overrides = parseRoleAccess(settings?.role_access_json);

  // Add-on / hideable modules are also blocked by their enable toggle.
  const moduleEnabled = (path: string): boolean => {
    if (path === '/pediatrics') return settings?.peds_enabled === true;
    if (path === '/tpa') return settings?.tpa_enabled === true;
    if (path === '/discharge-summary') return settings?.discharge_summary_enabled !== false;
    if (path === '/billing') return settings?.show_billing_module !== false;
    if (path === '/origin') return settings?.show_patient_origin !== false;
    return true;
  };

  const canAccess = (path: string): boolean => {
    if (!user) return false;
    // Licence gate applies to everyone, admin included — you can't open a module
    // the clinic's subscription doesn't include.
    if (!routeLicensed(path, licensedModules)) return false;
    if (user.role === 'admin' || adminUnlocked) return true;
    if (path === '/users' || path === '/settings') return false; // admin-only, always
    if (!moduleEnabled(path)) return false;
    const mod = ACCESS_MODULES.find((m) => m.path === path);
    if (!mod) return true; // unlisted sub-routes stay permissive
    return canAnyRole(user, effectiveRoles(path, mod.defaults, overrides), adminUnlocked);
  };

  const firstAllowed = (): string | null => {
    for (const m of ACCESS_MODULES) if (canAccess(m.path)) return m.path;
    return null;
  };

  return { canAccess, firstAllowed, ready: !!settings };
}

/** Wrap a route element: renders it only if the current user may open `path`. */
export function Guard({ path, children }: { path: string; children: React.ReactNode }) {
  const { canAccess, firstAllowed, ready } = useAccessGuard();
  if (!ready) return null;              // wait for settings before deciding (avoids a flash-bounce)
  if (canAccess(path)) return <>{children}</>;
  const dest = firstAllowed();
  if (dest && dest !== path) return <Navigate to={dest} replace />;
  return (
    <div className="p-10 max-w-md mx-auto text-center">
      <ShieldAlert className="w-10 h-10 mx-auto text-amber-500 mb-3" />
      <div className="text-[15px] font-semibold text-gray-900 dark:text-slate-100">No access to this screen</div>
      <div className="text-[12px] text-gray-500 dark:text-slate-400 mt-1">Your role hasn’t been given access to this module. Ask an admin to grant it in Settings → Role-Based Access.</div>
    </div>
  );
}
