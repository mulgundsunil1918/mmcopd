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
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from './hooks/useAuth';
import { useKeyboardShortcut } from './hooks/useKeyboardShortcut';

export default function App() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: clinicName } = useQuery({
    queryKey: ['clinic-name-title'],
    queryFn: () => window.electronAPI.app.getClinicName(),
  });

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

  if (!user) return <Login />;

  return (
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
  );
}
