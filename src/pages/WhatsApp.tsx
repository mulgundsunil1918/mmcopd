import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare, Plug, PlugZap, RefreshCw, Zap, ListChecks,
  CheckCircle2, XCircle, AlertCircle, Clock, Send, ChevronDown, ChevronUp,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useToast } from '../hooks/useToast';
import type { WaAutomationTrigger } from '../types/whatsapp';

type Tab = 'connect' | 'templates' | 'automation' | 'queue';

// ── Trigger metadata ──────────────────────────────────────────────────────────
const TRIGGERS: { key: WaAutomationTrigger; label: string; desc: string }[] = [
  { key: 'appointment_created',      label: 'Appointment Confirmed',  desc: 'Sent immediately when a new appointment is booked' },
  { key: 'appointment_reminder_24h', label: 'Reminder — 24 hours',   desc: 'Sent ~24 hours before the appointment time' },
  { key: 'appointment_reminder_1h',  label: 'Reminder — 1 hour',     desc: 'Sent ~1 hour before the appointment time' },
  { key: 'appointment_completed',    label: 'Visit Complete',         desc: 'Sent when the doctor marks the visit done' },
  { key: 'prescription_generated',   label: 'Prescription Ready',    desc: 'Sent when a prescription is saved' },
  { key: 'lab_report_ready',         label: 'Lab Report Ready',      desc: 'Sent when a lab report is marked complete' },
  { key: 'bill_generated',           label: 'Bill Generated',        desc: 'Sent when a bill is created at reception' },
  { key: 'followup_reminder_3d',     label: 'Follow-up Reminder',    desc: 'Sent 3 days before a scheduled follow-up date' },
  { key: 'birthday_wish',            label: 'Birthday Wish',         desc: 'Sent on the patient\'s birthday' },
];

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    connected:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    disconnected: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400',
    error:        'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    pending:      'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  };
  const icon: Record<string, React.ReactNode> = {
    connected:    <CheckCircle2 className="w-3 h-3" />,
    disconnected: <XCircle className="w-3 h-3" />,
    error:        <AlertCircle className="w-3 h-3" />,
    pending:      <Clock className="w-3 h-3" />,
  };
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold', map[status] ?? map.disconnected)}>
      {icon[status] ?? null} {status}
    </span>
  );
}

