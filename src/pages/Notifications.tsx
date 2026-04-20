import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { ProviderSettings } from '../components/ProviderSettings';
import { cn, fmtDateTime } from '../lib/utils';
import type { NotificationStatus } from '../types';

export function Notifications() {
  const [filter, setFilter] = useState<'all' | NotificationStatus>('all');

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['notifications', filter],
    queryFn: () => window.electronAPI.notifications.list(filter === 'all' ? undefined : filter),
  });

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100">Notifications</h1>
          <p className="text-xs text-gray-500 dark:text-slate-400">All SMS/WhatsApp messages logged from the app.</p>
        </div>
        <select
          className="input w-auto"
          value={filter}
          onChange={(e) => setFilter(e.target.value as any)}
        >
          <option value="all">All</option>
          <option value="pending">Pending</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      <ProviderSettings />

      <div className="card p-4">
        {isLoading ? (
          <div className="text-xs text-gray-500 dark:text-slate-400 py-4">Loading…</div>
        ) : logs.length === 0 ? (
          <EmptyState icon={Bell} title="No notifications yet" description="Notifications appear here when appointments are booked." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-gray-200 dark:border-slate-700 text-xs uppercase text-gray-500 dark:text-slate-400">
                <th className="py-2">Patient</th>
                <th className="py-2">Type</th>
                <th className="py-2">Message</th>
                <th className="py-2">Status</th>
                <th className="py-2">Time</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((n) => (
                <tr key={n.id} className="border-b border-gray-100 dark:border-slate-800">
                  <td className="py-2 text-gray-900 dark:text-slate-100">{n.patient_name || '—'}</td>
                  <td className="py-2"><span className="badge bg-gray-100 text-gray-700">{n.type}</span></td>
                  <td className="py-2 text-gray-700 dark:text-slate-200 max-w-md truncate" title={n.message}>{n.message}</td>
                  <td className="py-2">
                    <span className={cn(
                      'badge',
                      n.status === 'pending' && 'bg-amber-100 text-amber-800',
                      n.status === 'sent' && 'bg-green-100 text-green-700',
                      n.status === 'failed' && 'bg-red-100 text-red-700'
                    )}>{n.status}</span>
                  </td>
                  <td className="py-2 text-xs text-gray-500 dark:text-slate-400">{fmtDateTime(n.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
