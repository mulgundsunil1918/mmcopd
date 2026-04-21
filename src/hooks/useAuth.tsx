import { createContext, useContext, useEffect, useState } from 'react';

export type Role = 'admin' | 'receptionist' | 'doctor' | 'lab_tech' | 'pharmacist';
export interface SessionUser {
  id: number;
  username: string;
  role: Role;
  display_name: string | null;
  doctor_id: number | null;
}

const KEY = 'caredesk-session';

interface AuthCtx {
  user: SessionUser | null;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthCtx>({ user: null, login: async () => false, logout: () => {} });

export const useAuth = () => useContext(AuthContext);

/** Check if the current user has any of the given roles. Admin passes everything. */
export function canAnyRole(user: SessionUser | null, roles: Role[]): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return roles.includes(user.role);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(() => {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });

  useEffect(() => {
    try {
      if (user) localStorage.setItem(KEY, JSON.stringify(user));
      else localStorage.removeItem(KEY);
    } catch { /* ignore */ }
  }, [user]);

  const login = async (username: string, password: string) => {
    const u = await window.electronAPI.auth.login(username, password);
    if (u) { setUser(u); return true; }
    return false;
  };

  const logout = () => {
    if (user) window.electronAPI.audit.log(user, 'logout');
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
}
