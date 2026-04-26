import { createContext, useContext, useEffect, useState } from 'react';

export type Role = 'admin' | 'staff' | 'receptionist' | 'doctor' | 'lab_tech' | 'pharmacist';
export interface SessionUser {
  id: number;
  username: string;
  role: Role;
  display_name: string | null;
  doctor_id: number | null;
}

const SESSION_KEY = 'caredesk-session';
const ADMIN_UNLOCK_KEY = 'caredesk-admin-unlocked';

interface AuthCtx {
  user: SessionUser | null;
  /** True when admin mode has been unlocked this session (or user.role === 'admin') */
  adminUnlocked: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  unlockAdmin: (password: string) => Promise<boolean>;
  lockAdmin: () => void;
}

const AuthContext = createContext<AuthCtx>({
  user: null,
  adminUnlocked: false,
  login: async () => false,
  logout: () => {},
  unlockAdmin: async () => false,
  lockAdmin: () => {},
});

export const useAuth = () => useContext(AuthContext);

/** Check if the current user has any of the given roles. Admin (or unlocked admin) passes everything.
 *  'staff' is shorthand for receptionist + doctor combined. */
export function canAnyRole(user: SessionUser | null, roles: Role[], adminUnlocked = false): boolean {
  if (!user) return false;
  if (user.role === 'admin' || adminUnlocked) return true;
  if (user.role === 'staff' && (roles.includes('receptionist') || roles.includes('doctor'))) return true;
  return roles.includes(user.role);
}

// Default: logged in as staff (receptionist + doctor combined). Admin actions require password unlock.
// display_name is generic so the sidebar tile can derive the actual mode label from settings.app_mode.
const DEFAULT_SESSION: SessionUser = {
  id: 0,
  username: 'staff',
  role: 'staff',
  display_name: 'Clinic Staff',
  doctor_id: null,
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // If an older admin-auto-session was stored, replace with default staff session
        if (parsed?.role === 'admin' && parsed?.id === 1) return DEFAULT_SESSION;
        return parsed;
      }
    } catch { /* ignore */ }
    return DEFAULT_SESSION;
  });

  const [adminUnlocked, setAdminUnlocked] = useState<boolean>(() => {
    try { return sessionStorage.getItem(ADMIN_UNLOCK_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    try {
      if (user) localStorage.setItem(SESSION_KEY, JSON.stringify(user));
      else localStorage.removeItem(SESSION_KEY);
    } catch { /* ignore */ }
  }, [user]);

  useEffect(() => {
    try {
      if (adminUnlocked) sessionStorage.setItem(ADMIN_UNLOCK_KEY, '1');
      else sessionStorage.removeItem(ADMIN_UNLOCK_KEY);
    } catch { /* ignore */ }
  }, [adminUnlocked]);

  const login = async (username: string, password: string) => {
    const u = await window.electronAPI.auth.login(username, password);
    if (u) { setUser(u); return true; }
    return false;
  };

  const logout = () => {
    setUser(DEFAULT_SESSION);
    setAdminUnlocked(false);
  };

  const unlockAdmin = async (password: string) => {
    const ok = await window.electronAPI.admin.verifyPassword(password);
    if (ok) setAdminUnlocked(true);
    return ok;
  };

  const lockAdmin = () => setAdminUnlocked(false);

  return (
    <AuthContext.Provider value={{ user, adminUnlocked, login, logout, unlockAdmin, lockAdmin }}>
      {children}
    </AuthContext.Provider>
  );
}
