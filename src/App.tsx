import { Routes, Route, Navigate } from 'react-router-dom';
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
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from './hooks/useAuth';

export default function App() {
  const { user } = useAuth();
  const { data: clinicName } = useQuery({
    queryKey: ['clinic-name-title'],
    queryFn: () => window.electronAPI.app.getClinicName(),
  });

  useEffect(() => {
    if (clinicName) document.title = `${clinicName} · CareDesk HMS`;
  }, [clinicName]);

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
      </Route>
      <Route path="*" element={<Navigate to="/reception" replace />} />
    </Routes>
  );
}
