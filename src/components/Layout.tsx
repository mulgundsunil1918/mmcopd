import { Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { TopBar } from './TopBar';
import { UpdateBanner } from './UpdateBanner';

const COLLAPSED_KEY = 'caredesk:sidebar-collapsed';

export function Layout() {
  // Persist sidebar collapsed-state in localStorage so it survives reloads
  // without making a round-trip through settings/IPC.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [collapsed]);

  // Global keyboard shortcut: Ctrl+\ toggles the sidebar (familiar from VS Code).
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="flex flex-1 min-h-0 relative">
        {!collapsed && <Sidebar onCollapse={() => setCollapsed(true)} />}
        {collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="no-print absolute top-3 left-2 z-30 w-7 h-7 rounded-md bg-gray-100 dark:bg-slate-800 border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200 hover:bg-blue-100 dark:hover:bg-blue-900/30 hover:border-blue-400 inline-flex items-center justify-center shadow-sm"
            title="Expand sidebar (Ctrl+\\)"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
        <main className="flex-1 flex flex-col overflow-hidden">
          <TopBar />
          <div className="flex-1 overflow-auto">
            <Outlet />
          </div>
        </main>
      </div>
      <StatusBar />
      <UpdateBanner />
    </div>
  );
}

// Re-export for the Sidebar to consume.
export { ChevronLeft };
