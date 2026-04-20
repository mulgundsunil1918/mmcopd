import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';

export function Layout() {
  return (
    <div className="h-full flex flex-col bg-white">
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
      <StatusBar />
    </div>
  );
}
