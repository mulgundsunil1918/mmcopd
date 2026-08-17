import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Users, Calendar, Stethoscope, Receipt, Wallet, Bell, Settings as SettingsIcon, HeartPulse, Sun, Moon, History, MapPin, FlaskConical, BedDouble, Pill, ShieldCheck, UserCircle2, Lock, Unlock, Activity, Syringe, ChevronLeft, Wifi, Server, LogOut, BookOpen, MessageSquare, Baby, FileText, Printer, Pencil, Eye, EyeOff, GripVertical, Check } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '../lib/utils';
import { useTheme } from '../hooks/useTheme';
import { useAuth, canAnyRole, type Role } from '../hooks/useAuth';
import { parseRoleAccess, effectiveRoles, ACCESS_MODULES } from '../lib/accessModules';
import { ROUTE_MODULE } from '../lib/licenseModules';
import { moduleState } from '../lib/moduleAccess';
import { BackupAndClose } from './BackupAndClose';
import type { AppMode } from '../types';

/**
 * Each mode "includes" everything below it. Pharmacy is its own toggleable layer:
 * - Pharmacy appears in mode 1 (reception_pharmacy) onwards EXCEPT plain reception_doctor.
 * - Doctor appears in mode 2 (reception_doctor) and mode 3+ (reception_pharmacy_doctor onwards).
 * Lab needs mode 4+, IPD needs full.
 *
 * We can't use a simple integer rank because reception_pharmacy and reception_doctor
 * are siblings (neither is a strict subset of the other). Each NavItem now declares
 * a Set of modes it appears in.
 */
const PHARMACY_MODES = new Set<AppMode>(['reception_pharmacy', 'reception_pharmacy_doctor', 'reception_pharmacy_doctor_lab', 'full']);
const DOCTOR_MODES = new Set<AppMode>(['reception_doctor', 'reception_pharmacy_doctor', 'reception_pharmacy_doctor_lab', 'full']);
const LAB_MODES = new Set<AppMode>(['reception_pharmacy_doctor_lab', 'full']);
const IPD_MODES = new Set<AppMode>(['full']);
const ALL_MODES = new Set<AppMode>(['reception', 'reception_pharmacy', 'reception_doctor', 'reception_pharmacy_doctor', 'reception_pharmacy_doctor_lab', 'full']);

type NavItem2 = { to: string; label: string; icon: any; color: string; modes: Set<AppMode>; roles: Role[]; adminOnly?: boolean };

