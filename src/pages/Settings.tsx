import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Stethoscope, Plus, Pencil, Wallet, ListChecks, Save, Database as DbIcon, Calendar as CalIcon, ArrowRight, Loader2, AlertTriangle, Trash2, User as UserIcon, IndianRupee, PenTool, Power, AlertCircle, ArrowUp, ArrowDown, MessageCircle, Eye, FileText, MapPin, Syringe, RefreshCw, Sparkles, HardDrive, Sun } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '../lib/utils';
import { Check } from 'lucide-react';
import { Modal } from '../components/Modal';
import { ImageUpload } from '../components/ImageUpload';
import { WhatsAppMessaging } from '../components/WhatsAppMessaging';
import { SlipPreviewLauncher } from '../components/SlipPreviewLauncher';
import { AdminGate } from '../components/AdminGate';
import { useToast } from '../hooks/useToast';
import { INDIAN_STATES } from '../lib/india';
import { KARNATAKA_PLACES, ALL_NEARBY_PLACES } from '../lib/places';
import { DOCTOR_COLOR_OPTIONS, colorForDoctor } from '../lib/doctor-colors';
import type { AppMode, Doctor, Settings } from '../types';

type SettingsTab = 'clinic' | 'doctors' | 'workflow' | 'patients' | 'system' | 'comms';

const SETTINGS_TAB_KEY = 'caredesk:settings-tab';

export function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>(() => {
    try { return (localStorage.getItem(SETTINGS_TAB_KEY) as SettingsTab) || 'clinic'; } catch { return 'clinic'; }
  });
  useEffect(() => { try { localStorage.setItem(SETTINGS_TAB_KEY, tab); } catch { /* ignore */ } }, [tab]);

  return (
    <AdminGate title="Settings — Administrator area">
      <div className="p-6 max-w-5xl">
        <div className="mb-4">
          <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100">Settings</h1>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            Pick a tab below to find what you need.
          </p>
        </div>

        {/* Tab bar */}
        <div className="flex flex-wrap gap-1 mb-6 p-1 rounded-lg bg-gray-100 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 sticky top-0 z-10 backdrop-blur">
          <SettingsTabBtn active={tab === 'clinic'} onClick={() => setTab('clinic')} icon={<Building2 className="w-3.5 h-3.5" />}>Clinic</SettingsTabBtn>
          <SettingsTabBtn active={tab === 'doctors'} onClick={() => setTab('doctors')} icon={<Stethoscope className="w-3.5 h-3.5" />}>Doctors & Templates</SettingsTabBtn>
          <SettingsTabBtn active={tab === 'workflow'} onClick={() => setTab('workflow')} icon={<Wallet className="w-3.5 h-3.5" />}>Fees & Workflow</SettingsTabBtn>
          <SettingsTabBtn active={tab === 'patients'} onClick={() => setTab('patients')} icon={<UserIcon className="w-3.5 h-3.5" />}>Patients</SettingsTabBtn>
          <SettingsTabBtn active={tab === 'system'} onClick={() => setTab('system')} icon={<HardDrive className="w-3.5 h-3.5" />}>System</SettingsTabBtn>
          <SettingsTabBtn active={tab === 'comms'} onClick={() => setTab('comms')} icon={<MessageCircle className="w-3.5 h-3.5" />}>Communication</SettingsTabBtn>
        </div>

        <div className="space-y-6">
          {tab === 'clinic' && (
            <>
              <SettingsGroup title="Clinic Identity" subtitle="Name, logo, address, contact details printed on every OPD slip.">
                <ClinicInfo />
              </SettingsGroup>
              <SettingsGroup title="App Mode" subtitle="Pick which modules are visible in the sidebar (Reception, Pharmacy, Doctor, Lab, IPD).">
                <AppModeSelector />
              </SettingsGroup>
            </>
          )}

          {tab === 'doctors' && (
            <>
              <SettingsGroup title="Doctors" subtitle="Add doctors, set their fees, signature, color tag, and slip template.">
                <DoctorsManagement />
              </SettingsGroup>
              <SettingsGroup title="OPD Slip Body Templates" subtitle="Per-specialty body sections for the consultation panel and printed slip. Header / vitals / signature / follow-up box stay the same.">
                <SlipTemplatesEditor />
              </SettingsGroup>
              <SettingsGroup title="OPD Slip Preview" subtitle="See exactly how the printed slip looks with sample data.">
                <SlipPreviewLauncher />
              </SettingsGroup>
            </>
          )}

          {tab === 'workflow' && (
            <>
              <SettingsGroup title="Fees, Queue Flow & Display" subtitle="Consultation fees, queue toggle, and sidebar visibility for the user badge / Billing module.">
                <FeesAndFlow />
              </SettingsGroup>
              <SettingsGroup title="Patient Registration Fee" subtitle="One-time fee charged on registration. Collect at registration, at first appointment, or ask each time.">
                <RegistrationFeePolicy />
              </SettingsGroup>
              <SettingsGroup title="Free Follow-up Policy" subtitle="Reward repeat visits with same-doctor follow-ups inside a configurable window.">
                <FollowupPolicy />
              </SettingsGroup>
              <SettingsGroup title="Services" subtitle="Quick-pick chips shown on the Services page (procedures, vaccinations, etc.). Add, remove, or reorder.">
                <MiscServicesEditor />
              </SettingsGroup>
            </>
          )}

          {tab === 'patients' && (
            <>
              <SettingsGroup title="Patients & Locations" subtitle="Default state, district, and bundled village list shown as autocomplete.">
                <DefaultLocation />
              </SettingsGroup>
            </>
          )}

          {tab === 'system' && (
            <>
              <SettingsGroup title="Startup & Background" subtitle="Auto-launch with Windows, minimize to tray, start hidden.">
                <StartupBehavior />
              </SettingsGroup>
              <SettingsGroup title="Network Mode (multi-station)" subtitle="Run reception + doctor cabins as separate PCs sharing one CureDesk. Pick a server PC, others connect over the LAN.">
                <NetworkModeSettings />
              </SettingsGroup>
              <SettingsGroup title="Backup, Restore & Updates" subtitle="Where backups go, daily auto-backup, weekly USB reminder, restore, and app updates.">
                <BackupSettings />
              </SettingsGroup>
            </>
          )}

          {tab === 'comms' && (
            <>
              <SettingsGroup title="WhatsApp Messaging" subtitle="Click-to-WhatsApp template editor + live preview.">
                <WhatsAppMessaging />
              </SettingsGroup>
            </>
          )}
        </div>
      </div>
    </AdminGate>
  );
}

function SettingsTabBtn({
  active, onClick, icon, children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md font-semibold transition',
        active
          ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 shadow-sm border border-gray-200 dark:border-slate-700'
          : 'text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200 hover:bg-white/60 dark:hover:bg-slate-700/40 border border-transparent'
      )}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

function SettingsGroup({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="px-1">
        <div className="text-[11px] font-bold uppercase tracking-widest text-blue-700 dark:text-blue-300">{title}</div>
        <div className="text-[11px] text-gray-500 dark:text-slate-400">{subtitle}</div>
      </div>
      {children}
    </div>
  );
}

const MODES: { value: AppMode; title: string; blurb: string; includes: string[] }[] = [
  {
    value: 'reception',
    title: 'Reception Only',
    blurb: 'Front-desk flow: registration, appointments, billing, reports. No doctor screen, no pharmacy.',
    includes: ['Reception', 'Appointments', 'Billing', 'Accounts', 'Patient Log / Origin', 'Reports'],
  },
  {
    value: 'reception_pharmacy',
    title: 'Reception + Pharmacy',
    blurb: 'Adds the pharmacy module — drug master, batch-tracked stock, dispensing, Schedule H register. Useful for chemist-counter only setups.',
    includes: ['Everything in Reception', 'Pharmacy: inventory + dispense + Schedule H register'],
  },
  {
    value: 'reception_doctor',
    title: 'Reception + Doctor',
    blurb: 'Adds the doctor consultation workflow — vitals, history, Rx, OPD slip. Patients send Rx to outside chemist.',
    includes: ['Everything in Reception', 'Doctor dashboards', 'Consultation + OPD slip'],
  },
  {
    value: 'reception_pharmacy_doctor',
    title: 'Reception + Pharmacy + Doctor (recommended)',
    blurb: 'Most common single-clinic setup — front desk, in-house pharmacy that auto-fills from doctor Rx, full Schedule H compliance.',
    includes: ['Everything in Reception', 'Doctor consultation + OPD slip', 'Pharmacy with auto-deduct on Rx'],
  },
  {
    value: 'reception_pharmacy_doctor_lab',
    title: 'Reception + Pharmacy + Doctor + Lab',
    blurb: 'Polyclinic — adds the laboratory module: test catalog, orders, sample collection, result entry.',
    includes: ['Everything above', 'Lab test catalog', 'Lab orders + results'],
  },
  {
    value: 'full',
    title: 'Full HMS (adds IPD)',
    blurb: 'Full hospital — in-patient admissions, ward/bed management, discharge summary.',
    includes: ['Everything above', 'In-Patient (IPD) admissions', 'Ward + bed tracking', 'Discharge summary'],
  },
];

function AppModeSelector() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => window.electronAPI.settings.save(patch),
    onMutate: (patch) => {
      const prev = qc.getQueryData<Settings>(['settings']);
      if (prev) qc.setQueryData(['settings'], { ...prev, ...patch });
      return { prev };
    },
    onError: (_e, _p, ctx) => {
      if (ctx?.prev) qc.setQueryData(['settings'], ctx.prev);
      toast('Save failed', 'error');
    },
    onSuccess: async (_data, patch) => {
      await qc.refetchQueries({ queryKey: ['settings'] });
      const newMode = (patch as any).app_mode as AppMode | undefined;
      const title = newMode ? MODES.find((m) => m.value === newMode)?.title || newMode : 'settings';
      toast(`Switched to: ${title}`);
    },
  });

  if (!settings) return null;
  // Defensive default — if the persisted setting is missing/unknown, assume reception_doctor.
  const current: AppMode = (MODES.find((m) => m.value === settings.app_mode)?.value) || 'reception_doctor';
  const currentTitle = MODES.find((m) => m.value === current)!.title;

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-1">Application Mode</h2>
      <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-4">
        Pick which modules your clinic uses. Navigation adapts instantly — nothing gets deleted, just hidden.
      </p>
      <div className="text-xs mb-4 px-3 py-2 rounded-lg bg-blue-100 border border-blue-300 text-blue-900 dark:bg-blue-900/40 dark:border-blue-700 dark:text-blue-100">
        Currently active mode: <span className="font-bold">{currentTitle}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {MODES.map((m) => {
          const active = current === m.value;
          const pending = save.isPending && (save.variables as any)?.app_mode === m.value;
          return (
            <button
              key={m.value}
              type="button"
              disabled={save.isPending}
              onClick={() => {
                if (current === m.value) return;
                save.mutate({ app_mode: m.value });
              }}
              className={cn(
                'relative text-left rounded-xl p-4 transition overflow-hidden',
                active
                  ? 'border-4 border-blue-600 bg-blue-100 dark:bg-blue-900/50 dark:border-blue-400'
                  : 'border-2 border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-blue-400'
              )}
              style={active ? { boxShadow: '0 0 0 3px rgba(37, 99, 235, 0.3)' } : undefined}
            >
              {active && (
                <>
                  <div
                    className="absolute top-0 left-0 right-0"
                    style={{ height: 4, background: 'linear-gradient(90deg, #2563eb, #6366f1)' }}
                  />
                  <div
                    className="absolute top-2 right-2 flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider text-white"
                    style={{ backgroundColor: '#2563eb' }}
                  >
                    <Check className="w-3 h-3" /> Selected
                  </div>
                </>
              )}
              {pending && (
                <div className="absolute inset-0 bg-black/30 flex items-center justify-center text-white text-xs font-semibold">
                  Switching…
                </div>
              )}
              <div
                className={cn(
                  'text-sm font-bold pr-24',
                  active
                    ? 'text-blue-900 dark:text-blue-100'
                    : 'text-gray-900 dark:text-slate-100'
                )}
              >
                {m.title}
              </div>
              <div
                className={cn(
                  'text-[11px] mt-1',
                  active
                    ? 'text-blue-800 dark:text-blue-200'
                    : 'text-gray-600 dark:text-slate-300'
                )}
              >
                {m.blurb}
              </div>
              <ul
                className={cn(
                  'text-[11px] mt-2 list-disc pl-4 space-y-0.5',
                  active
                    ? 'text-blue-800 dark:text-blue-200'
                    : 'text-gray-500 dark:text-slate-400'
                )}
              >
                {m.includes.map((i) => <li key={i}>{i}</li>)}
              </ul>
            </button>
          );
        })}
      </div>
    </section>
  );
}

