import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare, Plug, PlugZap, RefreshCw, Zap, ListChecks,
  CheckCircle2, XCircle, AlertCircle, Clock, Send, Inbox,
  CheckCheck, User, Megaphone, Plus, Trash2, Play, Eye,
  ChevronDown, Sparkles, Star, BookOpen, ChevronRight, X, BarChart2,
  Smartphone, Cloud, FileText, Calendar, Pill, Receipt, TestTube, RotateCcw, Cake, ThumbsUp, Syringe,
} from 'lucide-react';
import { cn, fmtDateTime } from '../lib/utils';
import { useToast } from '../hooks/useToast';
import { buildWhatsAppUrl, renderTemplate, DEFAULT_WHATSAPP_TEMPLATE, buildContext } from '../lib/whatsapp';
import type { WaAutomationTrigger } from '../types/whatsapp';

type Tab = 'dashboard' | 'connect' | 'templates' | 'automation' | 'queue' | 'inbox' | 'campaigns' | 'broadcast';
type ActiveModule = 'module1' | 'module2';

function safeClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  });
}

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
  { key: 'feedback_request',         label: 'Experience & Google Review', desc: 'Sent ~2–4 hours after appointment completion, asks for feedback and Google review' },
  { key: 'vaccination_reminder',     label: 'Vaccination Reminder',       desc: 'Sent ~28 days after a vaccination service, reminding patient about next dose' },
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

// CureDesk-hosted relay — clinics never need to deploy their own server.
const CAREDESK_RELAY_URL = 'https://curedesk-relay.curedesk.workers.dev';

