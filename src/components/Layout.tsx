import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { TopBar } from './TopBar';
import { UpdateBanner } from './UpdateBanner';

export function Layout() {
  return (
    <div className="h-full flex flex-col bg-white">
      <div className="flex flex-1 min-h-0">
        <Sidebar />
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
