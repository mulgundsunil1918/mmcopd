import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Reception } from './pages/Reception';
import { Appointments } from './pages/Appointments';
import { DoctorSelect } from './pages/DoctorSelect';
import { DoctorDashboard } from './pages/DoctorDashboard';
import { Billing } from './pages/Billing';
import { Accounts } from './pages/Accounts';
import { Notifications } from './pages/Notifications';
import { SettingsPage } from './pages/Settings';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

export default function App() {
  const { data: clinicName } = useQuery({
    queryKey: ['clinic-name-title'],
    queryFn: () => window.electronAPI.app.getClinicName(),
  });

  useEffect(() => {
    if (clinicName) document.title = `${clinicName} · CareDesk HMS`;
  }, [clinicName]);

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
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/reception" replace />} />
    </Routes>
  );
}