type RestorePreview = {
  ok: true;
  sourcePath: string;
  sqlitePath: string;
  hasBundleDocs: boolean;
  documentFileCount: number | null;
  backupTakenAt: string | null;
  backup: { counts: Record<string, number | null>; totalRows: number };
  current: { counts: Record<string, number | null>; totalRows: number };
  currentDbPath: string;
};

const RESTORE_ROWS: { key: string; label: string }[] = [
  { key: 'patients', label: 'Patients' },
  { key: 'appointments', label: 'Appointments' },
  { key: 'bills', label: 'Bills' },
  { key: 'consultations', label: 'Consultations / EMR' },
  { key: 'prescription_items', label: 'Prescription items' },
  { key: 'lab_orders', label: 'Lab orders' },
  { key: 'pharmacy_sales', label: 'Pharmacy sales' },
  { key: 'ip_admissions', label: 'IP admissions' },
  { key: 'drug_inventory', label: 'Drugs in inventory' },
  { key: 'doctors', label: 'Doctors' },
  { key: 'users', label: 'User accounts' },
  { key: 'patient_documents', label: 'Patient documents (EMR)' },
  { key: 'notification_log', label: 'Notification log' },
  { key: 'audit_log', label: 'Audit log entries' },
];

function formatBackupTimestamp(iso: string): string {
  try {
    const d = parseISO(iso);
    return format(d, "do MMMM yyyy '·' hh:mm a");
  } catch {
    return iso;
  }
}

function RestoreRow({ label, now, after }: { label: string; now: number; after: number }) {
  const delta = after - now;
  const tone =
    delta === 0 ? 'text-gray-500 dark:text-slate-400' :
    delta > 0 ? 'text-emerald-700 dark:text-emerald-300 font-semibold' :
    'text-red-700 dark:text-red-300 font-semibold';
  const sign = delta > 0 ? '+' : '';
  return (
    <tr className="border-t border-gray-100 dark:border-slate-800">
      <td className="px-3 py-1.5 text-gray-900 dark:text-slate-100">{label}</td>
      <td className="px-3 py-1.5 text-right font-mono text-gray-700 dark:text-slate-200">{now.toLocaleString('en-IN')}</td>
      <td className="px-3 py-1.5 text-right font-mono text-gray-900 dark:text-slate-100 font-semibold">{after.toLocaleString('en-IN')}</td>
      <td className={cn('px-3 py-1.5 text-right font-mono', tone)}>
        {delta === 0 ? '—' : `${sign}${delta.toLocaleString('en-IN')}`}
      </td>
    </tr>
  );
}

