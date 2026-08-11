import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Baby, Search, Stethoscope, Plus, Pencil, Wallet, ListChecks, Save, Database as DbIcon, Calendar as CalIcon, ArrowRight, Loader2, AlertTriangle, Trash2, User as UserIcon, IndianRupee, PenTool, Power, AlertCircle, ArrowUp, ArrowDown, MessageCircle, Eye, FileText, MapPin, Syringe, RefreshCw, Sparkles, HardDrive, Sun, Copy, FlaskConical, ShieldCheck, KeyRound, Lock, BadgeCheck } from 'lucide-react';
import { DEFAULT_LAYOUT } from '../db/slip-templates';
import type { SlipLayout } from '../db/slip-templates';
import { format, parseISO } from 'date-fns';
import { cn } from '../lib/utils';
import { Check } from 'lucide-react';
import { Modal } from '../components/Modal';
import { ImageUpload } from '../components/ImageUpload';
import { WhatsAppMessaging } from '../components/WhatsAppMessaging';
import { SlipPreviewLauncher } from '../components/SlipPreviewLauncher';
import { OpdSlip } from '../components/OpdSlip';
import { promptDialog } from '../lib/promptDialog';
import { AdminGate } from '../components/AdminGate';
import { NetworkTroubleshoot } from '../components/NetworkTroubleshoot';
import { WardsBedsEditor } from '../components/settings/WardsBedsEditor';
import { DischargeTemplateEditor } from '../components/settings/DischargeTemplateEditor';
import { ClinicalTemplatesEditor } from '../components/settings/ClinicalTemplatesEditor';
import { RoleAccessEditor } from '../components/settings/RoleAccessEditor';
import { ModuleTutorialButton } from '../components/ModuleTutorial';
import { BillingSettings } from '../components/settings/BillingSettings';
import { useToast } from '../hooks/useToast';
import { INDIAN_STATES } from '../lib/india';
import { KARNATAKA_PLACES, ALL_NEARBY_PLACES } from '../lib/places';
import { DOCTOR_COLOR_OPTIONS, colorForDoctor } from '../lib/doctor-colors';
import type { AppMode, Doctor, Settings } from '../types';

type SettingsTab = 'clinic' | 'doctors' | 'workflow' | 'billing' | 'peds' | 'patients' | 'system' | 'comms' | 'subscription';

const SETTINGS_TAB_KEY = 'caredesk:settings-tab';

const TAB_LABEL: Record<SettingsTab, string> = {
  clinic: 'Clinic', doctors: 'Doctors & Templates', workflow: 'Fees & Workflow', billing: 'Billing & IPD',
  peds: 'Pediatrics', patients: 'Patients', system: 'System', comms: 'Communication',
};

/** Flat index of every settings section, so the search box can jump to its tab. */
const SETTINGS_SEARCH: { tab: SettingsTab; label: string; hint: string; keywords: string }[] = [
  { tab: 'clinic', label: 'Clinic Identity', hint: 'Name, logo, address, contact', keywords: 'clinic name logo address phone letterhead tagline registration email' },
  { tab: 'clinic', label: 'Prescription QR Codes', hint: 'QR codes on prescription page 2', keywords: 'qr code website maps prescription link' },
  { tab: 'clinic', label: 'App Mode', hint: 'Which modules show in the sidebar', keywords: 'app mode module sidebar reception pharmacy doctor lab ipd' },
  { tab: 'doctors', label: 'Doctors', hint: 'Fees, signature, colour, template', keywords: 'doctor fee signature colour color template room specialty' },
  { tab: 'doctors', label: 'OPD Slip Body Templates', hint: 'Consultation & printed-slip sections', keywords: 'opd slip template section body specialty growth layout' },
  { tab: 'doctors', label: 'Consultation Quick-Fill Templates', hint: 'One-tap clinical text by department', keywords: 'quick fill template consultation clinical department specialty history examination' },
  { tab: 'workflow', label: 'Fees, Queue Flow & Display', hint: 'Consultation fee, queue toggle', keywords: 'fee queue flow waiting done pending consultation display badge billing slot' },
  { tab: 'workflow', label: 'Patient Registration Fee', hint: 'One-time registration fee', keywords: 'registration fee one time' },
  { tab: 'workflow', label: 'Free Follow-up Policy', hint: 'Same-doctor follow-up window', keywords: 'follow up free policy window revisit' },
  { tab: 'workflow', label: 'Services', hint: 'Quick-pick service chips', keywords: 'services procedures vaccination chips price' },
  { tab: 'billing', label: 'Wards & Beds', hint: 'IPD wards and beds', keywords: 'ward bed ipd room admission' },
  { tab: 'billing', label: 'IPD Charges & Accrual', hint: 'Auto bed/nursing/doctor charges', keywords: 'ipd bed nursing accrual charge doctor visit advance deposit transfer' },
  { tab: 'billing', label: 'GST & Billing', hint: 'GST, invoice prefix, round-off', keywords: 'gst tax invoice prefix round off discount gstin' },
  { tab: 'billing', label: 'Insurance / TPA', hint: 'Cashless admissions', keywords: 'tpa insurance cashless claim preauth' },
  { tab: 'billing', label: 'Discharge Summary', hint: 'Builder + templates', keywords: 'discharge summary template letterhead' },
  { tab: 'billing', label: 'Admission Requests', hint: 'Doctor requests from OPD', keywords: 'admission request opd reception' },
  { tab: 'billing', label: 'Lab Auto-Billing', hint: 'Auto-raise a bill when tests are ordered', keywords: 'lab laboratory auto bill billing test order revenue investigation' },
  { tab: 'billing', label: 'Laboratory catalog', hint: 'Load & manage lab tests + prices', keywords: 'lab laboratory catalog test inventory pathology biochemistry microbiology histopathology radiology price manage load standard investigation' },
  { tab: 'peds', label: 'Pediatrics Add-on', hint: 'Growth, vaccines, calculators', keywords: 'pediatrics paediatrics growth centile who iap vaccine immunisation calculator bmi head circumference child chart' },
  { tab: 'patients', label: 'Patients & Locations', hint: 'Default state, district, villages', keywords: 'patient location state district village autocomplete' },
  { tab: 'patients', label: 'List Window (performance)', hint: 'How far back lists show by default', keywords: 'list window performance recent month week reception discharge slow speed pagination lag' },
  { tab: 'system', label: 'Security & Login', hint: 'Sign-in, idle sign-out', keywords: 'security login password idle signout user audit' },
  { tab: 'system', label: 'Role-Based Access', hint: 'Module access per staff role', keywords: 'role access permission module staff customisable' },
  { tab: 'system', label: 'Startup & Background', hint: 'Auto-launch, tray', keywords: 'startup background tray autolaunch windows minimize' },
  { tab: 'system', label: 'Network Mode', hint: 'Multi-station LAN setup', keywords: 'network multi station lan server client cabin' },
  { tab: 'system', label: 'Backup, Restore & Updates', hint: 'Backups, USB, app updates', keywords: 'backup restore update usb sqlite excel auto' },
  { tab: 'comms', label: 'WhatsApp Messaging', hint: 'Click-to-WhatsApp templates', keywords: 'whatsapp message template preview' },
  { tab: 'comms', label: 'AI Reply Suggestions', hint: 'Claude API key', keywords: 'ai claude api reply suggestion anthropic key' },
  { tab: 'subscription', label: 'Subscription & Modules', hint: 'Active plan, expiry, upgrade / renew', keywords: 'subscription licence license plan modules upgrade renew activate activation code expiry machine id lock unlock' },
];

