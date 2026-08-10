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
import { Guard } from './components/RouteGuard';
import { DischargeSummary } from './pages/DischargeSummary';
import { PrintJobs } from './pages/PrintJobs';
import { Notifications } from './pages/Notifications';
import { SettingsPage } from './pages/Settings';
import { UsersPage } from './pages/Users';
import { Reports } from './pages/Reports';
import { Analytics } from './pages/Analytics';
import { Miscellaneous } from './pages/Miscellaneous';
import { WhatsApp } from './pages/WhatsApp';
import { Pediatrics } from './pages/Pediatrics';
import { TPA } from './pages/TPA';
import { WelcomeWizard } from './components/WelcomeWizard';
import { ForceAdminPasswordGate } from './components/ForceAdminPasswordGate';
import { ForcePasswordChange } from './components/ForcePasswordChange';
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
  // Auto-open the wizard on FRESH installs as soon as settings load — does NOT
  // wait for login. The wizard renders OVER the Login screen so the user can't
  // miss it. Suppression uses sessionStorage so "Skip" only hides for this
  // session; next launch reshows until clinic_name is set.
  useEffect(() => {
    if (!settings) return;
    let dismissed = false;
    try { dismissed = sessionStorage.getItem('caredesk:welcome-dismissed') === '1'; } catch { /* ignore */ }
    const isFreshInstall = !settings.clinic_name && settings.network_mode === 'local';
    if (isFreshInstall && !dismissed) setWizardOpen(true);
  }, [settings?.clinic_name, settings?.network_mode]);

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

  // Wizard renders ABOVE the login gate so a fresh install shows the host /
  // client picker immediately — user doesn't have to log in first. The setup
  // banner reminds them on every page after login if clinic isn't configured.
  const wizardOverlay = wizardOpen ? <WelcomeWizard onClose={() => setWizardOpen(false)} /> : null;
  const needsSetupBanner = !!settings && !settings.clinic_name && settings.network_mode === 'local';

  if (!user) return <><ForceAdminPasswordGate />{wizardOverlay}<Login /></>;
  if (user.must_change_password) return <ForcePasswordChange />;

  return (
    <>
      <ForceAdminPasswordGate />
      {wizardOverlay}
      {needsSetupBanner && !wizardOpen && (
        <div className="no-print fixed top-0 left-0 right-0 z-[140] bg-blue-600 text-white px-4 py-2 text-xs text-center font-semibold shadow flex items-center justify-center gap-3">
          <span>🪄 Clinic not set up yet — pick how this PC fits into your clinic</span>
          <button
            onClick={() => setWizardOpen(true)}
            className="bg-white text-blue-700 px-3 py-0.5 rounded font-bold hover:bg-blue-50"
          >
            Open Setup Wizard
          </button>
        </div>
      )}
      {(live.status === 'disconnected' || live.status === 'error') && (
        <div className="no-print fixed top-0 left-0 right-0 z-[150] bg-red-600 text-white px-4 py-1.5 text-xs text-center font-semibold shadow">
          ⚠ Disconnected from clinic server — trying to reconnect every 5 seconds. Recent changes may not have synced.
        </div>
      )}
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/reception" replace />} />
        <Route path="/reception" element={<Guard path="/reception"><Reception /></Guard>} />
        <Route path="/appointments" element={<Guard path="/appointments"><Appointments /></Guard>} />
        <Route path="/doctor-select" element={<Guard path="/doctor-select"><DoctorSelect /></Guard>} />
        <Route path="/doctor/:id" element={<Guard path="/doctor-select"><DoctorDashboard /></Guard>} />
        <Route path="/billing" element={<Guard path="/billing"><Billing /></Guard>} />
        <Route path="/miscellaneous" element={<Guard path="/miscellaneous"><Miscellaneous /></Guard>} />
        <Route path="/accounts" element={<Guard path="/accounts"><Accounts /></Guard>} />
        <Route path="/patient-log" element={<Guard path="/patient-log"><PatientLog /></Guard>} />
        <Route path="/origin" element={<Guard path="/origin"><PatientOrigin /></Guard>} />
        <Route path="/lab" element={<Guard path="/lab"><Lab /></Guard>} />
        <Route path="/pharmacy" element={<Guard path="/pharmacy"><Pharmacy /></Guard>} />
        <Route path="/ipd" element={<Guard path="/ipd"><IPD /></Guard>} />
        <Route path="/discharge-summary" element={<Guard path="/discharge-summary"><DischargeSummary /></Guard>} />
        <Route path="/print-jobs" element={<Guard path="/print-jobs"><PrintJobs /></Guard>} />
        <Route path="/pediatrics" element={<Guard path="/pediatrics"><Pediatrics /></Guard>} />
        <Route path="/tpa" element={<Guard path="/tpa"><TPA /></Guard>} />
        <Route path="/notifications" element={<Guard path="/notifications"><Notifications /></Guard>} />
        <Route path="/whatsapp" element={<Guard path="/whatsapp"><WhatsApp /></Guard>} />
        {/* Settings & Users self-gate with an admin-password unlock screen, so they
            are intentionally NOT route-guarded (a redirect would hide that gate). */}
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/reports" element={<Guard path="/analytics"><Reports /></Guard>} />
        <Route path="/analytics" element={<Guard path="/analytics"><Analytics /></Guard>} />
      </Route>
      <Route path="*" element={<Navigate to="/reception" replace />} />
    </Routes>
    </>
  );
}