// ── Connect tab ───────────────────────────────────────────────────────────────
function ConnectTab() {
  const toast = useToast();
  const qc = useQueryClient();

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['wa:accounts'],
    queryFn: () => window.electronAPI.wa.accounts(),
    refetchInterval: 30_000,
  });

  const [form, setForm] = useState({ phone_number_id: '', waba_id: '', access_token: '', display_name: '', phone_number: '' });
  const [showForm, setShowForm] = useState(false);

  const connect = useMutation({
    mutationFn: (input: typeof form) => window.electronAPI.wa.connect(input),
    onSuccess: (r) => {
      if (r.ok) { toast('Connected successfully!'); setShowForm(false); setForm({ phone_number_id: '', waba_id: '', access_token: '', display_name: '', phone_number: '' }); }
      else toast(r.error ?? 'Connection failed', 'error');
      qc.invalidateQueries({ queryKey: ['wa:accounts'] });
    },
    onError: (e: any) => toast(e.message || 'Connection failed', 'error'),
  });

  const health = useMutation({
    mutationFn: (id: number) => window.electronAPI.wa.health(id),
    onSuccess: (r) => {
      toast(r.ok ? `Health OK — ${r.display_name ?? ''}` : (r.error ?? 'Health check failed'), r.ok ? 'success' : 'error');
      qc.invalidateQueries({ queryKey: ['wa:accounts'] });
    },
  });

  const disconnect = useMutation({
    mutationFn: (id: number) => window.electronAPI.wa.disconnect(id),
    onSuccess: () => { toast('Disconnected'); qc.invalidateQueries({ queryKey: ['wa:accounts'] }); },
  });

  return (
    <div className="space-y-5">
      {/* Accounts list */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-sm text-gray-800 dark:text-slate-100">Connected Numbers</h2>
          <button className="btn-primary text-xs" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : '+ Add Number'}
          </button>
        </div>

        {showForm && (
          <div className="border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4 bg-blue-50/50 dark:bg-blue-900/10 space-y-3">
            <p className="text-xs text-blue-700 dark:text-blue-400 font-medium">Enter your Meta WhatsApp Cloud API credentials</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-slate-400 block mb-1">Phone Number ID</label>
                <input className="input w-full" placeholder="1234567890123456" value={form.phone_number_id} onChange={(e) => setForm({ ...form, phone_number_id: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-slate-400 block mb-1">WABA ID</label>
                <input className="input w-full" placeholder="1234567890123456" value={form.waba_id} onChange={(e) => setForm({ ...form, waba_id: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-600 dark:text-slate-400 block mb-1">Permanent Access Token</label>
                <input className="input w-full font-mono text-xs" type="password" placeholder="EAAxxxxx..." value={form.access_token} onChange={(e) => setForm({ ...form, access_token: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-slate-400 block mb-1">Display Name</label>
                <input className="input w-full" placeholder="Clinic Name" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-slate-400 block mb-1">Phone Number</label>
                <input className="input w-full" placeholder="+91 9876543210" value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                className="btn-primary text-xs"
                disabled={!form.phone_number_id || !form.waba_id || !form.access_token || connect.isPending}
                onClick={() => connect.mutate(form)}
              >
                {connect.isPending ? 'Connecting…' : 'Connect'}
              </button>
              <button className="btn-ghost text-xs" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </div>
        )}

        {isLoading ? (
          <p className="text-xs text-gray-400">Loading…</p>
        ) : accounts.length === 0 ? (
          <div className="text-center py-8">
            <PlugZap className="w-8 h-8 text-gray-300 dark:text-slate-600 mx-auto mb-2" />
            <p className="text-sm text-gray-500 dark:text-slate-400">No WhatsApp numbers connected yet</p>
            <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Click "Add Number" to connect your clinic's WhatsApp</p>
          </div>
        ) : (
          <div className="space-y-3">
            {accounts.map((acct: any) => (
              <div key={acct.id} className="flex items-center justify-between border border-gray-200 dark:border-slate-700 rounded-lg p-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-gray-900 dark:text-slate-100">{acct.display_name || acct.phone_number || acct.phone_number_id}</span>
                    <StatusBadge status={acct.status} />
                  </div>
                  <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                    {acct.phone_number && <span className="mr-3">{acct.phone_number}</span>}
                    ID: {acct.phone_number_id}
                    {acct.last_health_check && <span className="ml-3 text-gray-400">Last check: {new Date(acct.last_health_check).toLocaleString()}</span>}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5 font-mono">
                    Webhook verify token: <span className="select-all">{acct.webhook_verify_token}</span>
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    className="btn-ghost text-xs"
                    disabled={health.isPending}
                    onClick={() => health.mutate(acct.id)}
                    title="Check health with Meta API"
                  >
                    <RefreshCw className={cn('w-3.5 h-3.5', health.isPending && 'animate-spin')} />
                  </button>
                  <button
                    className="btn-ghost text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                    onClick={() => disconnect.mutate(acct.id)}
                    title="Disconnect"
                  >
                    <Plug className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Webhook relay setup guide */}
      {accounts.length > 0 && (
        <div className="card p-4 space-y-3">
          <h2 className="font-semibold text-sm text-gray-800 dark:text-slate-100">Webhook Relay Setup</h2>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            Meta sends webhook events to a public server. CureDesk polls that server every 60s to fetch delivery receipts and inbound messages.
            Deploy the relay server on Railway or Render (free tier), then paste your relay URL in Meta's Developer Console.
          </p>
          {accounts[0] && (
            <div className="bg-gray-50 dark:bg-slate-800 rounded p-3 text-xs font-mono space-y-1">
              <p className="text-gray-500 dark:text-slate-400"># Set these environment variables on your relay server:</p>
              <p className="text-gray-800 dark:text-slate-200">VERIFY_TOKEN=<span className="text-blue-600 dark:text-blue-400 select-all">{accounts[0].webhook_verify_token}</span></p>
              <p className="text-gray-800 dark:text-slate-200">PHONE_NUMBER_ID=<span className="text-blue-600 dark:text-blue-400 select-all">{accounts[0].phone_number_id}</span></p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Templates tab ─────────────────────────────────────────────────────────────
function TemplatesTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: accounts = [] } = useQuery({ queryKey: ['wa:accounts'], queryFn: () => window.electronAPI.wa.accounts() });
  const [accountId, setAccountId] = useState<number | null>(null);

  const activeAccountId = accountId ?? (accounts[0]?.id ?? null);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['wa:templates', activeAccountId],
    queryFn: () => activeAccountId ? window.electronAPI.wa.templates(activeAccountId) : [],
    enabled: !!activeAccountId,
  });

  const sync = useMutation({
    mutationFn: () => window.electronAPI.wa.syncTemplates(activeAccountId!),
    onSuccess: (r) => {
      if (r.ok) toast(`Synced ${r.synced} templates from Meta`);
      else toast(r.error ?? 'Sync failed', 'error');
      qc.invalidateQueries({ queryKey: ['wa:templates', activeAccountId] });
    },
    onError: (e: any) => toast(e.message || 'Sync failed', 'error'),
  });

  const statusColor: Record<string, string> = {
    APPROVED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    PENDING:  'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    REJECTED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold text-sm text-gray-800 dark:text-slate-100">Message Templates</h2>
            {accounts.length > 1 && (
              <select className="input w-auto text-xs" value={activeAccountId ?? ''} onChange={(e) => setAccountId(Number(e.target.value))}>
                {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.display_name || a.phone_number}</option>)}
              </select>
            )}
          </div>
          <button className="btn-ghost text-xs flex items-center gap-1.5" disabled={!activeAccountId || sync.isPending} onClick={() => sync.mutate()}>
            <RefreshCw className={cn('w-3.5 h-3.5', sync.isPending && 'animate-spin')} />
            {sync.isPending ? 'Syncing…' : 'Sync from Meta'}
          </button>
        </div>

        {!activeAccountId ? (
          <p className="text-xs text-gray-400 py-4">Connect a WhatsApp number first.</p>
        ) : isLoading ? (
          <p className="text-xs text-gray-400 py-4">Loading…</p>
        ) : templates.length === 0 ? (
          <div className="text-center py-8">
            <ListChecks className="w-8 h-8 text-gray-300 dark:text-slate-600 mx-auto mb-2" />
            <p className="text-sm text-gray-500 dark:text-slate-400">No templates synced yet</p>
            <p className="text-xs text-gray-400 mt-1">Click "Sync from Meta" to pull your approved templates</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-gray-200 dark:border-slate-700 text-xs uppercase text-gray-500 dark:text-slate-400">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Category</th>
                  <th className="py-2 pr-4">Language</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2">Use Case</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t: any) => (
                  <tr key={t.id} className="border-b border-gray-100 dark:border-slate-800">
                    <td className="py-2 pr-4 font-mono text-xs text-gray-900 dark:text-slate-100">{t.name}</td>
                    <td className="py-2 pr-4 text-xs text-gray-600 dark:text-slate-300">{t.category}</td>
                    <td className="py-2 pr-4 text-xs text-gray-600 dark:text-slate-300">{t.language}</td>
                    <td className="py-2 pr-4">
                      <span className={cn('inline-block px-2 py-0.5 rounded-full text-xs font-semibold', statusColor[t.status] ?? statusColor.PENDING)}>
                        {t.status}
                      </span>
                    </td>
                    <td className="py-2 text-xs text-gray-500 dark:text-slate-400">{t.use_case || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card p-4">
        <h2 className="font-semibold text-sm text-gray-800 dark:text-slate-100 mb-2">How to create templates</h2>
        <ol className="text-xs text-gray-500 dark:text-slate-400 space-y-1 list-decimal list-inside">
          <li>Go to <strong className="text-gray-700 dark:text-slate-300">Meta Business Suite → WhatsApp → Message Templates</strong></li>
          <li>Create a UTILITY template for each automation trigger (appointment_reminder_24h, etc.)</li>
          <li>Use <code className="bg-gray-100 dark:bg-slate-700 px-1 rounded">{`{{1}}`}</code> for patient name, <code className="bg-gray-100 dark:bg-slate-700 px-1 rounded">{`{{2}}`}</code> for doctor, <code className="bg-gray-100 dark:bg-slate-700 px-1 rounded">{`{{3}}`}</code> for date, <code className="bg-gray-100 dark:bg-slate-700 px-1 rounded">{`{{4}}`}</code> for time</li>
          <li>Wait for Meta to APPROVE the template (usually 10–60 minutes)</li>
          <li>Come back here and click "Sync from Meta"</li>
        </ol>
      </div>
    </div>
  );
}

// ── Automation tab ────────────────────────────────────────────────────────────
function AutomationTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: accounts = [] } = useQuery({ queryKey: ['wa:accounts'], queryFn: () => window.electronAPI.wa.accounts() });
  const [accountId, setAccountId] = useState<number | null>(null);
  const activeAccountId = accountId ?? (accounts[0]?.id ?? null);

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['wa:automationRules', activeAccountId],
    queryFn: () => activeAccountId ? window.electronAPI.wa.automationRules(activeAccountId) : [],
    enabled: !!activeAccountId,
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['wa:templates', activeAccountId],
    queryFn: () => activeAccountId ? window.electronAPI.wa.templates(activeAccountId) : [],
    enabled: !!activeAccountId,
  });

  const approvedTemplates = (templates as any[]).filter((t) => t.status === 'APPROVED');

  const setRule = useMutation({
    mutationFn: ({ trigger, patch }: { trigger: string; patch: any }) =>
      window.electronAPI.wa.setRule(activeAccountId!, trigger, patch),
    onSuccess: () => { toast('Rule saved'); qc.invalidateQueries({ queryKey: ['wa:automationRules', activeAccountId] }); },
    onError: (e: any) => toast(e.message || 'Save failed', 'error'),
  });

  const getRuleForTrigger = (trigger: string) =>
    (rules as any[]).find((r) => r.trigger === trigger);

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold text-sm text-gray-800 dark:text-slate-100">Automation Rules</h2>
            {accounts.length > 1 && (
              <select className="input w-auto text-xs" value={activeAccountId ?? ''} onChange={(e) => setAccountId(Number(e.target.value))}>
                {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.display_name || a.phone_number}</option>)}
              </select>
            )}
          </div>
        </div>

        {!activeAccountId ? (
          <p className="text-xs text-gray-400 py-4">Connect a WhatsApp number first.</p>
        ) : approvedTemplates.length === 0 ? (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4 text-xs text-amber-700 dark:text-amber-400">
            No approved templates synced yet. Go to the Templates tab, sync from Meta, and make sure at least one template is APPROVED.
          </div>
        ) : isLoading ? (
          <p className="text-xs text-gray-400 py-4">Loading…</p>
        ) : (
          <div className="space-y-3">
            {TRIGGERS.map(({ key, label, desc }) => {
              const rule = getRuleForTrigger(key);
              const isEnabled = rule?.is_enabled === 1 || rule?.is_enabled === true;
              const templateName = rule?.template_name ?? '';

              return (
                <div key={key} className={cn('border rounded-lg p-3 transition-colors', isEnabled ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10' : 'border-gray-200 dark:border-slate-700')}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 dark:text-slate-100">{label}</span>
                        <span className="font-mono text-[10px] text-gray-400 dark:text-slate-500">{key}</span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{desc}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <select
                        className="input text-xs w-48"
                        value={templateName}
                        onChange={(e) => setRule.mutate({ trigger: key, patch: { template_name: e.target.value, is_enabled: isEnabled ? 1 : 0 } })}
                      >
                        <option value="">— pick template —</option>
                        {approvedTemplates.map((t: any) => (
                          <option key={t.id} value={t.name}>{t.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => setRule.mutate({ trigger: key, patch: { template_name: templateName, is_enabled: isEnabled ? 0 : 1 } })}
                        disabled={!templateName}
                        title={!templateName ? 'Pick a template first' : isEnabled ? 'Click to disable' : 'Click to enable'}
                        className={cn(
                          'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 transition-colors duration-200',
                          isEnabled ? 'bg-emerald-500 border-emerald-500' : 'bg-gray-300 dark:bg-slate-600 border-gray-300 dark:border-slate-600',
                          !templateName && 'opacity-40 cursor-not-allowed'
                        )}
                      >
                        <span className={cn('inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200', isEnabled ? 'translate-x-4' : 'translate-x-0')} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Queue tab ─────────────────────────────────────────────────────────────────
function QueueTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: accounts = [] } = useQuery({ queryKey: ['wa:accounts'], queryFn: () => window.electronAPI.wa.accounts() });
  const [accountId, setAccountId] = useState<number | null>(null);
  const [showSend, setShowSend] = useState(false);
  const [sendForm, setSendForm] = useState({ to: '', template: '', v1: '', v2: '', v3: '', v4: '' });

  const activeAccountId = accountId ?? (accounts[0]?.id ?? null);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['wa:queueStats', activeAccountId],
    queryFn: () => activeAccountId ? window.electronAPI.wa.queueStats(activeAccountId) : null,
    enabled: !!activeAccountId,
    refetchInterval: 15_000,
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['wa:templates', activeAccountId],
    queryFn: () => activeAccountId ? window.electronAPI.wa.templates(activeAccountId) : [],
    enabled: !!activeAccountId,
  });

  const flush = useMutation({
    mutationFn: () => window.electronAPI.wa.processQueue(),
    onSuccess: () => { toast('Queue flushed'); qc.invalidateQueries({ queryKey: ['wa:queueStats', activeAccountId] }); },
    onError: (e: any) => toast(e.message || 'Flush failed', 'error'),
  });

  const send = useMutation({
    mutationFn: () => {
      const vars: Record<string, string> = {};
      if (sendForm.v1) vars['1'] = sendForm.v1;
      if (sendForm.v2) vars['2'] = sendForm.v2;
      if (sendForm.v3) vars['3'] = sendForm.v3;
      if (sendForm.v4) vars['4'] = sendForm.v4;
      return window.electronAPI.wa.queueSend(activeAccountId!, sendForm.to, sendForm.template, vars);
    },
    onSuccess: () => {
      toast('Queued for sending');
      setShowSend(false);
      setSendForm({ to: '', template: '', v1: '', v2: '', v3: '', v4: '' });
      qc.invalidateQueries({ queryKey: ['wa:queueStats', activeAccountId] });
    },
    onError: (e: any) => toast(e.message || 'Queue failed', 'error'),
  });

  const approvedTemplates = (templates as any[]).filter((t) => t.status === 'APPROVED');

  const statCards = [
    { label: 'Pending', value: stats?.pending ?? '—', color: 'text-amber-600 dark:text-amber-400' },
    { label: 'Sent today', value: stats?.sent_today ?? '—', color: 'text-emerald-600 dark:text-emerald-400' },
    { label: 'Failed today', value: stats?.failed_today ?? '—', color: 'text-red-600 dark:text-red-400' },
    { label: 'Total today', value: stats?.total_today ?? '—', color: 'text-gray-700 dark:text-slate-200' },
  ];

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold text-sm text-gray-800 dark:text-slate-100">Message Queue</h2>
            {accounts.length > 1 && (
              <select className="input w-auto text-xs" value={activeAccountId ?? ''} onChange={(e) => setAccountId(Number(e.target.value))}>
                {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.display_name || a.phone_number}</option>)}
              </select>
            )}
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost text-xs flex items-center gap-1.5" disabled={!activeAccountId || flush.isPending} onClick={() => flush.mutate()}>
              <Zap className={cn('w-3.5 h-3.5', flush.isPending && 'animate-pulse')} />
              Flush Queue
            </button>
            <button className="btn-primary text-xs flex items-center gap-1.5" disabled={!activeAccountId} onClick={() => setShowSend((v) => !v)}>
              <Send className="w-3.5 h-3.5" /> Send Now
            </button>
          </div>
        </div>

        {/* Stats */}
        {!activeAccountId ? (
          <p className="text-xs text-gray-400 py-4">Connect a WhatsApp number first.</p>
        ) : statsLoading ? (
          <p className="text-xs text-gray-400">Loading…</p>
        ) : (
          <div className="grid grid-cols-4 gap-4 mb-4">
            {statCards.map(({ label, value, color }) => (
              <div key={label} className="border border-gray-200 dark:border-slate-700 rounded-lg p-3 text-center">
                <p className={cn('text-2xl font-bold tabular-nums', color)}>{value}</p>
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Manual send form */}
        {showSend && (
          <div className="border border-green-200 dark:border-green-800 rounded-lg p-4 bg-green-50/50 dark:bg-green-900/10 space-y-3">
            <p className="text-xs font-medium text-green-700 dark:text-green-400">Send a template message to any number</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-slate-400 block mb-1">Phone (with country code)</label>
                <input className="input w-full" placeholder="919876543210" value={sendForm.to} onChange={(e) => setSendForm({ ...sendForm, to: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-slate-400 block mb-1">Template</label>
                <select className="input w-full" value={sendForm.template} onChange={(e) => setSendForm({ ...sendForm, template: e.target.value })}>
                  <option value="">— select —</option>
                  {approvedTemplates.map((t: any) => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
              </div>
              {(['v1', 'v2', 'v3', 'v4'] as const).map((k, i) => (
                <div key={k}>
                  <label className="text-xs font-medium text-gray-600 dark:text-slate-400 block mb-1">Variable {`{{${i + 1}}}`}</label>
                  <input className="input w-full" placeholder={`value for {{${i + 1}}}`} value={sendForm[k]} onChange={(e) => setSendForm({ ...sendForm, [k]: e.target.value })} />
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                className="btn-primary text-xs"
                disabled={!sendForm.to || !sendForm.template || send.isPending}
                onClick={() => send.mutate()}
              >
                {send.isPending ? 'Queuing…' : 'Queue & Send'}
              </button>
              <button className="btn-ghost text-xs" onClick={() => setShowSend(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <div className="card p-4">
        <h2 className="font-semibold text-sm text-gray-800 dark:text-slate-100 mb-2">How it works</h2>
        <div className="text-xs text-gray-500 dark:text-slate-400 space-y-1">
          <p>• Messages are placed in the queue whenever an automation trigger fires (e.g. appointment booked)</p>
          <p>• The queue worker runs every 60 seconds and sends up to 20 messages per cycle</p>
          <p>• Failed messages are retried up to 3 times before being marked as permanently failed</p>
          <p>• Use "Flush Queue" to send pending messages immediately without waiting for the next cycle</p>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function WhatsApp() {
  const [tab, setTab] = useState<Tab>('connect');

  const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'connect',    label: 'Connect',    icon: <PlugZap className="w-4 h-4" /> },
    { key: 'templates',  label: 'Templates',  icon: <ListChecks className="w-4 h-4" /> },
    { key: 'automation', label: 'Automation', icon: <Zap className="w-4 h-4" /> },
    { key: 'queue',      label: 'Queue',      icon: <Send className="w-4 h-4" /> },
  ];

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100 inline-flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-green-600" /> WhatsApp Hub
        </h1>
        <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
          Connect your clinic's WhatsApp Business number and automate patient communication.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-slate-700">
        {TABS.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
              tab === key
                ? 'border-green-500 text-green-700 dark:text-green-400'
                : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200'
            )}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'connect'    && <ConnectTab />}
      {tab === 'templates'  && <TemplatesTab />}
      {tab === 'automation' && <AutomationTab />}
      {tab === 'queue'      && <QueueTab />}
    </div>
  );
}
