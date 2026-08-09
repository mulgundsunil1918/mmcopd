import { createContext, useContext, useEffect, useRef, useState } from 'react';

/** Mirrors the backend Role in main/auth.ts, plus the renderer-only 'staff'
 *  pseudo-role used for the default unauthenticated session. */
export type Role =
  | 'admin'
  | 'staff'
  | 'receptionist'
  | 'doctor'
  | 'nurse'
  | 'ward_incharge'
  | 'lab_tech'
  | 'pharmacist';
export interface SessionUser {
  id: number;
  username: string;
  role: Role;
  display_name: string | null;
  doctor_id: number | null;
  must_change_password?: boolean;
}

const SESSION_KEY = 'caredesk-session';
const ADMIN_UNLOCK_KEY = 'caredesk-admin-unlocked';
// Mirror of settings.require_login so the very first render can decide whether
// to show Login without waiting for the async settings fetch (avoids a flash of
// the app before redirecting to sign-in).
const REQUIRE_LOGIN_MIRROR = 'caredesk-require-login';

interface AuthCtx {
  user: SessionUser | null;
  /** True when admin mode has been unlocked this session (or user.role === 'admin') */
  adminUnlocked: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  unlockAdmin: (password: string) => Promise<boolean>;
  lockAdmin: () => void;
  clearMustChangePassword: () => void;
}

const AuthContext = createContext<AuthCtx>({
  user: null,
  adminUnlocked: false,
  login: async () => false,
  logout: () => {},
  unlockAdmin: async () => false,
  lockAdmin: () => {},
  clearMustChangePassword: () => {},
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

/** A stored session counts as a real sign-in only if it's a genuine account. */
function isRealLogin(u: any): u is SessionUser {
  return !!u && typeof u.id === 'number' && u.id > 0 && u.role !== 'staff';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Read the mirror synchronously so the first render is already correct.
  const requireLoginInitial = (() => {
    try { return localStorage.getItem(REQUIRE_LOGIN_MIRROR) === '1'; } catch { return false; }
  })();
  const [requireLogin, setRequireLogin] = useState(requireLoginInitial);
  const [sessionTimeout, setSessionTimeout] = useState(0);

  const [user, setUser] = useState<SessionUser | null>(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // If an older admin-auto-session was stored, drop it.
        if (parsed?.role === 'admin' && parsed?.id === 1) {
          return requireLoginInitial ? null : DEFAULT_SESSION;
        }
        // A genuine sign-in is always honoured. A stale default/staff session is
        // not a login — under require_login it must not grant access.
        if (isRealLogin(parsed)) return parsed;
        return requireLoginInitial ? null : parsed;
      }
    } catch { /* ignore */ }
    return requireLoginInitial ? null : DEFAULT_SESSION;
  });

  // Load the real setting; sync the mirror and, if login just became required
  // while only a default/staff session was active, drop to the sign-in screen.
  useEffect(() => {
    let cancelled = false;
    window.electronAPI.settings.get().then((s: any) => {
      if (cancelled || !s) return;
      const req = !!s.require_login;
      setRequireLogin(req);
      setSessionTimeout(Number(s.session_timeout_minutes) || 0);
      try { localStorage.setItem(REQUIRE_LOGIN_MIRROR, req ? '1' : '0'); } catch { /* ignore */ }
      if (req) setUser((cur) => (isRealLogin(cur) ? cur : null));
      else setUser((cur) => cur ?? DEFAULT_SESSION);
    }).catch(() => { /* settings unreachable — leave initial state */ });
    return () => { cancelled = true; };
  }, []);

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
    // With mandatory login, logging out returns to the sign-in screen rather
    // than a shared session.
    setUser(requireLogin ? null : DEFAULT_SESSION);
    setAdminUnlocked(false);
  };

  // Inactivity auto sign-out (only when login is required and a timeout is set).
  const lastActivity = useRef(Date.now());
  useEffect(() => {
    if (!requireLogin || sessionTimeout <= 0 || !isRealLogin(user)) return;
    const bump = () => { lastActivity.current = Date.now(); };
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivity.current >= sessionTimeout * 60_000) {
        setUser(null);
        setAdminUnlocked(false);
      }
    }, 15_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      window.clearInterval(timer);
    };
  }, [requireLogin, sessionTimeout, user]);

  const unlockAdmin = async (password: string) => {
    const ok = await window.electronAPI.admin.verifyPassword(password);
    if (ok) setAdminUnlocked(true);
    return ok;
  };

  const lockAdmin = () => setAdminUnlocked(false);

  const clearMustChangePassword = () => {
    setUser((u) => u ? { ...u, must_change_password: false } : u);
  };

  return (
    <AuthContext.Provider value={{ user, adminUnlocked, login, logout, unlockAdmin, lockAdmin, clearMustChangePassword }}>
      {children}
    </AuthContext.Provider>
  );
}
