import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare, Plug, PlugZap, RefreshCw, Zap, ListChecks,
  CheckCircle2, XCircle, AlertCircle, Clock, Send, Inbox,
  CheckCheck, User, Megaphone, Plus, Trash2, Play, Eye,
  ChevronDown,
} from 'lucide-react';
import { cn, fmtDateTime } from '../lib/utils';
import { useToast } from '../hooks/useToast';
import type { WaAutomationTrigger } from '../types/whatsapp';

type Tab = 'connect' | 'templates' | 'automation' | 'queue' | 'inbox' | 'campaigns';

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

// ── Relay config panel (shown inside ConnectTab) ──────────────────────────────
function RelayConfig({ accounts }: { accounts: any[] }) {
  const toast = useToast();
  const { data: cfg } = useQuery({ queryKey: ['wa:relayConfig'], queryFn: () => window.electronAPI.wa.relayConfig() });
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  useEffect(() => { if (cfg) { setUrl(cfg.url || ''); setSecret(cfg.secret || ''); } }, [cfg]);

  const save = useMutation({
    mutationFn: () => window.electronAPI.wa.setRelayConfig(url, secret),
    onSuccess: () => toast('Relay config saved'),
    onError: (e: any) => toast(e.message || 'Save failed', 'error'),
  });

  return (
    <div className="card p-4 space-y-3">
      <h2 className="font-semibold text-sm text-gray-800 dark:text-slate-100">Webhook Relay Server</h2>
      <p className="text-xs text-gray-500 dark:text-slate-400">
        Meta sends webhook events (delivery receipts, inbound messages) to a public URL. CureDesk polls that server every 60s.
        Deploy <code className="bg-gray-100 dark:bg-slate-700 px-1 rounded">relay-server/</code> on Railway (free tier), set the env vars below, then paste the URL here.
      </p>

      {/* Env vars to set on Railway */}
      <div className="bg-gray-50 dark:bg-slate-800 rounded p-3 text-xs font-mono space-y-1">
        <p className="text-gray-500 dark:text-slate-400"># Railway env vars:</p>
        {accounts[0] && <>
          <p className="text-gray-800 dark:text-slate-200">VERIFY_TOKEN=<span className="text-emerald-600 dark:text-emerald-400 select-all">{accounts[0].webhook_verify_token}</span></p>
          <p className="text-gray-800 dark:text-slate-200">PHONE_NUMBER_ID=<span className="text-emerald-600 dark:text-emerald-400 select-all">{accounts[0].phone_number_id}</span></p>
        </>}
        <p className="text-gray-800 dark:text-slate-200">SECRET=<span className="text-amber-600 dark:text-amber-400">(set a random string, paste below)</span></p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-slate-400 block mb-1">Relay URL</label>
          <input className="input w-full" placeholder="https://your-relay.railway.app" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-slate-400 block mb-1">Poll Secret (match SERVER env var)</label>
          <input className="input w-full font-mono text-xs" type="password" placeholder="random-secret-string" value={secret} onChange={(e) => setSecret(e.target.value)} />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button className="btn-primary text-xs" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save Relay Config'}
        </button>
        {cfg?.url && <span className="text-xs text-emerald-600 dark:text-emerald-400">✓ Relay configured — polling every 60s</span>}
      </div>

      <p className="text-xs text-gray-400 dark:text-slate-500">
        Meta Developer Console → WhatsApp → Webhook: set Callback URL to <strong>{url || 'https://your-relay.railway.app'}/webhook</strong> and Verify Token to the VERIFY_TOKEN above.
      </p>
    </div>
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

      {/* Webhook relay setup */}
      {accounts.length > 0 && <RelayConfig accounts={accounts} />}
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

// ── Segment metadata ──────────────────────────────────────────────────────────
const SEGMENTS = [
  { key: 'all',                label: 'All Patients',              desc: 'Every patient with a phone number on record' },
  { key: 'visited_last_30d',   label: 'Visited — last 30 days',    desc: 'Patients who had an appointment in the last 30 days' },
  { key: 'visited_last_90d',   label: 'Visited — last 90 days',    desc: 'Patients who had an appointment in the last 90 days' },
  { key: 'followup_due_7d',    label: 'Follow-up due (next 7 days)', desc: 'Patients with a scheduled follow-up date in the next week' },
  { key: 'birthday_this_month',label: 'Birthday this month',       desc: 'Patients whose birthday falls this calendar month' },
  { key: 'no_visit_90d',       label: 'Inactive — no visit in 90 days', desc: 'Patients not seen in the last 90 days (re-engagement)' },
] as const;

// ── Campaigns tab ─────────────────────────────────────────────────────────────
function CampaignsTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: accounts = [] } = useQuery({ queryKey: ['wa:accounts'], queryFn: () => window.electronAPI.wa.accounts() });
  const [accountId, setAccountId] = useState<number | null>(null);
  const activeAccountId = accountId ?? (accounts[0]?.id ?? null);

  const [showNew, setShowNew] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);

  // New campaign form state
  const [form, setForm] = useState({
    name: '', template_name: '', segment: 'all',
    v1: '', v2: '', v3: '', v4: '',
  });

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ['wa:campaigns', activeAccountId],
    queryFn: () => activeAccountId ? window.electronAPI.wa.campaigns(activeAccountId) : [],
    enabled: !!activeAccountId,
    refetchInterval: 10_000,
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['wa:templates', activeAccountId],
    queryFn: () => activeAccountId ? window.electronAPI.wa.templates(activeAccountId) : [],
    enabled: !!activeAccountId,
  });

  const { data: previewPatients, isFetching: previewing } = useQuery({
    queryKey: ['wa:campaignPreview', activeAccountId, form.segment],
    queryFn: () => activeAccountId ? window.electronAPI.wa.campaignPreview(activeAccountId, form.segment) : [],
    enabled: !!activeAccountId && showNew,
  });

  const { data: recipients = [] } = useQuery({
    queryKey: ['wa:campaignRecipients', selectedCampaignId],
    queryFn: () => selectedCampaignId ? window.electronAPI.wa.campaignRecipients(selectedCampaignId) : [],
    enabled: !!selectedCampaignId,
    refetchInterval: 5_000,
  });

  const approvedTemplates = (templates as any[]).filter((t) => t.status === 'APPROVED');

  const create = useMutation({
    mutationFn: () => {
      const vars: Record<string, string> = {};
      if (form.v1) vars['1'] = form.v1;
      if (form.v2) vars['2'] = form.v2;
      if (form.v3) vars['3'] = form.v3;
      if (form.v4) vars['4'] = form.v4;
      return window.electronAPI.wa.campaignCreate(activeAccountId!, {
        name: form.name, template_name: form.template_name,
        template_vars: Object.keys(vars).length ? vars : undefined,
        segment: form.segment,
      });
    },
    onSuccess: (r) => {
      if (r.ok) {
        toast('Campaign created');
        setShowNew(false);
        setForm({ name: '', template_name: '', segment: 'all', v1: '', v2: '', v3: '', v4: '' });
        qc.invalidateQueries({ queryKey: ['wa:campaigns', activeAccountId] });
      } else toast(r.error ?? 'Create failed', 'error');
    },
    onError: (e: any) => toast(e.message || 'Create failed', 'error'),
  });

  const launch = useMutation({
    mutationFn: (id: number) => window.electronAPI.wa.campaignLaunch(id),
    onSuccess: (r, id) => {
      if (r.ok) { toast(`Campaign launched — ${r.total} recipients`); setSelectedCampaignId(id); }
      else toast(r.error ?? 'Launch failed', 'error');
      qc.invalidateQueries({ queryKey: ['wa:campaigns', activeAccountId] });
    },
    onError: (e: any) => toast(e.message || 'Launch failed', 'error'),
  });

  const deleteCampaign = useMutation({
    mutationFn: (id: number) => window.electronAPI.wa.campaignDelete(id),
    onSuccess: () => { toast('Campaign deleted'); qc.invalidateQueries({ queryKey: ['wa:campaigns', activeAccountId] }); },
    onError: (e: any) => toast(e.message || 'Delete failed', 'error'),
  });

  const statusColor: Record<string, string> = {
    draft:     'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300',
    running:   'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    failed:    'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };

  const recipientStatusColor: Record<string, string> = {
    pending: 'text-amber-600 dark:text-amber-400',
    sent:    'text-emerald-600 dark:text-emerald-400',
    failed:  'text-red-600 dark:text-red-400',
  };

  if (!activeAccountId) {
    return <div className="card p-8 text-center"><p className="text-sm text-gray-500 dark:text-slate-400">Connect a WhatsApp number first.</p></div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold text-sm text-gray-800 dark:text-slate-100">Broadcast Campaigns</h2>
            {accounts.length > 1 && (
              <select className="input w-auto text-xs" value={activeAccountId ?? ''} onChange={(e) => setAccountId(Number(e.target.value))}>
                {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.display_name || a.phone_number}</option>)}
              </select>
            )}
          </div>
          <button className="btn-primary text-xs flex items-center gap-1.5" onClick={() => { setShowNew((v) => !v); setSelectedCampaignId(null); }}>
            <Plus className="w-3.5 h-3.5" /> New Campaign
          </button>
        </div>

        {/* ── New campaign form ── */}
        {showNew && (
          <div className="border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4 bg-blue-50/40 dark:bg-blue-900/10 space-y-4">
            <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">New Campaign</p>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="label">Campaign Name</label>
                <input className="input w-full" placeholder="e.g. Monsoon Health Check-up" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="label">Template</label>
                <select className="input w-full" value={form.template_name} onChange={(e) => setForm({ ...form, template_name: e.target.value })}>
                  <option value="">— select —</option>
                  {approvedTemplates.map((t: any) => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Patient Segment</label>
                <select className="input w-full" value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value })}>
                  {SEGMENTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
            </div>

            {/* Segment preview */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-500 dark:text-slate-400">Estimated reach:</span>
              {previewing
                ? <span className="text-gray-400">calculating…</span>
                : <span className="font-semibold text-gray-800 dark:text-slate-200">{previewPatients?.length ?? 0} patients</span>}
              <span className="text-gray-400 dark:text-slate-500">· {SEGMENTS.find((s) => s.key === form.segment)?.desc}</span>
            </div>

            {/* Template vars */}
            <div className="grid grid-cols-2 gap-3">
              {(['v1', 'v2', 'v3', 'v4'] as const).map((k, i) => (
                <div key={k}>
                  <label className="label">Variable {`{{${i + 1}}}`} <span className="text-gray-400 font-normal">(optional — {`{{1}}`} defaults to patient name)</span></label>
                  <input className="input w-full" placeholder={i === 0 ? 'defaults to patient name' : `value for {{${i + 1}}}`} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <button className="btn-primary text-xs" disabled={!form.name || !form.template_name || create.isPending || !previewPatients?.length} onClick={() => create.mutate()}>
                {create.isPending ? 'Creating…' : `Create Campaign (${previewPatients?.length ?? 0} recipients)`}
              </button>
              <button className="btn-ghost text-xs" onClick={() => setShowNew(false)}>Cancel</button>
            </div>
          </div>
        )}

        {/* ── Campaign list ── */}
        {isLoading ? (
          <p className="text-xs text-gray-400 py-4">Loading…</p>
        ) : (campaigns as any[]).length === 0 ? (
          <div className="text-center py-8">
            <Megaphone className="w-8 h-8 text-gray-300 dark:text-slate-600 mx-auto mb-2" />
            <p className="text-sm text-gray-500 dark:text-slate-400">No campaigns yet</p>
            <p className="text-xs text-gray-400 mt-1">Create a campaign to broadcast a template message to a patient segment</p>
          </div>
        ) : (
          <div className="space-y-2">
            {(campaigns as any[]).map((c) => {
              const seg = SEGMENTS.find((s) => s.key === c.segment);
              const isSelected = c.id === selectedCampaignId;
              const pct = c.total_count > 0 ? Math.round(((c.sent_count + c.failed_count) / c.total_count) * 100) : 0;
              return (
                <div key={c.id} className="border border-gray-200 dark:border-slate-700 rounded-lg">
                  <div className="flex items-center justify-between p-3 cursor-pointer" onClick={() => setSelectedCampaignId(isSelected ? null : c.id)}>
                    <div className="flex items-center gap-3 min-w-0">
                      <Megaphone className="w-4 h-4 text-gray-400 dark:text-slate-500 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-slate-100 truncate">{c.name}</p>
                        <p className="text-xs text-gray-500 dark:text-slate-400 truncate">
                          {seg?.label} · <span className="font-mono">{c.template_name}</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {c.status === 'running' && (
                        <div className="text-xs text-blue-600 dark:text-blue-400 tabular-nums">
                          {c.sent_count + c.failed_count}/{c.total_count} ({pct}%)
                        </div>
                      )}
                      {c.status === 'completed' && (
                        <div className="text-xs text-emerald-600 dark:text-emerald-400 tabular-nums">
                          ✓ {c.sent_count} sent · {c.failed_count} failed
                        </div>
                      )}
                      <span className={cn('inline-block px-2 py-0.5 rounded-full text-xs font-semibold', statusColor[c.status] ?? statusColor.draft)}>{c.status}</span>
                      {c.status === 'draft' && (
                        <button className="btn-ghost text-xs flex items-center gap-1 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20" onClick={(e) => { e.stopPropagation(); launch.mutate(c.id); }} disabled={launch.isPending}>
                          <Play className="w-3.5 h-3.5" /> Launch
                        </button>
                      )}
                      {c.status === 'draft' && (
                        <button className="btn-ghost text-xs text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={(e) => { e.stopPropagation(); deleteCampaign.mutate(c.id); }} title="Delete draft">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <ChevronDown className={cn('w-4 h-4 text-gray-400 transition-transform', isSelected && 'rotate-180')} />
                    </div>
                  </div>

                  {/* Progress bar for running */}
                  {c.status === 'running' && (
                    <div className="px-3 pb-2">
                      <div className="h-1.5 rounded-full bg-gray-100 dark:bg-slate-700 overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )}

                  {/* Recipients table */}
                  {isSelected && (
                    <div className="border-t border-gray-100 dark:border-slate-800 p-3">
                      {(recipients as any[]).length === 0 ? (
                        <p className="text-xs text-gray-400 text-center py-2">No recipients yet (launch to populate)</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left border-b border-gray-100 dark:border-slate-800 text-gray-500 dark:text-slate-400 uppercase text-[10px]">
                                <th className="py-1.5 pr-3">Patient</th>
                                <th className="py-1.5 pr-3">Phone</th>
                                <th className="py-1.5 pr-3">Status</th>
                                <th className="py-1.5">Sent at</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(recipients as any[]).slice(0, 50).map((r) => (
                                <tr key={r.id} className="border-b border-gray-50 dark:border-slate-800/50">
                                  <td className="py-1.5 pr-3 text-gray-800 dark:text-slate-200">{r.patient_name || '—'}</td>
                                  <td className="py-1.5 pr-3 font-mono text-gray-600 dark:text-slate-400">{r.phone}</td>
                                  <td className={cn('py-1.5 pr-3 font-medium', recipientStatusColor[r.status])}>{r.status}</td>
                                  <td className="py-1.5 text-gray-400">{r.sent_at ? new Date(r.sent_at).toLocaleTimeString() : '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {(recipients as any[]).length > 50 && (
                            <p className="text-xs text-gray-400 mt-2 text-center">Showing first 50 of {(recipients as any[]).length}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Info box */}
      <div className="card p-4">
        <h2 className="font-semibold text-sm text-gray-800 dark:text-slate-100 mb-2">How campaigns work</h2>
        <div className="text-xs text-gray-500 dark:text-slate-400 space-y-1">
          <p>• Create a campaign: pick a patient segment, choose an approved template, set optional variable overrides</p>
          <p>• <code className="bg-gray-100 dark:bg-slate-700 px-1 rounded">{'{{1}}'}</code> automatically fills with the patient's name unless you override it</p>
          <p>• Click Launch — messages send in batches of 10, with 1s between batches (Meta rate-limit safe)</p>
          <p>• Track delivery in real-time via the recipient table — refreshes every 5s while running</p>
          <p>• Only APPROVED templates can be used; UTILITY templates have the highest delivery rate</p>
        </div>
      </div>
    </div>
  );
}

// ── Inbox tab ─────────────────────────────────────────────────────────────────
function InboxTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: accounts = [] } = useQuery({ queryKey: ['wa:accounts'], queryFn: () => window.electronAPI.wa.accounts() });
  const [accountId, setAccountId] = useState<number | null>(null);
  const [convStatus, setConvStatus] = useState<'open' | 'resolved'>('open');
  const [selectedConvId, setSelectedConvId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeAccountId = accountId ?? (accounts[0]?.id ?? null);

  // Conversations list — refresh every 15s
  const { data: conversations = [], isLoading: convsLoading } = useQuery({
    queryKey: ['wa:conversations', activeAccountId, convStatus],
    queryFn: () => activeAccountId ? window.electronAPI.wa.conversations(activeAccountId, convStatus) : [],
    enabled: !!activeAccountId,
    refetchInterval: 15_000,
  });

  // Messages for selected conversation — refresh every 10s
  const { data: messages = [], isLoading: msgsLoading } = useQuery({
    queryKey: ['wa:messages', activeAccountId, selectedConvId],
    queryFn: () => activeAccountId && selectedConvId ? window.electronAPI.wa.messages(activeAccountId, selectedConvId) : [],
    enabled: !!activeAccountId && !!selectedConvId,
    refetchInterval: 10_000,
  });

  // Auto-scroll to bottom when messages load or change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Auto-select first conversation when list loads
  useEffect(() => {
    if (!selectedConvId && (conversations as any[]).length > 0) {
      setSelectedConvId((conversations as any[])[0].id);
    }
  }, [(conversations as any[]).length]);

  const sendText = useMutation({
    mutationFn: () => window.electronAPI.wa.sendText(activeAccountId!, selectedConvId!, replyText.trim()),
    onSuccess: (r) => {
      if (r.ok) {
        setReplyText('');
        qc.invalidateQueries({ queryKey: ['wa:messages', activeAccountId, selectedConvId] });
        qc.invalidateQueries({ queryKey: ['wa:conversations', activeAccountId, convStatus] });
      } else {
        toast(r.error ?? 'Send failed', 'error');
      }
    },
    onError: (e: any) => toast(e.message || 'Send failed', 'error'),
  });

  const resolve = useMutation({
    mutationFn: (status: 'open' | 'resolved') => window.electronAPI.wa.resolveConversation(selectedConvId!, status),
    onSuccess: (_, status) => {
      toast(status === 'resolved' ? 'Conversation resolved' : 'Conversation reopened');
      setSelectedConvId(null);
      qc.invalidateQueries({ queryKey: ['wa:conversations', activeAccountId, convStatus] });
    },
    onError: (e: any) => toast(e.message || 'Failed', 'error'),
  });

  const selectedConv = (conversations as any[]).find((c) => c.id === selectedConvId);

  function msgPreview(conv: any): string {
    if (!conv.last_msg_content) return '';
    try {
      const c = JSON.parse(conv.last_msg_content);
      if (typeof c.text === 'string') return c.text;
      if (c.template) return `[template: ${c.template}]`;
      return '';
    } catch { return ''; }
  }

  function msgText(msg: any): string {
    try {
      const c = JSON.parse(msg.content || '{}');
      if (typeof c.text === 'string') return c.text;
      if (c.template) return `📋 ${c.template}`;
      return msg.message_type ?? '…';
    } catch { return '…'; }
  }

  function relTime(iso: string) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diffMin = Math.floor((now.getTime() - d.getTime()) / 60_000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    return fmtDateTime(iso);
  }

  if (!activeAccountId) {
    return (
      <div className="card p-8 text-center">
        <PlugZap className="w-8 h-8 text-gray-300 dark:text-slate-600 mx-auto mb-2" />
        <p className="text-sm text-gray-500 dark:text-slate-400">Connect a WhatsApp number first.</p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden" style={{ height: 'calc(100vh - 220px)', minHeight: 500 }}>
      <div className="flex h-full">

        {/* ── Left: conversation list ─────────────────────────────────────── */}
        <div className="w-72 shrink-0 border-r border-gray-200 dark:border-slate-700 flex flex-col">
          {/* Header */}
          <div className="p-3 border-b border-gray-200 dark:border-slate-700 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-700 dark:text-slate-300">Conversations</span>
              {accounts.length > 1 && (
                <select className="input text-xs w-auto" value={activeAccountId ?? ''} onChange={(e) => { setAccountId(Number(e.target.value)); setSelectedConvId(null); }}>
                  {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.display_name || a.phone_number}</option>)}
                </select>
              )}
            </div>
            <div className="flex gap-1">
              {(['open', 'resolved'] as const).map((s) => (
                <button key={s} onClick={() => { setConvStatus(s); setSelectedConvId(null); }}
                  className={cn('flex-1 py-1 text-xs rounded font-medium transition-colors',
                    convStatus === s ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800')}>
                  {s === 'open' ? 'Open' : 'Resolved'}
                </button>
              ))}
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {convsLoading ? (
              <p className="text-xs text-gray-400 p-4">Loading…</p>
            ) : (conversations as any[]).length === 0 ? (
              <div className="p-6 text-center">
                <Inbox className="w-6 h-6 text-gray-300 dark:text-slate-600 mx-auto mb-2" />
                <p className="text-xs text-gray-400">No {convStatus} conversations</p>
              </div>
            ) : (
              (conversations as any[]).map((conv) => {
                const preview = msgPreview(conv);
                const unread = (conv.unread_count ?? 0) > 0;
                const isSelected = conv.id === selectedConvId;
                return (
                  <button key={conv.id} onClick={() => setSelectedConvId(conv.id)}
                    className={cn('w-full text-left px-3 py-3 border-b border-gray-100 dark:border-slate-800 transition-colors',
                      isSelected ? 'bg-green-50 dark:bg-green-900/20' : 'hover:bg-gray-50 dark:hover:bg-slate-800/50')}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-slate-700 flex items-center justify-center shrink-0">
                          <User className="w-4 h-4 text-gray-500 dark:text-slate-400" />
                        </div>
                        <div className="min-w-0">
                          <p className={cn('text-xs truncate', unread ? 'font-semibold text-gray-900 dark:text-slate-100' : 'font-medium text-gray-800 dark:text-slate-200')}>
                            {conv.patient_name?.trim() || conv.phone}
                          </p>
                          <p className="text-[11px] text-gray-500 dark:text-slate-400 truncate">{conv.phone}</p>
                        </div>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-1">
                        <span className="text-[10px] text-gray-400 dark:text-slate-500 whitespace-nowrap">{relTime(conv.last_message_at)}</span>
                        {unread && <span className="w-2 h-2 rounded-full bg-green-500" />}
                      </div>
                    </div>
                    {preview && (
                      <p className="text-[11px] text-gray-400 dark:text-slate-500 truncate mt-1 pl-10">{conv.last_msg_direction === 'inbound' ? '← ' : '→ '}{preview}</p>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ── Right: message thread ──────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0">
          {!selectedConvId ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <MessageSquare className="w-10 h-10 text-gray-200 dark:text-slate-700 mx-auto mb-3" />
                <p className="text-sm text-gray-400 dark:text-slate-500">Select a conversation</p>
              </div>
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div className="p-3 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                    <User className="w-4 h-4 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                      {selectedConv?.patient_name?.trim() || selectedConv?.phone}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-slate-400">{selectedConv?.phone}</p>
                  </div>
                </div>
                <button
                  onClick={() => resolve.mutate(convStatus === 'open' ? 'resolved' : 'open')}
                  disabled={resolve.isPending}
                  className={cn('btn-ghost text-xs flex items-center gap-1.5',
                    convStatus === 'open' ? 'text-gray-600 dark:text-slate-400' : 'text-emerald-600 dark:text-emerald-400')}
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  {convStatus === 'open' ? 'Resolve' : 'Reopen'}
                </button>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {msgsLoading ? (
                  <p className="text-xs text-gray-400 text-center py-8">Loading messages…</p>
                ) : (messages as any[]).length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-8">No messages yet.</p>
                ) : (
                  (messages as any[]).map((msg) => {
                    const isOut = msg.direction === 'outbound';
                    const text = msgText(msg);
                    return (
                      <div key={msg.id} className={cn('flex', isOut ? 'justify-end' : 'justify-start')}>
                        <div className={cn('max-w-[70%] rounded-2xl px-3 py-2 text-sm shadow-sm',
                          isOut
                            ? 'bg-green-500 text-white rounded-br-none'
                            : 'bg-gray-100 dark:bg-slate-700 text-gray-900 dark:text-slate-100 rounded-bl-none')}>
                          <p className="leading-snug break-words">{text}</p>
                          <div className={cn('flex items-center gap-1 mt-1 text-[10px]',
                            isOut ? 'text-green-100 justify-end' : 'text-gray-400 dark:text-slate-500 justify-start')}>
                            <span>{relTime(msg.timestamp)}</span>
                            {isOut && (
                              <span title={msg.status}>
                                {msg.status === 'read'      ? '✓✓' :
                                 msg.status === 'delivered' ? '✓✓' :
                                 msg.status === 'sent'      ? '✓'  : '⏳'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={bottomRef} />
              </div>

              {/* Reply box */}
              {convStatus === 'open' ? (
                <div className="p-3 border-t border-gray-200 dark:border-slate-700">
                  <div className="flex gap-2 items-end">
                    <textarea
                      className="input flex-1 resize-none text-sm"
                      rows={2}
                      placeholder="Type a reply… (only works within 24h of patient's last message)"
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          if (replyText.trim()) sendText.mutate();
                        }
                      }}
                    />
                    <button
                      className="btn-primary p-2.5 shrink-0"
                      disabled={!replyText.trim() || sendText.isPending}
                      onClick={() => sendText.mutate()}
                      title="Send (Enter)"
                    >
                      <Send className={cn('w-4 h-4', sendText.isPending && 'animate-pulse')} />
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">
                    Enter to send · Shift+Enter for newline · Free-text replies require the patient to have messaged you in the last 24 hours (Meta policy)
                  </p>
                </div>
              ) : (
                <div className="p-3 border-t border-gray-200 dark:border-slate-700 text-center">
                  <p className="text-xs text-gray-400 dark:text-slate-500">This conversation is resolved. <button className="underline text-green-600 dark:text-green-400" onClick={() => resolve.mutate('open')}>Reopen</button> to reply.</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function WhatsApp() {
  const [tab, setTab] = useState<Tab>('inbox');

  const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'inbox',      label: 'Inbox',      icon: <Inbox className="w-4 h-4" /> },
    { key: 'campaigns',  label: 'Campaigns',  icon: <Megaphone className="w-4 h-4" /> },
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
      {tab === 'inbox'      && <InboxTab />}
      {tab === 'campaigns'  && <CampaignsTab />}
      {tab === 'connect'    && <ConnectTab />}
      {tab === 'templates'  && <TemplatesTab />}
      {tab === 'automation' && <AutomationTab />}
      {tab === 'queue'      && <QueueTab />}
    </div>
  );
}