const NAV: NavItem2[] = [
  { to: '/reception', label: 'Reception', icon: Users, color: 'text-emerald-500', modes: ALL_MODES, roles: ['receptionist'] },
  { to: '/appointments', label: 'Appointments', icon: Calendar, color: 'text-blue-500', modes: ALL_MODES, roles: ['receptionist', 'doctor'] },
  { to: '/whatsapp', label: 'Communication', icon: MessageSquare, color: 'text-green-500', modes: ALL_MODES, roles: ['receptionist', 'doctor'] },
  { to: '/doctor-select', label: 'Doctors', icon: Stethoscope, color: 'text-purple-500', modes: DOCTOR_MODES, roles: ['doctor', 'receptionist'] },
  { to: '/lab', label: 'Laboratory', icon: FlaskConical, color: 'text-fuchsia-500', modes: LAB_MODES, roles: ['lab_tech', 'doctor', 'receptionist'] },
  { to: '/pharmacy', label: 'Pharmacy', icon: Pill, color: 'text-lime-500', modes: PHARMACY_MODES, roles: ['pharmacist', 'doctor', 'receptionist'] },
  { to: '/ipd', label: 'IPD', icon: BedDouble, color: 'text-red-500', modes: IPD_MODES, roles: ['doctor', 'receptionist', 'nurse', 'ward_incharge'] },
  { to: '/discharge-summary', label: 'Discharge Summary', icon: FileText, color: 'text-sky-500', modes: IPD_MODES, roles: ['doctor', 'receptionist', 'nurse'] },
  { to: '/pediatrics', label: 'Pediatrics', icon: Baby, color: 'text-pink-500', modes: ALL_MODES, roles: ['doctor', 'receptionist', 'nurse'] },
  { to: '/print-jobs', label: 'Print Jobs', icon: Printer, color: 'text-blue-500', modes: ALL_MODES, roles: ['receptionist', 'doctor', 'nurse'] },
  { to: '/tpa', label: 'Insurance / TPA', icon: ShieldCheck, color: 'text-teal-500', modes: ALL_MODES, roles: ['receptionist'] },
  { to: '/patient-log', label: 'Patient Log', icon: History, color: 'text-cyan-500', modes: ALL_MODES, roles: ['receptionist', 'doctor'] },
  { to: '/origin', label: 'Patient Origin', icon: MapPin, color: 'text-rose-500', modes: ALL_MODES, roles: ['receptionist', 'doctor'] },
  { to: '/billing', label: 'Billing', icon: Receipt, color: 'text-amber-500', modes: ALL_MODES, roles: ['receptionist'] },
  { to: '/miscellaneous', label: 'Services', icon: Syringe, color: 'text-pink-500', modes: ALL_MODES, roles: ['receptionist', 'doctor'] },
  { to: '/accounts', label: 'Accounts', icon: Wallet, color: 'text-teal-500', modes: ALL_MODES, roles: ['receptionist'] },
  { to: '/analytics', label: 'Analytics', icon: Activity, color: 'text-indigo-500', modes: ALL_MODES, roles: ['receptionist', 'doctor'] },
  // Reports merged into Analytics → Operational Reports tab. Page kept reachable
  // by URL (/reports) but no sidebar entry. Re-enable here if you want it back.
  { to: '/notifications', label: 'Notifications', icon: Bell, color: 'text-pink-500', modes: ALL_MODES, roles: ['receptionist'] },
  { to: '/help', label: 'Help & Tutorials', icon: BookOpen, color: 'text-blue-500', modes: ALL_MODES, roles: ['receptionist', 'doctor', 'nurse', 'ward_incharge', 'lab_tech', 'pharmacist', 'manager'] },
  { to: '/users', label: 'Users & Access', icon: ShieldCheck, color: 'text-indigo-500', modes: ALL_MODES, roles: ['receptionist', 'doctor'], adminOnly: true },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, color: 'text-slate-500', modes: ALL_MODES, roles: ['receptionist', 'doctor'], adminOnly: true },
];

