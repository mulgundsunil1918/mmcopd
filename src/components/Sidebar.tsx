import { NavLink } from 'react-router-dom';
import { Users, Calendar, Stethoscope, Receipt, Wallet, Bell, Settings as SettingsIcon, HeartPulse, Sun, Moon, History, MapPin, FlaskConical, BedDouble, Pill, ShieldCheck, UserCircle2, Lock, Unlock, Activity, Syringe, ChevronLeft, Wifi, Server, Heart } from 'lucide-react';

const SUPPORT_URL = 'https://bridgr.co.in/support?from=curedesk';
function openSupport() {
  window.electronAPI.app.openExternal(SUPPORT_URL).catch(() => { /* ignore */ });
}
import { useQuery } from '@tanstack/react-query';
import { cn } from '../lib/utils';
import { useTheme } from '../hooks/useTheme';
import { useAuth, canAnyRole, type Role } from '../hooks/useAuth';
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
  { to: '/doctor-select', label: 'Doctors', icon: Stethoscope, color: 'text-purple-500', modes: DOCTOR_MODES, roles: ['doctor', 'receptionist'] },
  { to: '/lab', label: 'Laboratory', icon: FlaskConical, color: 'text-fuchsia-500', modes: LAB_MODES, roles: ['lab_tech', 'doctor', 'receptionist'] },
  { to: '/pharmacy', label: 'Pharmacy', icon: Pill, color: 'text-lime-500', modes: PHARMACY_MODES, roles: ['pharmacist', 'doctor', 'receptionist'] },
  { to: '/ipd', label: 'IPD', icon: BedDouble, color: 'text-red-500', modes: IPD_MODES, roles: ['doctor', 'receptionist'] },
  { to: '/patient-log', label: 'Patient Log', icon: History, color: 'text-cyan-500', modes: ALL_MODES, roles: ['receptionist', 'doctor'] },
  { to: '/origin', label: 'Patient Origin', icon: MapPin, color: 'text-rose-500', modes: ALL_MODES, roles: ['receptionist', 'doctor'] },
  { to: '/billing', label: 'Billing', icon: Receipt, color: 'text-amber-500', modes: ALL_MODES, roles: ['receptionist'] },
  { to: '/miscellaneous', label: 'Services', icon: Syringe, color: 'text-pink-500', modes: ALL_MODES, roles: ['receptionist', 'doctor'] },
  { to: '/accounts', label: 'Accounts', icon: Wallet, color: 'text-teal-500', modes: ALL_MODES, roles: ['receptionist'] },
  { to: '/analytics', label: 'Analytics', icon: Activity, color: 'text-indigo-500', modes: ALL_MODES, roles: ['receptionist', 'doctor'] },
  // Reports merged into Analytics → Operational Reports tab. Page kept reachable
  // by URL (/reports) but no sidebar entry. Re-enable here if you want it back.
  { to: '/notifications', label: 'Notifications', icon: Bell, color: 'text-pink-500', modes: ALL_MODES, roles: ['receptionist'] },
  { to: '/users', label: 'Users & Access', icon: ShieldCheck, color: 'text-indigo-500', modes: ALL_MODES, roles: ['receptionist', 'doctor'], adminOnly: true },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, color: 'text-slate-500', modes: ALL_MODES, roles: ['receptionist', 'doctor'], adminOnly: true },
];

export function Sidebar({ onCollapse }: { onCollapse?: () => void } = {}) {
  const { theme, toggle } = useTheme();
  const { user, logout, adminUnlocked, lockAdmin } = useAuth();
  const { data: clinicName } = useQuery({ queryKey: ['clinic-name'], queryFn: () => window.electronAPI.app.getClinicName() });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });

  const currentMode = (settings?.app_mode || 'reception_pharmacy_doctor') as AppMode;
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
  const visibleNav = NAV.filter((n) => {
    if (!n.modes.has(currentMode)) return false;
    if (n.to === '/billing' && billingHidden) return false;
    if (n.to === '/origin' && originHidden) return false;
    return canAnyRole(user, n.roles, adminUnlocked);
  });

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
          {onCollapse && (
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
        {visibleNav.map(({ to, label, icon: Icon, color, adminOnly }) => {
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
        })}
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

        <button
          onClick={openSupport}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition text-white shadow-sm"
          style={{ background: 'linear-gradient(135deg, #ec4899, #db2777)' }}
          title="Open the developer support page in your browser"
        >
          <span className="flex items-center gap-2">
            <Heart className="w-3.5 h-3.5 fill-white" />
            <span className="font-semibold">Support the developer</span>
          </span>
        </button>

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
        <div className="sidebar-meta text-[10px] px-3">v0.3.0 · {currentMode.replace(/_/g, ' + ')}</div>
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