function BackupSettings() {
  const toast = useToast();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { draft, set, reset, dirty, save, saving } = useSectionDraft(settings, [
    'backup_folder',
    'backup_reminder_time',
    'auto_backup_enabled',
    'auto_backup_frequency',
    'auto_backup_time',
    'keep_all_backups',
    'usb_reminder_weekday',
    'usb_reminder_time',
    'update_check_enabled',
    'update_check_time',
  ]);

  const { data: updateState } = useQuery({
    queryKey: ['updates-state'],
    queryFn: () => window.electronAPI.updates.state(),
    refetchInterval: 30_000,
  });
  const checkNow = useMutation({
    mutationFn: () => window.electronAPI.updates.checkNow(),
    onSuccess: (r: any) => {
      if (!r?.isPackaged) {
        toast('Updates only work in the installed app, not in dev mode', 'info');
        return;
      }
      if (r.state === 'available') toast(`New version ${r.latestVersion} available`, 'info');
      else if (r.state === 'uptodate') toast('You\'re on the latest version', 'info');
      else if (r.state === 'error') toast(`Update check failed: ${r.error || 'unknown'}`, 'error');
    },
  });
  const installNow = useMutation({
    mutationFn: () => window.electronAPI.updates.installNow(),
  });
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreSource, setRestoreSource] = useState<string | null>(null);
  const [restorePhrase, setRestorePhrase] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const openRestoreFor = async (sourcePath: string) => {
    setRestoreSource(sourcePath);
    setRestorePhrase('');
    setPreview(null);
    setPreviewError(null);
    setRestoreOpen(true);
    setPreviewing(true);
    try {
      const r = await window.electronAPI.backup.previewRestore(sourcePath);
      if (r.ok) setPreview(r);
      else setPreviewError(r.error);
    } catch (e: any) {
      setPreviewError(e?.message || 'Could not read backup');
    } finally {
      setPreviewing(false);
    }
  };

  const pickBundleFolder = async () => {
    const p = await window.electronAPI.dialog.pickFolder({ title: 'Pick a CareDesk backup bundle folder (caredesk-<timestamp>)' });
    if (p) await openRestoreFor(p);
  };
  const pickSqliteFile = async () => {
    const p = await window.electronAPI.dialog.pickFile({
      title: 'Pick a caredesk.sqlite backup file',
      filters: [{ name: 'SQLite database', extensions: ['sqlite', 'db'] }],
    });
    if (p) await openRestoreFor(p);
  };

  const doRestore = async () => {
    if (!restoreSource) return;
    setRestoring(true);
    try {
      const r = await window.electronAPI.backup.restore(restoreSource, restorePhrase);
      if (r.ok) toast('Restore complete. App is restarting…', 'info');
      else toast(r.error || 'Restore failed', 'error');
    } catch (e: any) {
      toast(e.message || 'Restore failed', 'error');
    } finally { setRestoring(false); }
  };

  if (!settings) return null;
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Backup & End-of-day Routine</h2>
        <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
      </div>
      <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-4">
        Where the daily SQLite backup is written. Tip: install{' '}
        <a href="https://www.google.com/drive/download/" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Google Drive for Desktop</a>
        {' '}and point this at a Drive-synced folder (e.g. <code className="font-mono">G:\My Drive\CareDesk Backups</code>) — files upload to the cloud automatically.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="label">Backup Folder Path</label>
          <div className="flex gap-2">
            <input
              className="input font-mono text-xs flex-1"
              placeholder="G:\My Drive\CareDesk Backups"
              value={draft.backup_folder ?? ''}
              onChange={(e) => set('backup_folder', e.target.value)}
            />
            <button
              type="button"
              className="btn-secondary"
              onClick={async () => {
                const p = await window.electronAPI.dialog.pickFolder({ title: 'Pick the backup folder (e.g. your Google Drive Desktop folder)' });
                if (p) set('backup_folder', p);
              }}
            >
              Browse…
            </button>
          </div>
          <div className="text-[11px] text-amber-700 dark:text-amber-300 mt-1">
            ⚠ Must be a LOCAL folder on this PC (like <code>G:\My Drive\CareDesk Backups</code>). Google Drive web links (<code>drive.google.com/...</code>) don't work.
          </div>
          <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-0.5">
            Leave blank to use the app's default folder (<code>%APPDATA%\CureDesk HMS\backups</code>).
          </div>
        </div>
        <div>
          <label className="label">End-of-day Reminder Time</label>
          <input
            type="time"
            className="input"
            value={draft.backup_reminder_time ?? '21:00'}
            onChange={(e) => set('backup_reminder_time', e.target.value)}
          />
          <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-1">
            Reminder popup + Windows notification at this time.
          </div>
        </div>
      </div>

      {/* Automatic backup section */}
      <div className="mt-6 pt-5 border-t border-gray-200 dark:border-slate-700">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Automatic Backup</h3>
            <p className="text-[11px] text-gray-500 dark:text-slate-400">App quietly creates a backup on schedule, even if no one clicks anything.</p>
          </div>
          <label className="inline-flex items-center cursor-pointer">
            <button
              type="button"
              onClick={() => set('auto_backup_enabled', !draft.auto_backup_enabled)}
              className={cn(
                'w-12 h-7 rounded-full relative transition flex-shrink-0',
                draft.auto_backup_enabled ? 'bg-emerald-600' : 'bg-gray-300 dark:bg-slate-600'
              )}
            >
              <span
                className={cn('absolute top-0.5 w-6 h-6 rounded-full shadow-md transition-all', draft.auto_backup_enabled ? 'left-[26px]' : 'left-0.5')}
                style={{ backgroundColor: '#ffffff' }}
              />
            </button>
          </label>
        </div>
        {draft.auto_backup_enabled && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Frequency</label>
              <select
                className="input"
                value={draft.auto_backup_frequency ?? 'daily'}
                onChange={(e) => set('auto_backup_frequency', e.target.value as any)}
              >
                <option value="hourly">Every hour</option>
                <option value="every_3_hours">Every 3 hours</option>
                <option value="every_6_hours">Every 6 hours</option>
                <option value="twice_daily">Twice a day</option>
                <option value="daily">Once a day</option>
              </select>
            </div>
            {(draft.auto_backup_frequency === 'daily' || draft.auto_backup_frequency === 'twice_daily') && (
              <div>
                <label className="label">
                  {draft.auto_backup_frequency === 'twice_daily' ? 'First Run Time (second runs +12h)' : 'Time of Day'}
                </label>
                <input
                  type="time"
                  className="input"
                  value={draft.auto_backup_time ?? '13:00'}
                  onChange={(e) => set('auto_backup_time', e.target.value)}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Weekly USB reminder */}
      <div className="mt-6 pt-5 border-t border-gray-200 dark:border-slate-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-3">Weekly USB Backup Reminder</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Day of Week</label>
            <select
              className="input"
              value={draft.usb_reminder_weekday ?? 1}
              onChange={(e) => set('usb_reminder_weekday', Number(e.target.value) as any)}
            >
              <option value={0}>Sunday</option>
              <option value={1}>Monday</option>
              <option value={2}>Tuesday</option>
              <option value={3}>Wednesday</option>
              <option value={4}>Thursday</option>
              <option value={5}>Friday</option>
              <option value={6}>Saturday</option>
            </select>
          </div>
          <div>
            <label className="label">Time</label>
            <input
              type="time"
              className="input"
              value={draft.usb_reminder_time ?? '09:30'}
              onChange={(e) => set('usb_reminder_time', e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Retention */}
      <div className="mt-5 flex items-start justify-between gap-3 pt-4 border-t border-gray-200 dark:border-slate-700">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Keep all backup snapshots</div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400 max-w-md">
            <b>Recommended ON.</b> When ON, no old snapshot is ever auto-deleted — safer for cloud-synced folders. When OFF, only the last 30 snapshots are kept (saves disk).
          </div>
        </div>
        <button
          type="button"
          onClick={() => set('keep_all_backups', !draft.keep_all_backups)}
          className={cn(
            'w-12 h-7 rounded-full relative transition flex-shrink-0',
            draft.keep_all_backups ? 'bg-emerald-600' : 'bg-gray-300 dark:bg-slate-600'
          )}
        >
          <span
            className={cn('absolute top-0.5 w-6 h-6 rounded-full shadow-md transition-all', draft.keep_all_backups ? 'left-[26px]' : 'left-0.5')}
            style={{ backgroundColor: '#ffffff' }}
          />
        </button>
      </div>

      <div className="mt-4 text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-800 rounded p-2">
        ⚠ <b>Sync warning:</b> Google Drive Desktop is two-way. If you delete a backup file from your local Drive folder, it also deletes from drive.google.com. Always keep retention ON, and take a USB backup weekly as physical protection.
      </div>

      {/* App updates */}
      <div className="mt-6 pt-5 border-t border-gray-200 dark:border-slate-700">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">App Updates</h3>
          <p className="text-[11px] text-gray-500 dark:text-slate-400">
            Once a day at the configured time, the app checks GitHub for new releases. Your data is never touched by an update.
          </p>
        </div>

        {/* Status panel — colored by state */}
        <UpdateStatusPanel
          state={updateState as any}
          checking={checkNow.isPending}
          onCheck={() => checkNow.mutate()}
          onInstall={() => installNow.mutate()}
        />
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-700 dark:text-slate-200">Enable daily update check</span>
          <button
            type="button"
            onClick={() => set('update_check_enabled', !draft.update_check_enabled)}
            className={cn(
              'w-12 h-7 rounded-full relative transition flex-shrink-0',
              draft.update_check_enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-slate-600'
            )}
          >
            <span
              className={cn('absolute top-0.5 w-6 h-6 rounded-full shadow-md transition-all', draft.update_check_enabled ? 'left-[26px]' : 'left-0.5')}
              style={{ backgroundColor: '#ffffff' }}
            />
          </button>
        </div>
        {draft.update_check_enabled && (
          <div className="grid grid-cols-2 gap-4 mt-3">
            <div>
              <label className="label">Check time</label>
              <input
                type="time"
                className="input"
                value={draft.update_check_time ?? '10:30'}
                onChange={(e) => set('update_check_time', e.target.value)}
              />
              <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-1">Default 10:30 AM. App must be running at this time for the check to fire.</div>
            </div>
          </div>
        )}
      </div>

      {/* Restore / Import */}
      <div className="mt-6 pt-5 border-t-2 border-red-200 dark:border-red-900">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <div>
            <div className="text-sm font-semibold text-red-800 dark:text-red-300">Restore / Import Backup</div>
            <div className="text-[11px] text-red-700 dark:text-red-400 max-w-lg">
              Replaces all current data (patients, bills, EMR, settings, users) with the selected backup. A safety snapshot of current data is taken first. App restarts after restore.
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button className="btn-secondary" onClick={pickBundleFolder}>Pick Bundle Folder</button>
            <button className="btn-secondary" onClick={pickSqliteFile}>Pick .sqlite File</button>
          </div>
        </div>
      </div>

      <Modal open={restoreOpen} onClose={() => !restoring && setRestoreOpen(false)} title="Review backup before restoring" size="lg">
        <div className="space-y-3">
          {/* Source path */}
          <div>
            <div className="text-[11px] uppercase font-semibold text-gray-500 dark:text-slate-400 mb-1">Backup source</div>
            <div className="font-mono text-[11px] bg-gray-100 dark:bg-slate-800 p-2 rounded border border-gray-200 dark:border-slate-700 break-all">
              {restoreSource}
            </div>
          </div>

          {/* Preview status */}
          {previewing && (
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-slate-300 p-3 bg-gray-50 dark:bg-slate-800/50 rounded">
              <Loader2 className="w-4 h-4 animate-spin" /> Reading backup contents…
            </div>
          )}
          {previewError && (
            <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 rounded">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>{previewError}</div>
            </div>
          )}

          {/* Preview details */}
          {preview && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="card p-3 flex items-center gap-3">
                  <CalIcon className="w-5 h-5 text-blue-600" />
                  <div>
                    <div className="text-[10px] uppercase font-semibold text-gray-500 dark:text-slate-400">Backup taken on</div>
                    <div className="text-sm font-bold text-gray-900 dark:text-slate-100">
                      {preview.backupTakenAt ? formatBackupTimestamp(preview.backupTakenAt) : '— (unknown timestamp)'}
                    </div>
                  </div>
                </div>
                <div className="card p-3 flex items-center gap-3">
                  <DbIcon className="w-5 h-5 text-emerald-600" />
                  <div>
                    <div className="text-[10px] uppercase font-semibold text-gray-500 dark:text-slate-400">Total rows in backup</div>
                    <div className="text-sm font-bold text-gray-900 dark:text-slate-100">
                      {preview.backup.totalRows.toLocaleString('en-IN')}
                      {preview.hasBundleDocs && preview.documentFileCount != null && (
                        <span className="ml-2 text-[11px] font-normal text-gray-500 dark:text-slate-400">
                          + {preview.documentFileCount} document file(s)
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <div className="text-[11px] uppercase font-semibold text-gray-500 dark:text-slate-400 mb-1">
                  What you have now <ArrowRight className="inline w-3 h-3" /> What the backup will restore
                </div>
                <div className="border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden max-h-72 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 dark:bg-slate-800">
                      <tr className="text-left text-[10px] uppercase text-gray-500 dark:text-slate-400">
                        <th className="px-3 py-1.5">Data</th>
                        <th className="px-3 py-1.5 text-right">Now</th>
                        <th className="px-3 py-1.5 text-right">After Restore</th>
                        <th className="px-3 py-1.5 text-right">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {RESTORE_ROWS.map((r) => (
                        <RestoreRow
                          key={r.key}
                          label={r.label}
                          now={preview.current.counts[r.key] ?? 0}
                          after={preview.backup.counts[r.key] ?? 0}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-800 rounded p-2">
                Before overwriting, a <b>safety snapshot</b> of your current database + documents is saved to <code>pre-restore-&lt;timestamp&gt;/</code> in your backup folder. If this restore turns out to be wrong, you can restore that snapshot back.
              </div>

              <div>
                <label className="label">Type <code className="font-mono">REPLACE ALL DATA</code> to confirm</label>
                <input
                  className="input font-mono"
                  value={restorePhrase}
                  onChange={(e) => setRestorePhrase(e.target.value)}
                  placeholder="REPLACE ALL DATA"
                />
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-secondary" onClick={() => setRestoreOpen(false)} disabled={restoring}>Cancel</button>
            <button
              className="btn-danger"
              disabled={restoring || previewing || !preview || restorePhrase !== 'REPLACE ALL DATA'}
              onClick={doRestore}
            >
              {restoring ? 'Restoring…' : 'Restore & Restart App'}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

function DefaultLocation() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { draft, set, reset, dirty, save, saving } = useSectionDraft(settings, ['default_state', 'default_district', 'known_villages']);

  if (!settings) return null;
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Default Location & Known Villages</h2>
        <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
      </div>
      <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-4">
        These pre-fill on every new patient so the receptionist only types the village. Known villages appear as autocomplete suggestions.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Default State</label>
          <select className="input" value={draft.default_state ?? ''} onChange={(e) => set('default_state', e.target.value)}>
            <option value="">—</option>
            {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <TxtField label="Default District" value={draft.default_district ?? ''} onChange={(v) => set('default_district', v)} />
        <div className="col-span-2">
          <TxtField label="Known Villages / Places (your custom additions, comma-separated)" value={draft.known_villages ?? ''} onChange={(v) => set('known_villages', v)} />
          <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-1">
            Anything you add here appears as autocomplete in the Reception <b>Place</b> field — on top of the bundled list shown below.
          </div>
        </div>
        <div className="col-span-2">
          <BundledVillagesBrowser
            knownVillages={draft.known_villages ?? ''}
            onAdd={(v) => {
              const current = (draft.known_villages ?? '').split(',').map((x) => x.trim()).filter(Boolean);
              if (current.some((x) => x.toLowerCase() === v.toLowerCase())) return;
              set('known_villages', [...current, v].join(', '));
            }}
          />
        </div>
      </div>
    </section>
  );
}

function BundledVillagesBrowser({
  knownVillages,
  onAdd,
}: {
  knownVillages: string;
  onAdd: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const known = new Set(knownVillages.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  const districts = Object.keys(KARNATAKA_PLACES).sort();

  const filtered = (() => {
    const q = search.trim().toLowerCase();
    if (!q) return KARNATAKA_PLACES;
    const out: Record<string, string[]> = {};
    for (const d of districts) {
      const matches = KARNATAKA_PLACES[d].filter((v) => v.toLowerCase().includes(q));
      if (matches.length) out[d] = matches;
    }
    return out;
  })();
  const filteredDistricts = Object.keys(filtered).sort();
  const totalShown = filteredDistricts.reduce((s, d) => s + filtered[d].length, 0);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-slate-800/50 hover:bg-gray-100 dark:hover:bg-slate-800"
      >
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-gray-900 dark:text-slate-100">📍 Bundled Villages & Towns</span>
          <span className="text-[11px] text-gray-500 dark:text-slate-400">
            {ALL_NEARBY_PLACES.length.toLocaleString('en-IN')} places ·
            Gadag · Haveri · Koppal · Dharwad — already auto-suggesting in Reception
          </span>
        </div>
        <span className="text-xs text-gray-500 dark:text-slate-400">{open ? '▲ Hide' : '▼ Show'}</span>
      </button>

      {open && (
        <div className="p-3 bg-white dark:bg-slate-900/30">
          <div className="text-[11px] text-gray-600 dark:text-slate-300 mb-2">
            These ~{ALL_NEARBY_PLACES.length} villages and towns are <b>already built into the app</b> and show as autocomplete suggestions when the receptionist types in the Place field. Use this list to verify coverage. Click the <b>+ Add</b> chip to also pin a place to the top of suggestions.
          </div>
          <div className="relative mb-3">
            <input
              type="text"
              className="input pl-3"
              placeholder={`Search ${ALL_NEARBY_PLACES.length.toLocaleString('en-IN')} villages…`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {totalShown === 0 ? (
            <div className="text-center text-xs text-gray-500 dark:text-slate-400 py-6">
              No villages match "{search}". The receptionist can still type any place name freely.
            </div>
          ) : (
            <>
              {search && (
                <div className="text-[10px] text-gray-500 dark:text-slate-400 mb-2">
                  Showing {totalShown.toLocaleString('en-IN')} match{totalShown === 1 ? '' : 'es'} across {filteredDistricts.length} district{filteredDistricts.length === 1 ? '' : 's'}
                </div>
              )}
              <div className="max-h-72 overflow-y-auto space-y-3 pr-1">
                {filteredDistricts.map((district) => (
                  <div key={district}>
                    <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 py-1 text-[10px] uppercase tracking-wider font-bold text-blue-700 dark:text-blue-300 border-b border-blue-100 dark:border-blue-900">
                      {district} District · {filtered[district].length} places
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {filtered[district].map((v) => {
                        const isAdded = known.has(v.toLowerCase());
                        return (
                          <button
                            key={v}
                            type="button"
                            onClick={() => !isAdded && onAdd(v)}
                            disabled={isAdded}
                            className={cn(
                              'text-[11px] px-2 py-0.5 rounded border inline-flex items-center gap-1 transition',
                              isAdded
                                ? 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200 cursor-default'
                                : 'bg-white dark:bg-slate-800 border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 cursor-pointer'
                            )}
                            title={isAdded ? 'Already in your Known Villages list' : 'Click to pin to your Known Villages'}
                          >
                            {v}
                            {isAdded ? <Check className="w-3 h-3" /> : <span className="text-[9px] text-blue-600 dark:text-blue-400">+ pin</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ClinicInfo() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { draft, set, reset, dirty, save, saving } = useSectionDraft(settings, ['clinic_name', 'clinic_tagline', 'clinic_phone', 'clinic_email', 'clinic_address', 'clinic_registration_no'], {
    extraInvalidateKeys: [['clinic-name'], ['clinic-name-title']],
  });

  const logoSave = useMutation({
    mutationFn: (patch: Partial<Settings>) => window.electronAPI.settings.save(patch),
    onMutate: (patch) => { const prev = qc.getQueryData<Settings>(['settings']); if (prev) qc.setQueryData(['settings'], { ...prev, ...patch }); return { prev }; },
    onError: (_e, _p, ctx) => { if (ctx?.prev) qc.setQueryData(['settings'], ctx.prev); toast('Save failed', 'error'); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); toast('Logo saved'); },
  });

  if (!settings) return null;
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-blue-600" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Clinic Info</h2>
        </div>
        <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
      </div>
      <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-4">These appear on the OPD slip letterhead and invoices.</p>

      <div className="flex gap-6">
        <ImageUpload
          label="Clinic Logo"
          value={settings.clinic_logo}
          onChange={(v) => logoSave.mutate({ clinic_logo: v || '' })}
          aspect="square"
          placeholder="Click or drop"
          hint="⚠ Upload a high-quality logo (JPG / PNG). Max 5 MB. Logo saves immediately on upload."
        />
        <div className="flex-1 grid grid-cols-2 gap-4">
          <TxtField label="Clinic Name *" value={draft.clinic_name ?? ''} onChange={(v) => set('clinic_name', v)} />
          <TxtField label="Tagline" value={draft.clinic_tagline ?? ''} onChange={(v) => set('clinic_tagline', v)} />
          <TxtField label="Phone" value={draft.clinic_phone ?? ''} onChange={(v) => set('clinic_phone', v)} />
          <TxtField label="Email" value={draft.clinic_email ?? ''} onChange={(v) => set('clinic_email', v)} />
          <div className="col-span-2">
            <TxtField label="Address" value={draft.clinic_address ?? ''} onChange={(v) => set('clinic_address', v)} />
          </div>
          <TxtField label="Registration No." value={draft.clinic_registration_no ?? ''} onChange={(v) => set('clinic_registration_no', v)} />
        </div>
      </div>
    </section>
  );
}

function StartupBehavior() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ['auto-launch-status'],
    queryFn: () => window.electronAPI.app.getAutoLaunchStatus(),
    refetchInterval: 30_000,
  });

  // Save the setting AND immediately call the OS-level register/unregister IPC.
  const save = useMutation({
    mutationFn: async (patch: { auto_launch?: boolean; start_minimized?: boolean; minimize_to_tray?: boolean }) => {
      const next = { ...settings, ...patch } as Settings;
      await window.electronAPI.settings.save(patch);
      // Re-register with the OS only if auto_launch or start_minimized changed.
      if ('auto_launch' in patch || 'start_minimized' in patch) {
        const r = await window.electronAPI.app.setAutoLaunch(!!next.auto_launch, !!next.start_minimized);
        return r;
      }
      return { ok: true };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      refetchStatus();
      if (!r.ok && r.reason) {
        toast(r.reason, 'info');
      } else {
        toast('Saved');
      }
    },
    onError: (e: any) => toast(e?.message || 'Save failed', 'error'),
  });

  if (!settings) return null;

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Startup & Background Behavior</h2>
      </div>
      <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-4">
        Run CareDesk silently in the background like Google Drive Desktop — opens with your PC, sits in the tray, ready when you need it.
      </p>

      {/* Live OS-registration status pill */}
      <div className={cn(
        'rounded-lg p-3 mb-4 text-[11px] flex items-start gap-2',
        status?.registered
          ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
          : status?.supported && status?.isPackaged
          ? 'bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300'
          : 'bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200'
      )}>
        <span className="text-base leading-none mt-0.5">{status?.registered ? '✓' : status?.isPackaged ? '○' : '⚠'}</span>
        <div>
          <b>OS status:</b>{' '}
          {!status ? 'Checking…' :
            !status.supported ? `Not supported on this platform (${status.reason})` :
            !status.isPackaged ? 'Auto-launch only works in installed builds. In dev mode (npm start) the toggle saves but does NOT register with Windows. Build + install the app once, then the toggle below will actually register.' :
            status.registered ? `Registered with Windows. App will start on login from: ${status.exePath || ''}` :
            'NOT registered with Windows yet. Toggle on below to register.'
          }
        </div>
      </div>

      <div className="space-y-4">
        <ToggleRow
          label="Start CareDesk with Windows"
          subtitle="Launches automatically when you log into Windows. Recommended ON for clinics that keep the app running all day."
          checked={settings.auto_launch}
          onChange={(v) => save.mutate({ auto_launch: v })}
          tone="emerald"
        />
        <ToggleRow
          label="Start minimized to tray"
          subtitle="Skips the main window on launch. App sits in the system tray; click the tray icon to open. Pairs with the toggle above."
          checked={settings.start_minimized}
          onChange={(v) => save.mutate({ start_minimized: v })}
          disabled={!settings.auto_launch}
          tone="indigo"
        />
        <ToggleRow
          label="Minimize to tray when window is closed (X button)"
          subtitle="When ON, clicking X hides the window to the tray instead of quitting. Right-click tray icon → Quit to fully exit."
          checked={settings.minimize_to_tray}
          onChange={(v) => save.mutate({ minimize_to_tray: v })}
          tone="blue"
        />
      </div>
    </section>
  );
}

function ToggleRow({ label, subtitle, checked, onChange, disabled, tone = 'blue' }: {
  label: string; subtitle?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; tone?: 'blue' | 'emerald' | 'indigo';
}) {
  const tones: Record<string, string> = {
    blue: 'bg-blue-600',
    emerald: 'bg-emerald-600',
    indigo: 'bg-indigo-600',
  };
  return (
    <div className={cn('flex items-start justify-between gap-3', disabled && 'opacity-60')}>
      <div className="flex-1">
        <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">{label}</div>
        {subtitle && <div className="text-[11px] text-gray-500 dark:text-slate-400 max-w-xl">{subtitle}</div>}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'w-12 h-7 rounded-full relative transition flex-shrink-0',
          checked ? tones[tone] : 'bg-gray-300 dark:bg-slate-600',
          disabled && 'cursor-not-allowed'
        )}
      >
        <span
          className={cn('absolute top-0.5 w-6 h-6 rounded-full shadow-md transition-all', checked ? 'left-[26px]' : 'left-0.5')}
          style={{ backgroundColor: '#ffffff' }}
        />
      </button>
    </div>
  );
}

function FeesAndFlow() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { draft, set, reset, dirty, save, saving } = useSectionDraft(settings, ['consultation_fee', 'special_price', 'slot_duration', 'queue_flow_enabled', 'appointments_default_sort', 'show_user_badge', 'show_billing_module', 'show_patient_origin']);

  if (!settings) return null;
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4 text-amber-600" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Fees & Queue Flow</h2>
        </div>
        <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="label">Regular Consultation Fee (₹)</label>
          <input
            type="text"
            inputMode="numeric"
            className="input"
            value={draft.consultation_fee == null ? '' : String(draft.consultation_fee)}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9]/g, '');
              set('consultation_fee', v === '' ? 0 : Number(v));
            }}
          />
        </div>
        <div>
          <label className="label">Special Price (₹)</label>
          <input
            type="text"
            inputMode="numeric"
            className="input"
            value={draft.special_price == null ? '' : String(draft.special_price)}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9]/g, '');
              set('special_price', v === '' ? 0 : Number(v));
            }}
          />
        </div>
        <div>
          <label className="label">Slot Duration (minutes)</label>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={240}
            step={1}
            className="input"
            value={draft.slot_duration ?? 30}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              set('slot_duration', Number.isFinite(n) ? Math.max(1, Math.min(240, n)) : 0);
            }}
          />
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">Any value 1–240 min. Common: 5, 10, 15, 20, 30, 45, 60.</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-gray-200 dark:border-slate-700 pt-4">
        <div>
          <label className="label">Default Appointments Sort Order</label>
          <select
            className="input"
            value={draft.appointments_default_sort ?? 'oldest_first'}
            onChange={(e) => set('appointments_default_sort', e.target.value as any)}
          >
            <option value="oldest_first">Oldest first (token #1, #2, #3 …)</option>
            <option value="newest_first">Newest first (latest booking on top)</option>
          </select>
          <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-1">
            What the receptionist sees on opening Appointments. The toggle on the page can override per-session.
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-gray-200 dark:border-slate-700 pt-4">
        <div className="flex items-start gap-3">
          <ListChecks className="w-4 h-4 text-indigo-600 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Queue Flow (Waiting / In Progress / Done)</div>
            <div className="text-[11px] text-gray-500 dark:text-slate-400 max-w-md">
              When off, every appointment is marked Done on booking — status counters and doctor-side queue buttons hide. Turn on if you want to track the live queue during the day.
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => set('queue_flow_enabled', !draft.queue_flow_enabled)}
          className={cn(
            'w-12 h-7 rounded-full relative transition flex-shrink-0',
            draft.queue_flow_enabled ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-slate-600'
          )}
          aria-pressed={!!draft.queue_flow_enabled}
        >
          <span
            className={cn(
              'absolute top-0.5 w-6 h-6 rounded-full shadow-md transition-all',
              draft.queue_flow_enabled ? 'left-[26px]' : 'left-0.5'
            )}
            style={{ backgroundColor: '#ffffff' }}
          />
        </button>
      </div>

      {/* Show user badge in sidebar */}
      <div className="mt-5 flex items-center justify-between border-t border-gray-200 dark:border-slate-700 pt-4">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Show user identity badge in sidebar</div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400 max-w-md">
            The "<i>Reception + Doctor</i>" badge at the bottom of the sidebar.
            Useful when multiple staff log in. For single-user clinics it's just clutter — turn off to hide.
          </div>
        </div>
        <button
          type="button"
          onClick={() => set('show_user_badge', !draft.show_user_badge)}
          className={cn(
            'w-12 h-7 rounded-full relative transition flex-shrink-0',
            draft.show_user_badge ? 'bg-blue-600' : 'bg-gray-300 dark:bg-slate-600'
          )}
          aria-pressed={!!draft.show_user_badge}
        >
          <span
            className={cn(
              'absolute top-0.5 w-6 h-6 rounded-full shadow-md transition-all',
              draft.show_user_badge ? 'left-[26px]' : 'left-0.5'
            )}
            style={{ backgroundColor: '#ffffff' }}
          />
        </button>
      </div>

      {/* Show Billing module in sidebar */}
      <div className="mt-5 flex items-center justify-between border-t border-gray-200 dark:border-slate-700 pt-4">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Show Billing module in sidebar</div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400 max-w-md">
            The Billing page is for the <i>Send to Billing</i> queue + bill history.
            For clinics that take payment upfront at registration the queue is always empty —
            turn off to hide the page entirely. (Past bills are still visible per-patient in <b>Patient Log</b>.)
          </div>
        </div>
        <button
          type="button"
          onClick={() => set('show_billing_module', !draft.show_billing_module)}
          className={cn(
            'w-12 h-7 rounded-full relative transition flex-shrink-0',
            draft.show_billing_module ? 'bg-amber-600' : 'bg-gray-300 dark:bg-slate-600'
          )}
          aria-pressed={!!draft.show_billing_module}
        >
          <span
            className={cn(
              'absolute top-0.5 w-6 h-6 rounded-full shadow-md transition-all',
              draft.show_billing_module ? 'left-[26px]' : 'left-0.5'
            )}
            style={{ backgroundColor: '#ffffff' }}
          />
        </button>
      </div>

      {/* Show Patient Origin in sidebar */}
      <div className="mt-5 flex items-center justify-between border-t border-gray-200 dark:border-slate-700 pt-4">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Show Patient Origin module in sidebar</div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400 max-w-md">
            The Patient Origin page (geographic stats) is also accessible from <b>Analytics → Patient Origin</b>.
            Hide the standalone entry to keep the sidebar slim.
          </div>
        </div>
        <button
          type="button"
          onClick={() => set('show_patient_origin', !draft.show_patient_origin)}
          className={cn(
            'w-12 h-7 rounded-full relative transition flex-shrink-0',
            draft.show_patient_origin ? 'bg-rose-500' : 'bg-gray-300 dark:bg-slate-600'
          )}
          aria-pressed={!!draft.show_patient_origin}
        >
          <span
            className={cn(
              'absolute top-0.5 w-6 h-6 rounded-full shadow-md transition-all',
              draft.show_patient_origin ? 'left-[26px]' : 'left-0.5'
            )}
            style={{ backgroundColor: '#ffffff' }}
          />
        </button>
      </div>
    </section>
  );
}

function FollowupPolicy() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { draft, set, reset, dirty, save, saving } = useSectionDraft(settings, ['followup_enabled', 'followup_window_days', 'followup_free_visits', 'followup_grace_days']);
  if (!settings) return null;
  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Free Follow-up Policy</div>
        <div className="flex items-center gap-2">
          {dirty && <button className="btn-ghost text-xs" onClick={reset}>Reset</button>}
          <button className="btn-primary text-xs" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : dirty ? 'Save changes' : 'All changes saved'}</button>
        </div>
      </div>

      <div className="flex items-start gap-3 border-t border-gray-200 dark:border-slate-700 pt-4">
        <input
          type="checkbox"
          id="followup-enabled"
          checked={!!draft.followup_enabled}
          onChange={(e) => set('followup_enabled', e.target.checked)}
          className="mt-1 w-4 h-4 accent-emerald-600"
        />
        <label htmlFor="followup-enabled" className="flex-1 cursor-pointer">
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Enable free follow-up policy</div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400">
            Every paid visit grants the patient N free follow-ups within X days, with the same doctor. Auto-applied at booking; printed on the OPD slip in English + Kannada.
          </div>
        </label>
      </div>

      {draft.followup_enabled && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-gray-200 dark:border-slate-700 pt-4">
          <div>
            <label className="label">Free follow-up window (days)</label>
            <input type="number" min={1} max={90} className="input"
              value={draft.followup_window_days ?? 7}
              onChange={(e) => set('followup_window_days', Math.max(1, Math.min(90, parseInt(e.target.value, 10) || 1)))}
            />
            <div className="text-[10px] text-gray-500 mt-1">Patients qualify for free visit(s) within this window of their last paid visit.</div>
          </div>
          <div>
            <label className="label">Number of free visits</label>
            <input type="number" min={1} max={10} className="input"
              value={draft.followup_free_visits ?? 2}
              onChange={(e) => set('followup_free_visits', Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)))}
            />
            <div className="text-[10px] text-gray-500 mt-1">How many free follow-ups they get before the next paid visit resets the cycle.</div>
          </div>
          <div>
            <label className="label">Grace / "relaxed" days</label>
            <input type="number" min={0} max={30} className="input"
              value={draft.followup_grace_days ?? 2}
              onChange={(e) => set('followup_grace_days', Math.max(0, Math.min(30, parseInt(e.target.value, 10) || 0)))}
            />
            <div className="text-[10px] text-gray-500 mt-1">Extra days beyond the strict window where the receptionist can MANUALLY grant a courtesy free visit.</div>
          </div>
        </div>
      )}
    </section>
  );
}

function NetworkModeSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { draft, set, reset, dirty } = useSectionDraft(settings, ['network_mode', 'network_listen_port', 'network_server_url', 'network_secret', 'station_name']);
  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ['network-status'],
    queryFn: () => window.electronAPI.network.status(),
    refetchInterval: 5_000,
  });
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<{ ok: boolean; msg: string } | null>(null);

  if (!settings) return null;

  const save = async () => {
    setSaving(true);
    try {
      await window.electronAPI.settings.save({
        network_mode: draft.network_mode,
        network_listen_port: draft.network_listen_port,
        network_server_url: draft.network_server_url,
        network_secret: draft.network_secret,
        station_name: draft.station_name,
      });
      // Mirror mode + url to localStorage so the renderer can pick the right
      // routing at next boot (HTTP wrapper vs IPC).
      try {
        localStorage.setItem('caredesk:network-mode', draft.network_mode || 'local');
        localStorage.setItem('caredesk:network-server-url', draft.network_server_url || '');
        localStorage.setItem('caredesk:network-secret', draft.network_secret || '');
      } catch { /* ignore */ }
      // Restart the LAN server in the main process if needed.
      await window.electronAPI.network.applyMode();
      await qc.invalidateQueries({ queryKey: ['settings'] });
      await refetchStatus();
      toast('Network mode saved · restart the app for client-mode changes to take effect');
    } catch (e: any) {
      toast(e?.message || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const probe = async () => {
    setProbing(true);
    setProbeResult(null);
    try {
      const r = await window.electronAPI.network.probe({ url: draft.network_server_url || '', secret: draft.network_secret });
      if (r.ok) {
        const info = (r as any).info;
        setProbeResult({ ok: true, msg: `✓ Reached ${info.product} v${info.version} · ${info.clients} clients connected · ${info.ipcChannels} channels exposed` });
      } else {
        setProbeResult({ ok: false, msg: `✗ ${(r as any).error}` });
      }
    } finally {
      setProbing(false);
    }
  };

  const mode = draft.network_mode || 'local';

  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Network Mode</div>
        <div className="flex items-center gap-2">
          {dirty && <button className="btn-ghost text-xs" onClick={reset}>Reset</button>}
          <button className="btn-primary text-xs" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : dirty ? 'Save changes' : 'All saved'}</button>
        </div>
      </div>

      {/* BETA banner */}
      <div className="rounded-lg border-2 border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/20 p-3 text-[12px] text-amber-900 dark:text-amber-200">
        <b>⚠️ Beta — foundation only.</b> The Server / Client modes establish the connection and expose every IPC channel as an HTTP endpoint, but the renderer doesn't yet route through them automatically (coming next session). For now this is useful to verify the LAN topology and connectivity before the full sync ships.
      </div>

      {/* Station name (always editable) */}
      <div>
        <label className="label">Station / room name</label>
        <input
          type="text"
          className="input"
          value={draft.station_name || ''}
          onChange={(e) => set('station_name', e.target.value)}
          placeholder='e.g. "Reception Desk", "Cabin 1 — Dr. Patil", "Pharmacy Counter"'
        />
        <div className="text-[10px] text-gray-500 mt-1">Shown on the sidebar pill and (next session) in the host's connected-clients list.</div>
      </div>

      {/* Live status pill */}
      <div className="rounded-lg border-2 border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/40 p-3">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400 mb-1">Live status</div>
        <div className="text-[13px] text-gray-900 dark:text-slate-100 font-mono">
          mode = <b>{status?.mode || '—'}</b>
          {status?.mode === 'server' && (
            <> · server = <b>{status.running ? `running on :${status.port}` : 'NOT running'}</b> · clients = <b>{status.clients}</b> · channels exposed = <b>{status.ipcChannels}</b></>
          )}
          {status?.mode === 'client' && (
            <> · target = <b>{status.serverUrl || '(not set)'}</b></>
          )}
        </div>
      </div>

      {/* Mode picker */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {(['local', 'server', 'client'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => set('network_mode', m)}
            className={cn(
              'rounded-lg border-2 p-3 text-left transition',
              mode === m
                ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20'
                : 'border-gray-200 dark:border-slate-700 hover:border-blue-400 bg-white dark:bg-slate-900'
            )}
          >
            <div className={cn('text-sm font-bold', mode === m ? 'text-blue-900 dark:text-blue-200' : 'text-gray-900 dark:text-slate-100')}>
              {m === 'local' ? 'Local (single PC)' : m === 'server' ? 'Server (this PC hosts)' : 'Client (connect to server)'}
            </div>
            <div className="text-[11px] text-gray-600 dark:text-slate-400 mt-1">
              {m === 'local' && 'Default. Patient data stays on this PC. No LAN required.'}
              {m === 'server' && 'This PC hosts the database AND its own UI. Other CureDesk PCs connect to it.'}
              {m === 'client' && 'No local data. Reads + writes go over the LAN to the configured server URL.'}
            </div>
          </button>
        ))}
      </div>

      {/* Server-mode config */}
      {mode === 'server' && (
        <>
          <ServerJoinCodePanel />
          <MigrationHelper />
        </>
      )}

      {/* Client-mode config */}
      {mode === 'client' && (
        <div className="rounded-lg border border-violet-200 dark:border-violet-900 bg-violet-50/40 dark:bg-violet-900/10 p-4 space-y-3">
          <div className="text-xs font-semibold text-violet-900 dark:text-violet-200">Client settings</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="label">Server URL</label>
              <input type="text" className="input font-mono"
                value={draft.network_server_url || ''}
                onChange={(e) => set('network_server_url', e.target.value)}
                placeholder="http://192.168.1.100:4321" />
              <div className="text-[10px] text-gray-500 mt-1">IP + port of the CureDesk server PC.</div>
            </div>
            <div>
              <label className="label">Shared secret (token)</label>
              <input type="text" className="input font-mono"
                value={draft.network_secret || ''}
                onChange={(e) => set('network_secret', e.target.value)} placeholder="match the server's secret" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-secondary text-xs" onClick={probe} disabled={probing || !draft.network_server_url}>
              {probing ? 'Probing…' : 'Test connection'}
            </button>
            {probeResult && (
              <span className={cn('text-[12px] font-semibold', probeResult.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300')}>
                {probeResult.msg}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** Migration helper — guides the user through getting an existing local DB
 *  onto the chosen server PC. We can't auto-push the file across the LAN
 *  safely (it'd require server endpoints + careful FK ordering), so we hand
 *  the user the existing backup workflow with one-tap defaults. */
function MigrationHelper() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const exportNow = async () => {
    setBusy(true);
    try {
      const r = await window.electronAPI.backup.run();
      if ((r as any).ok) {
        setResult(`Backup written: ${(r as any).bundleDir}`);
        toast('Backup ready — copy that folder to the server PC, then on the server use Settings → Backup → Restore');
      } else {
        toast((r as any).error || 'Backup failed', 'error');
      }
    } catch (e: any) {
      toast(e?.message || 'Backup failed', 'error');
    } finally { setBusy(false); }
  };
  return (
    <div className="rounded-lg border-2 border-amber-300 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-900/15 p-4 space-y-3">
      <div className="text-sm font-bold text-amber-900 dark:text-amber-200">Bringing existing data to the server PC</div>
      <ol className="text-[12px] text-amber-900 dark:text-amber-200 list-decimal pl-5 space-y-1">
        <li>On THIS PC (the one with existing patient data), click <b>Export now</b>. It creates a full backup folder.</li>
        <li>Copy that folder onto a USB stick OR over the LAN to the SERVER PC.</li>
        <li>On the SERVER PC, open Settings → System → Backup, Restore & Updates → <b>Pick Bundle Folder</b> and pick the folder. Confirm restore.</li>
        <li>Server PC now has all your data. Cabin PCs auto-see it once they reconnect.</li>
      </ol>
      <div className="flex items-center gap-2">
        <button className="btn-primary text-xs" onClick={exportNow} disabled={busy}>{busy ? 'Exporting…' : 'Export now'}</button>
        {result && <span className="text-[11px] text-amber-800 dark:text-amber-300 font-mono truncate flex-1">{result}</span>}
      </div>
    </div>
  );
}

/** Big rotating join-code display for Server mode. Same code as the welcome wizard. */
function ServerJoinCodePanel() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: jc, refetch } = useQuery({
    queryKey: ['join-code'],
    queryFn: () => window.electronAPI.network.joinCode(),
    refetchInterval: 5_000,
  });
  const remaining = (() => {
    if (!jc?.expiresAt) return null;
    const sec = Math.max(0, Math.round((jc.expiresAt - Date.now()) / 1000));
    return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  })();
  const display = jc?.code ? `${jc.code.slice(0, 4)}-${jc.code.slice(4)}` : '······';
  const regen = async () => {
    const r = await window.electronAPI.network.regenJoinCode();
    if ((r as any).ok) { toast('New join code minted'); await refetch(); }
    else toast((r as any).error || 'Failed', 'error');
  };
  return (
    <div className="rounded-2xl border-4 border-blue-300 dark:border-blue-700 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest font-bold text-blue-900 dark:text-blue-200">Join Code</div>
          <div className="text-[11px] text-blue-700 dark:text-blue-300">Doctor cabin / pharmacy / billing PCs type this to connect.</div>
        </div>
        <button className="btn-secondary text-xs" onClick={regen}>
          <RefreshCw className="w-3.5 h-3.5" /> New code
        </button>
      </div>
      <div className="text-5xl font-extrabold tracking-[0.3em] font-mono text-blue-900 dark:text-blue-100 text-center my-4">
        {display}
      </div>
      <div className="flex items-center justify-between text-[11px] text-blue-800 dark:text-blue-300">
        <span>{remaining ? `Valid for ${remaining}` : 'Code not minted yet'}</span>
        <span>Host: <span className="font-mono">{jc?.lanIp || '—'}:{jc?.port || '—'}</span></span>
      </div>
    </div>
  );
}

function MiscServicesEditor() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const [list, setList] = useState<string[]>([]);
  const [newSvc, setNewSvc] = useState('');
  const [saving, setSaving] = useState(false);

  // Sync from server only when settings.misc_services CHANGES — not on every render —
  // so the user's in-progress edits don't get clobbered by background refetches.
  useEffect(() => {
    if (!settings) return;
    const csv = settings.misc_services || '';
    const arr = csv.split(',').map((s) => s.trim()).filter(Boolean);
    if (arr.length === 0) arr.push('Other');
    setList(arr);
  }, [settings?.misc_services]);

  // Scroll into view when arriving via the #misc-services anchor on /settings.
  useEffect(() => {
    if (window.location.hash === '#misc-services') {
      const el = document.getElementById('misc-services');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const dirty = settings ? list.join(',') !== (settings.misc_services || '') : false;

  const save = async () => {
    setSaving(true);
    try {
      // Always keep "Other" as a fallback.
      const final = list.filter((s) => s.trim().length > 0);
      if (!final.includes('Other')) final.push('Other');
      await window.electronAPI.settings.save({ misc_services: final.join(',') });
      // Mark settings stale so any active observer (and subsequent mounts)
      // re-fetches; refetchOnMount: 'always' on the consumer pages guarantees fresh data.
      await qc.invalidateQueries({ queryKey: ['settings'] });
      toast('Service list saved');
    } catch (e: any) {
      toast(e?.message || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const addService = () => {
    const v = newSvc.trim();
    if (!v) return;
    if (list.some((s) => s.toLowerCase() === v.toLowerCase())) {
      toast('That service is already in the list', 'error');
      return;
    }
    setList([...list, v]);
    setNewSvc('');
  };

  const removeAt = (i: number) => setList(list.filter((_, idx) => idx !== i));
  const moveUp = (i: number) => {
    if (i === 0) return;
    const next = [...list];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    setList(next);
  };
  const moveDown = (i: number) => {
    if (i === list.length - 1) return;
    const next = [...list];
    [next[i + 1], next[i]] = [next[i], next[i + 1]];
    setList(next);
  };

  if (!settings) return null;

  return (
    <section id="misc-services" className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Quick-pick services</div>
        <button className="btn-primary text-xs" disabled={!dirty || saving} onClick={save}>
          {saving ? 'Saving…' : dirty ? 'Save changes' : 'All changes saved'}
        </button>
      </div>

      <div className="text-[11px] text-gray-500 dark:text-slate-400">
        These chips appear on the Miscellaneous Charges page. The receptionist taps one to quickly tag the service.
        Drag-free reordering with the arrow buttons. <b>"Other"</b> is always kept as a fallback for free-typed descriptions.
      </div>

      {/* Existing services */}
      <ul className="border border-gray-200 dark:border-slate-700 rounded-lg divide-y divide-gray-100 dark:divide-slate-700 overflow-hidden">
        {list.length === 0 && (
          <li className="px-4 py-6 text-center text-xs text-gray-500">No services configured.</li>
        )}
        {list.map((s, i) => (
          <li key={s + i} className="flex items-center gap-2 px-3 py-2">
            <span className="flex-1 text-sm text-gray-900 dark:text-slate-100 font-medium">{s}</span>
            <button
              type="button"
              onClick={() => moveUp(i)}
              disabled={i === 0}
              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Move up"
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => moveDown(i)}
              disabled={i === list.length - 1}
              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Move down"
            >
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => removeAt(i)}
              disabled={s === 'Other'}
              className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed"
              title={s === 'Other' ? '"Other" is always kept' : 'Remove'}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </li>
        ))}
      </ul>

      {/* Add new */}
      <div className="flex items-center gap-2 border-t border-gray-200 dark:border-slate-700 pt-4">
        <input
          className="input flex-1"
          placeholder='New service name (e.g. "ECG", "Minor Surgery", "Cataract Drops")'
          value={newSvc}
          onChange={(e) => setNewSvc(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addService(); } }}
        />
        <button type="button" className="btn-primary" onClick={addService} disabled={!newSvc.trim()}>
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>
    </section>
  );
}

function SlipTemplatesEditor() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: templates = [] } = useQuery({
    queryKey: ['slip-templates'],
    queryFn: () => window.electronAPI.templates.list(),
    refetchOnMount: 'always',
  });
  const [draft, setDraft] = useState<any[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!templates) return;
    setDraft(JSON.parse(JSON.stringify(templates)));
    if (activeId == null && templates.length > 0) setActiveId(templates[0].id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(templates)]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(templates);
  const active = draft.find((t) => t.id === activeId);

  const save = async () => {
    setSaving(true);
    try {
      await window.electronAPI.templates.saveAll(draft);
      await qc.invalidateQueries({ queryKey: ['slip-templates'] });
      toast('Templates saved');
    } catch (e: any) { toast(e?.message || 'Save failed', 'error'); }
    finally { setSaving(false); }
  };

  const addTemplate = () => {
    const id = Math.max(0, ...draft.map((t) => t.id)) + 1;
    const next = [...draft, {
      id,
      name: `Template ${id}`,
      specialty_hint: '',
      sections: [
        { key: 'history', title: 'Chief Complaints / History', type: 'textarea', height_mm: 50, printed: true },
        { key: 'examination', title: 'Examination', type: 'textarea', height_mm: 50, printed: true },
        { key: 'impression', title: 'Impression / Diagnosis', type: 'textarea', height_mm: 22, printed: true },
        { key: 'advice', title: 'Advice / Prescription (Rx)', type: 'textarea', height_mm: 50, printed: true },
      ],
    }];
    setDraft(next);
    setActiveId(id);
  };

  const deleteTemplate = (id: number) => {
    if (draft.length <= 1) { toast('At least one template is required', 'error'); return; }
    const next = draft.filter((t) => t.id !== id);
    setDraft(next);
    if (activeId === id) setActiveId(next[0]?.id ?? null);
  };

  const renameTemplate = (id: number, patch: { name?: string; specialty_hint?: string }) => {
    setDraft(draft.map((t) => t.id === id ? { ...t, ...patch } : t));
  };

  const updateSections = (id: number, sections: any[]) => {
    setDraft(draft.map((t) => t.id === id ? { ...t, sections } : t));
  };

  const addSection = () => {
    if (!active) return;
    const newKey = `field_${Date.now()}`;
    updateSections(active.id, [...active.sections, {
      key: newKey, title: 'New Field', type: 'singleline', height_mm: 8, printed: true,
    }]);
  };

  const removeSection = (idx: number) => {
    if (!active) return;
    updateSections(active.id, active.sections.filter((_: any, i: number) => i !== idx));
  };

  const moveSection = (idx: number, dir: -1 | 1) => {
    if (!active) return;
    const next = [...active.sections];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    updateSections(active.id, next);
  };

  const updateSection = (idx: number, patch: any) => {
    if (!active) return;
    updateSections(active.id, active.sections.map((s: any, i: number) => i === idx ? { ...s, ...patch } : s));
  };

  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Slip Body Templates</div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary text-xs" onClick={addTemplate}>
            <Plus className="w-3.5 h-3.5" /> New template
          </button>
          <button className="btn-primary text-xs" disabled={!dirty || saving} onClick={save}>
            {saving ? 'Saving…' : dirty ? 'Save all changes' : 'All saved'}
          </button>
        </div>
      </div>

      <div className="text-[11px] text-gray-500 dark:text-slate-400">
        Each template defines the BODY sections of the consultation panel + printed slip
        (between the header/patient block and the signature). The reserved keys
        <code className="font-mono mx-1 px-1 rounded bg-gray-100 dark:bg-slate-800">history</code>
        <code className="font-mono mx-1 px-1 rounded bg-gray-100 dark:bg-slate-800">examination</code>
        <code className="font-mono mx-1 px-1 rounded bg-gray-100 dark:bg-slate-800">impression</code>
        <code className="font-mono mx-1 px-1 rounded bg-gray-100 dark:bg-slate-800">advice</code>
        map to the existing consultation columns; any other key is stored as a custom field.
        Assign templates to doctors in the <b>Doctors</b> section above.
      </div>

      {/* Template picker */}
      <div className="flex flex-wrap gap-2 border-t border-gray-200 dark:border-slate-700 pt-4">
        {draft.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveId(t.id)}
            className={cn(
              'px-3 py-1.5 text-xs rounded-md border-2 font-semibold',
              activeId === t.id
                ? 'bg-blue-600 text-white border-blue-700'
                : 'bg-white dark:bg-slate-800 border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200 hover:border-blue-400'
            )}
          >
            {t.name}
          </button>
        ))}
      </div>

      {active && (
        <div className="space-y-4 border-t border-gray-200 dark:border-slate-700 pt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="label">Template name</label>
              <input className="input" value={active.name} onChange={(e) => renameTemplate(active.id, { name: e.target.value })} />
            </div>
            <div>
              <label className="label">Specialty hint (shown in pickers)</label>
              <input className="input" value={active.specialty_hint || ''} onChange={(e) => renameTemplate(active.id, { specialty_hint: e.target.value })} />
            </div>
          </div>

          {/* Section list */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-gray-900 dark:text-slate-100">Sections (in print order)</div>
              <button className="btn-secondary text-xs" onClick={addSection}><Plus className="w-3.5 h-3.5" /> Add section</button>
            </div>
            <ul className="space-y-2">
              {active.sections.map((s: any, idx: number) => (
                <li key={idx} className="rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900/40 p-3">
                  <div className="flex items-start gap-2">
                    <div className="flex flex-col gap-0.5">
                      <button onClick={() => moveSection(idx, -1)} disabled={idx === 0}
                        className="p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-30" title="Move up">
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button onClick={() => moveSection(idx, 1)} disabled={idx === active.sections.length - 1}
                        className="p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-30" title="Move down">
                        <ArrowDown className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-2">
                      <div className="md:col-span-2">
                        <label className="label !mb-0.5 !text-[10px]">Title</label>
                        <input className="input !py-1 !text-xs" value={s.title} onChange={(e) => updateSection(idx, { title: e.target.value })} />
                      </div>
                      <div>
                        <label className="label !mb-0.5 !text-[10px]">Key</label>
                        <input className="input !py-1 !text-xs font-mono" value={s.key} onChange={(e) => updateSection(idx, { key: e.target.value.replace(/[^a-z0-9_]/gi, '_').toLowerCase() })} />
                      </div>
                      <div>
                        <label className="label !mb-0.5 !text-[10px]">Type</label>
                        <select className="input !py-1 !text-xs" value={s.type} onChange={(e) => updateSection(idx, { type: e.target.value })}>
                          <option value="textarea">Textarea (multi-line)</option>
                          <option value="singleline">Single line</option>
                          <option value="date">Date</option>
                          <option value="number">Number</option>
                          <option value="dropdown">Dropdown</option>
                        </select>
                      </div>
                      {(s.type === 'textarea' || s.type === 'singleline') && (
                        <div>
                          <label className="label !mb-0.5 !text-[10px]">Print height (mm)</label>
                          <input type="number" min={5} max={120} className="input !py-1 !text-xs" value={s.height_mm ?? 20} onChange={(e) => updateSection(idx, { height_mm: parseInt(e.target.value, 10) || 20 })} />
                        </div>
                      )}
                      {s.type === 'dropdown' && (
                        <div className="md:col-span-2">
                          <label className="label !mb-0.5 !text-[10px]">Options (comma-separated)</label>
                          <input className="input !py-1 !text-xs" value={(s.options || []).join(', ')} onChange={(e) => updateSection(idx, { options: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
                        </div>
                      )}
                      <div className="md:col-span-2">
                        <label className="label !mb-0.5 !text-[10px]">Placeholder</label>
                        <input className="input !py-1 !text-xs" value={s.placeholder || ''} onChange={(e) => updateSection(idx, { placeholder: e.target.value })} />
                      </div>
                      <label className="inline-flex items-center gap-1.5 text-[11px] mt-4 cursor-pointer">
                        <input type="checkbox" checked={s.printed !== false} onChange={(e) => updateSection(idx, { printed: e.target.checked })} className="w-3.5 h-3.5 accent-blue-600" />
                        <span>Print on slip</span>
                      </label>
                      <button onClick={() => removeSection(idx)} className="self-start mt-3 text-[11px] text-red-600 hover:text-red-700 inline-flex items-center gap-1">
                        <Trash2 className="w-3 h-3" /> Remove
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {draft.length > 1 && (
            <div className="border-t border-gray-200 dark:border-slate-700 pt-3">
              <button onClick={() => deleteTemplate(active.id)} className="text-xs text-red-600 hover:text-red-700 inline-flex items-center gap-1">
                <Trash2 className="w-3.5 h-3.5" /> Delete template "{active.name}"
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function RegistrationFeePolicy() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { draft, set, reset, dirty, save, saving } = useSectionDraft(settings, ['registration_fee_enabled', 'registration_fee_amount', 'registration_fee_default_timing']);
  if (!settings) return null;
  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Patient Registration Fee</div>
        <div className="flex items-center gap-2">
          {dirty && <button className="btn-ghost text-xs" onClick={reset}>Reset</button>}
          <button className="btn-primary text-xs" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : dirty ? 'Save changes' : 'All changes saved'}</button>
        </div>
      </div>

      <div className="flex items-start gap-3 border-t border-gray-200 dark:border-slate-700 pt-4">
        <input
          type="checkbox"
          id="regfee-enabled"
          checked={!!draft.registration_fee_enabled}
          onChange={(e) => set('registration_fee_enabled', e.target.checked)}
          className="mt-1 w-4 h-4 accent-amber-600"
        />
        <label htmlFor="regfee-enabled" className="flex-1 cursor-pointer">
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Enable patient registration fee</div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400">
            One-time charge per patient. Tracked separately on bills and analytics. Once paid, never asked again.
          </div>
        </label>
      </div>

      {draft.registration_fee_enabled && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-gray-200 dark:border-slate-700 pt-4">
          <div>
            <label className="label">Registration fee (₹)</label>
            <input type="number" min={0} max={10000} className="input"
              value={draft.registration_fee_amount ?? 100}
              onChange={(e) => set('registration_fee_amount', Math.max(0, Math.min(10000, parseInt(e.target.value, 10) || 0)))}
            />
          </div>
          <div>
            <label className="label">Default collection timing</label>
            <select className="input"
              value={draft.registration_fee_default_timing ?? 'ask'}
              onChange={(e) => set('registration_fee_default_timing', e.target.value as any)}
            >
              <option value="ask">Ask each time (toggle defaults ON in booking)</option>
              <option value="at_registration">Always collect at patient registration</option>
              <option value="at_first_appointment">Always collect at first appointment</option>
            </select>
            <div className="text-[10px] text-gray-500 mt-1">Receptionist can override per case. This is just the default checkbox state.</div>
          </div>
        </div>
      )}
    </section>
  );
}

type DeleteState =
  | null
  | { mode: 'confirm'; doctor: Doctor }  // First "Are you sure?" popup
  | {
      mode: 'has_records';
      doctor: Doctor;
      counts: { appointments: number; consultations: number; lab_orders: number; ip_admissions: number };
      total: number;
    };

/** Show name without doubling 'Dr.' when the stored name already starts with it. */
function dispName(name: string | undefined): string {
  if (!name) return '';
  return /^dr\.?\s/i.test(name) ? name : `Dr. ${name}`;
}

function DoctorsManagement() {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Partial<Doctor> | null>(null);
  const [deleteState, setDeleteState] = useState<DeleteState>(null);
  const [deleting, setDeleting] = useState(false);

  const { data: doctors = [] } = useQuery({
    queryKey: ['doctors-all'],
    queryFn: () => window.electronAPI.doctors.list(false),
  });

  const refreshDoctors = () => {
    qc.invalidateQueries({ queryKey: ['doctors'] });
    qc.invalidateQueries({ queryKey: ['doctors-all'] });
  };

  const saveMut = useMutation({
    mutationFn: (d: Partial<Doctor>) =>
      d.id ? window.electronAPI.doctors.update(d.id, d) : window.electronAPI.doctors.create(d),
    onSuccess: () => {
      refreshDoctors();
      toast('Doctor saved');
      setEditing(null);
    },
  });

  // Step 1: clicking Delete just opens the "Are you sure?" popup IMMEDIATELY.
  // No IPC call until the user actually confirms.
  const askDelete = (doc: Doctor) => {
    setDeleteState({ mode: 'confirm', doctor: doc });
  };

  // Step 2: user confirmed in the popup → actually try to delete via IPC.
  const reallyDelete = async () => {
    if (!deleteState) return;
    const doc = deleteState.doctor;
    setDeleting(true);
    try {
      // Defensive: the new IPC may not be loaded if the user is on a stale
      // main process (no full restart since the IPC was added).
      if (typeof window.electronAPI.doctors.delete !== 'function') {
        toast('Delete is unavailable — please fully close and reopen the app to load the new feature.', 'error');
        return;
      }
      const r = await window.electronAPI.doctors.delete(doc.id);
      if (r.ok) {
        toast(`${dispName((r as any).doctorName || doc.name)} deleted`);
        refreshDoctors();
        setDeleteState(null);
        setEditing(null);
        return;
      }
      // Refused because of historical records — switch popup to inactive offer.
      const hr = r as any;
      if (hr.mode === 'has_records' && hr.counts) {
        setDeleteState({ mode: 'has_records', doctor: doc, counts: hr.counts, total: hr.total });
        return;
      }
      toast(hr.error || 'Delete failed', 'error');
    } catch (e: any) {
      toast(e?.message || 'Delete failed unexpectedly', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const markInactive = async (doc: Doctor) => {
    setDeleting(true);
    try {
      if (typeof window.electronAPI.doctors.deactivate !== 'function') {
        toast('Mark Inactive is unavailable — please fully close and reopen the app.', 'error');
        return;
      }
      const r = await window.electronAPI.doctors.deactivate(doc.id);
      if (r.ok) {
        toast(`${dispName(r.doctorName || doc.name)} marked Inactive — won't appear in new bookings`);
        refreshDoctors();
        setDeleteState(null);
        setEditing(null);
      } else {
        toast(r.error || 'Failed to mark inactive', 'error');
      }
    } catch (e: any) {
      toast(e?.message || 'Failed to mark inactive', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Stethoscope className="w-4 h-4 text-purple-600" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Doctors</h2>
        </div>
        <button className="btn-primary" onClick={() => setEditing({ is_active: 1, default_fee: 500 })}>
          <Plus className="w-4 h-4" /> Add Doctor
        </button>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b border-gray-200 dark:border-slate-700 text-xs uppercase text-gray-500 dark:text-slate-400">
            <th className="py-2 px-2 w-10">Color</th>
            <th className="py-2 px-2">Name</th>
            <th className="py-2 px-2">Specialty</th>
            <th className="py-2 px-2 w-16">Room</th>
            <th className="py-2 px-3 text-right w-24 border-l border-gray-200 dark:border-slate-700">Fee</th>
            <th className="py-2 px-3 w-32 border-l border-gray-200 dark:border-slate-700">Signature</th>
            <th className="py-2 px-2 w-20">Status</th>
            <th className="py-2 px-2"></th>
          </tr>
        </thead>
        <tbody>
          {doctors.map((d) => (
            <tr key={d.id} className="border-b border-gray-100 dark:border-slate-800">
              <td className="py-2 px-2">
                <span
                  className="inline-block w-4 h-4 rounded-full ring-2 ring-white dark:ring-slate-800 shadow"
                  style={{ backgroundColor: colorForDoctor(d) }}
                  title={d.color ? `Custom: ${d.color}` : 'Auto-assigned color'}
                />
              </td>
              <td className="py-2 px-2 font-medium text-gray-900 dark:text-slate-100">{d.name}</td>
              <td className="py-2 px-2 text-gray-600 dark:text-slate-300">{d.specialty}</td>
              <td className="py-2 px-2 text-gray-600 dark:text-slate-300">{d.room_number || '—'}</td>
              <td className="py-2 px-3 text-right font-semibold border-l border-gray-100 dark:border-slate-800">
                ₹{d.default_fee}
              </td>
              <td className="py-2 px-3 border-l border-gray-100 dark:border-slate-800">
                {d.signature ? (
                  <img src={d.signature} className="h-7 max-w-[100px] object-contain" alt="signature" />
                ) : (
                  <span className="text-[11px] text-gray-400 italic">— not set —</span>
                )}
              </td>
              <td className="py-2 px-2">
                <span className={d.is_active ? 'badge bg-green-100 text-green-700' : 'badge bg-gray-200 text-gray-600'}>
                  {d.is_active ? 'Active' : 'Inactive'}
                </span>
              </td>
              <td className="py-2 text-right whitespace-nowrap">
                <button className="btn-ghost text-xs" onClick={() => setEditing(d)}>
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </button>
                <button
                  className="text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
                  onClick={() => askDelete(d)}
                  title="Delete this doctor"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit Doctor' : 'Add Doctor'} size="lg">
        {editing && (
          <div className="space-y-5">
            {/* ========= SECTION 1: PROFILE ========= */}
            <DoctorSection icon={<UserIcon className="w-4 h-4" />} title="Profile" subtitle="Identity, contact, room and color tag">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Name *">
                  <input className="input" value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                </Field>
                <Field label="Specialty *">
                  <input className="input" value={editing.specialty || ''} onChange={(e) => setEditing({ ...editing, specialty: e.target.value })} />
                </Field>
                <div className="col-span-2">
                  <Field label="Qualifications / Degrees (shown on OPD slip)">
                    <input
                      className="input"
                      placeholder="e.g. MBBS, MD (Medicine), DNB Cardiology"
                      value={editing.qualifications || ''}
                      onChange={(e) => setEditing({ ...editing, qualifications: e.target.value })}
                    />
                  </Field>
                </div>
                <Field label="Medical Registration No.">
                  <input
                    className="input"
                    placeholder="e.g. KMC-12345"
                    value={editing.registration_no || ''}
                    onChange={(e) => setEditing({ ...editing, registration_no: e.target.value })}
                  />
                </Field>
                <Field label="Phone">
                  <input className="input" value={editing.phone || ''} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
                </Field>
                <Field label="Email">
                  <input className="input" value={editing.email || ''} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
                </Field>
                <Field label="Room Number">
                  <input className="input" value={editing.room_number || ''} onChange={(e) => setEditing({ ...editing, room_number: e.target.value })} />
                </Field>
                <Field label="Available From (optional)">
                  <input
                    type="time"
                    className="input"
                    value={editing.available_from || ''}
                    onChange={(e) => setEditing({ ...editing, available_from: e.target.value || null })}
                  />
                </Field>
                <Field label="Available To (optional)">
                  <input
                    type="time"
                    className="input"
                    value={editing.available_to || ''}
                    onChange={(e) => setEditing({ ...editing, available_to: e.target.value || null })}
                  />
                </Field>
              </div>
              {(editing.available_from || editing.available_to) && (
                <div className="text-[11px] text-blue-700 dark:text-blue-300 -mt-2 px-1">
                  💡 Bookings outside <b>{editing.available_from || '—'} – {editing.available_to || '—'}</b> will be blocked at save time.
                  Leave both blank to allow any time.
                </div>
              )}

              {/* OPD Slip body template picker */}
              <DoctorTemplatePicker
                value={editing.template_id ?? null}
                onChange={(id) => setEditing({ ...editing, template_id: id })}
              />

              {/* Color picker */}
              <div className="mt-4">
                <label className="label flex items-center justify-between">
                  <span>Color Tag (visual identifier across the app)</span>
                  {editing.color && (
                    <button
                      type="button"
                      className="text-[11px] text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200"
                      onClick={() => setEditing({ ...editing, color: null })}
                      title="Clear and use auto-assigned color"
                    >
                      Clear (use auto)
                    </button>
                  )}
                </label>
                <div className="flex flex-wrap gap-2">
                  {DOCTOR_COLOR_OPTIONS.map((c) => {
                    const selected = (editing.color || '').toLowerCase() === c.hex.toLowerCase();
                    return (
                      <button
                        key={c.hex}
                        type="button"
                        onClick={() => setEditing({ ...editing, color: c.hex })}
                        title={c.label}
                        className={cn(
                          'relative w-9 h-9 rounded-lg shadow-sm transition active:scale-95',
                          selected ? 'ring-2 ring-offset-2 ring-gray-900 dark:ring-white scale-110' : 'hover:scale-105'
                        )}
                        style={{ backgroundColor: c.hex }}
                      >
                        {selected && <Check className="w-4 h-4 text-white absolute inset-0 m-auto" strokeWidth={3} />}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 flex items-center gap-2 text-[11px] text-gray-600 dark:text-slate-300">
                  <span>Currently:</span>
                  <span
                    className="inline-block w-4 h-4 rounded-full ring-2 ring-white dark:ring-slate-700 shadow"
                    style={{ backgroundColor: colorForDoctor(editing as Doctor) }}
                  />
                  <span className="font-mono">{editing.color || '(auto)'}</span>
                </div>
              </div>

              {/* Active toggle */}
              <div className="mt-4 flex items-center justify-between border-t border-gray-200 dark:border-slate-700 pt-3">
                <div className="flex items-start gap-2">
                  <Power className={cn('w-4 h-4 mt-0.5', editing.is_active === 1 ? 'text-emerald-600' : 'text-gray-400')} />
                  <div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Active</div>
                    <div className="text-[11px] text-gray-500 dark:text-slate-400">
                      Inactive doctors don't appear in new appointment bookings; their history stays.
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditing({ ...editing, is_active: editing.is_active === 1 ? 0 : 1 })}
                  className={cn(
                    'w-12 h-7 rounded-full relative transition flex-shrink-0',
                    editing.is_active === 1 ? 'bg-emerald-600' : 'bg-gray-300 dark:bg-slate-600'
                  )}
                >
                  <span
                    className={cn('absolute top-0.5 w-6 h-6 rounded-full shadow-md transition-all', editing.is_active === 1 ? 'left-[26px]' : 'left-0.5')}
                    style={{ backgroundColor: '#ffffff' }}
                  />
                </button>
              </div>
            </DoctorSection>

            {/* ========= SECTION 2: FEES ========= */}
            <DoctorSection icon={<IndianRupee className="w-4 h-4" />} title="Fees" subtitle="Default consultation fee charged at booking" tone="amber">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Default Consultation Fee (₹)">
                  <DoctorFeeInput
                    value={editing.default_fee}
                    onChange={(n) => setEditing({ ...editing, default_fee: n })}
                  />
                  <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-1">
                    Receptionist can override per booking using "Special" or "Custom" fee options.
                  </div>
                </Field>
              </div>
            </DoctorSection>

            {/* ========= SECTION 3: SIGNATURE ========= */}
            <DoctorSection icon={<PenTool className="w-4 h-4" />} title="Signature" subtitle="Printed on the OPD slip above the doctor's name" tone="violet">
              <ImageUpload
                label="Signature image"
                value={editing.signature}
                onChange={(v) => setEditing({ ...editing, signature: v })}
                aspect="wide"
                placeholder="Upload JPG / PNG signature"
                hint="Upload a high-quality scanned signature (JPG / PNG). Max 5 MB. Transparent PNG or white background gives the cleanest print."
              />
            </DoctorSection>

            {/* ========= ACTION BAR ========= */}
            <div className="flex items-center justify-between gap-2 pt-4 border-t border-gray-200 dark:border-slate-700">
              {editing.id ? (
                <button
                  className="text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 inline-flex items-center gap-1 px-3 py-2 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
                  onClick={() => askDelete(editing as Doctor)}
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete this doctor
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
                <button className="btn-primary" onClick={() => saveMut.mutate(editing)} disabled={saveMut.isPending}>
                  {saveMut.isPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ========= DELETE CONFIRMATION MODAL ========= */}
      <Modal
        open={!!deleteState}
        onClose={() => !deleting && setDeleteState(null)}
        title={
          deleteState?.mode === 'has_records'
            ? `Cannot permanently delete ${dispName(deleteState.doctor.name)}`
            : deleteState?.doctor
            ? `Are you sure you want to delete ${dispName(deleteState.doctor.name)}?`
            : ''
        }
        size="md"
      >
        {deleteState?.mode === 'confirm' && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 rounded">
              <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-gray-800 dark:text-slate-200">
                You're about to delete <b>{dispName(deleteState.doctor.name)}</b> ({deleteState.doctor.specialty}).
                <br /><br />
                If this doctor has past appointments or consultations, the app will offer to mark
                them <b>Inactive</b> instead so historical records are preserved.
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setDeleteState(null)} disabled={deleting}>
                Cancel
              </button>
              <button className="btn-danger" onClick={reallyDelete} disabled={deleting}>
                <Trash2 className="w-4 h-4" /> {deleting ? 'Deleting…' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        )}

        {deleteState?.mode === 'has_records' && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-800 rounded">
              <AlertCircle className="w-5 h-5 text-amber-700 dark:text-amber-300 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-gray-800 dark:text-slate-200">
                {dispName(deleteState.doctor.name)} has <b>{deleteState.total} historical record(s)</b> in the database.
                Permanent deletion would orphan that data, which is not safe.
              </div>
            </div>
            <div className="border border-gray-200 dark:border-slate-700 rounded overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-slate-800 text-[10px] uppercase text-gray-500 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-1.5 text-left">Record type</th>
                    <th className="px-3 py-1.5 text-right">Count</th>
                  </tr>
                </thead>
                <tbody>
                  <DepRow label="Appointments" count={deleteState.counts.appointments} />
                  <DepRow label="Consultations / EMR" count={deleteState.counts.consultations} />
                  <DepRow label="Lab orders" count={deleteState.counts.lab_orders} />
                  <DepRow label="IP admissions" count={deleteState.counts.ip_admissions} />
                </tbody>
              </table>
            </div>
            <div className="text-[12px] text-gray-700 dark:text-slate-300 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900 rounded p-2.5">
              <b>Recommended:</b> mark the doctor <b>Inactive</b> instead. They won't appear in
              new appointment bookings, but all past records (and the doctor's name on those slips)
              stay intact for audit and patient history.
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setDeleteState(null)} disabled={deleting}>
                Cancel
              </button>
              <button className="btn-warning" onClick={() => markInactive(deleteState.doctor)} disabled={deleting}>
                <Power className="w-4 h-4" /> {deleting ? 'Updating…' : 'Mark as Inactive'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}

function DoctorSection({
  icon, title, subtitle, tone = 'blue', children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  tone?: 'blue' | 'amber' | 'violet';
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    blue: 'border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-900/10 text-blue-800 dark:text-blue-300',
    amber: 'border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-900/10 text-amber-800 dark:text-amber-300',
    violet: 'border-violet-200 dark:border-violet-900 bg-violet-50/50 dark:bg-violet-900/10 text-violet-800 dark:text-violet-300',
  };
  return (
    <div className={cn('rounded-lg border', tones[tone])}>
      <div className="flex items-start gap-2 px-4 py-2 border-b border-current/20">
        <span className="mt-0.5">{icon}</span>
        <div>
          <div className="text-xs font-bold uppercase tracking-wider">{title}</div>
          {subtitle && <div className="text-[10px] opacity-80">{subtitle}</div>}
        </div>
      </div>
      <div className="p-4 bg-white dark:bg-slate-900/50 rounded-b-lg">
        {children}
      </div>
    </div>
  );
}

function DepRow({ label, count }: { label: string; count: number }) {
  if (count === 0) return null;
  return (
    <tr className="border-t border-gray-100 dark:border-slate-800">
      <td className="px-3 py-1.5 text-gray-900 dark:text-slate-100">{label}</td>
      <td className="px-3 py-1.5 text-right font-mono font-semibold">{count.toLocaleString('en-IN')}</td>
    </tr>
  );
}

/** Inline picker so the doctor edit form can assign an OPD-slip body template. */
function DoctorTemplatePicker({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const { data: templates = [] } = useQuery({
    queryKey: ['slip-templates'],
    queryFn: () => window.electronAPI.templates.list(),
  });
  return (
    <div className="mt-4">
      <label className="label">OPD Slip Body Template</label>
      <select
        className="input"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">— Use General (default) —</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}{t.specialty_hint ? ` · ${t.specialty_hint}` : ''}
          </option>
        ))}
      </select>
      <div className="text-[10px] text-gray-500 mt-1">
        Drives the body sections shown on the doctor's consultation panel and printed slip. Edit templates in the <b>OPD Slip Body Templates</b> section above.
      </div>
    </div>
  );
}

type UpdateState = {
  state: 'idle' | 'checking' | 'uptodate' | 'available' | 'error';
  appVersion?: string;
  currentVersion?: string;
  latestVersion?: string;
  releaseNotes?: string;
  releaseUrl?: string;
  downloadUrl?: string;
  isPackaged?: boolean;
  checkedAt?: string;
  error?: string;
};

/** Honest status panel for the update check. Colored card per state, real
 *  version numbers, and a real "Download & Install" button when an update
 *  is available (opens the new Setup.exe in the user's browser). */
function UpdateStatusPanel({
  state, checking, onCheck, onInstall,
}: {
  state: UpdateState | undefined;
  checking: boolean;
  onCheck: () => void;
  onInstall: () => void;
}) {
  const v = state?.appVersion || state?.currentVersion || '?';
  const latest = state?.latestVersion;
  const dev = state && !state.isPackaged;

  // Colored panel per state.
  const variant = (() => {
    if (dev) return { panel: 'border-amber-300 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-900/10', dot: '#f59e0b' };
    if (state?.state === 'available') return { panel: 'border-blue-400 dark:border-blue-700 bg-blue-50/60 dark:bg-blue-900/20', dot: '#2563eb' };
    if (state?.state === 'uptodate') return { panel: 'border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/15', dot: '#059669' };
    if (state?.state === 'error') return { panel: 'border-red-300 dark:border-red-800 bg-red-50/50 dark:bg-red-900/15', dot: '#dc2626' };
    return { panel: 'border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/40', dot: '#94a3b8' };
  })();

  return (
    <div className={cn('rounded-lg border-2 p-4', variant.panel)}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <span className="inline-block w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: variant.dot }} />
          <div className="min-w-0 flex-1">
            {dev && (
              <>
                <div className="text-sm font-semibold text-amber-900 dark:text-amber-200">Dev mode — update checks are disabled</div>
                <div className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">Updates only run on the installed CureDesk HMS, not when launched via <code className="font-mono">npm start</code>.</div>
              </>
            )}
            {!dev && state?.state === 'checking' && (
              <>
                <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 inline-flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking GitHub for new releases…
                </div>
                <div className="text-[11px] text-gray-600 dark:text-slate-400 mt-0.5">Current version: <span className="font-mono">{v}</span></div>
              </>
            )}
            {!dev && state?.state === 'uptodate' && (
              <>
                <div className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">✓ You're on the latest version</div>
                <div className="text-[11px] text-emerald-800 dark:text-emerald-300 mt-0.5">
                  Current version: <span className="font-mono">{v}</span>
                  {latest && latest !== v && <> · GitHub latest: <span className="font-mono">{latest}</span></>}
                  {state.checkedAt && <> · Checked {(() => { try { return new Date(state.checkedAt).toLocaleTimeString(); } catch { return state.checkedAt; } })()}</>}
                </div>
              </>
            )}
            {!dev && state?.state === 'available' && (
              <>
                <div className="text-sm font-semibold text-blue-900 dark:text-blue-200">
                  🚀 New version <span className="font-mono">{latest}</span> available
                </div>
                <div className="text-[11px] text-blue-800 dark:text-blue-300 mt-0.5">
                  You're on <span className="font-mono">{v}</span> · click <b>Download &amp; Install</b> to grab the new Setup.exe. Your patient data stays untouched.
                </div>
                {state.releaseNotes && (
                  <details className="mt-2 text-[11px] text-gray-700 dark:text-slate-300">
                    <summary className="cursor-pointer text-blue-700 dark:text-blue-400 font-semibold">Release notes</summary>
                    <pre className="mt-1 whitespace-pre-wrap font-mono text-[10px] bg-white/50 dark:bg-slate-900/40 p-2 rounded max-h-40 overflow-auto">{state.releaseNotes}</pre>
                  </details>
                )}
              </>
            )}
            {!dev && state?.state === 'error' && (
              <>
                <div className="text-sm font-semibold text-red-900 dark:text-red-200">Couldn't reach GitHub</div>
                <div className="text-[11px] text-red-800 dark:text-red-300 mt-0.5 break-all">{state.error || 'Unknown error'}</div>
                <div className="text-[11px] text-red-700 dark:text-red-400 mt-1">Check your internet connection and try again.</div>
              </>
            )}
            {!dev && state?.state === 'idle' && (
              <>
                <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Update check not run yet today</div>
                <div className="text-[11px] text-gray-600 dark:text-slate-400 mt-0.5">Current version: <span className="font-mono">{v}</span> · Click <b>Check now</b> to test.</div>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button type="button" className="btn-secondary text-xs" onClick={onCheck} disabled={checking}>
            {checking ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking…</> : <><RefreshCw className="w-3.5 h-3.5" /> Check now</>}
          </button>
          {state?.state === 'available' && (
            <button type="button" className="btn-primary text-xs" onClick={onInstall}>
              <ArrowRight className="w-3.5 h-3.5" /> Download &amp; Install
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

// Local-string-backed numeric input. Lets the user clear the field and type
// freely without parent-side `0` coercion clobbering each keystroke. Commits
// the parsed number upward on every change; commits 0 when blanked.
function DoctorFeeInput({ value, onChange }: { value: number | undefined; onChange: (n: number) => void }) {
  const [text, setText] = useState<string>(value == null ? '' : String(value));
  // Re-sync from parent ONLY when the parent value changes from outside (e.g. opening a different doctor).
  useEffect(() => {
    const parsed = text === '' ? 0 : Number(text);
    if (parsed !== (value ?? 0)) setText(value == null ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-slate-400 pointer-events-none">₹</span>
      <input
        type="text"
        inputMode="numeric"
        className="input pl-7"
        value={text}
        onChange={(e) => {
          const cleaned = e.target.value.replace(/[^0-9]/g, '');
          setText(cleaned);
          onChange(cleaned === '' ? 0 : Number(cleaned));
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
      />
    </div>
  );
}

function LazyInput({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} />
    </div>
  );
}

function TxtField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function SaveBar({ dirty, saving, onSave, onReset }: { dirty: boolean; saving: boolean; onSave: () => void; onReset: () => void }) {
  if (!dirty && !saving) {
    return <span className="text-[11px] text-gray-400 dark:text-slate-500 italic">All changes saved</span>;
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-amber-700 dark:text-amber-300 font-medium">Unsaved changes</span>
      <button type="button" className="btn-secondary text-xs" onClick={onReset} disabled={saving}>Reset</button>
      <button type="button" className="btn-primary text-xs" onClick={onSave} disabled={saving}>
        <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save Changes'}
      </button>
    </div>
  );
}

function useSectionDraft<K extends keyof Settings>(
  settings: Settings | undefined,
  keys: K[],
  opts: { extraInvalidateKeys?: any[][] } = {}
) {
  const qc = useQueryClient();
  const toast = useToast();
  const initial = (): Partial<Pick<Settings, K>> => {
    if (!settings) return {};
    const out: any = {};
    for (const k of keys) out[k] = settings[k];
    return out;
  };
  const [draft, setDraft] = useState<Partial<Pick<Settings, K>>>(initial);
  // Sync draft when settings load / change externally (but don't clobber local edits)
  useEffect(() => {
    if (!settings) return;
    setDraft((cur) => {
      // If draft is already dirty on a key, keep the local version.
      const next: any = { ...cur };
      for (const k of keys) if (next[k] === undefined) next[k] = settings[k];
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.clinic_name, settings?.clinic_address, settings?.clinic_phone, settings?.clinic_email, settings?.clinic_tagline, settings?.clinic_registration_no, settings?.default_state, settings?.default_district, settings?.known_villages, settings?.consultation_fee, settings?.special_price, settings?.slot_duration, settings?.queue_flow_enabled]);

  const dirty = !!settings && keys.some((k) => draft[k] !== settings[k]);

  const mutation = useMutation({
    mutationFn: (patch: Partial<Settings>) => window.electronAPI.settings.save(patch),
    onSuccess: async () => {
      await qc.refetchQueries({ queryKey: ['settings'] });
      for (const key of opts.extraInvalidateKeys || []) qc.invalidateQueries({ queryKey: key });
      toast('Saved');
    },
    onError: (e: any) => toast(e.message || 'Save failed', 'error'),
  });

  return {
    draft,
    set: <Kk extends K>(k: Kk, v: Settings[Kk]) => setDraft((d) => ({ ...d, [k]: v })),
    reset: () => setDraft(initial()),
    dirty,
    saving: mutation.isPending,
    save: () => {
      if (!settings) return;
      const patch: any = {};
      for (const k of keys) if (draft[k] !== settings[k]) patch[k] = draft[k];
      if (Object.keys(patch).length === 0) return;
      mutation.mutate(patch);
    },
  };
}