// ── Relay config panel (shown inside ConnectTab) ──────────────────────────────
function RelayConfig({ accounts }: { accounts: any[] }) {
  const toast = useToast();
  const { data: cfg } = useQuery({ queryKey: ['wa:relayConfig'], queryFn: () => window.electronAPI.wa.relayConfig() });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');

  useEffect(() => {
    // Always use the hosted relay URL — ignore any old saved value
    setUrl(CAREDESK_RELAY_URL);
    if (cfg) setSecret(cfg.secret || '');
  }, [cfg]);

  const save = useMutation({
    mutationFn: () => window.electronAPI.wa.setRelayConfig(url, secret),
    onSuccess: () => toast('Webhook config saved'),
    onError: (e: any) => toast(e.message || 'Save failed', 'error'),
  });

  const verifyToken = accounts[0]?.webhook_verify_token ?? '—';
  const webhookUrl = `${url}/webhook`;

  const copyToClipboard = (text: string, label: string) => {
    safeClipboard(text);
    toast(`${label} copied`);
  };

  const isConfigured = !!(cfg?.url);

  return (
    <div className="card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm text-gray-800 dark:text-slate-100">Step 3 — Register Webhook with Meta</h2>
        {isConfigured && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
            <CheckCircle2 className="w-3 h-3" /> Active
          </span>
        )}
      </div>

      <p className="text-xs text-gray-500 dark:text-slate-400">
        One-time setup: paste these two values into your Meta app's webhook settings so CureDesk can receive incoming messages and delivery updates.
      </p>

      {/* The two values the user needs to copy */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 bg-gray-50 dark:bg-slate-800 rounded-lg px-3 py-2.5">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-medium text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-0.5">Webhook URL (paste in Meta)</p>
            <p className="text-xs font-mono text-gray-800 dark:text-slate-100 truncate">{webhookUrl}</p>
          </div>
          <button
            className="shrink-0 px-2.5 py-1 text-xs rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors"
            onClick={() => copyToClipboard(webhookUrl, 'Webhook URL')}
          >
            Copy
          </button>
        </div>

        <div className="flex items-center gap-2 bg-gray-50 dark:bg-slate-800 rounded-lg px-3 py-2.5">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-medium text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-0.5">Verify Token (paste in Meta)</p>
            <p className="text-xs font-mono text-gray-800 dark:text-slate-100 truncate select-all">{verifyToken}</p>
          </div>
          <button
            className="shrink-0 px-2.5 py-1 text-xs rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors"
            onClick={() => copyToClipboard(verifyToken, 'Verify token')}
          >
            Copy
          </button>
        </div>
      </div>

      {/* Where to paste in Meta */}
      <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800 rounded-lg p-3 text-xs text-blue-700 dark:text-blue-300 space-y-1">
        <p className="font-semibold">Where to paste in Meta:</p>
        <p>1. Open <strong>Meta Developer Console</strong> → your app → <strong>WhatsApp → Configuration</strong></p>
        <p>2. Click <strong>Edit</strong> next to Webhooks → paste the URL and Verify Token above</p>
        <p>3. Click <strong>Verify and Save</strong> → then subscribe to the <strong>messages</strong> field</p>
        <p>Done — incoming messages will now appear in the Inbox.</p>
      </div>

      {/* Save button (saves the relay URL so the app knows where to poll) */}
      <div className="flex items-center gap-3">
        <button className="btn-primary text-xs" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : isConfigured ? 'Update' : 'Confirm Setup'}
        </button>
        <button className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 underline" onClick={() => setShowAdvanced(v => !v)}>
          {showAdvanced ? 'Hide advanced' : 'Advanced (custom relay)'}
        </button>
      </div>

      {/* Advanced: custom relay URL + secret — hidden by default */}
      {showAdvanced && (
        <div className="border border-dashed border-gray-200 dark:border-slate-700 rounded-lg p-3 space-y-3">
          <p className="text-[11px] text-gray-400 dark:text-slate-500">Only change these if you are hosting your own relay server.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-slate-400 block mb-1">Relay Base URL</label>
              <input className="input w-full text-xs" value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-slate-400 block mb-1">Poll Secret</label>
              <input className="input w-full font-mono text-xs" type="password" placeholder="secret" value={secret} onChange={(e) => setSecret(e.target.value)} />
            </div>
          </div>
        </div>
      )}
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
            <div className="rounded-lg bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 space-y-1">
              <p className="font-semibold">Which number should I connect?</p>
              <p>You can try connecting your <strong>existing WhatsApp Business App number</strong>. After connecting, open the WhatsApp Business App on that phone — if it still works normally, <strong>coexistence is enabled</strong> and you have both manual sends + automation on one number.</p>
              <p>If the app stops working after connecting, Meta has migrated the number to API-only mode. In that case, get a <strong>new SIM or landline number</strong> specifically for the clinic's automation.</p>
            </div>
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
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const [accountId, setAccountId] = useState<number | null>(null);
  const [reviewLinkDraft, setReviewLinkDraft] = useState<string | null>(null);
  const activeAccountId = accountId ?? (accounts[0]?.id ?? null);

  const saveReviewLink = useMutation({
    mutationFn: (url: string) => window.electronAPI.settings.save({ google_review_url: url }),
    onSuccess: () => { toast('Google Review link saved'); qc.invalidateQueries({ queryKey: ['settings'] }); setReviewLinkDraft(null); },
    onError: () => toast('Could not save link', 'error'),
  });

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

              const isFeedback = key === 'feedback_request';
              const currentReviewLink = reviewLinkDraft ?? settings?.google_review_url ?? '';

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

                  {/* Google Review URL field — only on feedback_request trigger */}
                  {isFeedback && (
                    <div className="mt-3 pt-3 border-t border-yellow-200 dark:border-yellow-800/50">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Star className="w-3 h-3 text-yellow-500" />
                        <span className="text-[11px] font-semibold text-yellow-700 dark:text-yellow-400">Google Review Link</span>
                        {settings?.google_review_url && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 font-medium">✓ Set</span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <input
                          className="input flex-1 text-xs"
                          placeholder="https://g.page/r/your-clinic-review-link"
                          value={reviewLinkDraft ?? (settings?.google_review_url ?? '')}
                          onChange={e => setReviewLinkDraft(e.target.value)}
                        />
                        <button
                          onClick={() => saveReviewLink.mutate(currentReviewLink)}
                          disabled={saveReviewLink.isPending || !currentReviewLink.trim()}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-yellow-500 hover:bg-yellow-600 text-white disabled:opacity-40 transition-colors whitespace-nowrap"
                        >
                          {saveReviewLink.isPending ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                      <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">
                        This link is included in the automated review request message sent after each appointment.
                      </p>
                    </div>
                  )}
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
  { key: 'all',                label: 'All Patients',                    desc: 'Every patient with a phone number on record' },
  { key: 'visited_last_30d',   label: 'Visited — last 30 days',          desc: 'Patients who had an appointment in the last 30 days' },
  { key: 'visited_last_90d',   label: 'Visited — last 90 days',          desc: 'Patients who had an appointment in the last 90 days' },
  { key: 'followup_due_7d',    label: 'Follow-up due (next 7 days)',      desc: 'Patients with a scheduled follow-up date in the next week' },
  { key: 'birthday_this_month',label: 'Birthday this month',              desc: 'Patients whose birthday falls this calendar month' },
  { key: 'no_visit_90d',       label: 'Inactive — no visit in 90 days',  desc: 'Patients not seen in the last 90 days (re-engagement)' },
  { key: 'health_awareness',   label: 'Health Awareness (visited 90d)',   desc: 'Active patients — ideal for health tips, seasonal alerts, preventive care' },
  { key: 'promotion',          label: 'Health Package Promotion (all)',   desc: 'All patients — broadcast health packages, camp announcements, offers' },
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
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
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

  // Clear AI suggestions when switching conversations
  useEffect(() => { setAiSuggestions([]); }, [selectedConvId]);

  async function fetchAiSuggestions() {
    if (!activeAccountId || !selectedConvId) return;
    setAiLoading(true);
    setAiSuggestions([]);
    try {
      const r = await window.electronAPI.wa.aiSuggest(activeAccountId, selectedConvId);
      if (r.ok && r.suggestions) setAiSuggestions(r.suggestions);
      else toast(r.error ?? 'AI suggest failed', 'error');
    } catch (e: any) {
      toast(e.message || 'AI suggest failed', 'error');
    } finally {
      setAiLoading(false);
    }
  }

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

  const sendFeedback = useMutation({
    mutationFn: () => window.electronAPI.wa.sendFeedbackRequest(activeAccountId!, selectedConvId!),
    onSuccess: (r) => {
      if (r.ok) {
        toast('Review request sent!');
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
                <div className="flex items-center gap-1">
                  {convStatus === 'open' && (
                    <button
                      onClick={() => sendFeedback.mutate()}
                      disabled={sendFeedback.isPending}
                      className="btn-ghost text-xs flex items-center gap-1.5 text-amber-600 dark:text-amber-400"
                      title="Send experience & Google review request"
                    >
                      <Star className={cn('w-3.5 h-3.5', sendFeedback.isPending && 'animate-pulse')} />
                      Rate Us
                    </button>
                  )}
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
                <div className="p-3 border-t border-gray-200 dark:border-slate-700 space-y-2">
                  {/* AI suggestion chips */}
                  {(aiSuggestions.length > 0 || aiLoading) && (
                    <div className="flex flex-wrap gap-1.5">
                      {aiLoading && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-300 text-xs animate-pulse">
                          <Sparkles className="w-3 h-3" /> Thinking…
                        </span>
                      )}
                      {aiSuggestions.map((s, i) => (
                        <button
                          key={i}
                          className="px-2.5 py-1 rounded-full text-xs bg-purple-50 hover:bg-purple-100 dark:bg-purple-900/20 dark:hover:bg-purple-900/40 text-purple-700 dark:text-purple-200 border border-purple-200 dark:border-purple-700 transition-colors text-left"
                          onClick={() => { setReplyText(s); setAiSuggestions([]); }}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
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
                    <div className="flex flex-col gap-1 shrink-0">
                      <button
                        className="btn-primary p-2.5"
                        disabled={!replyText.trim() || sendText.isPending}
                        onClick={() => sendText.mutate()}
                        title="Send (Enter)"
                      >
                        <Send className={cn('w-4 h-4', sendText.isPending && 'animate-pulse')} />
                      </button>
                      <button
                        className="p-2.5 rounded-lg border border-purple-200 dark:border-purple-700 hover:bg-purple-50 dark:hover:bg-purple-900/20 text-purple-600 dark:text-purple-300 disabled:opacity-40 transition-colors"
                        disabled={aiLoading || !selectedConvId}
                        onClick={fetchAiSuggestions}
                        title="AI reply suggestions"
                      >
                        <Sparkles className={cn('w-4 h-4', aiLoading && 'animate-pulse')} />
                      </button>
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-400 dark:text-slate-500">
                    Enter to send · Shift+Enter for newline · ✨ = AI reply suggestions (requires Anthropic key in Settings)
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

// ── Broadcast tab ─────────────────────────────────────────────────────────────
function getBodyText(template: any): string {
  const body = (template.components as any[])?.find((c: any) => c.type === 'BODY');
  return body?.text ?? '';
}

function extractVarCount(bodyText: string): number {
  const matches = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)];
  if (!matches.length) return 0;
  return Math.max(...matches.map((m) => parseInt(m[1])));
}

function applyVars(bodyText: string, vars: Record<string, string>): string {
  return bodyText.replace(/\{\{(\d+)\}\}/g, (_, n) => vars[n] || `{{${n}}}`);
}

const BLAST_SEGMENTS = [
  { key: 'all',                label: 'All Patients',         desc: 'Every registered patient with a phone number' },
  { key: 'active_6m',          label: 'Active (6 months)',    desc: 'Patients who visited in the last 6 months' },
  { key: 'visited_last_30d',   label: 'Visited last 30 days', desc: 'Patients seen this month' },
  { key: 'visited_last_90d',   label: 'Visited last 90 days', desc: 'Patients seen this quarter' },
  { key: 'no_visit_90d',       label: 'Not visited 90+ days', desc: 'Patients who haven\'t come in a while' },
  { key: 'birthday_this_month',label: 'Birthday this month',  desc: 'Patients with birthday this month' },
  { key: 'senior_citizens',    label: 'Senior Citizens (60+)', desc: 'Patients aged 60 and above' },
  { key: 'pediatric',          label: 'Pediatric (<18)',       desc: 'Children and infants' },
  { key: 'adults',             label: 'Adults (18–59)',        desc: 'Adult patients' },
  { key: 'vaccination_due',    label: 'Vaccination Due',       desc: 'Patients due for next vaccination dose' },
  { key: 'health_awareness',   label: 'Health Awareness',      desc: 'Active patients — for health tips & alerts' },
  { key: 'promotion',          label: 'Promotions',            desc: 'All patients — for offers & announcements' },
] as const;

// Meta India marketing message rate (₹ per conversation, approximate)
const META_INR_PER_MSG = 0.863;

// ── Pre-built template library ────────────────────────────────────────────────
const TEMPLATE_LIBRARY = [
  {
    category: 'Festivals',
    emoji: '🪔',
    templates: [
      { name: 'Happy Diwali', body: 'Wishing you and your family a very Happy Diwali, {{1}}! May this festival of lights bring joy, health and prosperity to your home.\n\nWarm regards,\n[Clinic Name]' },
      { name: 'Happy New Year', body: 'Happy New Year, {{1}}! Wishing you a year filled with good health and happiness.\n\nWarm regards,\n[Clinic Name]' },
      { name: 'Ugadi Greetings', body: 'Happy Ugadi, {{1}}! May this New Year bring you good health and prosperity.\n\nWarm regards,\n[Clinic Name]' },
      { name: 'Dussehra Wishes', body: 'Happy Dussehra, {{1}}! May the victory of good over evil bring peace and health to your life.\n\nWarm regards,\n[Clinic Name]' },
      { name: 'Eid Mubarak', body: 'Eid Mubarak, {{1}}! Wishing you and your family health, happiness and blessings this Eid.\n\nWarm regards,\n[Clinic Name]' },
      { name: 'Merry Christmas', body: 'Merry Christmas, {{1}}! Wishing you good health and joy this holiday season.\n\nWarm regards,\n[Clinic Name]' },
      { name: 'Independence Day', body: 'Happy Independence Day, {{1}}! Stay healthy and keep your family safe.\n\nWarm regards,\n[Clinic Name]' },
      { name: 'Republic Day', body: 'Happy Republic Day, {{1}}! Wishing you good health and happiness always.\n\nWarm regards,\n[Clinic Name]' },
      { name: 'Karnataka Rajyotsava', body: 'Happy Karnataka Rajyotsava, {{1}}! ಕನ್ನಡ ರಾಜ್ಯೋತ್ಸವದ ಶುಭಾಶಯಗಳು.\n\nWarm regards,\n[Clinic Name]' },
    ],
  },
  {
    category: 'Health Days',
    emoji: '🏥',
    templates: [
      { name: 'World Diabetes Day', body: 'Dear {{1}}, today is World Diabetes Day (Nov 14). Get your blood sugar checked regularly. We offer HbA1c tests at our clinic. Stay healthy!\n\n[Clinic Name]' },
      { name: 'World Heart Day', body: 'Dear {{1}}, on World Heart Day (Sep 29) — protect your heart! Regular checkups, healthy diet and exercise go a long way. Book a cardiac screening today.\n\n[Clinic Name]' },
      { name: 'World Hypertension Day', body: 'Dear {{1}}, it\'s World Hypertension Day (May 17). Know your blood pressure numbers! High BP has no symptoms — get checked today at [Clinic Name].' },
      { name: 'World Kidney Day', body: 'Dear {{1}}, on World Kidney Day — kidneys are vital! Stay hydrated, control BP and sugar. Consult us for kidney function tests.\n\n[Clinic Name]' },
      { name: 'World Immunization Week', body: 'Dear {{1}}, World Immunization Week is here! Is your family\'s vaccination schedule up to date? Contact [Clinic Name] for a complete vaccine check-up.' },
      { name: 'National Doctors Day', body: 'Thank you for trusting us, {{1}}! On National Doctors Day (Jul 1) we renew our commitment to your health and well-being.\n\n[Clinic Name]' },
      { name: "Children's Day", body: 'Happy Children\'s Day, {{1}}! Healthy children, healthy future. Schedule your child\'s annual health check-up at [Clinic Name] today.' },
      { name: 'Breast Cancer Awareness', body: 'Dear {{1}}, October is Breast Cancer Awareness Month. Early detection saves lives — schedule a screening consultation at [Clinic Name] today.' },
    ],
  },
  {
    category: 'Healthcare',
    emoji: '💉',
    templates: [
      { name: 'Free Health Camp', body: 'Dear {{1}}, [Clinic Name] is organising a FREE Health Check-up Camp on [Date]. Includes BP, Sugar, BMI check. Register now — limited slots!\n\nCall: [Phone]' },
      { name: 'Vaccination Drive', body: 'Dear {{1}}, [Clinic Name] is conducting a Vaccination Drive on [Date]. Protect yourself and your family. Book your slot now!\n\nCall: [Phone]' },
      { name: 'Dengue Awareness', body: 'Dear {{1}}, Dengue is spreading this season. Symptoms: fever, rash, joint pain. Do not ignore! Visit [Clinic Name] for early testing and treatment.' },
      { name: 'Monsoon Precautions', body: 'Dear {{1}}, monsoon season brings infections! Drink clean water, avoid street food and use mosquito protection. Stay safe — [Clinic Name] is here for you.' },
      { name: "Women's Health Camp", body: 'Dear {{1}}, [Clinic Name] is hosting a Women\'s Health Camp on [Date]. Free consultations on gynaecology, PCOS, thyroid and more. Register now!' },
      { name: 'Eye Camp', body: 'Dear {{1}}, FREE Eye Check-up Camp at [Clinic Name] on [Date]. Get your vision tested by specialists. Limited slots — call [Phone] to register.' },
      { name: 'Health Package Offer', body: 'Dear {{1}}, [Clinic Name] is offering a comprehensive health package at a special price this month. Includes blood work, ECG and consultation. Call us today!' },
      { name: 'Seasonal Flu Advisory', body: 'Dear {{1}}, flu season is here. Wash hands frequently, avoid crowded places and get a flu shot. [Clinic Name] has flu vaccines available — walk in anytime.' },
    ],
  },
  {
    category: 'Seasonal',
    emoji: '☔',
    templates: [
      { name: 'Monsoon Fever Alert', body: 'Dear {{1}}, monsoon fevers (Dengue, Typhoid, Malaria) are on the rise. Stay hydrated, use mosquito nets and visit us at the first sign of fever.\n\n[Clinic Name]' },
      { name: 'Summer Heat Advisory', body: 'Dear {{1}}, beat the summer heat! Drink 3+ litres of water daily, avoid direct sun from 12–4 PM. If you feel dizzy or get heat stroke, visit [Clinic Name] immediately.' },
      { name: 'Winter Wellness', body: 'Dear {{1}}, winter is here — take care of your health! Dress warmly, get your flu shot and keep up with your medications. [Clinic Name] is open all days.' },
      { name: 'Post-Diwali Health', body: 'Dear {{1}}, the celebrations are over — time to detox! If you have respiratory issues from fireworks smoke or acidity from sweets, visit [Clinic Name].' },
    ],
  },
] as const;

function BroadcastTab() {
  const toast = useToast();
  const qc = useQueryClient();

  const { data: accounts = [] } = useQuery({ queryKey: ['wa:accounts'], queryFn: () => window.electronAPI.wa.accounts() });
  const activeAccountId: number | null = (accounts as any[])[0]?.id ?? null;

  const { data: templates = [] } = useQuery({
    queryKey: ['wa:templates', activeAccountId],
    queryFn: () => activeAccountId ? window.electronAPI.wa.templates(activeAccountId) : [],
    enabled: !!activeAccountId,
  });

  const approved = (templates as any[]).filter((t) => t.status === 'APPROVED');

  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [segment, setSegment] = useState<string>('all');
  const [vars, setVars] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [libCategory, setLibCategory] = useState(0);
  const [showLib, setShowLib] = useState(true);

  // Schedule state
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('now');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('08:00');

  const { data: previewPatients = [], isFetching: previewing } = useQuery({
    queryKey: ['wa:campaignPreview', activeAccountId, segment],
    queryFn: () => activeAccountId ? window.electronAPI.wa.campaignPreview(activeAccountId, segment) : [],
    enabled: !!activeAccountId && !!selectedTemplate,
  });

  const { data: recentCampaigns = [] } = useQuery({
    queryKey: ['wa:campaigns', activeAccountId],
    queryFn: () => activeAccountId ? window.electronAPI.wa.campaigns(activeAccountId) : [],
    enabled: !!activeAccountId,
    refetchInterval: 15_000,
  });

  const patientCount = (previewPatients as any[]).length;
  const bodyText = selectedTemplate ? getBodyText(selectedTemplate) : '';
  const varCount = extractVarCount(bodyText);
  const preview = bodyText ? applyVars(bodyText, vars) : '';
  const segmentLabel = BLAST_SEGMENTS.find((s) => s.key === segment)?.label ?? segment;
  const estimatedCost = (patientCount * META_INR_PER_MSG).toFixed(0);

  const create = useMutation({
    mutationFn: () => {
      const templateVars: Record<string, string> = {};
      for (let i = 1; i <= varCount; i++) templateVars[String(i)] = vars[String(i)] || '';
      const now = new Date();
      const name = `${selectedTemplate.name} — ${now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`;
      const scheduled_at = scheduleMode === 'later' && scheduleDate
        ? `${scheduleDate}T${scheduleTime}:00`
        : undefined;
      return window.electronAPI.wa.campaignCreate(activeAccountId!, {
        name,
        template_name: selectedTemplate.name,
        template_vars: Object.keys(templateVars).length ? templateVars : undefined,
        segment,
        scheduled_at,
      });
    },
    onSuccess: async (r) => {
      if (!r.ok) { toast(r.error ?? 'Failed to create broadcast', 'error'); return; }
      if (scheduleMode === 'later') {
        toast(`Broadcast scheduled for ${scheduleDate} at ${scheduleTime}`);
      } else {
        const launchResult = await window.electronAPI.wa.campaignLaunch(r.id!);
        if (launchResult.ok) {
          toast(`Sending to ${launchResult.total} patients — messages go out in batches`);
        } else {
          toast(launchResult.error ?? 'Launch failed', 'error');
        }
      }
      setConfirming(false);
      setSelectedTemplate(null);
      setVars({});
      setScheduleMode('now');
      qc.invalidateQueries({ queryKey: ['wa:campaigns', activeAccountId] });
    },
    onError: (e: any) => toast(e.message || 'Failed', 'error'),
  });

  if (!activeAccountId) {
    return <div className="card p-8 text-center"><p className="text-sm text-gray-500 dark:text-slate-400">Connect a WhatsApp number first (Connect tab).</p></div>;
  }

  return (
    <div className="space-y-4">

      {/* ── Confirm modal ── */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <Megaphone className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-800 dark:text-slate-100">
                  {scheduleMode === 'later' ? 'Schedule broadcast?' : 'Send broadcast now?'}
                </p>
                <p className="text-xs text-gray-500 dark:text-slate-400">This cannot be undone</p>
              </div>
            </div>
            <div className="bg-gray-50 dark:bg-slate-800 rounded-xl p-4 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-gray-500 dark:text-slate-400">Template</span>
                <span className="font-medium text-gray-800 dark:text-slate-200">{selectedTemplate?.name}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500 dark:text-slate-400">Recipients</span>
                <span className="font-semibold text-green-600 dark:text-green-400">{patientCount} patients</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500 dark:text-slate-400">Segment</span>
                <span className="font-medium text-gray-800 dark:text-slate-200">{segmentLabel}</span>
              </div>
              {scheduleMode === 'later' && scheduleDate && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500 dark:text-slate-400">Scheduled for</span>
                  <span className="font-medium text-blue-600 dark:text-blue-400">{scheduleDate} at {scheduleTime}</span>
                </div>
              )}
              <div className="flex justify-between text-xs border-t border-gray-200 dark:border-slate-700 pt-2">
                <span className="text-gray-500 dark:text-slate-400">Est. WhatsApp cost</span>
                <span className="font-medium text-amber-600 dark:text-amber-400">≈ ₹{estimatedCost}</span>
              </div>
              {preview && (
                <div className="mt-1 border-t border-gray-200 dark:border-slate-700 pt-2">
                  <p className="text-[10px] text-gray-400 dark:text-slate-500 mb-1">Message preview</p>
                  <p className="text-xs text-gray-700 dark:text-slate-300 whitespace-pre-wrap line-clamp-4">{preview}</p>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button className="flex-1 btn-primary py-2.5" disabled={create.isPending} onClick={() => create.mutate()}>
                {create.isPending
                  ? (scheduleMode === 'later' ? 'Scheduling…' : 'Sending…')
                  : scheduleMode === 'later'
                    ? `Schedule for ${scheduleDate}`
                    : `Yes, send to ${patientCount} patients`}
              </button>
              <button className="btn-ghost px-4" onClick={() => setConfirming(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Template Library ── */}
      <div className="card overflow-hidden">
        <button
          className="w-full flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors"
          onClick={() => setShowLib(v => !v)}
        >
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-violet-500" />
            <span className="font-semibold text-sm text-gray-800 dark:text-slate-100">Template Library</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 font-medium">
              {TEMPLATE_LIBRARY.reduce((n, c) => n + c.templates.length, 0)} templates
            </span>
          </div>
          <ChevronDown className={cn('w-4 h-4 text-gray-400 transition-transform', showLib && 'rotate-180')} />
        </button>

        {showLib && (
          <div className="border-t border-gray-100 dark:border-slate-700/60">
            {/* Category tabs */}
            <div className="flex gap-1 p-3 pb-0 overflow-x-auto">
              {TEMPLATE_LIBRARY.map((cat, i) => (
                <button
                  key={cat.category}
                  onClick={() => setLibCategory(i)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors shrink-0',
                    libCategory === i
                      ? 'bg-violet-600 text-white'
                      : 'text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800',
                  )}
                >
                  {TEMPLATE_LIBRARY[i].emoji} {cat.category}
                </button>
              ))}
            </div>
            <div className="p-3 grid grid-cols-1 gap-2 max-h-64 overflow-y-auto">
              {TEMPLATE_LIBRARY[libCategory].templates.map((t) => {
                const matchedMeta = approved.find((m: any) =>
                  m.name.toLowerCase().includes(t.name.toLowerCase().replace(/\s+/g, '_')) ||
                  m.name.toLowerCase().includes(t.name.toLowerCase().replace(/\s+/g, ''))
                );
                return (
                  <div key={t.name} className="border border-gray-200 dark:border-slate-700 rounded-lg p-3 bg-gray-50 dark:bg-slate-800/40">
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <p className="text-xs font-semibold text-gray-700 dark:text-slate-200">{t.name}</p>
                      <div className="flex gap-1 shrink-0">
                        <button
                          className="text-[10px] px-2 py-1 rounded bg-gray-200 dark:bg-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-300 dark:hover:bg-slate-600 transition-colors"
                          onClick={() => { safeClipboard(t.body); toast('Message text copied'); }}
                        >
                          Copy text
                        </button>
                        {matchedMeta && (
                          <button
                            className="text-[10px] px-2 py-1 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-900/50 transition-colors"
                            onClick={() => { setSelectedTemplate(matchedMeta); setVars({}); document.getElementById('compose-section')?.scrollIntoView({ behavior: 'smooth' }); }}
                          >
                            Use template ↓
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-[10px] text-gray-400 dark:text-slate-500 whitespace-pre-wrap line-clamp-3">{t.body}</p>
                    {!matchedMeta && (
                      <p className="mt-1.5 text-[10px] text-amber-600 dark:text-amber-400">
                        Create this template in Meta Business Manager to use it
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Compose ── */}
      <div id="compose-section" className="card p-5 space-y-5">
        <div>
          <h2 className="font-semibold text-gray-800 dark:text-slate-100 flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-rose-500" /> Compose Broadcast
          </h2>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">
            Pick a segment, choose an approved template and send in one click.
          </p>
        </div>

        {/* Segment selector */}
        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-slate-400 block mb-2">Who to send to</label>
          <div className="flex flex-wrap gap-2">
            {BLAST_SEGMENTS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSegment(s.key)}
                title={s.desc}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                  segment === s.key
                    ? 'bg-green-600 text-white border-green-600'
                    : 'border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:border-green-400 hover:text-green-700 dark:hover:text-green-400',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
          {selectedTemplate && (
            <p className="mt-2 text-xs text-gray-400 dark:text-slate-500">
              {previewing
                ? 'Counting…'
                : <><span className="font-semibold text-gray-700 dark:text-slate-200">{patientCount}</span> patients · estimated cost <span className="text-amber-600 dark:text-amber-400 font-medium">≈ ₹{estimatedCost}</span></>}
            </p>
          )}
        </div>

        {/* Template picker */}
        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-slate-400 block mb-2">
            Choose an approved template
            {approved.length === 0 && <span className="ml-2 text-amber-500"> — none approved yet (create in Meta &amp; sync)</span>}
          </label>
          {approved.length > 0 ? (
            <div className="space-y-2">
              {approved.map((t: any) => {
                const body = getBodyText(t);
                const isSelected = selectedTemplate?.id === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => { setSelectedTemplate(isSelected ? null : t); setVars({}); }}
                    className={cn(
                      'w-full text-left rounded-xl border p-3.5 transition-all',
                      isSelected
                        ? 'border-green-500 bg-green-50 dark:bg-green-900/15 ring-1 ring-green-500'
                        : 'border-gray-200 dark:border-slate-700 hover:border-green-300 dark:hover:border-green-700 bg-white dark:bg-slate-800/50',
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        'w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5',
                        isSelected ? 'border-green-600 bg-green-600' : 'border-gray-300 dark:border-slate-600',
                      )}>
                        {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-800 dark:text-slate-100">{t.name}</p>
                        {body && <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 line-clamp-2 whitespace-pre-wrap">{body}</p>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="border-2 border-dashed border-gray-200 dark:border-slate-700 rounded-xl p-6 text-center">
              <ListChecks className="w-6 h-6 text-gray-300 dark:text-slate-600 mx-auto mb-2" />
              <p className="text-xs text-gray-400 dark:text-slate-500">Go to Templates tab → Sync from Meta once your templates are approved</p>
            </div>
          )}
        </div>

        {/* Variable inputs */}
        {selectedTemplate && varCount > 0 && (
          <div className="space-y-3">
            <label className="text-xs font-medium text-gray-600 dark:text-slate-400 block">Fill in the message variables</label>
            {Array.from({ length: varCount }, (_, i) => i + 1).map((n) => (
              <div key={n}>
                <label className="text-xs text-gray-500 dark:text-slate-400 block mb-1">
                  {`{{${n}}}`}
                  {n === 1 && <span className="ml-1 text-gray-400">(leave blank to use patient name)</span>}
                </label>
                <input
                  className="input w-full"
                  placeholder={n === 1 ? 'e.g. Wishing you a Happy Diwali!' : `Variable ${n}`}
                  value={vars[String(n)] ?? ''}
                  onChange={(e) => setVars((v) => ({ ...v, [String(n)]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        )}

        {/* Preview */}
        {selectedTemplate && preview && (
          <div className="bg-[#dcf8c6] dark:bg-green-900/20 rounded-xl p-4">
            <p className="text-[10px] font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-2">Message Preview</p>
            <p className="text-sm text-gray-800 dark:text-slate-100 whitespace-pre-wrap leading-relaxed">{preview}</p>
            <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-2">{'{{1}}'} resolves to each patient&apos;s name if left blank</p>
          </div>
        )}

        {/* Schedule toggle */}
        {selectedTemplate && (
          <div>
            <label className="text-xs font-medium text-gray-600 dark:text-slate-400 block mb-2">When to send</label>
            <div className="flex gap-2 mb-3">
              {(['now', 'later'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setScheduleMode(m)}
                  className={cn(
                    'px-4 py-2 rounded-lg text-xs font-medium border transition-colors',
                    scheduleMode === m
                      ? 'bg-green-600 text-white border-green-600'
                      : 'border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300',
                  )}
                >
                  {m === 'now' ? 'Send Now' : 'Schedule for Later'}
                </button>
              ))}
            </div>
            {scheduleMode === 'later' && (
              <div className="flex gap-3">
                <input
                  type="date"
                  className="input flex-1"
                  value={scheduleDate}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setScheduleDate(e.target.value)}
                />
                <input
                  type="time"
                  className="input w-32"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                />
              </div>
            )}
          </div>
        )}

        {/* Send / Schedule button */}
        <button
          className={cn(
            'w-full py-3 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2',
            selectedTemplate && (scheduleMode === 'now' ? patientCount > 0 : scheduleDate)
              ? 'bg-green-600 hover:bg-green-700 text-white shadow-lg shadow-green-200 dark:shadow-green-900/30'
              : 'bg-gray-100 dark:bg-slate-800 text-gray-400 dark:text-slate-500 cursor-not-allowed',
          )}
          disabled={!selectedTemplate || (scheduleMode === 'now' ? patientCount === 0 : !scheduleDate) || previewing}
          onClick={() => setConfirming(true)}
        >
          <Megaphone className="w-4 h-4" />
          {!selectedTemplate
            ? 'Select a template above'
            : scheduleMode === 'later'
              ? scheduleDate ? `Schedule for ${scheduleDate} at ${scheduleTime}` : 'Pick a date to schedule'
              : previewing
                ? 'Counting patients…'
                : `Send to ${patientCount} patients (≈ ₹${estimatedCost})`}
        </button>
      </div>

      {/* ── Recent broadcasts ── */}
      {(recentCampaigns as any[]).length > 0 && (
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-3">Recent Broadcasts</h3>
          <div className="space-y-0">
            {(recentCampaigns as any[]).slice(0, 10).map((c: any) => (
              <div key={c.id} className="flex items-center gap-3 py-2.5 border-b border-gray-100 dark:border-slate-700/50 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-700 dark:text-slate-200 truncate">{c.name}</p>
                  <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5">
                    {c.sent_count}/{c.total_count} sent
                    {c.scheduled_at && c.status === 'draft' && ` · scheduled ${new Date(c.scheduled_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} ${c.scheduled_at.slice(11, 16)}`}
                    {c.completed_at && ` · ${new Date(c.completed_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {c.status === 'completed' && c.total_count > 0 && (
                    <span className="text-[10px] text-gray-400 dark:text-slate-500 font-mono">
                      {Math.round(c.sent_count / c.total_count * 100)}%
                    </span>
                  )}
                  <span className={cn(
                    'text-[10px] px-2 py-0.5 rounded-full font-medium',
                    c.status === 'completed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                    : c.status === 'running'  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                    : c.status === 'failed'   ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    : c.scheduled_at ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400'
                    : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300',
                  )}>
                    {c.status === 'draft' && c.scheduled_at ? 'scheduled' : c.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Setup Guide Panel ─────────────────────────────────────────────────────────
function GuidePanel({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['setup']));

  const toggleSection = (id: string) =>
    setOpenSections((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const copyText = (text: string, label: string) => {
    safeClipboard(text);
    toast(`${label} copied`);
  };

  type AccordionProps = { id: string; icon: React.ReactNode; iconColor: string; title: string; children: React.ReactNode };
  const Accordion = ({ id, icon, iconColor, title, children }: AccordionProps) => {
    const isOpen = openSections.has(id);
    return (
      <div className="border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden">
        <button
          className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-slate-800/40 transition-colors"
          onClick={() => toggleSection(id)}
        >
          <span className={cn('w-6 h-6 rounded-md flex items-center justify-center shrink-0', iconColor)}>{icon}</span>
          <span className="flex-1 text-sm font-semibold text-gray-800 dark:text-slate-100">{title}</span>
          <ChevronDown className={cn('w-4 h-4 text-gray-400 shrink-0 transition-transform', isOpen && 'rotate-180')} />
        </button>
        {isOpen && (
          <div className="px-4 pb-4 pt-1 border-t border-gray-100 dark:border-slate-700/50 text-xs text-gray-600 dark:text-slate-300 space-y-3">
            {children}
          </div>
        )}
      </div>
    );
  };

  const Q = ({ q, children }: { q: string; children: React.ReactNode }) => (
    <div>
      <p className="font-semibold text-gray-700 dark:text-slate-200 mb-1">Q: {q}</p>
      <div className="text-gray-500 dark:text-slate-400 space-y-1">{children}</div>
    </div>
  );

  const Step = ({ n, children }: { n: number; children: React.ReactNode }) => (
    <div className="flex gap-2.5">
      <span className="shrink-0 w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-[10px] font-bold flex items-center justify-center mt-0.5">{n}</span>
      <span>{children}</span>
    </div>
  );

  const Tip = ({ children }: { children: React.ReactNode }) => (
    <div className="bg-blue-50 dark:bg-blue-900/15 border border-blue-100 dark:border-blue-800 rounded-lg px-3 py-2 text-blue-700 dark:text-blue-300">
      <span className="font-semibold">Tip: </span>{children}
    </div>
  );

  const Warn = ({ children }: { children: React.ReactNode }) => (
    <div className="bg-amber-50 dark:bg-amber-900/15 border border-amber-100 dark:border-amber-800 rounded-lg px-3 py-2 text-amber-700 dark:text-amber-300">
      <span className="font-semibold">Note: </span>{children}
    </div>
  );

  const Code = ({ children }: { children: React.ReactNode }) => (
    <code className="bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 px-1.5 py-0.5 rounded text-[10px] font-mono">{children}</code>
  );

  return (
    <div className="fixed inset-y-0 right-0 w-[420px] z-50 flex flex-col shadow-2xl bg-white dark:bg-slate-900 border-l border-gray-200 dark:border-slate-700">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-slate-700 shrink-0 bg-green-50 dark:bg-green-900/20">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-green-600" />
          <span className="font-bold text-sm text-gray-800 dark:text-slate-100">WhatsApp Help Guide</span>
        </div>
        <button className="p-1.5 rounded-lg hover:bg-white/60 dark:hover:bg-slate-800 text-gray-400" onClick={onClose}>
          <X className="w-4 h-4" />
        </button>
      </div>
      <p className="px-4 py-2 text-[11px] text-gray-400 dark:text-slate-500 bg-gray-50 dark:bg-slate-800/50 border-b border-gray-100 dark:border-slate-700/50 shrink-0">
        Click any section to expand it. All common questions are covered here.
      </p>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2.5">

        {/* ── OVERVIEW ── */}
        <Accordion id="overview" icon={<MessageSquare className="w-3.5 h-3.5" />} iconColor="bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400" title="What is this? (Read first)">
          <p>CureDesk connects to <strong>WhatsApp Business Cloud API</strong> — the same technology used by banks, hospitals and e-commerce companies to send WhatsApp messages at scale.</p>
          <p>This is <strong>not</strong> your personal WhatsApp. It uses a dedicated business number registered with Meta (WhatsApp's parent company). Every message goes directly through WhatsApp's official servers.</p>
          <p><strong>What you can do:</strong></p>
          <ul className="space-y-0.5 pl-3">
            <li>• Send automatic appointment reminders, prescriptions, bills</li>
            <li>• Broadcast Diwali wishes, health camps, offers to all patients</li>
            <li>• Receive and reply to patient messages in the Inbox</li>
            <li>• Ask patients for Google reviews</li>
            <li>• Get AI help writing replies</li>
          </ul>
          <p><strong>What you need:</strong></p>
          <ul className="space-y-0.5 pl-3">
            <li>• A Facebook / Meta Business account (free)</li>
            <li>• A phone number to use as your WhatsApp Business number (can be a new SIM or existing landline)</li>
            <li>• Internet connection on the computer running CureDesk</li>
          </ul>
          <Tip>You may be able to use your existing WhatsApp Business App number here. After connecting, open the WhatsApp Business App — if it still works, Meta has enabled <strong>coexistence</strong> and you keep both. If the app stops, you'll need a new number for the API. When in doubt, try your existing number first.</Tip>
        </Accordion>

        {/* ── SETUP ── */}
        <Accordion id="setup" icon={<PlugZap className="w-3.5 h-3.5" />} iconColor="bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400" title="Setup — Step by Step">
          <p className="font-semibold text-gray-700 dark:text-slate-200">Step 1 — Create a Meta app and get your credentials</p>
          <Step n={1}>Go to <strong>developers.facebook.com</strong> and log in with your Facebook account.</Step>
          <Step n={2}>Click <strong>My Apps → Create App → Business</strong>. Give it any name (e.g. "Clinic WhatsApp").</Step>
          <Step n={3}>Inside the app, click <strong>Add Product</strong> → find <strong>WhatsApp</strong> → click Set Up.</Step>
          <Step n={4}>You'll see a panel called <strong>WhatsApp → API Setup</strong>. Note down:
            <ul className="mt-1 ml-2 space-y-0.5">
              <li>• <strong>Phone Number ID</strong> (looks like: 123456789012345)</li>
              <li>• <strong>WhatsApp Business Account ID</strong> (WABA ID)</li>
            </ul>
          </Step>
          <Step n={5}>Go to <strong>Business Settings → System Users → Add</strong>. Create a user with Admin role. Click <strong>Generate New Token</strong>, select your app, enable <Code>whatsapp_business_messaging</Code> and <Code>whatsapp_business_management</Code> permissions. Copy the token — this is your <strong>Access Token</strong>.</Step>
          <Warn>The temporary access token shown on the API Setup page expires in 24 hours. Always generate a Permanent token via System Users — otherwise automation will stop working.</Warn>
          <Q q="Can I use my existing clinic WhatsApp number?">
            <p>Possibly yes — Meta introduced <strong>coexistence mode</strong> in 2023, which lets some accounts use the same number on both the WhatsApp Business App and the Cloud API simultaneously.</p>
            <p className="mt-1"><strong>How to check:</strong> Connect your existing number using the steps above. Then open the WhatsApp Business App on that phone. If the app still works normally — coexistence is on and you're good. If the app shows an error or stops working — Meta has migrated the number to API-only and you'll need a separate number.</p>
            <Tip>Try your existing number first. If it works, you save yourself a new SIM.</Tip>
          </Q>

          <p className="font-semibold text-gray-700 dark:text-slate-200 mt-1">Step 2 — Connect in CureDesk</p>
          <Step n={1}>Open the <strong>Connect</strong> tab above.</Step>
          <Step n={2}>Enter the Phone Number ID, WABA ID, and Access Token you just copied.</Step>
          <Step n={3}>Enter your clinic's display name and the WhatsApp phone number.</Step>
          <Step n={4}>Click <strong>Connect</strong>. The status turns green if successful.</Step>

          <p className="font-semibold text-gray-700 dark:text-slate-200 mt-1">Step 3 — Register Webhook (one-time)</p>
          <Step n={1}>In the Connect tab, scroll to the <strong>Webhook</strong> section. Copy the Webhook URL and Verify Token.</Step>
          <Step n={2}>Go to <strong>Meta Developer Console → your app → WhatsApp → Configuration → Webhooks</strong>.</Step>
          <Step n={3}>Click Edit → paste the Webhook URL and Verify Token → click Verify and Save.</Step>
          <Step n={4}>Subscribe to the <strong>messages</strong> field.</Step>
          <Tip>This step is needed so CureDesk receives incoming messages and delivery receipts. Without it the Inbox won't show patient replies.</Tip>
        </Accordion>

        {/* ── TEMPLATES ── */}
        <Accordion id="templates" icon={<ListChecks className="w-3.5 h-3.5" />} iconColor="bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400" title="Message Templates — Everything You Need to Know">
          <Q q="What is a template?">
            <p>A template is a pre-written message format that Meta reviews and approves before you can send it. Think of it like a stamp of approval — Meta wants to make sure businesses aren't sending spam.</p>
            <p>Templates are used for all outgoing messages <strong>outside</strong> the 24-hour window (appointment reminders, broadcast messages, etc.).</p>
          </Q>
          <Q q="Why does Meta need to approve my template?">
            <p>Meta's policy: businesses can only initiate WhatsApp conversations using approved templates. This prevents spam. Utility messages (appointment reminders, prescriptions) get approved easily. Marketing messages (offers, camp announcements) take longer and must follow stricter rules.</p>
          </Q>
          <Q q="How do I create a template?">
            <Step n={1}>Go to <strong>Meta Business Manager</strong> (business.facebook.com) → <strong>WhatsApp Manager → Message Templates → Create Template</strong>.</Step>
            <Step n={2}>Choose a category: <strong>Utility</strong> (for transactional messages like appointment reminders) or <strong>Marketing</strong> (for promotional messages like camps, offers).</Step>
            <Step n={3}>Write your message. Use <Code>{'{{1}}'}</Code>, <Code>{'{{2}}'}</Code> etc. for dynamic parts (patient name, date, etc.).</Step>
            <Step n={4}>Submit for review. Utility templates usually approve in a few hours. Marketing can take 24–48 hours.</Step>
            <Step n={5}>Once approved, go to the <strong>Templates</strong> tab in CureDesk and click <strong>Sync from Meta</strong>.</Step>
          </Q>
          <Q q="What are {{1}}, {{2}} variables?">
            <p>These are placeholders that get replaced with real patient data when the message is sent. For example:</p>
            <p>Template: <em>"Hello <Code>{'{{1}}'}</Code>, your appointment on <Code>{'{{2}}'}</Code> at <Code>{'{{3}}'}</Code> is confirmed."</em></p>
            <p>Sent as: <em>"Hello Ravi Sharma, your appointment on 15 Jan at 10:30 AM is confirmed."</em></p>
            <p><strong>Variable reference for each automation:</strong></p>
            <div className="bg-gray-50 dark:bg-slate-800 rounded-lg p-2 space-y-1.5 mt-1">
              {[
                { t: 'Appointment reminders', v: '{{1}} Patient name · {{2}} Doctor · {{3}} Date · {{4}} Time' },
                { t: 'Prescription ready', v: '{{1}} Patient name · {{2}} Doctor name' },
                { t: 'Lab report ready', v: '{{1}} Patient name' },
                { t: 'Bill generated', v: '{{1}} Patient name · {{2}} Bill total · {{3}} Payment mode' },
                { t: 'Follow-up reminder', v: '{{1}} Patient name · {{2}} Follow-up date' },
                { t: 'Birthday wish', v: '{{1}} Patient name' },
                { t: 'Feedback / Rate Us', v: '{{1}} Patient name' },
                { t: 'Vaccination reminder', v: '{{1}} Patient name' },
                { t: 'Broadcast / Campaign', v: '{{1}} Patient name (auto) · rest you fill in' },
              ].map((r) => (
                <div key={r.t}>
                  <p className="font-medium text-gray-700 dark:text-slate-200 text-[10px]">{r.t}</p>
                  <p className="text-gray-400 dark:text-slate-500 text-[10px]">{r.v}</p>
                </div>
              ))}
            </div>
          </Q>
          <Q q="My template was rejected. What do I do?">
            <p>Common rejection reasons:</p>
            <ul className="space-y-0.5 pl-3">
              <li>• Contains too much promotional language in a Utility template → change category to Marketing</li>
              <li>• Mentions competitor brands</li>
              <li>• Template text is too vague</li>
              <li>• Has external links that look suspicious</li>
            </ul>
            <p className="mt-1">Fix the issue and resubmit. You can also appeal the rejection directly in Meta Business Manager.</p>
          </Q>
          <Q q="How many templates can I have?">
            <p>Meta allows up to 250 active approved templates per WhatsApp Business Account on the free tier.</p>
          </Q>
        </Accordion>

        {/* ── AUTOMATION ── */}
        <Accordion id="automation" icon={<Zap className="w-3.5 h-3.5" />} iconColor="bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400" title="Automation — How Each Trigger Works">
          <p>Go to the <strong>Automation</strong> tab, toggle on a trigger, and select which approved template to send. CureDesk handles the rest automatically.</p>
          <div className="space-y-2">
            {[
              { name: 'Appointment Confirmed', icon: '📅', when: 'Fires immediately when a new appointment is created in CureDesk OPD.', note: 'Works for walk-in and pre-booked appointments.' },
              { name: 'Reminder — 24 hours', icon: '⏰', when: 'Fires automatically ~24 hours before the appointment time.', note: 'The scheduler checks every 60 seconds so reminders are accurate within 1 minute.' },
              { name: 'Reminder — 1 hour', icon: '⏰', when: 'Fires ~1 hour before the appointment time.', note: '' },
              { name: 'Prescription Ready', icon: '💊', when: 'Fires when the doctor clicks Save on a prescription in CureDesk.', note: '' },
              { name: 'Lab Report Ready', icon: '🧪', when: 'Fires when a lab order status is changed to "Reported".', note: '' },
              { name: 'Bill Generated', icon: '🧾', when: 'Fires when reception creates a new bill. Variables include total amount and payment mode.', note: '' },
              { name: 'Follow-up Reminder', icon: '🔁', when: 'Fires 3 days before the follow-up date set on a consultation note.', note: '' },
              { name: 'Birthday Wish', icon: '🎂', when: 'Fires every morning to patients whose birthday is today (matches date of birth in patient record).', note: '' },
              { name: 'Experience & Review', icon: '⭐', when: 'Fires 2–4 hours after an appointment is marked Done. Sends a feedback + Google Review request.', note: 'Set your Google Review link in the Automation tab (Experience & Review row) or in Settings → Clinic Info.' },
              { name: 'Vaccination Reminder', icon: '💉', when: 'Fires 27–30 days after a bill that contains "vacc" in its line items (indicating a vaccination was given).', note: 'Perfect for multi-dose vaccines like Hepatitis B.' },
            ].map((t) => (
              <div key={t.name} className="bg-gray-50 dark:bg-slate-800/50 rounded-lg p-2.5">
                <p className="font-semibold text-gray-700 dark:text-slate-200 text-[11px]">{t.icon} {t.name}</p>
                <p className="text-gray-400 dark:text-slate-500 text-[10px] mt-0.5">{t.when}</p>
                {t.note && <p className="text-blue-600 dark:text-blue-400 text-[10px] mt-0.5 italic">{t.note}</p>}
              </div>
            ))}
          </div>
          <Warn>Each trigger only fires if a <strong>connected WhatsApp account</strong> exists and the trigger is <strong>toggled on</strong> with a valid approved template selected. If no template is selected, nothing is sent — no error shown.</Warn>
        </Accordion>

        {/* ── MASS MESSAGES ── */}
        <Accordion id="broadcast" icon={<Megaphone className="w-3.5 h-3.5" />} iconColor="bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400" title="Mass Messages & Broadcasts">
          <Q q="How do I send a Diwali message to all patients?">
            <Step n={1}>Go to the <strong>Mass Message</strong> tab.</Step>
            <Step n={2}>Browse the <strong>Template Library</strong> — there's a ready-made Diwali template. Click <strong>Copy text</strong>.</Step>
            <Step n={3}>Create the template in <strong>Meta Business Manager</strong> using the copied text. Wait for approval.</Step>
            <Step n={4}>Once approved, come back to Mass Message → select <strong>All Patients</strong> → pick the template → click Send.</Step>
          </Q>
          <Q q="Who receives the message?">
            <p>Only patients who have a phone number recorded in CureDesk AND who have WhatsApp on that number. If a patient doesn't have WhatsApp, the message will fail silently (shown as failed in the Queue).</p>
          </Q>
          <Q q="Can I send to a specific group of patients?">
            <p>Yes — use the segment selector:</p>
            <ul className="space-y-0.5 pl-3 mt-1">
              <li>• <strong>All Patients</strong> — everyone in the database</li>
              <li>• <strong>Active (6 months)</strong> — patients seen in the last 6 months</li>
              <li>• <strong>Senior Citizens (60+)</strong> — good for health camps</li>
              <li>• <strong>Pediatric</strong> — children's health day campaigns</li>
              <li>• <strong>Birthday this month</strong> — birthday wishes</li>
              <li>• <strong>Vaccination Due</strong> — patients 27–30 days past their last vaccination bill</li>
            </ul>
          </Q>
          <Q q="Can I schedule a message for later?">
            <p>Yes — in the Compose section, switch from <strong>Send Now</strong> to <strong>Schedule for Later</strong>, pick a date and time, then click Schedule. CureDesk will automatically send it at that time as long as the app is running.</p>
          </Q>
          <Q q="How fast does the broadcast go out?">
            <p>Messages are sent in batches of 10, with a 1-second gap between batches. For 500 patients that's about 50 seconds. For 5,000 patients it takes ~8 minutes. You don't need to stay on the page — it runs in the background.</p>
          </Q>
        </Accordion>

        {/* ── INBOX ── */}
        <Accordion id="inbox" icon={<Inbox className="w-3.5 h-3.5" />} iconColor="bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400" title="Inbox & Replying to Patients">
          <Q q="Why can't I reply to a patient?">
            <p>WhatsApp has a <strong>24-hour customer service window</strong>. You can only send a free-text reply within 24 hours of the patient's last message to you. After that window closes, you can only send a pre-approved template message (via the Queue tab).</p>
            <p className="mt-1">This is Meta's policy to prevent businesses from spamming patients. It's the same rule for all WhatsApp Business providers (WATI, Zoko, etc.).</p>
          </Q>
          <Q q="Patient replied but I don't see it in the Inbox?">
            <p>Check that the Webhook is registered correctly (Step 3 of setup). Without the webhook, CureDesk doesn't receive incoming messages. Go to Connect tab → Webhook section and verify the URL and Verify Token are saved.</p>
          </Q>
          <Q q="How do AI reply suggestions work?">
            <Step n={1}>Go to <strong>Settings → Communications → AI Reply Suggestions</strong>.</Step>
            <Step n={2}>Sign up at <strong>console.anthropic.com</strong> → API Keys → Create new key.</Step>
            <Step n={3}>Paste the key in Settings and save.</Step>
            <Step n={4}>In any Inbox conversation, click the <strong>✨ (sparkles)</strong> button. Three suggested replies appear based on the conversation context.</Step>
            <Step n={5}>Click a suggestion to fill the reply box, then send.</Step>
            <Tip>AI reads the last 10 messages. It understands medical context and suggests appropriate, professional responses in the patient's language.</Tip>
          </Q>
          <Q q="What does 'Resolved' mean?">
            <p>Marking a conversation Resolved moves it out of the active list. The conversation history is preserved. You can filter to see resolved conversations. Use it when a patient's issue has been addressed.</p>
          </Q>
        </Accordion>

        {/* ── RATE US ── */}
        <Accordion id="review" icon={<Star className="w-3.5 h-3.5" />} iconColor="bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400" title="Google Review / Rate Us">
          <Q q="How do I get my clinic's Google Review link?">
            <Step n={1}>Go to <strong>business.google.com</strong> and log in with the Google account linked to your clinic.</Step>
            <Step n={2}>Find your clinic's Business Profile → click <strong>Get more reviews</strong> (or "Share review form").</Step>
            <Step n={3}>Google will show you a short link like <Code>g.page/r/XXXXXX/review</Code>.</Step>
            <Step n={4}>Copy that link.</Step>
            <Step n={5}>Open <strong>Settings → Clinic Info → Google Review URL</strong> in CureDesk and paste it. Save.</Step>
          </Q>
          <Q q="How do I send a Rate Us request to a patient?">
            <p>Three ways:</p>
            <ul className="space-y-1 pl-3">
              <li>• <strong>Module 1 — Manual quick send</strong>: Switch to <strong>WhatsApp Business</strong> (Module 1), select <strong>Google Review Request</strong> as the message type, enter the patient's number, and click Open in WhatsApp. You press Send in the app.</li>
              <li>• <strong>Module 2 — Inbox button</strong>: Open a conversation in the Inbox → click the <strong>⭐ Rate Us</strong> button in the conversation header.</li>
              <li>• <strong>Module 2 — Automated</strong>: Enable the <strong>Experience & Review</strong> trigger in the Automation tab. Sends automatically 2–4 hours after every appointment completion — no action needed.</li>
            </ul>
          </Q>
          <Q q="Where do I set the Google Review link?">
            <p>Two places — both save to the same setting:</p>
            <ul className="space-y-1 pl-3 mt-1">
              <li>• <strong>In WhatsApp</strong>: Module 1 → select Google Review Request → the link field appears below the message preview. Or Module 2 → Automation tab → Experience & Review row has a link field.</li>
              <li>• <strong>In Settings</strong>: Settings → Clinic Info → Google Review URL.</li>
            </ul>
          </Q>
          <Warn>Module 1 uses a free-text message (not a template), so it opens WhatsApp for you to press Send manually. Module 2's automation trigger uses an approved Meta template so it sends itself anytime, no window restriction.</Warn>
        </Accordion>

        {/* ── PRICING ── */}
        <Accordion id="pricing" icon={<BarChart2 className="w-3.5 h-3.5" />} iconColor="bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400" title="Pricing & Message Limits">
          <Q q="How much does WhatsApp cost?">
            <p>Meta charges per <strong>conversation</strong> (a 24-hour session, not per message). Rates for India:</p>
            <div className="bg-gray-50 dark:bg-slate-800 rounded-lg p-3 mt-1 space-y-1.5">
              <div className="flex justify-between text-[11px]">
                <span className="text-gray-600 dark:text-slate-300 font-medium">Marketing (offers, campaigns)</span>
                <span className="font-mono text-amber-600 dark:text-amber-400">≈ ₹0.86/msg</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-gray-600 dark:text-slate-300 font-medium">Utility (reminders, prescriptions)</span>
                <span className="font-mono text-green-600 dark:text-green-400">≈ ₹0.14/msg</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-gray-600 dark:text-slate-300 font-medium">Service (replies to patient)</span>
                <span className="font-mono text-green-600 dark:text-green-400">Free (first 1000/month)</span>
              </div>
            </div>
            <p className="mt-1.5">Example: sending a Diwali message to 1,000 patients ≈ ₹860. CureDesk shows you the estimated cost before you broadcast.</p>
          </Q>
          <Q q="How many messages can I send per day?">
            <p>Meta has tier-based limits:</p>
            <ul className="space-y-0.5 pl-3">
              <li>• New account: <strong>1,000 unique users per day</strong></li>
              <li>• After 7+ days + good quality: auto-upgrade to <strong>10,000/day</strong></li>
              <li>• Higher tiers: <strong>100,000/day</strong> and <strong>unlimited</strong></li>
            </ul>
            <p className="mt-1">Your tier upgrades automatically as you build a good messaging history (high delivery rate, low blocks).</p>
          </Q>
          <Q q="What's free?">
            <p>Meta gives you <strong>1,000 free service conversations per month</strong> (patient-initiated). The first 250 template messages are free for new accounts. After that, standard rates apply.</p>
          </Q>
        </Accordion>

        {/* ── TROUBLESHOOTING ── */}
        <Accordion id="troubleshoot" icon={<AlertCircle className="w-3.5 h-3.5" />} iconColor="bg-red-100 dark:bg-red-900/30 text-red-500 dark:text-red-400" title="Troubleshooting — Common Problems">
          <Q q="Status shows 'Connected' but messages are not sending?">
            <ul className="space-y-0.5 pl-3">
              <li>• Check the <strong>Queue</strong> tab — messages may be in "failed" status with an error message</li>
              <li>• Verify the Access Token hasn't expired (generate a Permanent token via System Users)</li>
              <li>• Make sure the phone number hasn't been banned by Meta (check Meta Business Manager)</li>
              <li>• Check if the patient's number has WhatsApp — if not, it will fail</li>
            </ul>
          </Q>
          <Q q="Status is not turning green after entering credentials?">
            <ul className="space-y-0.5 pl-3">
              <li>• Double-check the Phone Number ID and WABA ID — they're different numbers, easy to mix up</li>
              <li>• Make sure the Access Token has both permissions: <Code>whatsapp_business_messaging</Code> and <Code>whatsapp_business_management</Code></li>
              <li>• The token must be for a System User, not a temporary test token</li>
            </ul>
          </Q>
          <Q q="Patient messages are not appearing in the Inbox?">
            <ul className="space-y-0.5 pl-3">
              <li>• Verify the Webhook is registered in Meta Developer Console</li>
              <li>• Confirm you subscribed to the <strong>messages</strong> field in the webhook</li>
              <li>• Check that the Verify Token in CureDesk matches what you entered in Meta</li>
              <li>• The Connect tab must show "Active" in the Webhook section</li>
            </ul>
          </Q>
          <Q q="Automation triggers are set up but nothing is sending?">
            <ul className="space-y-0.5 pl-3">
              <li>• Confirm the trigger is <strong>toggled on</strong> (green) in the Automation tab</li>
              <li>• Confirm a valid <strong>approved</strong> template is selected for that trigger</li>
              <li>• The patient must have a phone number in their profile</li>
              <li>• Check the Queue tab — the message may have failed with an error</li>
            </ul>
          </Q>
          <Q q="AI suggestions (✨) not working?">
            <ul className="space-y-0.5 pl-3">
              <li>• Verify the Anthropic API key is saved in <strong>Settings → Communications → AI Reply Suggestions</strong></li>
              <li>• Make sure the key starts with <Code>sk-ant-</Code></li>
              <li>• Check your Anthropic account has credits (console.anthropic.com → Billing)</li>
            </ul>
          </Q>
          <Q q="Template approval is taking too long?">
            <p>Utility templates usually approve in 1–6 hours. Marketing templates can take 24–48 hours. If it's been more than 3 days, check Meta Business Manager for any rejection messages. You can also contact Meta Business Support.</p>
          </Q>
          <Q q="Getting 'message_send_failed' errors?">
            <p>Common causes: invalid phone number format (must include country code, e.g. 919876543210 for India), number not on WhatsApp, account temporarily blocked, or template not yet approved.</p>
          </Q>
        </Accordion>

      </div>
    </div>
  );
}

// ── Module 1 — WhatsApp Business App ─────────────────────────────────────────
// Default message templates — variables: {{patient_name}} {{doctor_name}} {{date}} {{time}} {{token}} {{clinic_name}} {{clinic_phone}} {{clinic_address}} {{review_link}}
const M1_TEMPLATES_KEY = 'curedesk_wa_m1_templates_v1';
const DEFAULT_M1_TEMPLATES: Record<string, string> = {
  confirmed:  `Namaste {{patient_name}} 🙏\n\nYour appointment at *{{clinic_name}}* is confirmed!\n\n👨‍⚕️ *Doctor:* {{doctor_name}}\n📅 *Date:* {{date}}  🕒 *Time:* {{time}}\n🎟️ *Token:* #{{token}}\n\nPlease arrive 10 minutes early.\n\n📍 {{clinic_address}}\n☎️ {{clinic_phone}}\n\nThank you,\n*{{clinic_name}}*`,
  visit_done: `Hello {{patient_name}} 👋\n\nThank you for visiting *{{clinic_name}}* today! We hope you had a wonderful experience.\n\nFor any follow-up or queries, please call us at {{clinic_phone}}.\n\nTake care! 🙏\n*{{clinic_name}}*`,
  review:     `Hello {{patient_name}} 👋\n\nThank you for visiting *{{clinic_name}}*! 🙏\n\nWe'd love to hear about your experience — could you spare a moment to leave us a Google review?\n\n⭐ {{review_link}}\n\nYour feedback means a lot to us. Thank you!\n*{{clinic_name}}*`,
  rx:         `Hello {{patient_name}} 👋\n\nYour prescription from *{{clinic_name}}* is ready. Please collect it at your earliest convenience.\n\nThank you,\n*{{clinic_name}}*`,
  lab:        `Hello {{patient_name}} 👋\n\nYour lab report is ready at *{{clinic_name}}*. Please collect it at your convenience.\n\nThank you,\n*{{clinic_name}}*`,
  bill:       `Hello {{patient_name}} 👋\n\nThank you for visiting *{{clinic_name}}*. Your bill is ready.\n\nFor any queries, call us at {{clinic_phone}}.\n\nThank you!`,
};

const M1_TYPE_META: { key: string; label: string; icon: string; color: string }[] = [
  { key: 'confirmed',  label: 'Appt Confirmed', icon: '✅', color: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300' },
  { key: 'visit_done', label: 'Visit Done',      icon: '🏥', color: 'bg-teal-50 dark:bg-teal-900/20 border-teal-200 dark:border-teal-800 text-teal-700 dark:text-teal-300' },
  { key: 'review',     label: 'Google Review',   icon: '⭐', color: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-300' },
  { key: 'rx',         label: 'Rx Ready',        icon: '💊', color: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300' },
  { key: 'lab',        label: 'Lab Ready',       icon: '🧪', color: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300' },
  { key: 'bill',       label: 'Bill',            icon: '🧾', color: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300' },
];

function loadM1Templates(): Record<string, string> {
  try {
    const saved = localStorage.getItem(M1_TEMPLATES_KEY);
    return saved ? { ...DEFAULT_M1_TEMPLATES, ...JSON.parse(saved) } : { ...DEFAULT_M1_TEMPLATES };
  } catch { return { ...DEFAULT_M1_TEMPLATES }; }
}

function Module1Section() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });

  const today = new Date().toISOString().split('T')[0];
  const { data: appts = [], isLoading: apptLoading } = useQuery({
    queryKey: ['appointments', today],
    queryFn: () => window.electronAPI.appointments.list({ date: today }),
    refetchInterval: 30_000,
  });

  const [sentLog, setSentLog] = useState<{ name: string; type: string; time: string }[]>([]);
  const [showCustom, setShowCustom] = useState(false);
  const [customPhone, setCustomPhone] = useState('');
  const [customMsg, setCustomMsg] = useState('');
  const [reviewLinkDraft, setReviewLinkDraft] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Record<string, string>>(loadM1Templates);
  const [editingTpls, setEditingTpls] = useState<Record<string, string> | null>(null);

  const reviewLink = reviewLinkDraft ?? settings?.google_review_url ?? '';
  const cc = settings?.whatsapp_country_code || '91';

  const saveReviewLink = useMutation({
    mutationFn: (url: string) => window.electronAPI.settings.save({ google_review_url: url }),
    onSuccess: () => { toast('Google Review link saved'); qc.invalidateQueries({ queryKey: ['settings'] }); setReviewLinkDraft(null); },
    onError: () => toast('Could not save link', 'error'),
  });

  const buildMessage = (typeKey: string, appt: any) => {
    const ctx = { ...buildContext(appt, settings as any), review_link: reviewLink || '[Set Google Review link]' };
    return renderTemplate(templates[typeKey] ?? DEFAULT_M1_TEMPLATES[typeKey] ?? '', ctx);
  };

  const sendToPatient = async (appt: any, typeKey: string) => {
    if (!appt.patient_phone?.replace(/\D/g, '')) {
      toast(`No phone number on record for ${appt.patient_name}`, 'error');
      return;
    }
    const message = buildMessage(typeKey, appt);
    const url = buildWhatsAppUrl(appt.patient_phone, message, cc);
    if (!url) { toast('Invalid phone number', 'error'); return; }
    const res = await window.electronAPI.app.openExternal(url);
    if (res.ok) {
      const meta = M1_TYPE_META.find(t => t.key === typeKey)!;
      toast(`WhatsApp opened for ${appt.patient_name} — press Send`, 'success');
      setSentLog(prev => [{ name: appt.patient_name, type: meta.label, time: new Date().toLocaleTimeString() }, ...prev.slice(0, 9)]);
    } else {
      toast(res.error || 'Could not open WhatsApp', 'error');
    }
  };

  const sendCustom = async () => {
    if (!customPhone.trim()) { toast('Enter a phone number', 'error'); return; }
    if (!customMsg.trim()) { toast('Message is empty', 'error'); return; }
    const url = buildWhatsAppUrl(customPhone.trim(), customMsg, cc);
    if (!url) { toast('Invalid phone number', 'error'); return; }
    const res = await window.electronAPI.app.openExternal(url);
    if (res.ok) {
      toast('WhatsApp opened — press Send', 'success');
      setSentLog(prev => [{ name: customPhone.trim(), type: 'Custom', time: new Date().toLocaleTimeString() }, ...prev.slice(0, 9)]);
    } else {
      toast(res.error || 'Could not open WhatsApp', 'error');
    }
  };

  const openEditor = () => setEditingTpls({ ...templates });
  const saveTemplates = () => {
    if (!editingTpls) return;
    setTemplates(editingTpls);
    localStorage.setItem(M1_TEMPLATES_KEY, JSON.stringify(editingTpls));
    setEditingTpls(null);
    toast('Message templates saved');
  };

  const statusStyle: Record<string, string> = {
    'Waiting':         'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    'In Progress':     'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    'Done':            'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    'Cancelled':       'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400',
    'Send to Billing': 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  };

  const VARS = '{{patient_name}}  {{doctor_name}}  {{date}}  {{time}}  {{token}}  {{clinic_name}}  {{clinic_phone}}  {{clinic_address}}';

  return (
    <div className="space-y-4">
      {/* Banner */}
      <div className="rounded-xl p-4 flex gap-4 items-start" style={{ background: 'linear-gradient(135deg,#f0fdf4,#dcfce7)' }}>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0" style={{ background: '#25D366' }}>📱</div>
        <div>
          <p className="font-bold text-emerald-800 text-sm mb-1">Module 1 — WhatsApp Business</p>
          <p className="text-xs text-emerald-900 leading-relaxed">
            CureDesk opens WhatsApp with the message pre-typed — you just press <strong>Send</strong>.
            Click a button next to any patient below. No phone number to type, no form to fill.
          </p>
          <div className="flex gap-2 mt-2 flex-wrap">
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-200 text-emerald-800 font-semibold">✓ No setup</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-200 text-emerald-800 font-semibold">✓ Existing number</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-200 text-emerald-800 font-semibold">✓ Free forever</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-600 text-white font-semibold">You press Send in WhatsApp</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_260px] gap-4">
        {/* ── Patient list / Template editor ── */}
        <div className="card p-0 overflow-hidden">
          {editingTpls ? (
            /* ── Template editor ── */
            <div>
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50">
                <p className="text-xs font-bold text-gray-700 dark:text-slate-200 flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5 text-emerald-500" /> Edit Message Templates
                </p>
                <button onClick={() => setEditingTpls(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-200">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4 space-y-4 max-h-[520px] overflow-y-auto">
                <div className="rounded-lg bg-blue-50 dark:bg-blue-900/15 border border-blue-100 dark:border-blue-800 px-3 py-2 text-[10px] text-blue-700 dark:text-blue-300">
                  <strong>Variables you can use:</strong><br />
                  <span className="font-mono">{VARS}</span><br />
                  <span className="font-mono">{'{{review_link}}'}</span> — Google Review URL (Review template only)
                </div>
                {M1_TYPE_META.map(meta => (
                  <div key={meta.key}>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-semibold text-gray-700 dark:text-slate-200">
                        {meta.icon} {meta.label}
                      </label>
                      <button
                        onClick={() => setEditingTpls(prev => ({ ...prev!, [meta.key]: DEFAULT_M1_TEMPLATES[meta.key] }))}
                        className="text-[10px] text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400 font-medium"
                      >
                        Reset to default
                      </button>
                    </div>
                    <textarea
                      className="input w-full text-xs font-mono resize-none leading-relaxed"
                      rows={5}
                      value={editingTpls[meta.key] ?? DEFAULT_M1_TEMPLATES[meta.key]}
                      onChange={e => setEditingTpls(prev => ({ ...prev!, [meta.key]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
              <div className="flex gap-2 px-4 py-3 border-t border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50">
                <button onClick={saveTemplates}
                  className="flex-1 py-2 rounded-lg text-xs font-semibold text-white transition-colors"
                  style={{ background: '#25D366' }}>
                  Save All Templates
                </button>
                <button onClick={() => setEditingTpls(null)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            /* ── Today's patients ── */
            <>
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-slate-700">
                <p className="text-xs font-bold text-gray-700 dark:text-slate-200 flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5 text-emerald-500" />
                  Today's Patients
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400 font-medium">
                    {(appts as any[]).length}
                  </span>
                </p>
                <div className="flex items-center gap-3">
                  <p className="text-[10px] text-gray-400 dark:text-slate-500">
                    {new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                  </p>
                  <button onClick={openEditor}
                    className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline">
                    <FileText className="w-3 h-3" /> Edit messages
                  </button>
                </div>
              </div>

              {apptLoading ? (
                <p className="text-xs text-gray-400 p-4">Loading appointments…</p>
              ) : (appts as any[]).length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-sm text-gray-400 dark:text-slate-500">No appointments today</p>
                  <p className="text-[11px] text-gray-300 dark:text-slate-600 mt-1">Book from the OPD / Appointments page</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-slate-700/50">
                  {(appts as any[]).map((a) => (
                    <div key={a.id} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-800/40 transition-colors">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-semibold text-gray-800 dark:text-slate-100 truncate">{a.patient_name}</span>
                        <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full font-semibold shrink-0', statusStyle[a.status] ?? statusStyle['Cancelled'])}>
                          {a.status}
                        </span>
                        <span className="text-[10px] text-gray-400 dark:text-slate-500 ml-auto shrink-0">{a.appointment_time} · {a.doctor_name}</span>
                      </div>
                      <div className="flex gap-1.5 flex-wrap">
                        {M1_TYPE_META.map(t => (
                          <button
                            key={t.key}
                            onClick={() => sendToPatient(a, t.key)}
                            title={`Send ${t.label} to ${a.patient_name}`}
                            className={cn('flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-semibold transition-all active:scale-95 hover:opacity-80', t.color)}
                          >
                            {t.icon} {t.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Right panel ── */}
        <div className="space-y-3">
          {sentLog.length > 0 && (
            <div className="card p-4">
              <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-2">Recent Sends</p>
              <div className="space-y-2">
                {sentLog.map((entry, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-sm mt-0.5">📤</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-700 dark:text-slate-200 truncate">{entry.name}</p>
                      <p className="text-[10px] text-gray-400">{entry.type} · {entry.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card p-4 border-yellow-200 dark:border-yellow-800 bg-yellow-50/40 dark:bg-yellow-900/10">
            <div className="flex items-center gap-1.5 mb-2">
              <Star className="w-3.5 h-3.5 text-yellow-500" />
              <p className="text-xs font-bold text-yellow-800 dark:text-yellow-300">Google Review Link</p>
              {settings?.google_review_url && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 font-medium">✓ Set</span>}
            </div>
            <input className="input w-full text-xs mb-2" placeholder="https://g.page/r/your-review-link"
              value={reviewLinkDraft ?? (settings?.google_review_url ?? '')}
              onChange={e => setReviewLinkDraft(e.target.value)} />
            <button onClick={() => saveReviewLink.mutate(reviewLink)}
              disabled={saveReviewLink.isPending || !reviewLink.trim()}
              className="w-full py-1.5 rounded-lg text-xs font-semibold bg-yellow-500 hover:bg-yellow-600 text-white disabled:opacity-40 transition-colors">
              {saveReviewLink.isPending ? 'Saving…' : 'Save Link'}
            </button>
            <p className="text-[10px] text-yellow-600 dark:text-yellow-500 mt-1.5 leading-relaxed">
              Used in the ⭐ Google Review button and automated review requests.
            </p>
          </div>

          <div className="card p-4">
            <button onClick={() => setShowCustom(v => !v)}
              className="w-full flex items-center justify-between text-xs font-semibold text-gray-600 dark:text-slate-300">
              <span className="flex items-center gap-1.5"><Send className="w-3 h-3" /> Send to any number</span>
              <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', showCustom && 'rotate-180')} />
            </button>
            {showCustom && (
              <div className="mt-3 space-y-2">
                <input className="input w-full text-xs" placeholder="Phone number" value={customPhone} onChange={e => setCustomPhone(e.target.value)} />
                <textarea className="input w-full text-xs resize-none" rows={4} placeholder="Type your message…" value={customMsg} onChange={e => setCustomMsg(e.target.value)} />
                <button onClick={sendCustom} disabled={!customPhone.trim() || !customMsg.trim()}
                  className="w-full py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-40 transition-colors"
                  style={{ background: '#25D366' }}>
                  📱 Open in WhatsApp
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Module 2 — Cloud API section ─────────────────────────────────────────────
function Module2Section() {
  const [tab, setTab] = useState<Tab>('inbox');
  const { data: accounts = [] } = useQuery({ queryKey: ['wa:accounts'], queryFn: () => window.electronAPI.wa.accounts(), refetchInterval: 60_000 });
  const isConnected = (accounts as any[]).some((a: any) => a.status === 'connected');

  const M2_TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'inbox',      label: 'Inbox',        icon: <Inbox className="w-3.5 h-3.5" /> },
    { key: 'broadcast',  label: 'Mass Message', icon: <Megaphone className="w-3.5 h-3.5" /> },
    { key: 'campaigns',  label: 'Campaigns',    icon: <BarChart2 className="w-3.5 h-3.5" /> },
    { key: 'automation', label: 'Automation',   icon: <Zap className="w-3.5 h-3.5" /> },
    { key: 'templates',  label: 'Templates',    icon: <ListChecks className="w-3.5 h-3.5" /> },
    { key: 'queue',      label: 'Queue',        icon: <Send className="w-3.5 h-3.5" /> },
    { key: 'connect',    label: 'Cloud Setup',  icon: <PlugZap className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="space-y-4">
      {/* Module 2 header */}
      <div className="rounded-xl p-4 flex gap-4 items-start" style={{ background: 'linear-gradient(135deg,#eef2ff,#e0e7ff)' }}>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 bg-indigo-500">☁️</div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <p className="font-bold text-indigo-800 text-sm">Module 2 — WhatsApp Automation</p>
            {isConnected
              ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-200 text-indigo-800 font-semibold">✓ Connected</span>
              : <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">⚠ Not set up</span>}
          </div>
          <p className="text-xs text-indigo-700 leading-relaxed">
            Full automation via Meta's Cloud API. Messages send themselves — reminders, prescriptions, birthday wishes —
            plus a full inbox to receive and reply to patient messages.
          </p>
          <div className="flex gap-2 mt-2 flex-wrap">
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-200 text-indigo-800 font-semibold">✓ Fully automated</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-200 text-indigo-800 font-semibold">✓ Inbox + replies</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-200 text-indigo-800 font-semibold">✓ Read receipts</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-white text-indigo-700 font-semibold border border-indigo-300">May work with existing number</span>
          </div>
        </div>
        {!isConnected && (
          <button onClick={() => setTab('connect')}
            className="shrink-0 px-3 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors">
            Set Up →
          </button>
        )}
      </div>

      {/* M2 Sub-tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-slate-700 overflow-x-auto">
        {M2_TABS.map(({ key, label, icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap -mb-px',
              tab === key
                ? 'border-indigo-500 text-indigo-700 dark:text-indigo-400'
                : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200',
            )}>
            {icon} {label}
          </button>
        ))}
      </div>

      {/* M2 Tab content */}
      {tab === 'inbox'      && <InboxTab />}
      {tab === 'broadcast'  && <BroadcastTab />}
      {tab === 'campaigns'  && <CampaignsTab />}
      {tab === 'connect'    && <ConnectTab />}
      {tab === 'templates'  && <TemplatesTab />}
      {tab === 'automation' && <AutomationTab />}
      {tab === 'queue'      && <QueueTab />}
    </div>
  );
}

// ── Dashboard tab (kept for reference, now replaced by two-module view) ───────
function DashboardTab({ onNavigate }: { onNavigate: (t: Tab) => void }) {
  const { data: accounts = [] } = useQuery({ queryKey: ['wa:accounts'], queryFn: () => window.electronAPI.wa.accounts(), refetchInterval: 60_000 });
  const activeAccountId: number | null = (accounts as any[])[0]?.id ?? null;

  const { data: stats } = useQuery({
    queryKey: ['wa:queueStats', activeAccountId],
    queryFn: () => activeAccountId ? window.electronAPI.wa.queueStats(activeAccountId) : null,
    enabled: !!activeAccountId,
    refetchInterval: 30_000,
  });

  const { data: conversations = [] } = useQuery({
    queryKey: ['wa:conversations', activeAccountId, 'open'],
    queryFn: () => activeAccountId ? window.electronAPI.wa.conversations(activeAccountId, 'open') : [],
    enabled: !!activeAccountId,
    refetchInterval: 30_000,
  });

  const isConnected = (accounts as any[]).some((a: any) => a.status === 'connected');
  const unreadCount = (conversations as any[]).filter((c: any) => (c.unread_count ?? 0) > 0).length;

  const statCards = [
    { label: 'Sent Today',       value: stats?.sent_today    ?? '—', icon: '📤', color: 'text-emerald-600 dark:text-emerald-400' },
    { label: 'Pending',          value: stats?.pending       ?? '—', icon: '⏳', color: 'text-amber-600 dark:text-amber-400' },
    { label: 'Failed Today',     value: stats?.failed_today  ?? '—', icon: '⚠️', color: 'text-red-500 dark:text-red-400' },
    { label: 'Unread Messages',  value: unreadCount,                 icon: '💬', color: 'text-blue-600 dark:text-blue-400' },
  ];

  return (
    <div className="space-y-5">
      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4">
        {statCards.map(({ label, value, icon, color }) => (
          <div key={label} className="card p-4 flex flex-col gap-2">
            <span className="text-xl">{icon}</span>
            <p className="text-xs text-gray-500 dark:text-slate-400 font-medium">{label}</p>
            <p className={cn('text-3xl font-extrabold tabular-nums', color)}>{value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-5">
        {/* Quick actions */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wide">Quick Actions</h3>

          <button onClick={() => onNavigate('broadcast')}
            className="w-full card p-4 flex items-center gap-3 hover:border-rose-300 dark:hover:border-rose-700 hover:bg-rose-50/50 dark:hover:bg-rose-900/10 transition-all text-left">
            <span className="text-xl">📣</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800 dark:text-slate-100">Mass Message / Broadcast</p>
              <p className="text-xs text-gray-500 dark:text-slate-400">Festival wishes, health camps, offers to all patients</p>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
          </button>

          <button onClick={() => onNavigate('automation')}
            className="w-full card p-4 flex items-center gap-3 hover:border-amber-300 dark:hover:border-amber-700 hover:bg-amber-50/50 dark:hover:bg-amber-900/10 transition-all text-left">
            <span className="text-xl">⚡</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800 dark:text-slate-100">Automation Rules</p>
              <p className="text-xs text-gray-500 dark:text-slate-400">Appointment reminders, prescriptions, birthday wishes</p>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
          </button>

          <button onClick={() => onNavigate('inbox')}
            className="w-full card p-4 flex items-center gap-3 hover:border-green-300 dark:hover:border-green-700 hover:bg-green-50/50 dark:hover:bg-green-900/10 transition-all text-left">
            <span className="text-xl">💬</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800 dark:text-slate-100">Patient Inbox</p>
              <p className="text-xs text-gray-500 dark:text-slate-400">
                {unreadCount > 0 ? <span className="text-green-600 dark:text-green-400 font-semibold">{unreadCount} unread</span> : 'All conversations'}
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
          </button>

          <button onClick={() => onNavigate('campaigns')}
            className="w-full card p-4 flex items-center gap-3 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-all text-left">
            <span className="text-xl">📊</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800 dark:text-slate-100">Campaign Manager</p>
              <p className="text-xs text-gray-500 dark:text-slate-400">Track sent campaigns and delivery stats</p>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
          </button>
        </div>

        {/* Connection + automation status */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wide">Module Status</h3>

          {/* M1 — always available */}
          <div className="card p-4 border-l-4 border-l-emerald-500">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0" style={{ background: '#25D366' }}>📱</div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-semibold text-gray-800 dark:text-slate-100">WhatsApp Business</p>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 font-semibold">✓ Always On</span>
                </div>
                <p className="text-xs text-gray-500 dark:text-slate-400">One-click sends from patient profile — no setup needed. Works with your existing WhatsApp number.</p>
              </div>
            </div>
          </div>

          {/* M2 — Cloud API */}
          <div className={cn('card p-4 border-l-4', isConnected ? 'border-l-indigo-500' : 'border-l-gray-300 dark:border-l-slate-600')}>
            <div className="flex items-start gap-3">
              <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0', isConnected ? 'bg-indigo-500' : 'bg-gray-200 dark:bg-slate-700')}>☁️</div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-semibold text-gray-800 dark:text-slate-100">WhatsApp Automation</p>
                  {isConnected
                    ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 font-semibold">✓ Connected</span>
                    : <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400 font-semibold">Not set up</span>}
                </div>
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  {isConnected
                    ? `${(accounts as any[]).length} number(s) connected · Full automation active`
                    : 'Enable for automated reminders, inbox, and delivery receipts.'}
                </p>
                {!isConnected && (
                  <button onClick={() => onNavigate('connect')} className="mt-2 text-xs text-indigo-600 dark:text-indigo-400 font-semibold hover:underline">
                    Set up WhatsApp Automation →
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* How-to summary */}
          <div className="card p-4 bg-blue-50/60 dark:bg-blue-900/10 border-blue-100 dark:border-blue-800">
            <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-2">💡 How it works</p>
            <ul className="text-xs text-blue-600 dark:text-blue-400 space-y-1">
              <li>• <strong>WhatsApp Business</strong> — send from patient profile with one click, you press Send in WhatsApp</li>
              <li>• <strong>WhatsApp Automation</strong> — fully automated: reminders send themselves, inbox + read receipts</li>
              <li>• Both modules share the same template library and patient history</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Automation triggers summary */}
      <div className="card p-5">
        <h3 className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-4">Automation Triggers Available</h3>
        <div className="grid grid-cols-2 gap-2">
          {TRIGGERS.map(({ key, label, desc }) => (
            <div key={key} className="flex items-start gap-2.5 p-3 rounded-lg bg-gray-50 dark:bg-slate-800/50">
              <span className="text-base shrink-0">
                {key.includes('appointment_created') ? '📅' :
                 key.includes('reminder') ? '⏰' :
                 key.includes('prescription') ? '💊' :
                 key.includes('lab') ? '🧪' :
                 key.includes('bill') ? '🧾' :
                 key.includes('followup') ? '🔁' :
                 key.includes('birthday') ? '🎂' :
                 key.includes('feedback') ? '⭐' :
                 key.includes('vaccination') ? '💉' : '📩'}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-gray-700 dark:text-slate-200">{label}</p>
                <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5 leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
        <button onClick={() => onNavigate('automation')}
          className="mt-4 w-full py-2 rounded-lg border border-amber-200 dark:border-amber-800 text-xs font-semibold text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors flex items-center justify-center gap-2">
          <Zap className="w-3.5 h-3.5" /> Configure Automation Rules
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function WhatsApp() {
  const [activeModule, setActiveModule] = useState<ActiveModule>('module1');
  const [showGuide, setShowGuide] = useState(false);

  return (
    <div className="relative">
      {showGuide && <GuidePanel onClose={() => setShowGuide(false)} />}

      {/* ── Hero banner ── */}
      <div className="px-6 pt-6 pb-5 bg-slate-900 dark:bg-slate-950">
        <div className="flex items-start justify-between mb-5">
          <div>
            <div className="text-[10px] font-bold tracking-widest text-slate-500 uppercase mb-1">CureDesk HMS</div>
            <h1 className="text-xl font-extrabold text-white flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-emerald-400" /> Communication Center
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Two independent WhatsApp modes — choose the one that fits your clinic.
            </p>
          </div>
          <button
            onClick={() => setShowGuide(v => !v)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0',
              showGuide
                ? 'bg-emerald-500 text-white'
                : 'bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600',
            )}>
            <BookOpen className="w-3.5 h-3.5" /> Help Guide
          </button>
        </div>

        {/* ── Module switcher ── */}
        <div className="grid grid-cols-2 gap-3">
          {/* Module 1 card */}
          <button onClick={() => setActiveModule('module1')}
            className={cn(
              'rounded-xl p-4 text-left transition-all border-2',
              activeModule === 'module1'
                ? 'border-emerald-500 bg-emerald-950/60 shadow-lg shadow-emerald-900/40'
                : 'border-slate-700 bg-slate-800/60 hover:bg-slate-800 hover:border-slate-600',
            )}>
            <div className="flex items-center gap-2.5 mb-2">
              <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center text-base',
                activeModule === 'module1' ? 'bg-emerald-500/20' : 'bg-slate-700'
              )}>📱</div>
              <div>
                <p className="text-sm font-bold text-white">WhatsApp Business</p>
                <p className="text-[10px] text-slate-400">Module 1</p>
              </div>
              {activeModule === 'module1' && (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 ml-auto shrink-0" />
              )}
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Zero setup · Use your existing number · You press Send manually
            </p>
            <div className="flex gap-1.5 mt-2.5 flex-wrap">
              <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-medium',
                activeModule === 'module1' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700 text-slate-400'
              )}>✓ Free</span>
              <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-medium',
                activeModule === 'module1' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700 text-slate-400'
              )}>✓ No approval</span>
              <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-medium',
                activeModule === 'module1' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700 text-slate-400'
              )}>✓ Existing number</span>
            </div>
          </button>

          {/* Module 2 card */}
          <button onClick={() => setActiveModule('module2')}
            className={cn(
              'rounded-xl p-4 text-left transition-all border-2',
              activeModule === 'module2'
                ? 'border-indigo-500 bg-indigo-950/60 shadow-lg shadow-indigo-900/40'
                : 'border-slate-700 bg-slate-800/60 hover:bg-slate-800 hover:border-slate-600',
            )}>
            <div className="flex items-center gap-2.5 mb-2">
              <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center text-base',
                activeModule === 'module2' ? 'bg-indigo-500/20' : 'bg-slate-700'
              )}>☁️</div>
              <div>
                <p className="text-sm font-bold text-white">WhatsApp Automation</p>
                <p className="text-[10px] text-slate-400">Module 2</p>
              </div>
              {activeModule === 'module2' && (
                <CheckCircle2 className="w-4 h-4 text-indigo-400 ml-auto shrink-0" />
              )}
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Full automation · Inbox · Campaigns · Messages send themselves
            </p>
            <div className="flex gap-1.5 mt-2.5 flex-wrap">
              <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-medium',
                activeModule === 'module2' ? 'bg-indigo-500/20 text-indigo-300' : 'bg-slate-700 text-slate-400'
              )}>✓ Auto reminders</span>
              <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-medium',
                activeModule === 'module2' ? 'bg-indigo-500/20 text-indigo-300' : 'bg-slate-700 text-slate-400'
              )}>✓ Inbox</span>
              <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-medium',
                activeModule === 'module2' ? 'bg-indigo-500/20 text-indigo-300' : 'bg-slate-700 text-slate-400'
              )}>✓ Read receipts</span>
            </div>
          </button>
        </div>
      </div>

      {/* ── Module content ── */}
      <div className="p-6">
        {activeModule === 'module1' && <Module1Section />}
        {activeModule === 'module2' && <Module2Section />}
      </div>
    </div>
  );
}
