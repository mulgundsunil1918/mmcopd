import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, ChevronDown, MessageSquare } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { cn, fmtDateTime } from '../lib/utils';
import { useToast } from '../hooks/useToast';
import type { NotificationStatus, Settings } from '../types';

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
          <h1 className="text-lg font-bold text-gray-900">Notifications</h1>
          <p className="text-xs text-gray-500">All SMS/WhatsApp messages logged from the app. Providers can be wired from settings below.</p>
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
          <div className="text-xs text-gray-500 py-4">Loading…</div>
        ) : logs.length === 0 ? (
          <EmptyState icon={Bell} title="No notifications yet" description="Notifications appear here when appointments are booked." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-gray-200 text-xs uppercase text-gray-500">
                <th className="py-2">Patient</th>
                <th className="py-2">Type</th>
                <th className="py-2">Message</th>
                <th className="py-2">Status</th>
                <th className="py-2">Time</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((n) => (
                <tr key={n.id} className="border-b border-gray-100">
                  <td className="py-2">{n.patient_name || '—'}</td>
                  <td className="py-2"><span className="badge bg-gray-100 text-gray-700">{n.type}</span></td>
                  <td className="py-2 text-gray-600 max-w-md truncate" title={n.message}>{n.message}</td>
                  <td className="py-2">
                    <span className={cn(
                      'badge',
                      n.status === 'pending' && 'bg-amber-100 text-amber-800',
                      n.status === 'sent' && 'bg-green-100 text-green-700',
                      n.status === 'failed' && 'bg-red-100 text-red-700'
                    )}>{n.status}</span>
                  </td>
                  <td className="py-2 text-xs text-gray-500">{fmtDateTime(n.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ProviderSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => window.electronAPI.settings.save(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast('Settings saved');
    },
  });

  if (!settings) return null;

  return (
    <div className="card">
      <button
        className="w-full flex items-center justify-between p-4 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-blue-600" />
          <span className="font-semibold text-sm text-gray-900">Provider Settings</span>
          <span className="text-[11px] text-gray-500">
            SMS: {settings.sms_enabled ? 'On' : 'Off'} · WhatsApp: {settings.whatsapp_enabled ? 'On' : 'Off'}
          </span>
        </div>
        <ChevronDown className={cn('w-4 h-4 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t border-gray-200 p-4 space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.sms_enabled}
              onChange={(e) => save.mutate({ sms_enabled: e.target.checked })}
            />
            <span>Enable SMS (Twilio)</span>
          </label>
          {settings.sms_enabled && (
            <div className="grid grid-cols-2 gap-3 pl-6">
              <Input label="Account SID" value={settings.sms_account_sid || ''} onSave={(v) => save.mutate({ sms_account_sid: v })} />
              <Input label="Auth Token" value={settings.sms_auth_token || ''} onSave={(v) => save.mutate({ sms_auth_token: v })} type="password" />
              <Input label="From Number" value={settings.sms_from_number || ''} onSave={(v) => save.mutate({ sms_from_number: v })} />
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.whatsapp_enabled}
              onChange={(e) => save.mutate({ whatsapp_enabled: e.target.checked })}
            />
            <span>Enable WhatsApp</span>
          </label>
          {settings.whatsapp_enabled && (
            <div className="grid grid-cols-2 gap-3 pl-6">
              <Input label="API URL" value={settings.whatsapp_api_url || ''} onSave={(v) => save.mutate({ whatsapp_api_url: v })} />
              <Input label="API Key" value={settings.whatsapp_api_key || ''} onSave={(v) => save.mutate({ whatsapp_api_key: v })} type="password" />
            </div>
          )}

          <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
            Providers are not wired yet. When enabled, notifications are queued with status "pending" — actual sending will be wired in Stage 3.
          </div>
        </div>
      )}
    </div>
  );
}

function Input({ label, value, onSave, type = 'text' }: { label: string; value: string; onSave: (v: string) => void; type?: string }) {
  const [v, setV] = useState(value);
  return (
    <div>
      <label className="label">{label}</label>
      <input
        type={type}
        className="input"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== value && onSave(v)}
      />
    </div>
  );
}