export function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>(() => {
    try { return (localStorage.getItem(SETTINGS_TAB_KEY) as SettingsTab) || 'clinic'; } catch { return 'clinic'; }
  });
  useEffect(() => { try { localStorage.setItem(SETTINGS_TAB_KEY, tab); } catch { /* ignore */ } }, [tab]);
  const [search, setSearch] = useState('');

  // Pre-load settings at the page level so every sub-component's useQuery
  // returns synchronously from cache — no blank-flash on any tab.
  const { isLoading: settingsLoading, isError: settingsError } = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.electronAPI.settings.get(),
    staleTime: 30_000,
  });

  return (
    <AdminGate title="Settings — Administrator area">
      <div className="p-6 max-w-5xl">
        <div className="mb-4">
          <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100">Settings</h1>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            Search below, or pick a tab to find what you need.
          </p>
        </div>

        {/* Search — jumps straight to any setting's tab */}
        <div className="relative mb-4 max-w-md">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            className="input pl-9"
            placeholder="Search settings… e.g. growth, GST, backup, roles"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search.trim() && (
            <div className="absolute z-30 mt-1 w-full max-h-72 overflow-auto rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg">
              {(() => {
                const q = search.trim().toLowerCase();
                const hits = SETTINGS_SEARCH.filter((e) => `${e.label} ${e.hint} ${e.keywords} ${TAB_LABEL[e.tab]}`.toLowerCase().includes(q));
                if (hits.length === 0) return <div className="px-3 py-2 text-xs text-gray-500">No matching setting.</div>;
                return hits.map((e, i) => (
                  <button
                    key={i}
                    onClick={() => { setTab(e.tab); setSearch(''); }}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-slate-800 border-b border-gray-100 dark:border-slate-800 last:border-0"
                  >
                    <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100">{e.label}</div>
                    <div className="text-[11px] text-gray-500">{e.hint} · <span className="uppercase tracking-wide text-blue-600 dark:text-blue-400">{TAB_LABEL[e.tab]}</span></div>
                  </button>
                ));
              })()}
            </div>
          )}
        </div>

        {settingsError && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
            ⚠️ Could not load settings from the database. Try closing and reopening the app.
          </div>
        )}

        {/* Tab bar */}
        <div className="flex flex-wrap gap-1 mb-6 p-1 rounded-lg bg-gray-100 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 sticky top-0 z-10 backdrop-blur">
          <SettingsTabBtn active={tab === 'clinic'} onClick={() => setTab('clinic')} icon={<Building2 className="w-3.5 h-3.5" />}>Clinic</SettingsTabBtn>
          <SettingsTabBtn active={tab === 'doctors'} onClick={() => setTab('doctors')} icon={<Stethoscope className="w-3.5 h-3.5" />}>Doctors & Templates</SettingsTabBtn>
          <SettingsTabBtn active={tab === 'workflow'} onClick={() => setTab('workflow')} icon={<Wallet className="w-3.5 h-3.5" />}>Fees & Workflow</SettingsTabBtn>
          <SettingsTabBtn active={tab === 'billing'} onClick={() => setTab('billing')} icon={<IndianRupee className="w-3.5 h-3.5" />}>Billing & IPD</SettingsTabBtn>
          <SettingsTabBtn active={tab === 'peds'} onClick={() => setTab('peds')} icon={<Baby className="w-3.5 h-3.5" />}>Pediatrics</SettingsTabBtn>
          <SettingsTabBtn active={tab === 'patients'} onClick={() => setTab('patients')} icon={<UserIcon className="w-3.5 h-3.5" />}>Patients</SettingsTabBtn>
          <SettingsTabBtn active={tab === 'system'} onClick={() => setTab('system')} icon={<HardDrive className="w-3.5 h-3.5" />}>System</SettingsTabBtn>
          <SettingsTabBtn active={tab === 'comms'} onClick={() => setTab('comms')} icon={<MessageCircle className="w-3.5 h-3.5" />}>Communication</SettingsTabBtn>
          <SettingsTabBtn active={tab === 'subscription'} onClick={() => setTab('subscription')} icon={<ShieldCheck className="w-3.5 h-3.5" />}>Subscription</SettingsTabBtn>
        </div>

        {settingsLoading && (
          <div className="space-y-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-2">
                <div className="h-3 bg-gray-200 dark:bg-slate-700 rounded w-40 animate-pulse" />
                <div className="card p-5 animate-pulse space-y-3">
                  <div className="h-3 bg-gray-200 dark:bg-slate-700 rounded w-2/3" />
                  <div className="h-3 bg-gray-200 dark:bg-slate-700 rounded w-1/2" />
                  <div className="h-3 bg-gray-200 dark:bg-slate-700 rounded w-3/4" />
                </div>
              </div>
            ))}
          </div>
        )}

        <div className={cn('space-y-6', settingsLoading && 'hidden')}>
          {tab === 'clinic' && (
            <>
              <SettingsGroup title="Clinic Identity" subtitle="Name, logo, address, contact details printed on every OPD slip.">
                <ClinicInfo />
              </SettingsGroup>
              <SettingsGroup title="Prescription QR Codes" subtitle="Show 1 or 2 QR codes on the prescription page 2 — e.g. website link and Google Maps location.">
                <PrescriptionQr />
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
              <SettingsGroup title="OPD Slip Body Templates" subtitle="Per-specialty sections for the consultation panel and printed slip. Edit a template, then hit Preview to see exactly how it prints — right there.">
                <SlipTemplatesEditor />
              </SettingsGroup>
              <SettingsGroup title="Consultation Quick-Fill Templates" subtitle="One-tap clinical text for a consultation. Shared for the clinic, or saved under a doctor’s name so only that doctor sees it.">
                <ClinicalTemplatesEditor />
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

          {tab === 'billing' && <BillingIpdTab />}

          {tab === 'subscription' && <SubscriptionTab />}

          {tab === 'peds' && <PediatricsTab />}

          {tab === 'patients' && (
            <>
              <SettingsGroup title="Patients & Locations" subtitle="Default state, district, and bundled village list shown as autocomplete.">
                <DefaultLocation />
              </SettingsGroup>
              <SettingsGroup title="List Window (keeps big lists fast)" subtitle="How far back the Reception patient list and Discharge Summary list show by default. Search always finds everyone, however old.">
                <RecordsWindowSetting />
              </SettingsGroup>
            </>
          )}

          {tab === 'system' && (
            <>
              <SettingsGroup title="Security & Login" subtitle="Require each person to sign in as themselves, and auto sign-out an idle station.">
                <SecurityLoginSettings />
              </SettingsGroup>
              <SettingsGroup title="Role-Based Access" subtitle="Choose exactly which modules each staff role can open. Fully customisable — admin always sees everything.">
                <RoleAccessEditor />
              </SettingsGroup>
              <SettingsGroup title="Startup & Background" subtitle="Auto-launch with Windows, minimize to tray, start hidden.">
                <StartupBehavior />
              </SettingsGroup>
              <SettingsGroup title="Network Mode (multi-station)" subtitle="Run reception + doctor cabins as separate PCs sharing one CureDesk. Pick a server PC, others connect over the LAN.">
                <RelaunchWizardButton />
                <NetworkModeSettings />
              </SettingsGroup>
              <SettingsGroup title="Multi-Station Setup Guide" subtitle="Step-by-step walkthrough — what to buy, how to wire it up, how to connect each PC, and what to do when something breaks.">
                <NetworkSetupGuide />
              </SettingsGroup>
              <SettingsGroup title="Backup, Restore & Updates" subtitle="Where backups go, daily auto-backup, weekly USB reminder, restore, and app updates.">
                <BackupSettings />
              </SettingsGroup>
              {/* "Reset all clinic data" (HardResetPanel) is intentionally hidden — too
                  destructive to expose in normal clinic Settings. Restore this block if a
                  supervised factory-reset is ever needed. */}
            </>
          )}

          {tab === 'comms' && (
            <>
              <SettingsGroup title="WhatsApp Messaging" subtitle="Click-to-WhatsApp template editor + live preview.">
                <WhatsAppMessaging />
              </SettingsGroup>
              <SettingsGroup title="AI Reply Suggestions" subtitle="Anthropic (Claude) API key for one-tap reply suggestions in the WhatsApp inbox.">
                <AiSettings />
              </SettingsGroup>
              <SettingsGroup title="Support the Developer" subtitle="If CureDesk is helping your clinic, consider supporting continued development.">
                <SupportDeveloperPanel />
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
            <div key={m.value} className="flex flex-col gap-1.5">
            <button
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
            {/* "Learn about this setup" tutorial, just below each module option */}
            <div className="px-1">
              <ModuleTutorialButton mode={m.value} />
            </div>
            </div>
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

// Friendly names for known tables; any table without one falls back to a
// prettified version of its raw name. The row list itself is built dynamically
// from whatever tables the backup + current database actually contain, so every
// module (IPD, lab, billing, WhatsApp…) is always shown — nothing is hardcoded.
const TABLE_LABELS: Record<string, string> = {
  patients: 'Patients', appointments: 'Appointments', bills: 'Bills', bill_items: 'Bill items',
  bill_payments: 'Bill payments', advances: 'Advances', charge_heads: 'Charge heads',
  consultations: 'Consultations / EMR', prescription_items: 'Prescription items',
  lab_orders: 'Lab orders', lab_order_items: 'Lab results', lab_tests: 'Lab test catalog',
  pharmacy_sales: 'Pharmacy sales', pharmacy_sale_items: 'Pharmacy sale items',
  drug_inventory: 'Drugs (legacy)', drug_master: 'Drug master', drug_stock_batches: 'Drug stock batches',
  wholesalers: 'Wholesalers', purchase_invoices: 'Purchase invoices', purchase_invoice_items: 'Purchase invoice items',
  dispensing_register: 'Dispensing register', ip_admissions: 'IP admissions', wards: 'Wards', beds: 'Beds',
  bed_transfers: 'Bed transfers', ip_vitals: 'IP vitals', ip_medication_orders: 'IP medication orders',
  ip_medication_admin: 'IP medication admin (MAR)', ip_progress_notes: 'IP progress notes',
  ip_nursing_notes: 'IP nursing notes', ip_intake_output: 'IP intake/output', ip_diet_orders: 'IP diet orders',
  ip_cross_consultations: 'IP cross consultations', mlc_register: 'MLC register', mlc_correspondence: 'MLC correspondence',
  admission_requests: 'Admission requests', tpa_master: 'TPA insurers', tpa_claims: 'TPA claims',
  tpa_claim_events: 'TPA claim events', discharge_templates: 'Discharge templates',
  peds_growth_measurements: 'Pediatric growth', peds_vaccine_records: 'Pediatric vaccines',
  patient_immunizations: 'Immunisations', patient_allergies: 'EMR allergies', patient_conditions: 'EMR conditions',
  patient_family_history: 'EMR family history', patient_documents: 'Patient documents', print_jobs: 'Print jobs',
  doctors: 'Doctors', users: 'User accounts', notification_log: 'Notification log', audit_log: 'Audit log entries',
  body_release: 'Body release register', counters: 'Number counters', settings: 'Settings',
};
function prettyTable(name: string): string {
  if (TABLE_LABELS[name]) return TABLE_LABELS[name];
  if (name.startsWith('wa_')) return 'WhatsApp · ' + name.slice(3).replace(/_/g, ' ');
  return name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, ' ');
}

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

/**
 * One-click cloud backup. Detects Google Drive / OneDrive / Dropbox / iCloud
 * folders synced on this PC and routes the auto-backup into one — the cloud app
 * does the upload, so no API keys and the data stays in the clinic's account.
 */
function CloudBackupCard({ currentFolder, onApplied }: { currentFolder?: string; onApplied: (path: string) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const { data: detected } = useQuery({ queryKey: ['cloud-folders'], queryFn: () => window.electronAPI.backup.detectCloudFolders() });
  const { data: status } = useQuery({ queryKey: ['backup-status'], queryFn: () => window.electronAPI.backup.status(), refetchInterval: 60_000 });

  const folders = detected?.folders ?? [];
  const active = folders.find((f) => currentFolder && currentFolder.startsWith(f.path));
  const emoji: Record<string, string> = { 'Google Drive': '🟢', 'OneDrive': '🔷', 'Dropbox': '🟦', 'iCloud Drive': '☁️' };

  const use = async (f: { provider: string; path: string }) => {
    setBusy(f.path);
    try {
      const r = await window.electronAPI.backup.useCloudFolder(f.path, f.provider);
      if (r.ok && r.path) {
        onApplied(r.path);
        qc.invalidateQueries({ queryKey: ['settings'] });
        qc.invalidateQueries({ queryKey: ['backup-status'] });
        toast(`Auto-backup now saves to ${f.provider}`, 'success');
      } else toast(r.error || 'Could not set up cloud backup', 'error');
    } catch (e: any) { toast(e?.message || 'Failed', 'error'); }
    finally { setBusy(null); }
  };

  return (
    <div className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/50 dark:bg-blue-900/15 p-4 mb-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">☁️</span>
        <div className="text-[13px] font-bold text-blue-900 dark:text-blue-200">Cloud backup (recommended)</div>
      </div>
      {active ? (
        <div className="text-[12px] text-emerald-700 dark:text-emerald-300 mb-2">
          ✓ Backing up to <b>{active.provider}</b>
          {status?.lastBackupAt ? <> · last backup {new Date(status.lastBackupAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</> : <> · first backup runs on the schedule below</>}
        </div>
      ) : (
        <p className="text-[12px] text-gray-600 dark:text-slate-300 mb-2">
          Send every auto-backup straight to your own cloud. Your data stays in <b>your</b> account — no passwords or keys are ever shared with CureDesk.
        </p>
      )}
      {folders.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {folders.map((f) => (
            <button key={f.path} disabled={busy === f.path} onClick={() => use(f)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-white dark:bg-slate-800 border border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900/40 disabled:opacity-50">
              {busy === f.path ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span>{emoji[f.provider] || '☁️'}</span>}
              {active?.path === f.path ? `Using ${f.provider}` : `Back up to ${f.provider}`}
            </button>
          ))}
        </div>
      ) : (
        <div className="text-[12px] text-gray-600 dark:text-slate-300">
          <div className="font-semibold mb-1">No cloud folder found on this PC yet. To set one up:</div>
          <ol className="list-decimal ml-4 space-y-0.5 text-[11px]">
            <li>Install <a href="https://www.google.com/drive/download/" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Google Drive for Desktop</a> (or OneDrive / Dropbox) and sign in.</li>
            <li>Reopen this screen — a one-click <b>“Back up to Google Drive”</b> button appears here automatically.</li>
            <li>Or just paste the folder path manually below.</li>
          </ol>
        </div>
      )}
    </div>
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
    onSuccess: (r: any) => {
      if (r?.backup?.ok) toast('Backed up your data, then opened the installer download.', 'success');
      else toast('Opened the installer download. Back up from here before installing.', 'info');
    },
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
    const p = await window.electronAPI.dialog.pickFolder({ title: 'Pick a CureDesk backup bundle folder (caredesk-<timestamp>)' });
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
        {' '}and point this at a Drive-synced folder (e.g. <code className="font-mono">G:\My Drive\CureDesk Backups</code>) — files upload to the cloud automatically.
      </p>

      <CloudBackupCard
        currentFolder={draft.backup_folder}
        onApplied={(p) => { set('backup_folder', p); set('auto_backup_enabled', true); }}
      />

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="label">Backup Folder Path</label>
          <div className="flex gap-2">
            <input
              className="input font-mono text-xs flex-1"
              placeholder="G:\My Drive\CureDesk Backups"
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
            ⚠ Must be a LOCAL folder on this PC (like <code>G:\My Drive\CureDesk Backups</code>). Google Drive web links (<code>drive.google.com/...</code>) don't work.
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
            Once a day at the configured time, the app checks the update server for new releases. Your data is never touched by an update.
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
                      {Array.from(new Set([...Object.keys(preview.backup.counts), ...Object.keys(preview.current.counts)]))
                        .filter((k) => (preview.backup.counts[k] ?? 0) > 0 || (preview.current.counts[k] ?? 0) > 0)
                        .sort((a, b) => prettyTable(a).localeCompare(prettyTable(b)))
                        .map((k) => (
                          <RestoreRow
                            key={k}
                            label={prettyTable(k)}
                            now={preview.current.counts[k] ?? 0}
                            after={preview.backup.counts[k] ?? 0}
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
  const { draft, set, reset, dirty, save, saving } = useSectionDraft(settings, ['clinic_name', 'clinic_tagline', 'clinic_phone', 'clinic_email', 'clinic_address', 'clinic_registration_no', 'google_review_url'], {
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
          <div className="col-span-2">
            <label className="label">Google Review URL</label>
            <input
              className="input w-full"
              value={draft.google_review_url ?? ''}
              onChange={(e) => set('google_review_url', e.target.value)}
              placeholder="https://g.page/r/…/review"
            />
            <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1">Used in the WhatsApp "Rate Us" button and feedback automation.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function PrescriptionQr() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { draft, set, reset, dirty, save, saving } = useSectionDraft(
    settings,
    ['qr1_img', 'qr1_label', 'qr2_img', 'qr2_label']
  );

  const hasQr1 = !!(draft.qr1_img);
  const hasQr2 = !!(draft.qr2_img);
  const neither = !hasQr1 && !hasQr2;

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500 dark:text-slate-400">
        Upload your QR code images (UPI, Google Pay, PhonePe, Google Review, etc.). Leave both blank to hide. One image = single code; both = two codes side-by-side on the prescription.
      </p>

      {/* QR 1 */}
      <div className="border border-gray-200 dark:border-slate-700 rounded-lg p-4 space-y-3">
        <div className="text-xs font-semibold text-gray-700 dark:text-slate-300 uppercase tracking-wide">QR Code 1</div>
        <div className="flex gap-4 items-start">
          <ImageUpload
            label="QR Image"
            value={draft.qr1_img ?? null}
            onChange={(v) => { set('qr1_img', v ?? ''); }}
            aspect="square"
            placeholder="Upload QR"
            hint="JPG / PNG · Max 5 MB"
          />
          <div className="flex-1">
            <label className="label">Label (shown below QR on prescription)</label>
            <input className="input w-full" value={draft.qr1_label ?? ''} onChange={(e) => set('qr1_label', e.target.value)} placeholder="e.g. Scan to Pay, Google Review" />
          </div>
        </div>
      </div>

      {/* QR 2 */}
      <div className="border border-gray-200 dark:border-slate-700 rounded-lg p-4 space-y-3">
        <div className="text-xs font-semibold text-gray-700 dark:text-slate-300 uppercase tracking-wide">QR Code 2</div>
        <div className="flex gap-4 items-start">
          <ImageUpload
            label="QR Image"
            value={draft.qr2_img ?? null}
            onChange={(v) => { set('qr2_img', v ?? ''); }}
            aspect="square"
            placeholder="Upload QR"
            hint="JPG / PNG · Max 5 MB"
          />
          <div className="flex-1">
            <label className="label">Label (shown below QR on prescription)</label>
            <input className="input w-full" value={draft.qr2_label ?? ''} onChange={(e) => set('qr2_label', e.target.value)} placeholder="e.g. Find Us on Maps" />
          </div>
        </div>
      </div>

      {neither && (
        <p className="text-xs text-amber-600 dark:text-amber-400">No images uploaded — QR codes will not appear on the prescription.</p>
      )}

      <div className="flex gap-3">
        <button className="btn-primary text-sm" disabled={!dirty || saving} onClick={() => save()}>
          {saving ? 'Saving…' : 'Save QR Settings'}
        </button>
        {dirty && <button className="btn-ghost text-sm" onClick={() => reset()}>Discard</button>}
      </div>
    </div>
  );
}

function AiSettings() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { draft, set, reset, dirty, save, saving } = useSectionDraft(settings, ['anthropic_api_key']);
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500 dark:text-slate-400">
        When an Anthropic API key is set, a ✨ button appears in the WhatsApp inbox. Clicking it sends the last few messages to Claude and returns 3 ready-to-send reply chips. The key is stored locally only.
      </p>
      <div>
        <label className="label">Anthropic API Key</label>
        <div className="flex gap-2">
          <input
            className="input flex-1"
            type={show ? 'text' : 'password'}
            placeholder="sk-ant-…"
            value={draft.anthropic_api_key ?? ''}
            onChange={(e) => set('anthropic_api_key', e.target.value)}
          />
          <button className="btn-ghost text-xs" onClick={() => setShow((v) => !v)}>{show ? 'Hide' : 'Show'}</button>
        </div>
      </div>
      <div className="flex gap-3">
        <button className="btn-primary text-sm" disabled={!dirty || saving} onClick={() => save()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {dirty && <button className="btn-ghost text-sm" onClick={() => reset()}>Discard</button>}
      </div>
    </div>
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
        Run CureDesk silently in the background like Google Drive Desktop — opens with your PC, sits in the tray, ready when you need it.
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
          label="Start CureDesk with Windows"
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

/** Hard-reset wipe + restart. Three-step confirmation to avoid accidents.
 *  Bypasses the Windows uninstaller entirely so the user can get a fresh
 *  install state without admin elevation or going through Add/Remove Programs. */
function HardResetPanel() {
  const toast = useToast();
  const [step, setStep] = useState<'idle' | 'confirm1' | 'confirm2'>('idle');
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = async () => {
    setBusy(true);
    try {
      const r = await window.electronAPI.admin.hardResetAndRestart();
      if (!r.ok) toast(r.error || 'Reset failed', 'error');
      // If r.ok, the app restarts; nothing more to do here.
    } catch (e: any) {
      toast(e?.message || 'Reset failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-5 border-2 border-red-300 dark:border-red-800 bg-red-50/40 dark:bg-red-900/15">
      <div className="text-sm font-bold text-red-900 dark:text-red-200 mb-1">⚠ Reset all clinic data</div>
      <div className="text-[12px] text-red-800 dark:text-red-300 mb-4">
        Permanently deletes EVERYTHING stored by CureDesk HMS on this PC:
        <ul className="list-disc pl-5 mt-1 space-y-0.5">
          <li>Patient records · doctors · bills · prescriptions</li>
          <li>EMR (allergies, conditions, immunizations, family history, documents)</li>
          <li>Pharmacy: drug master, batches, sales, dispensing register, purchases, wholesalers</li>
          <li>Appointments, lab orders, consultations, IPD admissions</li>
          <li>Settings, audit log, notifications</li>
          <li><b>All backups in the configured backup folder are NOT touched</b> — you can restore from one if needed</li>
        </ul>
        After reset, the app restarts and shows the Welcome wizard like a fresh install.
      </div>
      {step === 'idle' && (
        <button className="btn-danger" onClick={() => setStep('confirm1')}>
          Reset all clinic data…
        </button>
      )}
      {step === 'confirm1' && (
        <div className="space-y-2">
          <div className="text-[13px] text-red-900 dark:text-red-200 font-semibold">
            This cannot be undone. Type <code className="font-mono px-1 bg-white/60 dark:bg-slate-900/40 rounded">RESET</code> below to continue:
          </div>
          <input
            className="input"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder='Type "RESET" exactly'
            autoFocus
          />
          <div className="flex gap-2">
            <button className="btn-secondary text-xs" onClick={() => { setStep('idle'); setPhrase(''); }}>
              Cancel
            </button>
            <button
              className="btn-danger text-xs"
              disabled={phrase !== 'RESET'}
              onClick={() => setStep('confirm2')}
            >
              Continue →
            </button>
          </div>
        </div>
      )}
      {step === 'confirm2' && (
        <div className="space-y-2">
          <div className="text-[13px] text-red-900 dark:text-red-200 font-semibold">
            Final check — the app will close, wipe data, and restart in 3 seconds.
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary text-xs" onClick={() => { setStep('idle'); setPhrase(''); }} disabled={busy}>
              Cancel
            </button>
            <button className="btn-danger text-xs" onClick={reset} disabled={busy}>
              {busy ? 'Resetting…' : 'Yes, wipe everything and restart'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Big eye-catching button at the top of Network Mode that re-opens the
 *  welcome wizard. Useful for users who clicked Skip on first launch but now
 *  want to set up multi-station, OR users who want to re-pair quickly. */
function RelaunchWizardButton() {
  const open = () => {
    // Clear the dismissed flag so the wizard treats this as fresh.
    try { sessionStorage.removeItem('caredesk:welcome-dismissed'); } catch { /* ignore */ }
    try { localStorage.removeItem('caredesk:welcome-dismissed'); } catch { /* ignore */ }
    window.dispatchEvent(new Event('caredesk:openWelcomeWizard'));
  };
  return (
    <section className="card p-4 mb-3 border-2 border-blue-300 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-900/15">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-blue-900 dark:text-blue-200">🪄 Run the Setup Wizard</div>
          <div className="text-[12px] text-blue-700 dark:text-blue-300 mt-0.5">
            The same friendly flow that ran on first install — pick "host this clinic" or "connect to existing".
            Use this if you skipped it earlier or want to re-pair a station.
          </div>
        </div>
        <button type="button" className="btn-primary" onClick={open}>
          Open Wizard
        </button>
      </div>
    </section>
  );
}

function NetworkModeSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { draft, set, reset, dirty } = useSectionDraft(settings, ['network_mode', 'network_listen_port', 'network_server_url', 'network_secret', 'network_bind_ip', 'station_name']);
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

      {/* Setup guidance */}
      <div className="rounded-lg border-2 border-blue-300 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-900/20 p-3 text-[12px] text-blue-900 dark:text-blue-200">
        <b>Before you rely on this:</b> give the host PC a fixed address (a DHCP reservation in your router) and stop it from sleeping —
        those two things prevent most connection problems. A wired connection is more reliable than Wi-Fi; if this PC has both,
        pin the wired adapter below. If anything goes wrong, use <b>Run full diagnostics</b>.
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
          {status?.running && (() => {
            const st = status.selfTest;
            const ip = status.lanIp || st?.ip;
            if (st?.reachable) {
              return (
                <div className="rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2 text-[12px] text-emerald-800 dark:text-emerald-200">
                  ✓ Reachability check passed — other PCs can connect to this host at <span className="font-mono">http://{ip}:{status.port}</span>.
                </div>
              );
            }
            if (st && !st.reachable) {
              return (
                <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-[12px] text-amber-800 dark:text-amber-200 flex items-start justify-between gap-3 flex-wrap">
                  <span>⚠ The server is running but did <b>not</b> answer on its own network address <span className="font-mono">{st.ip || '(no LAN IP)'}:{st.port}</span> — {st.error}. Cabins likely can’t connect: <b>allow CureDesk through the firewall</b> (Windows shows an “Allow access” prompt the first time), check the pinned adapter below, then re-check.</span>
                  <button className="btn-secondary text-xs whitespace-nowrap" onClick={async () => { await window.electronAPI.network.selfTest(); refetchStatus(); }}>Re-check</button>
                </div>
              );
            }
            return <div className="text-[12px] text-gray-500 dark:text-slate-400">Checking whether other PCs can reach this host…</div>;
          })()}
          <ServerJoinCodePanel />
          <MigrationHelper />
        </>
      )}

      {/* Connection health, adapter picker, diagnostics, reconnect / forget */}
      <NetworkTroubleshoot mode={mode as 'local' | 'server' | 'client'} />

      {/* Client-mode config — friendly join-code flow first, manual fields tucked away */}
      {mode === 'client' && (
        <ClientConnectPanel
          currentUrl={draft.network_server_url || ''}
          currentSecret={draft.network_secret || ''}
          onSavedConfig={async (url, secret) => {
            // Persist the negotiated config + reload the network mode in main.
            set('network_server_url', url);
            set('network_secret', secret);
            await window.electronAPI.settings.save({
              network_mode: 'client',
              network_server_url: url,
              network_secret: secret,
            });
            try {
              localStorage.setItem('caredesk:network-mode', 'client');
              localStorage.setItem('caredesk:network-server-url', url);
              localStorage.setItem('caredesk:network-secret', secret);
            } catch { /* ignore */ }
            await window.electronAPI.network.applyMode();
            await qc.invalidateQueries({ queryKey: ['settings'] });
            await refetchStatus();
          }}
        />
      )}
    </section>
  );
}

/** Friendly Client setup panel — auto-discovery + 6-char join code, with
 *  the manual URL/secret fields tucked under an "Advanced" toggle. */
function ClientConnectPanel({
  currentUrl, currentSecret, onSavedConfig,
}: {
  currentUrl: string;
  currentSecret: string;
  onSavedConfig: (url: string, secret: string) => Promise<void>;
}) {
  const toast = useToast();
  const [discovered, setDiscovered] = useState<{ ip: string; port: number; version: string }[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [pickedServer, setPickedServer] = useState<{ ip: string; port: number } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [manualUrl, setManualUrl] = useState(currentUrl);
  const [manualSecret, setManualSecret] = useState(currentSecret);

  const scan = async () => {
    setDiscovering(true);
    setMsg(null);
    try {
      const list = await window.electronAPI.network.discover({ timeoutMs: 5_000 });
      setDiscovered(list);
      if (list.length === 0) setMsg({ ok: false, text: 'No CureDesk servers found on this Wi-Fi. Make sure the host PC is running and on the same network.' });
    } catch (e: any) {
      setMsg({ ok: false, text: `Scan failed: ${e?.message || e}` });
    } finally {
      setDiscovering(false);
    }
  };

  const connectWithCode = async () => {
    if (!pickedServer) { setMsg({ ok: false, text: 'Pick a discovered server first (or enter URL manually below).' }); return; }
    const cleaned = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cleaned.length !== 6) { setMsg({ ok: false, text: 'Join code must be 6 letters/digits.' }); return; }
    setBusy(true);
    setMsg(null);
    try {
      const url = `http://${pickedServer.ip}:${pickedServer.port}`;
      const r = await window.electronAPI.network.pair({ url, code: cleaned });
      if (!(r as any).ok) {
        setMsg({ ok: false, text: (r as any).error || 'Pairing failed' });
        setBusy(false);
        return;
      }
      const { secret } = r as any;
      await onSavedConfig(url, secret);
      setMsg({ ok: true, text: `✓ Connected to ${url} — config saved` });
      toast('Connected to clinic server');
      setCode('');
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  };

  const connectManual = async () => {
    const url = manualUrl.trim().replace(/\/+$/, '');
    const secret = manualSecret.trim();
    if (!url) { setMsg({ ok: false, text: 'Enter the server URL.' }); return; }
    setBusy(true);
    setMsg(null);
    try {
      const probe = await window.electronAPI.network.probe({ url, secret });
      if (!(probe as any).ok) {
        setMsg({ ok: false, text: `Couldn't reach server: ${(probe as any).error}` });
        setBusy(false);
        return;
      }
      await onSavedConfig(url, secret);
      setMsg({ ok: true, text: `✓ Connected to ${url} — config saved` });
      toast('Connected to clinic server');
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border-2 border-violet-300 dark:border-violet-800 bg-violet-50/40 dark:bg-violet-900/10 p-4 space-y-4">
      {/* Current state */}
      {currentUrl ? (
        <div className="text-[12px] text-violet-900 dark:text-violet-200">
          <b>Currently connected to:</b> <span className="font-mono">{currentUrl}</span>
        </div>
      ) : (
        <div className="text-[13px] font-bold text-violet-900 dark:text-violet-200">
          ⚠ Not connected to any clinic server yet.
        </div>
      )}

      {/* STEP 1 — find host */}
      <div>
        <div className="text-xs font-bold text-violet-900 dark:text-violet-200 mb-2">Step 1 — Find the host PC</div>
        <button type="button" className="btn-secondary text-xs" onClick={scan} disabled={discovering}>
          {discovering ? 'Scanning Wi-Fi…' : (discovered.length > 0 ? '🔄 Rescan' : '🔍 Scan for clinic servers on this Wi-Fi')}
        </button>
        {discovered.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {discovered.map((s) => {
              const isPicked = pickedServer?.ip === s.ip && pickedServer?.port === s.port;
              return (
                <li key={`${s.ip}:${s.port}`}>
                  <button
                    type="button"
                    onClick={() => setPickedServer({ ip: s.ip, port: s.port })}
                    className={cn(
                      'w-full text-left rounded-md border-2 p-2 transition',
                      isPicked
                        ? 'border-violet-600 bg-violet-100 dark:bg-violet-900/40'
                        : 'border-violet-200 dark:border-violet-800 bg-white dark:bg-slate-900 hover:border-violet-500'
                    )}
                  >
                    <div className="text-[12px] font-semibold text-gray-900 dark:text-slate-100">
                      {isPicked && '✓ '}CureDesk HMS · v{s.version}
                    </div>
                    <div className="text-[10px] text-gray-500 font-mono">{s.ip}:{s.port}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* STEP 2 — type code */}
      {pickedServer && (
        <div>
          <div className="text-xs font-bold text-violet-900 dark:text-violet-200 mb-2">
            Step 2 — Type the join code from the host PC's screen
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              className="input font-mono text-2xl tracking-[0.3em] text-center uppercase flex-1"
              placeholder="XXXXXX"
              maxLength={7}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') connectWithCode(); }}
            />
            <button
              type="button"
              className="btn-primary"
              onClick={connectWithCode}
              disabled={busy || code.replace(/-/g, '').length !== 6}
            >
              {busy ? 'Connecting…' : '🚀 Connect'}
            </button>
          </div>
          <div className="text-[10px] text-gray-500 mt-1">
            On the host PC: Settings → System → Network Mode → big blue "Join Code" panel.
          </div>
        </div>
      )}

      {/* Status message */}
      {msg && (
        <div className={cn('rounded p-2 text-[12px] font-semibold',
          msg.ok ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300'
                 : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300')}>
          {msg.text}
        </div>
      )}

      {/* Advanced (manual URL + secret) */}
      <div className="border-t border-violet-200 dark:border-violet-800 pt-3">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-[11px] text-violet-700 dark:text-violet-300 font-semibold hover:underline"
        >
          {showAdvanced ? '▼ Hide' : '▶ Show'} advanced — connect with URL + secret manually
        </button>
        {showAdvanced && (
          <div className="mt-3 space-y-3">
            <div className="text-[11px] text-gray-600 dark:text-slate-400">
              Use this if auto-discovery doesn't find the host (different subnet, UDP blocked, etc.).
              You'll need to copy the secret token from the host PC's settings file directly.
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="label">Server URL</label>
                <input type="text" className="input font-mono"
                  value={manualUrl}
                  onChange={(e) => setManualUrl(e.target.value)}
                  placeholder="http://192.168.1.100:4321" />
              </div>
              <div>
                <label className="label">Shared secret (token)</label>
                <input type="text" className="input font-mono"
                  value={manualSecret}
                  onChange={(e) => setManualSecret(e.target.value)} placeholder="paste from host" />
              </div>
            </div>
            <button type="button" className="btn-primary" onClick={connectManual} disabled={busy || !manualUrl.trim()}>
              {busy ? 'Connecting…' : '🚀 Connect with manual config'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Long-form, picture-free, paint-by-numbers setup guide for the multi-station
 *  feature. Every section is collapsible (default closed) so the page stays
 *  scannable. */
function NetworkSetupGuide() {
  const [open, setOpen] = useState<string | null>('overview');
  const toggle = (key: string) => setOpen(open === key ? null : key);

  return (
    <section className="card p-5 space-y-3">
      <div className="text-sm text-gray-700 dark:text-slate-300">
        New to multi-station? Read the sections below in order. Each step is small enough
        to do in 2-3 minutes.
      </div>

      <button
        className="btn-secondary text-xs w-fit"
        onClick={() => window.electronAPI.app.openExternal('https://mulgundsunil1918.github.io/mmcopd/multi-station.html').catch(() => { /* ignore */ })}
        title="Opens the full illustrated, printable Setup & Recovery guide in your browser"
      >
        📄 Open the illustrated Setup &amp; Recovery guide (printable) →
      </button>

      <GuideSection
        id="overview" open={open === 'overview'} onToggle={toggle}
        title="What is multi-station and do I need it?"
        tone="slate"
      >
        <p>
          By default CureDesk runs on <b>one PC</b>. All your patient data, doctors, bills,
          and settings live on that single computer. This is fine if reception and the doctor
          share the same desk.
        </p>
        <p className="mt-2">
          <b>Multi-station mode</b> lets you run CureDesk on several PCs at once — reception,
          each doctor's cabin, pharmacy, billing — all sharing the same patient list and queue
          live. Reception books a patient → the right doctor's cabin sees the new entry within
          seconds.
        </p>
        <p className="mt-2">
          <b>Use multi-station if:</b> you have 2+ PCs in your clinic and want them to see the
          same data. Skip it if you only have one PC.
        </p>
      </GuideSection>

      <GuideSection
        id="prereq" open={open === 'prereq'} onToggle={toggle}
        title="Prerequisites — what you need before starting"
        tone="amber"
      >
        <ul className="list-disc pl-5 space-y-1">
          <li><b>Windows PCs</b> — one for each station you want to run CureDesk on. Any modern PC works.</li>
          <li><b>One Wi-Fi router</b> in the clinic. Both PCs must connect to the SAME Wi-Fi (or LAN cable).
            A normal home/office router is fine — no special hardware needed.</li>
          <li><b>One PC chosen as the "main PC"</b> (also called <i>server</i> or <i>host</i>). This is usually
            the reception PC because it stays on all day. All patient data lives here. Other PCs (doctor cabins)
            are <i>clients</i> that connect to it.</li>
          <li><b>The CureDesk installer (.exe)</b> on a USB stick or downloaded — same Setup file for all PCs.</li>
          <li><b>Admin rights on each PC</b> — needed once during install to allow the firewall.</li>
        </ul>
        <div className="mt-3 p-2 rounded bg-amber-100 dark:bg-amber-900/30 text-[12px]">
          💡 <b>Tip:</b> If the main PC is shut down, cabin PCs can't see data. Keep the main PC plugged into
          a UPS so a brief power cut doesn't disrupt the whole clinic.
        </div>
      </GuideSection>

      <GuideSection
        id="server" open={open === 'server'} onToggle={toggle}
        title="Step-by-step: setting up the MAIN PC (server)"
        tone="blue"
      >
        <ol className="list-decimal pl-5 space-y-2">
          <li>On the main PC, run <code className="font-mono px-1 bg-gray-100 dark:bg-slate-800 rounded">CureDesk-HMS-Setup.exe</code>.
            Follow the wizard: pick install location → click Install → click Finish.</li>
          <li>CureDesk launches. The <b>Welcome wizard</b> appears.</li>
          <li>Click the big blue card: <b>"🏥 This is my clinic's main PC"</b>.</li>
          <li>Type a name for this PC: e.g. <b>Reception Desk</b> or <b>Front Office</b>.
            (Skip — defaults to "Reception Desk".) Click Continue.</li>
          <li>Wait 2-3 seconds. The wizard sets up the LAN server, generates a secret, and shows
            a big <b>JOIN CODE</b> like <span className="font-mono font-bold">7K3P-QM</span>.</li>
          <li>Windows asks <b>"Allow CureDesk HMS to communicate on networks?"</b> → click <b>Allow access</b>.
            (One-time. This only opens your local Wi-Fi, NOT the internet.)</li>
          <li>Note down the join code on a piece of paper, or just leave the wizard open while you go to
            the cabin PCs. The code is valid for 10 minutes — if it expires, click <b>"New code"</b> to
            mint a fresh one.</li>
          <li>Click <b>Done — start using CureDesk</b>. The main PC is now ready.</li>
        </ol>
        <div className="mt-3 p-2 rounded bg-blue-100 dark:bg-blue-900/30 text-[12px]">
          ✓ <b>How to know it worked:</b> Look at the bottom-left of the sidebar. You should see a green
          dot next to <b>"Reception Desk"</b> with the text <i>"Hosting · 0 clients"</i>.
        </div>
      </GuideSection>

      <GuideSection
        id="client" open={open === 'client'} onToggle={toggle}
        title="Step-by-step: connecting a CABIN PC (client)"
        tone="violet"
      >
        <ol className="list-decimal pl-5 space-y-2">
          <li>On the cabin PC, run the same <code className="font-mono px-1 bg-gray-100 dark:bg-slate-800 rounded">CureDesk-HMS-Setup.exe</code>.
            Install + Finish.</li>
          <li>CureDesk launches → Welcome wizard appears.</li>
          <li>Click the violet card: <b>"👤 Connect to existing clinic"</b>.</li>
          <li>The wizard scans the Wi-Fi for ~5 seconds. The main PC should appear as a clickable card
            (e.g. <span className="font-mono">CureDesk HMS · v0.3.0 · 192.168.1.100:4321</span>). Click it.</li>
          <li>If the scan finds nothing, click <b>"Type code manually"</b> instead and enter the main PC's IP
            (find it on the main PC's join-code screen — bottom row, "This PC's IP").</li>
          <li>Type the 6-character join code from the main PC's screen (e.g. <span className="font-mono">7K3P-QM</span>) → click <b>Connect</b>.</li>
          <li>Wizard asks for a name for THIS station. Type <b>Cabin 1</b>, <b>Cabin 2</b>, <b>Pharmacy</b>, etc.
            (Or click one of the quick chips.) Click Continue.</li>
          <li>You'll see <b>"✓ Connected!"</b>. Click Continue. <b>Restart the app once</b> (close + reopen)
            so the data starts flowing from the main PC.</li>
        </ol>
        <div className="mt-3 p-2 rounded bg-violet-100 dark:bg-violet-900/30 text-[12px]">
          ✓ <b>How to know it worked:</b> The cabin PC's sidebar (bottom-left) shows a green dot next to
          your station name (e.g. <b>"Cabin 1"</b>) with the text <i>"Client → http://192.168.1.100:4321"</i>.
          Open the Reception page — the same patients you see on the main PC are now visible here.
        </div>
        <div className="mt-2 p-2 rounded bg-violet-100 dark:bg-violet-900/30 text-[12px]">
          🔁 <b>Repeat for each cabin PC.</b> Each one is its own session — you can give them different
          names so audit logs and the host's connected-clients list can tell them apart.
        </div>
      </GuideSection>

      <GuideSection
        id="usage" open={open === 'usage'} onToggle={toggle}
        title="Day-to-day use: how the queue flows"
        tone="emerald"
      >
        <ol className="list-decimal pl-5 space-y-2">
          <li><b>Reception books a patient</b> with <i>Dr. Patil · Cabin 2</i>.
            The booking saves on the main PC and broadcasts to all stations.</li>
          <li><b>Cabin 2's screen</b> updates within ~1 second — Dr. Patil sees the new patient in
            their queue list. (No "refresh" button needed.)</li>
          <li>Doctor calls the patient → opens the consultation panel → fills
            history / examination / impression / advice / Rx → clicks <b>Save</b>.</li>
          <li>If the doctor uses the <b>"Send to Reception (Ready for Print)"</b> button, the appointment
            status changes; reception's screen lights up the row in blue → reception clicks <b>Print OPD slip</b>.</li>
          <li>Pharmacy PC (if you have one) sees the prescription appear in the dispense queue automatically.</li>
        </ol>
        <p className="mt-2">All this happens with <b>no manual file copying</b>, no shared drives — just live data
          flowing between the PCs over your Wi-Fi.</p>
      </GuideSection>

      <GuideSection
        id="rename" open={open === 'rename'} onToggle={toggle}
        title="Renaming a station / re-pairing later"
        tone="slate"
      >
        <p><b>To rename this PC:</b> Settings → System → Network Mode → edit the <b>"Station / room name"</b>
          field at the top → click Save changes. Sidebar pill updates immediately.</p>
        <p className="mt-2"><b>To add a NEW cabin PC later:</b></p>
        <ol className="list-decimal pl-5 space-y-1 mt-1">
          <li>On the MAIN PC, open Settings → System → Network Mode. Find the big rotating join code panel.</li>
          <li>If the code has expired, click <b>"New code"</b>.</li>
          <li>On the new cabin PC, install CureDesk → in the wizard pick "Connect to existing clinic" → enter the code.</li>
        </ol>
        <p className="mt-2"><b>To switch a cabin to a different role:</b> Settings → System → Network Mode → click
          another mode card (Local / Server / Client) → save → restart the app.</p>
      </GuideSection>

      <GuideSection
        id="trouble" open={open === 'trouble'} onToggle={toggle}
        title="Troubleshooting"
        tone="red"
      >
        <div className="space-y-3">
          <Trouble q="The cabin PC's wizard says 'No clinics found'.">
            <ul className="list-disc pl-5 space-y-1">
              <li>Make sure both PCs are on the <b>same Wi-Fi</b> (not different floors / different routers).</li>
              <li>Check that the main PC's CureDesk is running and showing the join code.</li>
              <li>Some routers block UDP broadcast. Click <b>"Type code manually"</b> in the wizard and enter
                the main PC's IP (shown on the main PC's join-code screen).</li>
              <li>Windows Firewall: when CureDesk first starts on the main PC, Windows asks to allow it.
                If you accidentally clicked Block, run this in Command Prompt as Administrator:
                <pre className="mt-1 p-2 bg-gray-100 dark:bg-slate-800 rounded text-[11px] overflow-x-auto">netsh advfirewall firewall add rule name="CureDesk HMS" dir=in action=allow protocol=TCP localport=4321</pre>
              </li>
            </ul>
          </Trouble>
          <Trouble q="The join code says 'Invalid' or 'Expired'.">
            <ul className="list-disc pl-5 space-y-1">
              <li>Codes expire after 10 minutes. On the main PC, click the pink <b>"New code"</b> button to mint a fresh one.</li>
              <li>Make sure you typed the code exactly — no spaces, the dash is auto-inserted.</li>
              <li>The code is case-insensitive but no zeros / ones / letter-O / letter-L are used to avoid confusion.</li>
            </ul>
          </Trouble>
          <Trouble q="Cabin PC shows the red 'Disconnected from clinic server' banner.">
            <ul className="list-disc pl-5 space-y-1">
              <li>The main PC may be off, sleeping, or the Wi-Fi dropped. Wait 5 seconds — the cabin auto-reconnects.</li>
              <li>If the banner stays for more than a minute, walk to the main PC and check it's still running.</li>
              <li>Make sure the main PC isn't in <b>Sleep</b> mode (Settings → System → Power → set "Never sleep" while plugged in).</li>
            </ul>
          </Trouble>
          <Trouble q="Two stations changed the same appointment at the same moment.">
            <p>CureDesk uses optimistic locking. The first save wins; the second one shows
              <b> "Conflict — another station already changed this appointment to ___. Refresh and try again."</b>
              The losing user just refreshes (F5 or click another tab and back) and re-applies their change.</p>
          </Trouble>
          <Trouble q="I want to STOP using multi-station and go back to one PC.">
            <p>On every cabin PC: Settings → System → Network Mode → click <b>Local</b> → Save → restart app.
              On the main PC: do the same. Each PC's local data stays put. (To consolidate the cabin's local
              data into the main PC's DB, use the export/import flow under "Bringing existing data to the server PC".)</p>
          </Trouble>
          <Trouble q="The main PC's join-code screen disappeared.">
            <p>It's still active. Open Settings → System → Network Mode → scroll to the big rotating code panel.
              The code is the same as long as it hasn't expired; click "New code" if needed.</p>
          </Trouble>
        </div>
      </GuideSection>

      <GuideSection
        id="security" open={open === 'security'} onToggle={toggle}
        title="Security model — what's protected, what isn't"
        tone="slate"
      >
        <ul className="list-disc pl-5 space-y-1">
          <li><b>Patient data never leaves your clinic Wi-Fi.</b> No cloud, no internet calls.
            CureDesk only opens an internet connection for daily update checks (which can be turned off).</li>
          <li>The main PC's server requires a <b>shared secret token</b>. Cabin PCs without the token can't
            read or write data. The token is auto-generated and stored on each PC after pairing.</li>
          <li>The 6-character join code is <b>short-lived (10 minutes)</b> and rotates — so even if a code
            is overheard, it can't be used after expiry.</li>
          <li><b>Anyone on the same Wi-Fi with the token can use any feature.</b> Per-station role enforcement
            (e.g. "this cabin can only see Dr. X's patients") isn't built yet — keep your clinic Wi-Fi
            password-protected so outsiders can't join.</li>
          <li>Daily backups still run on the main PC and protect against drive failure.</li>
        </ul>
      </GuideSection>
    </section>
  );
}

function GuideSection({
  id, open, onToggle, title, tone, children,
}: {
  id: string;
  open: boolean;
  onToggle: (id: string) => void;
  title: string;
  tone: 'slate' | 'amber' | 'blue' | 'violet' | 'emerald' | 'red';
  children: React.ReactNode;
}) {
  const tones: Record<string, { border: string; bg: string; head: string; chev: string }> = {
    slate:   { border: 'border-slate-300 dark:border-slate-700',     bg: 'bg-slate-50/50 dark:bg-slate-800/30',     head: 'text-gray-900 dark:text-slate-100',     chev: 'text-gray-500' },
    amber:   { border: 'border-amber-300 dark:border-amber-800',     bg: 'bg-amber-50/40 dark:bg-amber-900/15',     head: 'text-amber-900 dark:text-amber-200',    chev: 'text-amber-600' },
    blue:    { border: 'border-blue-300 dark:border-blue-800',       bg: 'bg-blue-50/40 dark:bg-blue-900/15',       head: 'text-blue-900 dark:text-blue-200',      chev: 'text-blue-600' },
    violet:  { border: 'border-violet-300 dark:border-violet-800',   bg: 'bg-violet-50/40 dark:bg-violet-900/15',   head: 'text-violet-900 dark:text-violet-200',  chev: 'text-violet-600' },
    emerald: { border: 'border-emerald-300 dark:border-emerald-800', bg: 'bg-emerald-50/40 dark:bg-emerald-900/15', head: 'text-emerald-900 dark:text-emerald-200', chev: 'text-emerald-600' },
    red:     { border: 'border-red-300 dark:border-red-800',         bg: 'bg-red-50/40 dark:bg-red-900/15',         head: 'text-red-900 dark:text-red-200',        chev: 'text-red-600' },
  };
  const t = tones[tone];
  return (
    <div className={cn('rounded-lg border-2', t.border, t.bg)}>
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className={cn('text-sm font-bold', t.head)}>{title}</span>
        <span className={cn('text-lg font-bold leading-none', t.chev)}>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 text-[13px] text-gray-700 dark:text-slate-300 leading-relaxed">
          {children}
        </div>
      )}
    </div>
  );
}

function Trouble({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="border-l-2 border-red-400 pl-3">
      <div className="font-semibold text-red-900 dark:text-red-300 text-[13px] mb-1">❓ {q}</div>
      <div className="text-[12px]">{children}</div>
    </div>
  );
}

/** Support button — opens the developer's support page in the user's browser. */
function SupportDeveloperPanel() {
  const SUPPORT_URL = 'https://bridgr.co.in/support?from=curedesk';
  const open = () => { window.electronAPI.app.openExternal(SUPPORT_URL).catch(() => { /* ignore */ }); };
  return (
    <section className="card p-5">
      <div className="flex items-start gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-gray-900 dark:text-slate-100 mb-1 inline-flex items-center gap-2">
            <span className="text-pink-600">❤</span> Support keeps CureDesk free
          </div>
          <p className="text-[12px] text-gray-600 dark:text-slate-400 max-w-xl">
            CureDesk HMS is built and maintained for Indian clinics. Free to install, free to use,
            no subscriptions, no per-patient fees, your data stays on your computer.
            If it's saving your clinic time, a one-time contribution helps fund new features
            (lab reports, IPD billing, mobile receptionist app) and lets us keep it free for everyone.
          </p>
          <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-2 font-mono break-all">
            {SUPPORT_URL}
          </p>
        </div>
        <button
          type="button"
          onClick={open}
          className="px-5 py-3 rounded-lg text-white font-semibold inline-flex items-center gap-2 shadow-md hover:shadow-lg transition"
          style={{ background: 'linear-gradient(135deg, #ec4899, #db2777)' }}
        >
          <span>❤</span>
          <span>Open Support Page</span>
        </button>
      </div>
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
      // backup.now() resolves with the bundle details, or throws on failure —
      // there is no `ok` flag on the result.
      const r = await window.electronAPI.backup.now();
      setResult(`Backup written: ${r.bundleDir}`);
      toast('Backup ready — copy that folder to the server PC, then on the server use Settings → Backup → Restore');
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
  const [activeTab, setActiveTab] = useState<'sections' | 'layout'>('sections');
  const [previewId, setPreviewId] = useState<number | null>(null);   // inline slip preview

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

  const addTemplate = async () => {
    const entered = await promptDialog('Name this template', { placeholder: 'e.g. General OPD, Pediatrics, OBG', confirmLabel: 'Create' });
    const name = (entered || '').trim();
    if (!name) return;   // cancelled or empty — don't create a "Template N"
    const id = Math.max(0, ...draft.map((t) => t.id)) + 1;
    const next = [...draft, {
      id,
      name,
      specialty_hint: '',
      // Sensible starter sections a doctor can rename or remove — no blank slate.
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

  const duplicateTemplate = () => {
    if (!active) return;
    const id = Math.max(0, ...draft.map((t) => t.id)) + 1;
    const copy = { ...JSON.parse(JSON.stringify(active)), id, name: `${active.name} (copy)` };
    setDraft([...draft, copy]);
    setActiveId(id);
  };

  const updateLayout = (patch: Record<string, any>) => {
    if (!active) return;
    const prevLayout = active.layout ?? {};
    setDraft(draft.map((t) => t.id === active.id ? { ...t, layout: { ...prevLayout, ...patch } } : t));
  };

  const addSection = async () => {
    if (!active) return;
    const entered = await promptDialog('Section title', { placeholder: 'e.g. Local Examination, Investigations Advised', confirmLabel: 'Add' });
    const title = (entered || '').trim();
    if (!title) return;
    const newKey = `field_${Date.now()}`;   // key is internal — auto-generated, never shown
    updateSections(active.id, [...active.sections, {
      key: newKey, title, type: 'textarea', height_mm: 30, printed: true,
    }]);
  };

  /** Add a special pediatric growth section — computes centiles live in the consult
      (shown only to a pediatrician when the Pediatrics module is on). */
  const addGrowthSection = () => {
    if (!active) return;
    if (active.sections.some((s: any) => s.type === 'growth')) return;
    updateSections(active.id, [...active.sections, {
      key: `growth_${Date.now()}`, title: 'Growth & Centiles', type: 'growth', height_mm: 24, printed: true,
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
          {active && (
            <button
              className="btn-secondary text-xs"
              onClick={async () => { if (dirty) { await window.electronAPI.templates.saveAll(draft); await qc.invalidateQueries({ queryKey: ['slip-templates'] }); } setPreviewId(active.id); }}
              title="See how this template prints"
            >
              <Eye className="w-3.5 h-3.5" /> Preview
            </button>
          )}
          {active && (
            <button className="btn-secondary text-xs" onClick={duplicateTemplate} title="Duplicate selected template">
              <Copy className="w-3.5 h-3.5" /> Duplicate
            </button>
          )}
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

          {/* Sections / Layout tab switcher */}
          <div className="flex gap-1 border-b border-gray-200 dark:border-slate-700">
            {(['sections', 'layout'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium capitalize rounded-t border-b-2 -mb-px transition-colors',
                  activeTab === t
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400 bg-white dark:bg-slate-800'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200'
                )}
              >
                {t === 'sections' ? 'Sections' : 'Layout & Print'}
              </button>
            ))}
          </div>

          {activeTab === 'sections' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-gray-900 dark:text-slate-100">Sections (in print order)</div>
                <div className="flex gap-1.5">
                  {!active.sections.some((s: any) => s.type === 'growth') && (
                    <button className="btn-secondary text-xs" onClick={addGrowthSection} title="Pediatric growth — live centiles for a pediatrician when Pediatrics is on">
                      <Plus className="w-3.5 h-3.5" /> Pediatric growth
                    </button>
                  )}
                  <button className="btn-secondary text-xs" onClick={addSection}><Plus className="w-3.5 h-3.5" /> Add section</button>
                </div>
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
                      <SlipSectionRow s={s} idx={idx} updateSection={updateSection} removeSection={removeSection} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {activeTab === 'layout' && (() => {
            const layout: SlipLayout = { ...DEFAULT_LAYOUT, ...(active.layout ?? {}) };
            const allKeys = active.sections.map((s: any) => s.key as string);
            const p1 = layout.page1Keys.length > 0 ? layout.page1Keys : allKeys.slice(0, Math.ceil(allKeys.length / 2));
            const p2 = layout.page2Keys.length > 0 ? layout.page2Keys : allKeys.slice(Math.ceil(allKeys.length / 2));
            const assignPage = (key: string, page: 1 | 2) => {
              const newP1: string[] = page === 1 ? [...new Set<string>([...p1, key])] : p1.filter((k: string) => k !== key);
              const newP2: string[] = page === 2 ? [...new Set<string>([...p2, key])] : p2.filter((k: string) => k !== key);
              updateLayout({ page1Keys: newP1, page2Keys: newP2 });
            };
            return (
              <div className="space-y-5">

                {/* Pages */}
                <div>
                  <label className="label">Pages</label>
                  <div className="flex gap-2">
                    {([1, 2] as const).map((n) => (
                      <button key={n} onClick={() => updateLayout({ pages: n })}
                        className={cn('flex-1 py-2 text-xs rounded-lg border font-medium transition-colors',
                          layout.pages === n
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:border-blue-400')}>
                        {n === 1 ? '1 Page (single sheet)' : '2 Pages (front + back)'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Logo size */}
                <div>
                  <label className="label">Logo size</label>
                  <div className="flex gap-2">
                    {(['none', 'small', 'medium', 'large'] as const).map((sz) => (
                      <button key={sz} onClick={() => updateLayout({ logoSize: sz })}
                        className={cn('flex-1 py-1.5 text-xs rounded-lg border font-medium capitalize transition-colors',
                          layout.logoSize === sz
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:border-blue-400')}>
                        {sz}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Header style */}
                <div>
                  <label className="label">Header style</label>
                  <div className="flex gap-2">
                    {(['full', 'compact'] as const).map((hs) => (
                      <button key={hs} onClick={() => updateLayout({ headerStyle: hs })}
                        className={cn('flex-1 py-1.5 text-xs rounded-lg border font-medium capitalize transition-colors',
                          layout.headerStyle === hs
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:border-blue-400')}>
                        {hs === 'full' ? 'Full (name + qualifications + address)' : 'Compact (name only)'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Font size */}
                <div>
                  <label className="label">Font size — {layout.fontSize}px</label>
                  <input type="range" min={10} max={16} step={1} value={layout.fontSize}
                    onChange={(e) => updateLayout({ fontSize: parseInt(e.target.value, 10) })}
                    className="w-full accent-blue-600" />
                  <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                    <span>10 (tiny)</span><span>13 (default)</span><span>16 (large)</span>
                  </div>
                </div>

                {/* Show/hide toggles */}
                <div>
                  <label className="label">Show / hide blocks</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {([
                      ['showVitals',     'Vitals strip'],
                      ['showRxTable',    'Rx table'],
                      ['showSignature',  'Signature block'],
                      ['showQrCodes',    'QR codes'],
                      ['showFollowupBox','Follow-up box'],
                    ] as [keyof SlipLayout, string][]).map(([field, label]) => (
                      <label key={field} className="inline-flex items-center gap-2 text-xs cursor-pointer select-none p-2 rounded-lg border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700/40">
                        <input type="checkbox" checked={layout[field] as boolean}
                          onChange={(e) => updateLayout({ [field]: e.target.checked })}
                          className="w-3.5 h-3.5 accent-blue-600" />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Page split (only for 2-page mode) */}
                {layout.pages === 2 && allKeys.length > 0 && (
                  <div>
                    <label className="label">Page split — assign sections to pages</label>
                    <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-2">Click a page button to move a section. Leave blank for automatic split.</p>
                    <div className="space-y-1.5">
                      {allKeys.map((key: string) => {
                        const inP1 = p1.includes(key);
                        const inP2 = p2.includes(key);
                        const sec = active.sections.find((s: any) => s.key === key);
                        return (
                          <div key={key} className="flex items-center gap-2 text-xs">
                            <span className="flex-1 font-medium text-gray-700 dark:text-slate-300 truncate">{sec?.title || key}</span>
                            <button onClick={() => assignPage(key, 1)}
                              className={cn('px-2 py-0.5 rounded border text-[11px] transition-colors',
                                inP1 ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 dark:border-slate-600 text-gray-500 hover:border-blue-400')}>
                              Pg 1
                            </button>
                            <button onClick={() => assignPage(key, 2)}
                              className={cn('px-2 py-0.5 rounded border text-[11px] transition-colors',
                                inP2 ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-300 dark:border-slate-600 text-gray-500 hover:border-indigo-400')}>
                              Pg 2
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    <button onClick={() => updateLayout({ page1Keys: [], page2Keys: [] })}
                      className="mt-2 text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-slate-300">
                      Reset to auto-split
                    </button>
                  </div>
                )}

              </div>
            );
          })()}

          {draft.length > 1 && (
            <div className="border-t border-gray-200 dark:border-slate-700 pt-3">
              <button onClick={() => deleteTemplate(active.id)} className="text-xs text-red-600 hover:text-red-700 inline-flex items-center gap-1">
                <Trash2 className="w-3.5 h-3.5" /> Delete template "{active.name}"
              </button>
            </div>
          )}
        </div>
      )}

      {/* Inline preview of the template just edited — opens right here, no
          scrolling to a separate section. */}
      {previewId !== null && <SlipTemplatePreview templateId={previewId} onClose={() => setPreviewId(null)} />}
    </section>
  );
}

/** Renders the OPD slip with sample data for one template id (the inline preview). */
function SlipTemplatePreview({ templateId, onClose }: { templateId: number; onClose: () => void }) {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { data: doctors = [] } = useQuery({ queryKey: ['doctors'], queryFn: () => window.electronAPI.doctors.list(true) });
  if (!settings) return null;

  const baseDoctor = (doctors as any[]).find((d) => d.is_active) ?? {
    id: 1, name: 'Dr. Sample', specialty: 'General', phone: '', room_number: '101',
    is_active: 1, default_fee: 0, qualifications: 'MBBS', registration_no: '', signature: null, color: '#2563eb',
  };
  const doctor = { ...baseDoctor, template_id: templateId };   // force OpdSlip to resolve this template

  const today = new Date();
  const dob3 = new Date(today.getFullYear() - 3, today.getMonth(), today.getDate() - 12);
  const appointment: any = {
    id: 9999, patient_id: 9999, doctor_id: doctor.id,
    appointment_date: today.toISOString().slice(0, 10), appointment_time: '10:30',
    token_number: 7, consultation_token: null, visit_number: 3, visit_id: 'PT-PREVIEW-0001/V3',
    status: 'Done', notes: 'Fever x3 days', created_at: today.toISOString(),
    patient_name: 'Rohit Kulkarni (sample)', patient_uhid: 'PT-PREVIEW-0001',
    patient_dob: dob3.toISOString().slice(0, 10), patient_gender: 'M', patient_phone: '9876543210',
    patient_blood_group: 'O+', patient_created_at: today.toISOString(),
    doctor_name: doctor.name, doctor_specialty: doctor.specialty, doctor_room: doctor.room_number,
  };
  const consultation: any = {
    id: 9999, appointment_id: 9999, patient_id: 9999, doctor_id: doctor.id,
    history: 'Fever since 3 days, cough, reduced appetite.',
    examination: 'Throat congested. Chest clear. P/A soft.',
    impression: 'Acute viral URTI.', advice: 'Steam inhalation, warm fluids, review in 48h.',
    follow_up_date: new Date(today.getTime() + 5 * 864e5).toISOString().slice(0, 10),
    vitals: { bp: '110/72', pulse: '92', temp: '101.4', spo2: '98', rr: '20', weight: '14', height: '95' },
    created_at: today.toISOString(), updated_at: today.toISOString(),
  };
  const rx: any = [
    { drug_name: 'Crocin Syrup 60ml', dosage: '5 ml', frequency: 'TID', duration: '3 days', instructions: 'After food' },
    { drug_name: 'ORS Sachet', dosage: '1 sachet', frequency: 'PRN', duration: 'As needed', instructions: 'In 200 ml water' },
  ];

  return (
    <OpdSlip appointment={appointment} consultation={consultation} doctor={doctor as any}
      settings={settings} rxItems={rx} labOrders={[]} onClose={onClose} />
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

              {/* OPD Slip body template slots (up to 3 per doctor) */}
              <DoctorTemplateSlotsEditor
                doctor={editing}
                onChange={(patch) => setEditing({ ...editing, ...patch })}
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
function DoctorTemplateSlotsEditor({ doctor, onChange }: {
  doctor: Partial<Doctor>;
  onChange: (patch: Partial<Doctor>) => void;
}) {
  const { data: templates = [] } = useQuery({
    queryKey: ['slip-templates'],
    queryFn: () => window.electronAPI.templates.list(),
  });

  const slotNames: [string, string, string] = (() => {
    try { return JSON.parse(doctor.template_slot_names || '[]').concat(['Template 1','Template 2','Template 3']).slice(0,3); }
    catch { return ['Template 1','Template 2','Template 3']; }
  })();

  const templateIds = [doctor.template_id ?? null, doctor.template_id_2 ?? null, doctor.template_id_3 ?? null];

  const setSlotName = (i: number, val: string) => {
    const next: [string,string,string] = [...slotNames] as any;
    next[i] = val;
    onChange({ template_slot_names: JSON.stringify(next) });
  };

  const setSlotTemplate = (i: number, id: number | null) => {
    if (i === 0) onChange({ template_id: id });
    if (i === 1) onChange({ template_id_2: id });
    if (i === 2) onChange({ template_id_3: id });
  };

  return (
    <div className="mt-4 space-y-3">
      <div className="text-xs font-semibold text-gray-700 dark:text-slate-200">OPD Slip Template Slots</div>
      <div className="text-[10px] text-gray-500 dark:text-slate-400 -mt-1">
        Up to 3 templates per doctor — e.g. "New Patient", "Follow-up", "Procedure". Slot name is shown on the print picker.
      </div>
      {([0, 1, 2] as const).map((i) => (
        <div key={i} className="grid grid-cols-[120px_1fr] gap-2 items-center">
          <input
            className="input !py-1 !text-xs font-semibold"
            value={slotNames[i]}
            onChange={(e) => setSlotName(i, e.target.value)}
            placeholder={`Slot ${i + 1} name`}
          />
          <select
            className="input !py-1 !text-xs"
            value={templateIds[i] ?? ''}
            onChange={(e) => setSlotTemplate(i, e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">{i === 0 ? '— General (default) —' : '— Not used —'}</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}{t.specialty_hint ? ` · ${t.specialty_hint}` : ''}
              </option>
            ))}
          </select>
        </div>
      ))}
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
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking for new releases…
                </div>
                <div className="text-[11px] text-gray-600 dark:text-slate-400 mt-0.5">Current version: <span className="font-mono">{v}</span></div>
              </>
            )}
            {!dev && state?.state === 'uptodate' && (
              <>
                <div className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">✓ You're on the latest version</div>
                <div className="text-[11px] text-emerald-800 dark:text-emerald-300 mt-0.5">
                  Current version: <span className="font-mono">{v}</span>
                  {latest && latest !== v && <> · Latest available: <span className="font-mono">{latest}</span></>}
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
                <div className="text-sm font-semibold text-red-900 dark:text-red-200">Couldn't reach the update server</div>
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

// =====================================================================
// Subscription & Modules — shows the active plan, which modules are on, and an
// upgrade/renew flow (enter a fresh activation code / licence for THIS machine).
const SUB_MODULES: { key: string; name: string; desc: string; base?: boolean }[] = [
  // Base bundle — included in every plan (never locked).
  { key: 'reception', name: 'Reception & Registration', desc: 'Patient registration, tokens, queue', base: true },
  { key: 'opd', name: 'OPD / Consultation', desc: 'Doctor consultation & prescriptions', base: true },
  { key: 'lab', name: 'Laboratory', desc: 'Test orders, results, 170+ catalog', base: true },
  { key: 'peds', name: 'Pediatrics', desc: 'Growth charts, vaccines — free for paediatricians', base: true },
  { key: 'analytics', name: 'Analytics & Reports', desc: 'Revenue, module P&L, insights', base: true },
  // Paid add-ons — licence-gated.
  { key: 'pharmacy', name: 'Pharmacy', desc: 'Dispensing, FEFO inventory, sales' },
  { key: 'ipd', name: 'In-Patient (IPD)', desc: 'Admissions, wards, discharge, TPA' },
  { key: 'whatsapp', name: 'WhatsApp Messaging', desc: 'Click-to-WhatsApp + automation' },
];

function SubscriptionTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<'online' | 'paste' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: lic, isLoading } = useQuery({ queryKey: ['license'], queryFn: () => window.electronAPI.license.status() });

  if (isLoading || !lic) {
    return <SettingsGroup title="Subscription & Modules" subtitle="Loading your plan…"><div className="card p-6 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-400" /></div></SettingsGroup>;
  }

  const modules: string[] = lic.modules || [];
  const isDev = lic.state === 'dev';
  const c: any = lic.contact || {};
  const clinic = lic.payload?.clinic || '';
  const expiry = lic.payload?.expires_at ? format(parseISO(lic.payload.expires_at), 'd MMM yyyy') : '—';
  const machineId = lic.hardwareId || '';
  const isActive = (k: string, base?: boolean) => isDev || base || modules.includes(k);

  const planTone =
    lic.state === 'locked' ? { bg: 'bg-red-50 dark:bg-red-900/20', text: 'text-red-700 dark:text-red-300', label: 'Expired — read-only' }
    : lic.state === 'grace' ? { bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-700 dark:text-amber-300', label: `Expired — ${lic.graceDaysLeft} grace day(s) left` }
    : isDev ? { bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-600 dark:text-slate-300', label: 'Development build — not enforced' }
    : { bg: 'bg-emerald-50 dark:bg-emerald-900/20', text: 'text-emerald-700 dark:text-emerald-300', label: lic.daysLeft != null ? `Active — ${lic.daysLeft} day(s) left` : 'Active' };

  const copyId = async () => { try { await navigator.clipboard.writeText(machineId); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } };

  const done = (r: any) => {
    if (r?.ok) {
      qc.invalidateQueries({ queryKey: ['license'] });
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast('Subscription updated — new modules unlocked', 'success');
      setOpen(false); setCode(''); setToken(''); setErr(null);
    } else {
      setErr(r?.error || 'Activation failed.');
    }
  };
  const applyOnline = async () => {
    setErr(null); if (!code.trim()) { setErr('Enter the activation code you were given.'); return; }
    setBusy('online');
    try { done(await window.electronAPI.license.activateOnline(code.trim())); }
    catch (e: any) { setErr(e?.message || 'Activation failed.'); }
    finally { setBusy(null); }
  };
  const applyPaste = async () => {
    setErr(null); if (!token.trim()) { setErr('Paste the licence code you were sent.'); return; }
    setBusy('paste');
    try { done(await window.electronAPI.license.activate(token.trim())); }
    catch (e: any) { setErr(e?.message || 'Activation failed.'); }
    finally { setBusy(null); }
  };

  return (
    <>
      <SettingsGroup title="Your Plan" subtitle="What this clinic is licensed for, and until when.">
        <div className="card p-5 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            {clinic && <div className="text-[15px] font-bold text-gray-900 dark:text-slate-100">{clinic}</div>}
            <span className={cn('text-[12px] font-semibold px-2.5 py-1 rounded-full', planTone.bg, planTone.text)}>{planTone.label}</span>
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-1 text-[12px] text-gray-600 dark:text-slate-300">
            <div><span className="text-gray-400">Valid until:</span> <b>{expiry}</b></div>
            <div className="flex items-center gap-1.5">
              <span className="text-gray-400">Machine ID:</span> <span className="font-mono text-[11px]">{machineId || '—'}</span>
              {machineId && <button onClick={copyId} className="text-blue-600 hover:underline inline-flex items-center gap-0.5"><Copy className="w-3 h-3" />{copied ? 'Copied' : 'Copy'}</button>}
            </div>
          </div>
          {!isDev && (
            <button className="btn-primary" onClick={() => { setErr(null); setOpen(true); }}>
              <KeyRound className="w-4 h-4" /> Enter upgrade / renewal code
            </button>
          )}
          {isDev && <p className="text-[12px] text-gray-500 dark:text-slate-400">This is a development build — all modules are on and licensing isn’t enforced. On an installed copy, only the modules in the clinic’s licence appear active below.</p>}
        </div>
      </SettingsGroup>

      <SettingsGroup title="Modules" subtitle="Green = included in your subscription. Locked ones can be switched on any time — just call us for an upgrade code.">
        <div className="card p-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {SUB_MODULES.map((m) => {
            const on = isActive(m.key, m.base);
            return (
              <div key={m.key} className={cn('rounded-lg border p-3 flex items-start gap-3', on ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-900/10' : 'border-gray-200 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-800/40')}>
                {on ? <BadgeCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" /> : <Lock className="w-4 h-4 text-gray-400 shrink-0 mt-1" />}
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-2">
                    {m.name}
                    {m.base && <span className="text-[10px] font-normal text-gray-400">(always included)</span>}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-slate-400">{m.desc}</div>
                  {!on && <button onClick={() => { setErr(null); setOpen(true); }} className="text-[11px] font-semibold text-blue-600 hover:underline mt-1">Upgrade to activate →</button>}
                </div>
              </div>
            );
          })}
        </div>
      </SettingsGroup>

      <SettingsGroup title="Need to upgrade or renew?" subtitle="Adding a module or extending your licence takes under a minute — no reinstall, no data loss.">
        <div className="card p-5 text-[13px] text-gray-700 dark:text-slate-200 space-y-2">
          <p>Call or message us and tell us which modules you want (or that you’re renewing). We’ll generate an activation code tied to <b>this computer’s Machine ID</b> and send it over. Enter it above, and the new modules unlock instantly — your patients, bills and records stay exactly as they are.</p>
          <div className="flex flex-wrap gap-4 pt-1 font-semibold">
            {c.phone && <span>📞 {c.phone}</span>}
            {c.email && <span>✉ {c.email}</span>}
          </div>
        </div>
      </SettingsGroup>

      <Modal open={open} onClose={() => busy === null && setOpen(false)} title="Upgrade / renew subscription" size="md">
        <div className="space-y-4">
          <p className="text-[13px] text-gray-600 dark:text-slate-300">Share this Machine ID when you call — your code is tied to it. Then enter the code we send you.</p>
          <div>
            <label className="label">Machine ID</label>
            <div className="flex gap-2">
              <input className="input font-mono text-xs" readOnly value={machineId} />
              <button className="btn-secondary text-xs whitespace-nowrap" onClick={copyId}><Copy className="w-3.5 h-3.5" /> {copied ? 'Copied' : 'Copy'}</button>
            </div>
          </div>

          {lic.onlineAvailable && (
            <div>
              <label className="label">Activation code</label>
              <input className="input font-mono tracking-widest uppercase" value={code} placeholder="CURE-XXXX-XXXX-XXXX"
                onChange={(e) => setCode(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter') applyOnline(); }} />
              <button className="btn-primary w-full justify-center mt-2" disabled={busy !== null || !code.trim()} onClick={applyOnline}>
                {busy === 'online' ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} Activate online
              </button>
            </div>
          )}

          <div className={lic.onlineAvailable ? 'pt-3 border-t border-gray-100 dark:border-slate-700' : ''}>
            <label className="label">{lic.onlineAvailable ? 'Or paste a licence code' : 'Licence code'}</label>
            <textarea className="input font-mono text-[11px] leading-tight" rows={3} value={token} placeholder="Paste the licence code you were sent…" onChange={(e) => setToken(e.target.value)} />
            <button className="btn-primary w-full justify-center mt-2" disabled={busy !== null || !token.trim()} onClick={applyPaste}>
              {busy === 'paste' ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} Apply licence
            </button>
          </div>

          {err && <div className="text-[12px] text-red-600 dark:text-red-400">{err}</div>}
          <p className="text-[11px] text-gray-400 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 shrink-0" /> Upgrading only swaps your licence — it never touches your data.</p>
        </div>
      </Modal>
    </>
  );
}

// =====================================================================
// Billing & IPD tab
// =====================================================================
function BillingIpdTab() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { draft, set, reset, dirty, saving, save } = useSectionDraft(settings, [
    'gst_enabled', 'gst_registration_type', 'clinic_gstin', 'clinic_legal_name', 'clinic_state_code',
    'healthcare_gst_exempt', 'invoice_prefix', 'ip_number_prefix', 'bill_round_off',
    'discount_caps_json', 'discount_require_reason',
    'ipd_auto_accrue_bed', 'ipd_auto_accrue_nursing', 'ipd_auto_accrue_doctor_visit',
    'ipd_doctor_visit_mode', 'ipd_transfer_charge_rule', 'ipd_accrual_time', 'ipd_advance_enabled',
    'tpa_enabled', 'ipd_admission_requests_enabled', 'discharge_summary_enabled', 'lab_auto_bill',
  ]);

  if (!settings) return <div className="card p-8 text-center text-sm text-gray-500"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between sticky top-12 z-[5] bg-white/80 dark:bg-slate-900/80 backdrop-blur py-2 -my-2 px-1 rounded">
        <div className="text-[11px] text-gray-500 dark:text-slate-400">
          Changes here apply across the clinic. Wards and beds save on their own; the toggles below need <b>Save</b>.
        </div>
        <div className="flex items-center gap-2">
          {dirty && <button className="btn-ghost text-xs" onClick={reset}>Reset</button>}
          <button className="btn-primary text-xs" disabled={!dirty || saving} onClick={save}>
            {saving ? 'Saving…' : dirty ? 'Save changes' : 'All saved'}
          </button>
        </div>
      </div>

      <WardsBedsEditor />

      {/* IPD auto-accrual */}
      <div className="card p-5 space-y-4">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">IPD Charges &amp; Accrual</div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
            Which charges post themselves to an admitted patient's running bill, and how. Anything auto-posted can still
            be edited or removed on the bill.
          </div>
        </div>

        <AccrualToggle label="Charge the bed rate automatically each day"
          help="Every occupied bed posts its ward's daily rate once per day. Turn off to add bed charges by hand."
          value={draft.ipd_auto_accrue_bed ?? true} onChange={(v) => set('ipd_auto_accrue_bed', v)} />
        <AccrualToggle label="Charge the nursing rate automatically each day"
          help="Posts the ward's nursing rate daily, separate from the bed. Off if nursing is included in your bed rate."
          value={draft.ipd_auto_accrue_nursing ?? true} onChange={(v) => set('ipd_auto_accrue_nursing', v)} />
        <AccrualToggle label="Charge doctor visit fees automatically each day"
          help="Posts a visit fee for the doctor(s) who saw the patient that day, using their fee from the doctor list."
          value={draft.ipd_auto_accrue_doctor_visit ?? true} onChange={(v) => set('ipd_auto_accrue_doctor_visit', v)} />

        {(draft.ipd_auto_accrue_doctor_visit ?? true) && (
          <div className="pl-6">
            <label className="label">Which doctors get a daily visit fee</label>
            <select className="input" value={draft.ipd_doctor_visit_mode ?? 'per_consultant'}
              onChange={(e) => set('ipd_doctor_visit_mode', e.target.value as any)}>
              <option value="per_consultant">Every doctor who wrote a note that day</option>
              <option value="primary_only">Only the admitting doctor</option>
              <option value="manual">None automatically — add by hand</option>
            </select>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-gray-100 dark:border-slate-800">
          <div>
            <label className="label">If a patient moves ward mid-day, charge…</label>
            <select className="input" value={draft.ipd_transfer_charge_rule ?? 'higher'}
              onChange={(e) => set('ipd_transfer_charge_rule', e.target.value as any)}>
              <option value="higher">The higher of the two bed rates (recommended)</option>
              <option value="prorata">Split by hours in each ward</option>
              <option value="both">Both beds in full</option>
            </select>
            <div className="text-[10px] text-gray-500 mt-1">
              "Higher" is standard practice and the easiest to explain at the billing counter.
            </div>
          </div>
          <div>
            <label className="label">Time the daily charges post</label>
            <input className="input" type="time" value={draft.ipd_accrual_time ?? '00:05'}
              onChange={(e) => set('ipd_accrual_time', e.target.value)} />
            <div className="text-[10px] text-gray-500 mt-1">
              Just after midnight is usual, so each day's charge lands at the start of that day.
            </div>
          </div>
        </div>

        <AccrualToggle label="Collect advance deposits at admission"
          help="Lets reception take a deposit when admitting, adjusted against the final bill. Refunds are handled at discharge (important for LAMA and death, where money is usually owed back)."
          value={draft.ipd_advance_enabled ?? true} onChange={(v) => set('ipd_advance_enabled', v)} />
      </div>

      <BillingSettings draft={draft} set={set as any} />

      {/* TPA */}
      <div className="card p-5">
        <AccrualToggle label="Handle insurance / TPA (cashless) admissions"
          help="Turns on the insurance module — insurer master, pre-authorisation tracking, and claim reconciliation. Leave off if you take only cash, UPI and card."
          value={draft.tpa_enabled ?? false} onChange={(v) => set('tpa_enabled', v)} />
      </div>

      {/* Discharge Summary module */}
      <div className="card p-5">
        <AccrualToggle label="Discharge Summary builder (sidebar)"
          help="Adds a dedicated “Discharge Summary” screen to the sidebar to build, save, preview and print full discharge summaries from your templates — on the clinic letterhead. Turn off to hide it."
          value={draft.discharge_summary_enabled ?? true} onChange={(v) => set('discharge_summary_enabled', v)} />
      </div>

      <DischargeTemplateEditor />

      {/* Admission requests */}
      <div className="card p-5">
        <AccrualToggle label="Let doctors request admissions from OPD"
          help="A doctor seeing a patient can press “Request Admission”; it appears under IPD → Requests for reception to approve and assign a ward and bed. Turn off if reception admits directly."
          value={draft.ipd_admission_requests_enabled ?? true} onChange={(v) => set('ipd_admission_requests_enabled', v)} />
      </div>

      {/* Lab auto-billing */}
      <div className="card p-5">
        <AccrualToggle label="Auto-raise a bill when a lab test is ordered"
          help="When a doctor or reception orders lab tests, an unpaid bill is created automatically from the test prices, so lab revenue lands in billing instead of being missed. Reception collects it at the counter. Turn off if you bill lab work another way."
          value={draft.lab_auto_bill ?? true} onChange={(v) => set('lab_auto_bill', v)} />
      </div>

      <LabSettingsCard />

    </div>
  );
}

/**
 * Pediatrics add-on settings — its own tab (was buried under Billing & IPD).
 * The module gates a dedicated Pediatrics screen plus the in-consultation growth
 * section for pediatricians. Growth reference default: WHO 0–5y, IAP 5–18y.
 */
function PediatricsTab() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { draft, set, reset, dirty, saving, save } = useSectionDraft(settings, [
    'peds_enabled', 'peds_growth_enabled', 'peds_vaccines_enabled', 'peds_calculators_enabled',
    'peds_vaccine_schedule', 'peds_growth_default',
  ]);

  if (!settings) return <div className="card p-8 text-center text-sm text-gray-500"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between sticky top-12 z-[5] bg-white/80 dark:bg-slate-900/80 backdrop-blur py-2 -my-2 px-1 rounded">
        <div className="text-[11px] text-gray-500 dark:text-slate-400">
          Turn the paediatrics tools on or off. The toggles below need <b>Save</b>.
        </div>
        <div className="flex items-center gap-2">
          {dirty && <button className="btn-ghost text-xs" onClick={reset}>Reset</button>}
          <button className="btn-primary text-xs" disabled={!dirty || saving} onClick={save}>
            {saving ? 'Saving…' : dirty ? 'Save changes' : 'All saved'}
          </button>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-1.5"><Baby className="w-4 h-4 text-pink-500" /> Pediatrics Add-on</div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
            Growth centiles (WHO 0–5y &amp; IAP 5–18y), an immunisation diary, and paediatric calculators — in a dedicated
            Pediatrics screen, and live inside a pediatrician’s consultation. Off by default — turn it on only if your clinic sees children.
          </div>
        </div>
        <AccrualToggle label="Enable the Pediatrics module"
          help="Adds a Pediatrics item to the sidebar, and shows the growth section live inside a pediatrician's consultation. Each tool below can be shown or hidden separately."
          value={draft.peds_enabled ?? false} onChange={(v) => set('peds_enabled', v)} />
        {draft.peds_enabled && (
          <div className="pl-7 space-y-3 border-l-2 border-pink-200 dark:border-pink-900">
            <AccrualToggle label="Growth &amp; centiles"
              help="Enter weight, height and (under 5) head circumference; get centiles and z-scores with a saved history. Charts: WHO (0–5y) and IAP 2015 (5–18y), plus BMI."
              value={draft.peds_growth_enabled ?? true} onChange={(v) => set('peds_growth_enabled', v)} />
            {(draft.peds_growth_enabled ?? true) && (
              <div className="pl-2">
                <label className="label">Growth-chart reference</label>
                <select className="input max-w-md" value={draft.peds_growth_default ?? 'auto'} onChange={(e) => set('peds_growth_default', e.target.value as any)}>
                  <option value="auto">Automatic — WHO under 5, IAP 5–18 (recommended)</option>
                  <option value="who">Always WHO</option>
                  <option value="iap">Always IAP 2015</option>
                </select>
                <div className="text-[11px] text-gray-500 mt-1">
                  Head circumference always uses WHO and only shows for under-5s. Height, weight and BMI use the reference chosen here.
                </div>
              </div>
            )}
            <AccrualToggle label="Immunisation diary"
              help="Per-child vaccine schedule with due dates from date of birth; mark doses as given."
              value={draft.peds_vaccines_enabled ?? true} onChange={(v) => set('peds_vaccines_enabled', v)} />
            <AccrualToggle label="Calculators"
              help="Mid-parental (target) height and corrected age / postmenstrual age for premature babies."
              value={draft.peds_calculators_enabled ?? true} onChange={(v) => set('peds_calculators_enabled', v)} />
            <div>
              <label className="label">Vaccine schedule</label>
              <select className="input max-w-xs" value={draft.peds_vaccine_schedule ?? 'iap'} onChange={(e) => set('peds_vaccine_schedule', e.target.value as any)}>
                <option value="iap">IAP (Indian Academy of Pediatrics)</option>
                <option value="nis">NIS (National Immunization Schedule)</option>
              </select>
              <div className="text-[11px] text-gray-500 mt-1">Which schedule new immunisation diaries are built from.</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Default time window for the big record lists (Reception patients, Discharge
 * Summary admissions). Keeps the app snappy when the database has grown to tens
 * of thousands of rows — search always scans everything, only the default view
 * is trimmed.
 */
/**
 * Laboratory catalog management — surfaced in Settings so an admin can load the
 * standard Indian test catalog and jump to the full editor. The tests drive OPD/
 * IPD ordering, auto-billing and the Modules P&L, so this is the one place to
 * curate what the lab offers and at what price.
 */
function LabSettingsCard() {
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const { data: tests = [] } = useQuery({ queryKey: ['lab-tests', false], queryFn: () => window.electronAPI.lab.listTests(false) });
  const active = tests.filter((t: any) => t.is_active === 1).length;

  const loadStd = async () => {
    setBusy(true);
    try {
      const r = await window.electronAPI.lab.loadStandardCatalog();
      if (r.ok) { qc.invalidateQueries({ queryKey: ['lab-tests', false] }); toast(r.added > 0 ? `Added ${r.added} standard tests — set your prices in the catalog` : 'Standard catalog already loaded', 'success'); }
      else toast('Could not load the catalog', 'error');
    } catch (e: any) { toast(e?.message || 'Failed', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div className="card p-5 space-y-3">
      <div>
        <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-1.5"><FlaskConical className="w-4 h-4 text-fuchsia-500" /> Laboratory catalog</div>
        <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
          The tests your lab offers, with prices — used across OPD/IPD orders, billing and analytics.
          {tests.length > 0 ? <> Currently <b>{tests.length}</b> tests · <b>{active}</b> active.</> : <> No tests loaded yet.</>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary text-xs" disabled={busy} onClick={loadStd} title="Adds the ~160 common Indian pathology + radiology tests (skips ones you already have)">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Load standard catalog (~160 tests)
        </button>
        <button className="btn-primary text-xs" onClick={() => navigate('/lab')}>
          <Pencil className="w-3.5 h-3.5" /> Manage tests &amp; prices
        </button>
      </div>
      <div className="text-[11px] text-gray-500 dark:text-slate-400">
        Covers pathology (haematology, biochemistry, serology, microbiology, histopathology…) and radiology. Set prices, enable/disable
        and add your own tests under <b>Laboratory → Test Catalog</b>.
      </div>
    </div>
  );
}

function RecordsWindowSetting() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { draft, set, reset, dirty, saving, save } = useSectionDraft(settings, ['records_list_window']);
  if (!settings) return <div className="card p-6 text-center"><Loader2 className="w-4 h-4 animate-spin mx-auto text-gray-400" /></div>;
  return (
    <div className="card p-5 space-y-3">
      <div className="max-w-xs">
        <label className="label">Show records from</label>
        <select className="input" value={draft.records_list_window ?? 'month'} onChange={(e) => set('records_list_window', e.target.value as any)}>
          <option value="week">Last 7 days</option>
          <option value="month">Last month</option>
          <option value="quarter">Last 3 months</option>
          <option value="all">Everything</option>
        </select>
      </div>
      <div className="text-[11px] text-gray-500 dark:text-slate-400">
        This trims only the <b>default</b> list you see before typing, so a clinic with 20,000+ patients still opens instantly.
        Searching by name, phone, UHID or IP number always looks through your <b>entire</b> history, no matter how old.
      </div>
      <div className="flex items-center gap-2">
        {dirty && <button className="btn-ghost text-xs" onClick={reset}>Reset</button>}
        <button className="btn-primary text-xs" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}</button>
      </div>
    </div>
  );
}

/**
 * One editable slip section. Simple by default — a doctor sees only the section
 * name, how much space it takes on the slip, and a print toggle. The technical
 * options (field type, hint text, exact height, dropdown choices) are tucked
 * behind an "Advanced" link so nobody has to understand "Print height (mm)".
 */
function SlipSectionRow({ s, idx, updateSection, removeSection }: {
  s: any; idx: number; updateSection: (idx: number, patch: any) => void; removeSection: (idx: number) => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  // Friendly space sizes mapped to millimetres.
  const SPACE: Record<string, number> = { Small: 22, Medium: 45, Large: 70 };
  const spaceLabel = (mm: number) => mm <= 30 ? 'Small' : mm <= 55 ? 'Medium' : mm <= 90 ? 'Large' : 'Custom';
  const hasSpace = s.type === 'textarea' || s.type === 'singleline';

  return (
    <div className="flex-1 space-y-2">
      {/* Simple row: name · space · print */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
        <div className="md:col-span-7">
          <label className="label !mb-0.5 !text-[10px]">Section name</label>
          <input className="input !py-1.5 !text-sm" value={s.title} placeholder="e.g. Examination"
            onChange={(e) => updateSection(idx, { title: e.target.value })} />
        </div>
        {hasSpace && (
          <div className="md:col-span-3">
            <label className="label !mb-0.5 !text-[10px]">Space on slip</label>
            <select className="input !py-1.5 !text-sm"
              value={spaceLabel(s.height_mm ?? 45)}
              onChange={(e) => { const v = e.target.value; if (SPACE[v]) updateSection(idx, { height_mm: SPACE[v] }); }}>
              {Object.keys(SPACE).map((k) => <option key={k} value={k}>{k}</option>)}
              {spaceLabel(s.height_mm ?? 45) === 'Custom' && <option value="Custom">Custom ({s.height_mm}mm)</option>}
            </select>
          </div>
        )}
        <label className="md:col-span-2 inline-flex items-center gap-1.5 text-[12px] cursor-pointer pb-1.5">
          <input type="checkbox" checked={s.printed !== false} onChange={(e) => updateSection(idx, { printed: e.target.checked })} className="w-4 h-4 accent-blue-600" />
          <span>Print it</span>
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setAdvanced((v) => !v)} className="text-[11px] text-blue-600 dark:text-blue-300 hover:underline">
          {advanced ? 'Hide advanced' : 'Advanced options'}
        </button>
        <button onClick={() => removeSection(idx)} className="text-[11px] text-red-600 hover:text-red-700 inline-flex items-center gap-1">
          <Trash2 className="w-3 h-3" /> Remove section
        </button>
      </div>

      {advanced && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 rounded-lg bg-white dark:bg-slate-900/60 border border-gray-200 dark:border-slate-700 p-3">
          <div>
            <label className="label !mb-0.5 !text-[10px]">What kind of field</label>
            <select className="input !py-1 !text-xs" value={s.type} onChange={(e) => updateSection(idx, { type: e.target.value })}>
              <option value="textarea">Paragraph (several lines)</option>
              <option value="singleline">Short text (one line)</option>
              <option value="date">Date</option>
              <option value="number">Number</option>
              <option value="dropdown">Pick from a list</option>
            </select>
          </div>
          {s.type === 'dropdown' && (
            <div>
              <label className="label !mb-0.5 !text-[10px]">List choices (separate with commas)</label>
              <input className="input !py-1 !text-xs" value={(s.options || []).join(', ')}
                onChange={(e) => updateSection(idx, { options: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
            </div>
          )}
          <div>
            <label className="label !mb-0.5 !text-[10px]">Hint text (grey text shown before typing)</label>
            <input className="input !py-1 !text-xs" value={s.placeholder || ''} onChange={(e) => updateSection(idx, { placeholder: e.target.value })} placeholder="optional" />
          </div>
          {hasSpace && (
            <div>
              <label className="label !mb-0.5 !text-[10px]">Exact height on print (mm)</label>
              <input type="number" min={5} max={120} className="input !py-1 !text-xs" value={s.height_mm ?? 45}
                onChange={(e) => updateSection(idx, { height_mm: parseInt(e.target.value, 10) || 45 })} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SecurityLoginSettings() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { draft, set, reset, dirty, saving, save } = useSectionDraft(settings, ['require_login', 'session_timeout_minutes']);
  if (!settings) return <div className="card p-8 text-center text-sm text-gray-500"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>;

  return (
    <div className="card p-5 space-y-4">
      <AccrualToggle
        label="Require everyone to sign in"
        help="Each person logs in with their own username and password, and their actions are attributed to them in the audit trail. Turn off for a single shared PC where no login is needed. When on, sign-out returns to the login screen instead of a shared session."
        value={draft.require_login ?? false}
        onChange={(v) => set('require_login', v)}
      />
      {draft.require_login && (
        <div className="pl-7 border-l-2 border-blue-200 dark:border-blue-900">
          <label className="label">Auto sign-out after idle (minutes)</label>
          <input
            type="number" min={0} max={240} className="input max-w-[140px]"
            value={draft.session_timeout_minutes ?? 0}
            onChange={(e) => set('session_timeout_minutes', Math.max(0, Number(e.target.value) || 0))}
          />
          <div className="text-[11px] text-gray-500 mt-1">
            Signs a user out automatically after this many minutes with no mouse or keyboard activity — useful for a shared reception PC. Set 0 to never auto sign-out.
          </div>
        </div>
      )}
      {draft.require_login && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-[11px] text-amber-800 dark:text-amber-200">
          Before turning this on, make sure every staff member has an account under <b>Users &amp; Access</b> with a password they know. You can always sign in as <b>admin</b> to manage accounts.
        </div>
      )}
      <div className="flex items-center gap-2">
        {dirty && <button className="btn-ghost text-xs" onClick={reset}>Reset</button>}
        <button
          className="btn-primary text-xs"
          disabled={!dirty || saving}
          onClick={() => {
            const loginChanged = (draft.require_login ?? false) !== (settings.require_login ?? false);
            // Update the synchronous mirror so the gate re-evaluates correctly.
            try { localStorage.setItem('caredesk-require-login', draft.require_login ? '1' : '0'); } catch { /* ignore */ }
            save();
            // Turning the requirement on or off changes the app's entry gate, so
            // reload to apply it cleanly (the setting itself is already saved).
            if (loginChanged) setTimeout(() => window.location.reload(), 500);
          }}
        >
          {saving ? 'Saving…' : dirty ? 'Save changes' : 'All saved'}
        </button>
      </div>
    </div>
  );
}

function AccrualToggle({ label, help, value, onChange }: {
  label: string; help: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input type="checkbox" className="mt-1" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <div>
        <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100">{label}</div>
        <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">{help}</div>
      </div>
    </label>
  );
}
