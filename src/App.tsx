import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Reception } from './pages/Reception';
import { Appointments } from './pages/Appointments';
import { DoctorSelect } from './pages/DoctorSelect';
import { DoctorDashboard } from './pages/DoctorDashboard';
import { Billing } from './pages/Billing';
import { Accounts } from './pages/Accounts';
import { PatientLog } from './pages/PatientLog';
import { PatientOrigin } from './pages/PatientOrigin';
import { Lab } from './pages/Lab';
import { Pharmacy } from './pages/Pharmacy';
import { IPD } from './pages/IPD';
import { Notifications } from './pages/Notifications';
import { SettingsPage } from './pages/Settings';
import { UsersPage } from './pages/Users';
import { Reports } from './pages/Reports';
import { Analytics } from './pages/Analytics';
import { Miscellaneous } from './pages/Miscellaneous';
import { WelcomeWizard } from './components/WelcomeWizard';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from './hooks/useAuth';
import { useKeyboardShortcut } from './hooks/useKeyboardShortcut';
import { useNetworkLive } from './hooks/useNetworkLive';

export default function App() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: clinicName } = useQuery({
    queryKey: ['clinic-name-title'],
    queryFn: () => window.electronAPI.app.getClinicName(),
  });
  // First-launch welcome wizard — only shows if the user hasn't dismissed it
  // AND the clinic isn't yet set up (clinic_name empty + network_mode is the
  // default 'local'). One toggle per PC.
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.electronAPI.settings.get(),
  });
  const [wizardOpen, setWizardOpen] = useState(false);
  useEffect(() => {
    if (!user || !settings) return;
    // Fresh install detection — clinic isn't configured yet AND user hasn't
    // dismissed the wizard in THIS session. We use sessionStorage (not local)
    // so a Skip only suppresses for the current launch — next launch shows it
    // again until the user actually fills in clinic name (or picks Server / Client).
    let dismissed = false;
    try { dismissed = sessionStorage.getItem('caredesk:welcome-dismissed') === '1'; } catch { /* ignore */ }
    const isFreshInstall = !settings.clinic_name && settings.network_mode === 'local';
    if (isFreshInstall && !dismissed) setWizardOpen(true);
  }, [user, settings?.clinic_name, settings?.network_mode]);

  // Settings → "Run Setup Wizard" button dispatches this event so the
  // Settings page can re-open the App-level wizard without prop-drilling.
  useEffect(() => {
    const open = () => setWizardOpen(true);
    window.addEventListener('caredesk:openWelcomeWizard', open);
    return () => window.removeEventListener('caredesk:openWelcomeWizard', open);
  }, []);

  useEffect(() => {
    if (clinicName) document.title = `${clinicName} · CureDesk HMS`;
  }, [clinicName]);

  // Global shortcuts that work from ANY page. They navigate first, then fire a
  // window event the destination page listens for. The setTimeout(0) gap lets
  // React mount the new page (and its listener) before we dispatch.
  useKeyboardShortcut({ ctrl: true, key: 'n' }, () => {
    if (!user) return;
    navigate('/reception');
    setTimeout(() => window.dispatchEvent(new Event('caredesk:newPatient')), 60);
  }, [user]);
  useKeyboardShortcut({ ctrl: true, key: 'b' }, () => {
    if (!user) return;
    navigate('/appointments');
    setTimeout(() => window.dispatchEvent(new Event('caredesk:bookAppointment')), 60);
  }, [user]);

  // Subscribe to live WebSocket events when in Client mode (auto-no-op in Local
  // / Server). Status drives the offline banner below.
  const live = useNetworkLive();

  if (!user) return <Login />;

  return (
    <>
      {wizardOpen && <WelcomeWizard onClose={() => setWizardOpen(false)} />}
      {(live.status === 'disconnected' || live.status === 'error') && (
        <div className="no-print fixed top-0 left-0 right-0 z-[150] bg-red-600 text-white px-4 py-1.5 text-xs text-center font-semibold shadow">
          ⚠ Disconnected from clinic server — trying to reconnect every 5 seconds. Recent changes may not have synced.
        </div>
      )}
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/reception" replace />} />
        <Route path="/reception" element={<Reception />} />
        <Route path="/appointments" element={<Appointments />} />
        <Route path="/doctor-select" element={<DoctorSelect />} />
        <Route path="/doctor/:id" element={<DoctorDashboard />} />
        <Route path="/billing" element={<Billing />} />
        <Route path="/miscellaneous" element={<Miscellaneous />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/patient-log" element={<PatientLog />} />
        <Route path="/origin" element={<PatientOrigin />} />
        <Route path="/lab" element={<Lab />} />
        <Route path="/pharmacy" element={<Pharmacy />} />
        <Route path="/ipd" element={<IPD />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/analytics" element={<Analytics />} />
      </Route>
      <Route path="*" element={<Navigate to="/reception" replace />} />
    </Routes>
    </>
  );
}
