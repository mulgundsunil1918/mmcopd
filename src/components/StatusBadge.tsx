import type { AppointmentStatus } from '../types';
import { cn } from '../lib/utils';

const STYLES: Record<AppointmentStatus, string> = {
  'Waiting': 'bg-blue-100 text-blue-700',
  'In Progress': 'bg-green-100 text-green-700',
  'Done': 'bg-gray-200 text-gray-700',
  'Cancelled': 'bg-red-100 text-red-700',
  'Send to Billing': 'bg-amber-100 text-amber-800',
  'Ready for Print': 'bg-cyan-500 text-white',
};

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  return <span className={cn('badge', STYLES[status])}>{status}</span>;
}
