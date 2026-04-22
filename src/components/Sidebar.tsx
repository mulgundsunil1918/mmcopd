import { NavLink } from 'react-router-dom';
import { Users, Calendar, Stethoscope, Receipt, Wallet, Bell, Settings as SettingsIcon, HeartPulse, Sun, Moon, History, MapPin, FlaskConical, BedDouble, Pill, LogOut, ShieldCheck, UserCircle2, BarChart3, Lock, Unlock } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '../lib/utils';
import { useTheme } from '../hooks/useTheme';
import { useAuth, canAnyRole, type Role } from '../hooks/useAuth';
import type { AppMode } from '../types';

type NavItem = { to: string; label: string; icon: any; color: string; minMode: AppMode; roles: Role[]; adminOnly?: boolean };

const MODE_RANK: Record<AppMode, number> = {
  reception: 0,
  reception_doctor: 1,
  reception_doctor_lab: 2,
  reception_doctor_lab_ip: 3,
};

const NAV: NavItem[] = [
  { to: '/reception', label: 'Reception', icon: Users, color: 'text-emerald-500', minMode: 'reception', roles: ['receptionist'] },
  { to: '/appointments', label: 'Appointments', icon: Calendar, color: 'text-blue-500', minMode: 'reception', roles: ['receptionist', 'doctor'] },
  { to: '/doctor-select', label: 'Doctors', icon: Stethoscope, color: 'text-purple-500', minMode: 'reception_doctor', roles: ['doctor', 'receptionist'] },
  { to: '/lab', label: 'Laboratory', icon: FlaskConical, color: 'text-fuchsia-500', minMode: 'reception_doctor_lab', roles: ['lab_tech', 'doctor', 'receptionist'] },
  { to: '/pharmacy', label: 'Pharmacy', icon: Pill, color: 'text-lime-500', minMode: 'reception_doctor_lab', roles: ['pharmacist', 'doctor', 'receptionist'] },
  { to: '/ipd', label: 'IPD', icon: BedDouble, color: 'text-red-500', minMode: 'reception_doctor_lab_ip', roles: ['doctor', 'receptionist'] },
  { to: '/patient-log', label: 'Patient Log', icon: History, color: 'text-cyan-500', minMode: 'reception', roles: ['receptionist', 'doctor'] },
  { to: '/origin', label: 'Patient Origin', icon: MapPin, color: 'text-rose-500', minMode: 'reception', roles: ['receptionist', 'doctor'] },
  { to: '/billing', label: 'Billing', icon: Receipt, color: 'text-amber-500', minMode: 'reception', roles: ['receptionist'] },
  { to: '/accounts', label: 'Accounts', icon: Wallet, color: 'text-teal-500', minMode: 'reception', roles: ['receptionist'] },
  { to: '/reports', label: 'Reports', icon: BarChart3, color: 'text-orange-500', minMode: 'reception', roles: ['receptionist', 'doctor'] },
  { to: '/notifications', label: 'Notifications', icon: Bell, color: 'text-pink-500', minMode: 'reception', roles: ['receptionist'] },
  { to: '/users', label: 'Users & Access', icon: ShieldCheck, color: 'text-indigo-500', minMode: 'reception', roles: ['receptionist', 'doctor'], adminOnly: true },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, color: 'text-slate-500', minMode: 'reception', roles: ['receptionist', 'doctor'], adminOnly: true },
];

export function Sidebar() {
  const { theme, toggle } = useTheme();
  const { user, logout, adminUnlocked, lockAdmin } = useAuth();
  const { data: clinicName } = useQuery({ queryKey: ['clinic-name'], queryFn: () => window.electronAPI.app.getClinicName() });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });

  const currentMode = settings?.app_mode || 'reception_doctor';
  const visibleNav = NAV.filter((n) => {
    if (MODE_RANK[n.minMode] > MODE_RANK[currentMode]) return false;
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
              <HeartPulse className="w-5 h-5 text-white" />
            </div>
          )}
          <div className="min-w-0">
            <div className="sidebar-title text-sm leading-tight truncate">{settings?.clinic_name || 'CareDesk HMS'}</div>
            <div className="sidebar-subtitle text-[10px] leading-tight truncate">{settings?.clinic_tagline || clinicName || 'Mulgund Multispeciality'}</div>
          </div>
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
        {user && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg sidebar-link">
            <UserCircle2 className="w-4 h-4 text-blue-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold truncate">{user.display_name || user.username}</div>
              <div className="text-[10px] opacity-80 uppercase tracking-wider">
                {user.role === 'staff' ? 'Reception + Doctor' : user.role.replace('_', ' ')}
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
        <div className="sidebar-meta text-[10px] px-3">v0.1.0 · {currentMode.replace(/_/g, ' + ')}</div>
      </div>
    </aside>
  );
}
