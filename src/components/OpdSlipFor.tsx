import { useQuery } from '@tanstack/react-query';
import { OpdSlip } from './OpdSlip';
import type { AppointmentWithJoins } from '../types';

export function OpdSlipFor({
  appointment,
  onClose,
}: {
  appointment: AppointmentWithJoins;
  onClose: () => void;
}) {
  const { data: doctor } = useQuery({
    queryKey: ['doctors', appointment.doctor_id],
    queryFn: () => window.electronAPI.doctors.get(appointment.doctor_id),
  });
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.electronAPI.settings.get(),
  });
  const { data: consultation } = useQuery({
    queryKey: ['consultation', appointment.id],
    queryFn: () => window.electronAPI.consultations.getByAppointment(appointment.id),
  });

  if (!doctor || !settings) return null;

  return (
    <OpdSlip
      appointment={appointment}
      consultation={consultation ?? null}
      doctor={doctor}
      settings={settings}
      onClose={onClose}
    />
  );
}