export function Sidebar({ onCollapse }: { onCollapse?: () => void } = {}) {
  const { theme, toggle } = useTheme();
  const { user, logout, adminUnlocked, lockAdmin } = useAuth();
  const { data: clinicName } = useQuery({ queryKey: ['clinic-name'], queryFn: () => window.electronAPI.app.getClinicName() });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { data: license } = useQuery({ queryKey: ['license'], queryFn: () => window.electronAPI.license.status(), staleTime: 60_000 });
  const licensedModules = license?.modules;
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ order: string[]; hidden: Record<string, boolean> } | null>(null);

  const currentMode = (settings?.app_mode || 'reception_pharmacy_doctor') as AppMode;
  const { data: updateState } = useQuery({
    queryKey: ['updates-state'],
    queryFn: () => window.electronAPI.updates.state(),
    staleTime: Infinity,
  });
  const appVersion = updateState?.appVersion || '—';
  const billingHidden = settings?.show_billing_module === false;
  const originHidden = settings?.show_patient_origin === false;

  // Human-readable label for the user identity badge — derived from the
  // configured app mode, NOT the user's static role (which used to show
  // 'Reception + Doctor' even when the admin had picked 'Reception only').
  const MODE_LABELS: Record<AppMode, string> = {
    reception: 'Reception only',
    reception_pharmacy: 'Reception + Pharmacy',
    reception_doctor: 'Reception + Doctor',
    reception_pharmacy_doctor: 'Reception + Pharmacy + Doctor',
    reception_pharmacy_doctor_lab: 'Reception + Pharmacy + Doctor + Lab',
    full: 'Full HMS',
  };
  const modeLabel = MODE_LABELS[currentMode] || currentMode;
  // Admin-customised role → module access (from Settings). Empty = built-in defaults.
  const accessOverrides = parseRoleAccess(settings?.role_access_json);

  // Role / licence / mode permitted items, in NAV order (before custom layout).
  // Uses the SAME evaluator as the URL guard, so the menu can never show
  // something the guard would block (or hide something it would allow).
  // The ONE exception: owner-only screens (Settings, Users & Access) stay in the
  // menu wearing a padlock even before the admin password is entered. They are
  // how you enter that password — hiding them until you are already unlocked
  // locked every clinic out of its own Settings.
  const permitted = NAV.filter((n) => {
    const st = moduleState(n.to, {
      user: user as any,
      adminUnlocked,
      licensedModules,
      settings,
      overrides: accessOverrides,
      // Role defaults come from ACCESS_MODULES — the same table Settings edits and
      // the URL guard consults. The sidebar used to keep its own copy in NAV.roles,
      // and the two drifted the moment a role was added: 'manager' was registered
      // everywhere else but missing here, so a manager signed in to an empty menu.
      // NAV.roles now only covers paths ACCESS_MODULES does not list (/help, /users).
      defaults: ACCESS_MODULES.find((m: { path: string; defaults: Role[] }) => m.path === n.to)?.defaults ?? n.roles,
      adminOnly: n.adminOnly,
      inCurrentMode: n.modes.has(currentMode),
    });
    return st.allowed || st.reason === 'owner_only';
  });
  const permittedMap = new Map(permitted.map((n) => [n.to, n]));

  // Apply the user's saved custom layout (order + hidden) on top of `permitted`.
  const savedLayout: { to: string; hidden?: boolean }[] = (() => {
    try { const p = JSON.parse(settings?.sidebar_layout || '[]'); return Array.isArray(p) ? p : []; } catch { return []; }
  })();
  const layoutOrder = savedLayout.map((x) => x.to);
  const hiddenMap: Record<string, boolean> = {};
  for (const x of savedLayout) if (x.hidden) hiddenMap[x.to] = true;
  const ordered = [...permitted]
    .sort((a, b) => {
      const ia = layoutOrder.indexOf(a.to), ib = layoutOrder.indexOf(b.to);
      if (ia === -1 && ib === -1) return 0;   // both new → keep NAV order (V8 sort is stable)
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    })
    .map((n) => ({ ...n, hidden: !!hiddenMap[n.to] }));

  const PINNED = new Set(['/settings']);      // never hideable → can't lock yourself out
  const visibleNav = ordered.filter((n) => PINNED.has(n.to) || !n.hidden);

  // ── Sidebar customisation (edit mode) ──────────────────────────────────────
  const startEdit = () => {
    setDraft({ order: ordered.map((n) => n.to), hidden: { ...hiddenMap } });
    setEditing(true);
  };
  const moveItem = (from: number | null, to: number) => {
    if (from === null || from === to || !draft) return;
    const order = [...draft.order];
    const [it] = order.splice(from, 1);
    order.splice(to, 0, it);
    setDraft({ ...draft, order });
  };
  const toggleHidden = (to: string) => {
    if (!draft || PINNED.has(to)) return;
    setDraft({ ...draft, hidden: { ...draft.hidden, [to]: !draft.hidden[to] } });
  };
  const saveLayout = async () => {
    if (!draft) return;
    const layout = draft.order.map((to) => ({ to, hidden: !!draft.hidden[to] }));
    try {
      await window.electronAPI.settings.save({ sidebar_layout: JSON.stringify(layout) } as any);
      qc.invalidateQueries({ queryKey: ['settings'] });
    } catch { /* ignore */ }
    setEditing(false); setDraft(null);
  };
  const resetLayout = async () => {
    try {
      await window.electronAPI.settings.save({ sidebar_layout: '' } as any);
      qc.invalidateQueries({ queryKey: ['settings'] });
    } catch { /* ignore */ }
    setEditing(false); setDraft(null);
  };

  return (
    <aside className="sidebar w-60 flex flex-col no-print">
      <div className="px-5 py-5 border-b sidebar-divider">
        <div className="flex items-center gap-2">
          {settings?.clinic_logo ? (
            <img src={settings.clinic_logo} alt="Logo" className="w-9 h-9 rounded-lg object-contain shadow" style={{ background: '#ffffff' }} />
          ) : (
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow">
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round" className="w-5 h-5">
                <path d="M12 5v14M5 12h14"/>
                <circle cx="18.5" cy="18.5" r="2" fill="white" stroke="none"/>
              </svg>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="sidebar-title text-sm leading-tight truncate">{settings?.clinic_name || 'CureDesk HMS'}</div>
            <div className="sidebar-subtitle text-[10px] leading-tight truncate">{settings?.clinic_tagline || clinicName || 'Modern OPD management'}</div>
          </div>
          {!editing && (
            <button
              type="button"
              onClick={startEdit}
              title="Customise menu — reorder & hide items"
              className="flex-shrink-0 w-6 h-6 rounded hover:bg-white/10 inline-flex items-center justify-center text-gray-400 hover:text-white transition"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
          {onCollapse && !editing && (
            <button
              type="button"
              onClick={onCollapse}
              title="Hide sidebar (Ctrl+\)"
              className="flex-shrink-0 w-6 h-6 rounded hover:bg-white/10 inline-flex items-center justify-center text-gray-400 hover:text-white transition"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {editing && draft ? (
          <>
            <div className="px-1 pb-2 mb-2 border-b sidebar-divider">
              <div className="text-[11px] font-semibold sidebar-title">Customise menu</div>
              <div className="text-[10px] sidebar-subtitle">Drag ⠿ to reorder · 👁 to hide / show</div>
              <div className="flex gap-1.5 mt-2">
                <button type="button" onClick={saveLayout} className="flex-1 text-[11px] font-semibold px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-500 inline-flex items-center justify-center gap-1"><Check className="w-3 h-3" /> Save</button>
                <button type="button" onClick={() => { setEditing(false); setDraft(null); }} className="flex-1 text-[11px] font-semibold px-2 py-1 rounded bg-black/10 dark:bg-white/10 hover:bg-black/20 dark:hover:bg-white/20">Cancel</button>
                <button type="button" onClick={resetLayout} title="Reset to default order" className="text-[11px] px-2 py-1 rounded bg-black/10 dark:bg-white/10 hover:bg-black/20 dark:hover:bg-white/20">Reset</button>
              </div>
            </div>
            {draft.order.map((to, i) => {
              const item = permittedMap.get(to);
              if (!item) return null;
              const Icon = item.icon;
              const isHidden = !!draft.hidden[to];
              const pinned = PINNED.has(to);
              return (
                <div
                  key={to}
                  draggable
                  onDragStart={() => setDragIdx(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); moveItem(dragIdx, i); setDragIdx(null); }}
                  onDragEnd={() => setDragIdx(null)}
                  className={cn(
                    'flex items-center gap-2 px-2 py-2 rounded-lg text-sm sidebar-link select-none border border-transparent',
                    dragIdx === i ? 'opacity-40' : '',
                    dragIdx !== null && dragIdx !== i ? 'border-dashed border-white/20' : '',
                    isHidden && 'opacity-45',
                  )}
                >
                  <GripVertical className="w-3.5 h-3.5 text-gray-400 shrink-0 cursor-grab" />
                  <Icon className={cn('w-4 h-4', item.color)} />
                  <span className="flex-1 truncate">{item.label}</span>
                  {pinned ? (
                    <Lock className="w-3.5 h-3.5 text-gray-400" />
                  ) : (
                    <button type="button" onClick={() => toggleHidden(to)} title={isHidden ? 'Show in menu' : 'Hide from menu'} className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10">
                      {isHidden ? <EyeOff className="w-4 h-4 text-gray-400" /> : <Eye className="w-4 h-4 text-emerald-500" />}
                    </button>
                  )}
                </div>
              );
            })}
          </>
        ) : (
          visibleNav.map(({ to, label, icon: Icon, color, adminOnly }) => {
            const locked = !!adminOnly && !adminUnlocked && user?.role !== 'admin';
            return (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition',
                    isActive ? 'sidebar-link-active shadow-sm' : 'sidebar-link'
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className={cn('w-4 h-4', isActive ? 'text-white' : color)} />
                    <span className="flex-1">{label}</span>
                    {locked && <Lock className={cn('w-3 h-3', isActive ? 'text-white' : 'text-amber-500')} />}
                  </>
                )}
              </NavLink>
            );
          })
        )}
      </nav>

      <div className="px-3 py-3 border-t sidebar-divider space-y-2">
        <NetworkStatusPill />
        {user && (settings?.show_user_badge !== false) && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg sidebar-link">
            <UserCircle2 className="w-4 h-4 text-blue-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold truncate">{user.display_name || user.username}</div>
              <div className="text-[10px] opacity-80 uppercase tracking-wider">
                {modeLabel}
              </div>
            </div>
          </div>
        )}

        {adminUnlocked && (
          <button
            onClick={lockAdmin}
            className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, #dc2626, #b91c1c)' }}
            title="Lock admin mode"
          >
            <span className="flex items-center gap-1.5"><Unlock className="w-3.5 h-3.5" /> Admin unlocked</span>
            <span className="text-[10px] opacity-90">Lock</span>
          </button>
        )}

        <BackupAndClose />

        {/* Sign out — only shown when staff sign-in is on. Without this a clinic
            that turns logins on can never switch user on a shared counter PC. */}
        {settings?.require_login && !!user && user.role !== 'staff' && user.id > 0 && (
          <button
            onClick={logout}
            className="sidebar-link w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition"
            title="Sign out and return to the login screen"
          >
            <span className="flex items-center gap-2"><LogOut className="w-3.5 h-3.5 text-rose-500" /> Sign out</span>
            <span className="sidebar-meta text-[10px]">{user?.username}</span>
          </button>
        )}

        <button
          onClick={toggle}
          className="sidebar-link w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition"
          title="Toggle theme"
        >
          <span className="flex items-center gap-2">
            {theme === 'dark' ? <Moon className="w-3.5 h-3.5 text-indigo-400" /> : <Sun className="w-3.5 h-3.5 text-amber-500" />}
            <span>{theme === 'dark' ? 'Dark' : 'Light'} mode</span>
          </span>
          <span className="sidebar-meta text-[10px]">tap</span>
        </button>
        {/* Read the real version — this was hardcoded, so every build since 0.4.0
            told support the wrong version when a clinic reported a problem. */}
        <div className="sidebar-meta text-[10px] px-3">v{appVersion} · {currentMode.replace(/_/g, ' + ')}</div>
      </div>
    </aside>
  );
}

/** Compact pill that shows whether this PC is local / hosting (server) / connected
 *  to a server, with live colored dot. Hidden when in plain Local mode to keep
 *  the sidebar clean for single-PC users. */
function NetworkStatusPill() {
  const { data: status } = useQuery({
    queryKey: ['network-status'],
    queryFn: () => window.electronAPI.network.status(),
    refetchInterval: 5_000,
  });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  if (!status || status.mode === 'local') return null;
  const isServer = status.mode === 'server';
  const ok = isServer ? status.running : true;
  const dot = ok ? '#10b981' : '#ef4444';
  const Icon = isServer ? Server : Wifi;
  const station = settings?.station_name || (isServer ? 'Reception Desk' : 'This Cabin');
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg sidebar-link" title={`Station: ${station}\n${JSON.stringify(status, null, 2)}`}>
      <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: dot }} />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold truncate">{station}</div>
        <div className="text-[9px] opacity-80 uppercase tracking-wider truncate">
          {isServer ? `Hosting · ${status.clients} clients` : `Client → ${status.serverUrl || '(not set)'}`}
        </div>
      </div>
      <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: dot }} />
    </div>
  );
}
