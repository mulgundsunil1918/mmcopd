import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Baby, Search, Stethoscope, Plus, Pencil, Wallet, ListChecks, Save, Database as DbIcon, Calendar as CalIcon, ArrowRight, Loader2, AlertTriangle, Trash2, User as UserIcon, IndianRupee, PenTool, Power, AlertCircle, ArrowUp, ArrowDown, Eye, FileText, MapPin, Syringe, RefreshCw, Sparkles, HardDrive, Sun, Copy, FlaskConical, ShieldCheck, KeyRound, Lock, BadgeCheck, Wifi, Download } from 'lucide-react';
import { DEFAULT_LAYOUT } from '../db/slip-templates';
import type { SlipLayout } from '../db/slip-templates';
import { format, parseISO } from 'date-fns';
import { cn } from '../lib/utils';
import { copyText } from '../lib/clipboard';
import { PATIENT_LANGS } from '../lib/rxLang';
import { Check } from 'lucide-react';
import { Modal } from '../components/Modal';
import { ImageUpload } from '../components/ImageUpload';
import { PrintHeader, resolveLetterhead, LOGO_SIZES, LOGO_MM, LOGO_SIZE_LABEL } from '../components/print/PrintHeader';
import { clockInfo } from '../lib/clock';
import { Letterhead as OpdLetterhead } from '../components/OpdSlip';

// Injected as `true` only by the demo build (vite.demo.config.ts); undefined in
// the Electron build. Used with a typeof guard so personal literals can be
// stripped from the public bundle.
declare const __IS_DEMO__: boolean;
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
import { PharmacyGstCard, PharmacyDiscountLimits, PharmacyCredit } from '../components/settings/PharmacySettings';
import { AccrualToggle, SectionSaveBar, TabIntro, LockedModule, Explain } from '../components/settings/shared';
import { SETTINGS_TABS, SETTINGS_GROUPS, SETTINGS_TAB_STORAGE_KEY, tabDef, tabFromStored, BILLING_KEYS, PHARMACY_KEYS, LAB_KEYS, IPD_KEYS, WHATSAPP_KEYS, COMPUTERS_KEYS, type SettingsTabId, type SettingsTabDef } from '../lib/settingsMap';
import { Pill, BedDouble, ScanLine, MessageSquare, Monitor } from 'lucide-react';
import { ModeChoice, ReceptionAccessList, SharedDeskDiscountBox, useReceptionAccess } from '../components/computers/ComputersParts';
import { ConnectGuide } from '../components/computers/ConnectGuide';
import { computersMode, thisComputer, type ComputersMode } from '../lib/computers';
import { useWhatsAppTemplates } from '../hooks/useWhatsAppTemplates';
import { WA_TEMPLATE_TYPES, DEFAULT_WA_TEMPLATES, WA_VARIABLES, resolveWaTemplates, serializeWaTemplates } from '../lib/whatsappTemplates';
import { WHATSAPP_PLACEHOLDERS, renderTemplate } from '../lib/whatsapp';
import { useToast } from '../hooks/useToast';
import { useLicensedModules } from '../hooks/useLicensedModules';
import { HelpTip } from '../components/HelpTip';
import { STATION_ROLES, STATION_LABEL, stationShows, type StationRole } from '../lib/moduleAccess';
import { moduleState } from '../lib/moduleAccess';
import { ACCESS_MODULES, ASSIGNABLE_ROLES, parseRoleAccess } from '../lib/accessModules';
import type { Role } from '../hooks/useAuth';

/**
 * Which app modes each route belongs to. Mirrors the sidebar's NAV table and
 * RouteGuard's ROUTE_MODES so the Settings previews below judge a module the
 * same way the real menu does — a preview that disagreed with the app would be
 * worse than no preview at all.
 */
const PHARMACY_MODES = new Set<AppMode>(['reception_pharmacy', 'reception_pharmacy_doctor', 'reception_pharmacy_doctor_lab', 'full']);
const DOCTOR_MODES = new Set<AppMode>(['reception_doctor', 'reception_pharmacy_doctor', 'reception_pharmacy_doctor_lab', 'full']);
const LAB_MODES = new Set<AppMode>(['reception_pharmacy_doctor_lab', 'full']);
const IPD_MODES = new Set<AppMode>(['full']);
const MODE_ROUTES: Record<string, Set<AppMode>> = {
  '/doctor-select': DOCTOR_MODES,
  '/lab': LAB_MODES,
  '/radiology': LAB_MODES,
  '/pharmacy': PHARMACY_MODES,
  '/ipd': IPD_MODES,
  '/discharge-summary': IPD_MODES,
};

/** Menu items shown in the "This computer will show" preview, in sidebar order. */
const MENU_PREVIEW: { path: string; label: string }[] = [
  { path: '/reception', label: 'Reception' }, { path: '/appointments', label: 'Appointments' },
  { path: '/whatsapp', label: 'Communication' }, { path: '/doctor-select', label: 'Doctors' },
  { path: '/lab', label: 'Laboratory' }, { path: '/radiology', label: 'Radiology' }, { path: '/pharmacy', label: 'Pharmacy' },
  { path: '/ipd', label: 'IPD' }, { path: '/discharge-summary', label: 'Discharge Summary' },
  { path: '/pediatrics', label: 'Pediatrics' }, { path: '/print-jobs', label: 'Print Jobs' },
  { path: '/tpa', label: 'Insurance / TPA' }, { path: '/patient-log', label: 'Patient Log' },
  { path: '/origin', label: 'Patient Origin' }, { path: '/billing', label: 'Billing' },
  { path: '/miscellaneous', label: 'Services' }, { path: '/accounts', label: 'Accounts' },
  { path: '/analytics', label: 'Analytics' }, { path: '/notifications', label: 'Notifications' },
];
import { INDIAN_STATES } from '../lib/india';
import { KARNATAKA_PLACES, ALL_NEARBY_PLACES } from '../lib/places';
import { DOCTOR_COLOR_OPTIONS, colorForDoctor } from '../lib/doctor-colors';
import type { AppMode, Doctor, ReferringDoctor, Settings } from '../types';
import { localISO } from '../lib/localDate';
import { AccountsSettingsTab, DoctorPayAndCuts, WhatToShow } from '../components/settings/AccountsSettings';
import { SETTINGS_GROUP_KEY } from '../components/Feature';

type SettingsTab = SettingsTabId;

const SETTINGS_TAB_KEY = SETTINGS_TAB_STORAGE_KEY;

const TAB_LABEL = Object.fromEntries(SETTINGS_TABS.map((t) => [t.id, t.label])) as Record<SettingsTab, string>;

/** The little picture on each tab button. */
const TAB_ICON: Record<SettingsTab, React.ReactNode> = {
  clinic: <Building2 className="w-3.5 h-3.5" />, doctors: <Stethoscope className="w-3.5 h-3.5" />, reception: <Wallet className="w-3.5 h-3.5" />,
  billing: <IndianRupee className="w-3.5 h-3.5" />, pharmacy: <Pill className="w-3.5 h-3.5" />, lab: <FlaskConical className="w-3.5 h-3.5" />,
  ipd: <BedDouble className="w-3.5 h-3.5" />, whatsapp: <MessageSquare className="w-3.5 h-3.5" />, peds: <Baby className="w-3.5 h-3.5" />, system: <HardDrive className="w-3.5 h-3.5" />,
  computers: <Monitor className="w-3.5 h-3.5" />, subscription: <ShieldCheck className="w-3.5 h-3.5" />, accounts: <ListChecks className="w-3.5 h-3.5" />,
};

/** Flat index of every settings section, so the search box can jump to its tab. */
const SETTINGS_SEARCH: { tab: SettingsTab; label: string; hint: string; keywords: string }[] = [
  { tab: 'clinic', label: 'Clinic Identity', hint: 'Name, logo, address, contact', keywords: 'clinic name logo address phone tagline registration email' },
  { tab: 'clinic', label: 'Letterhead & Logo', hint: 'The header printed on every document', keywords: 'letterhead logo header print bill slip lab radiology pharmacy' },
  { tab: 'clinic', label: 'Prescription QR Codes', hint: 'QR codes on prescription page 2', keywords: 'qr code website maps prescription link' },
  { tab: 'doctors', label: 'Doctors', hint: 'Fees, signature, colour, template', keywords: 'doctor fee signature colour color template room specialty' },
  { tab: 'doctors', label: 'Referrals', hint: 'Where patients come from', keywords: 'referral referring doctor google self family source' },
  { tab: 'doctors', label: 'OPD Slip Body Templates', hint: 'Consultation & printed-slip sections', keywords: 'opd slip template section body specialty growth layout' },
  { tab: 'doctors', label: 'Patient Language on Printed Slip', hint: 'Second language under each medicine', keywords: 'language kannada hindi tamil telugu malayalam marathi bilingual multilingual print opd slip patient second regional' },
  { tab: 'doctors', label: 'Consultation Quick-Fill Templates', hint: 'One-tap clinical text by department', keywords: 'quick fill template consultation clinical department specialty history examination' },
  { tab: 'accounts', label: 'Staff and salaries', hint: 'Who the clinic pays, monthly salary, attendance', keywords: 'staff salary salaries attendance employee nurse helper payroll' },
  { tab: 'accounts', label: 'Vouchers and who may raise them', hint: 'Numbers, cash in hand, roles and limits', keywords: 'voucher expense maintenance opening cash day book raise cancel limit' },
  { tab: 'doctors', label: 'Pay and Cuts', hint: 'How each doctor and referrer is paid', keywords: 'doctor pay salary cut commission margin share percent referral lab pharmacy radiology services' },
  { tab: 'reception', label: 'Fees, Queue Flow & Display', hint: 'Consultation fee, queue toggle', keywords: 'fee queue flow waiting done pending consultation display badge billing slot' },
  { tab: 'reception', label: 'Patient Registration Fee', hint: 'One-time registration fee', keywords: 'registration fee one time' },
  { tab: 'reception', label: 'Free Follow-up Policy', hint: 'Same-doctor follow-up window', keywords: 'follow up free policy window revisit' },
  { tab: 'reception', label: 'Services', hint: 'Quick-pick service chips', keywords: 'services procedures vaccination chips price' },
  { tab: 'reception', label: 'Patients & Locations', hint: 'Default state, district, villages', keywords: 'patient location state district village autocomplete' },
  { tab: 'reception', label: 'List Window (performance)', hint: 'How far back lists show by default', keywords: 'list window performance recent month week reception discharge slow speed pagination lag' },
  { tab: 'billing', label: 'GST & Invoicing', hint: 'GST registration, GSTIN, invoice prefix, round-off', keywords: 'gst tax invoice prefix round off gstin registration composition regular exempt' },
  { tab: 'billing', label: 'Charge Heads (price list)', hint: 'Consultation, bed, nursing, procedures', keywords: 'charge head price list rate consultation bed nursing procedure oxygen' },
  { tab: 'billing', label: 'Discount limits for staff', hint: 'Most each role may take off a bill', keywords: 'discount limit cap role reason receptionist nurse manager' },
  { tab: 'pharmacy', label: 'GST on pharmacy sales', hint: 'The pharmacy’s own GST switch', keywords: 'pharmacy gst tax switch mrp purchase claim' },
  { tab: 'pharmacy', label: 'Pharmacy GSTIN, name & drug licence on bills', hint: 'If different from the clinic’s', keywords: 'pharmacy gstin legal name drug licence license dl number bill print' },
  { tab: 'pharmacy', label: 'GST % a new medicine starts with', hint: 'Default GST for the Drug List', keywords: 'default gst drug medicine new rate 5 12 18 28 percent' },
  { tab: 'pharmacy', label: 'Discount limits at the pharmacy counter', hint: 'Most each role may give on a medicine sale', keywords: 'pharmacy counter discount limit cap pharmacist receptionist percent' },
  { tab: 'pharmacy', label: 'Credit — let patients pay later', hint: 'Medicines on credit; charge to the ward bill', keywords: 'credit pay later owed receivable pharmacy ipd bill charge' },
  { tab: 'lab', label: 'Lab & Radiology Auto-Billing', hint: 'Raise a bill when a test or scan is ordered', keywords: 'lab laboratory radiology scan xray auto bill billing order revenue investigation' },
  { tab: 'lab', label: 'Laboratory catalogue', hint: 'Load & manage lab tests + prices', keywords: 'lab laboratory catalog catalogue test inventory pathology biochemistry microbiology histopathology price manage load standard investigation' },
  { tab: 'lab', label: 'Radiology catalogue', hint: 'Load & manage scans + prices', keywords: 'radiology catalogue catalog scan x-ray xray ultrasound usg ct mri price manage load standard' },
  { tab: 'ipd', label: 'Wards & Beds', hint: 'IPD wards and beds', keywords: 'ward bed ipd room admission' },
  { tab: 'ipd', label: 'IPD Charges & Accrual', hint: 'Auto bed/nursing/doctor charges, deposits', keywords: 'ipd bed nursing accrual charge doctor visit advance deposit transfer' },
  { tab: 'ipd', label: 'GST on in-patient bills & admission number', hint: 'Ward bill GST, IP number prefix', keywords: 'ipd in-patient gst tax admission number prefix ip' },
  { tab: 'ipd', label: 'Insurance / TPA', hint: 'Cashless admissions', keywords: 'tpa insurance cashless claim preauth' },
  { tab: 'ipd', label: 'Discharge Summary', hint: 'Builder + templates', keywords: 'discharge summary template letterhead' },
  { tab: 'ipd', label: 'Admission Requests', hint: 'Doctor requests from OPD', keywords: 'admission request opd reception' },
  { tab: 'whatsapp', label: 'WhatsApp message wording', hint: 'What each one-click message says', keywords: 'whatsapp message template wording text confirmed visit done review rx lab radiology bill reminder' },
  { tab: 'whatsapp', label: 'Google review link', hint: 'Used by the Google Review WhatsApp message', keywords: 'google review link url rate us feedback whatsapp' },
  { tab: 'whatsapp', label: 'Country code for phone numbers', hint: 'Added in front of a patient number (91 for India)', keywords: 'whatsapp country code 91 phone number prefix' },
  { tab: 'whatsapp', label: 'WhatsApp Pro automation', hint: 'Status of the automatic reminders (AiSensy)', keywords: 'whatsapp pro automation aisensy reminders inbox campaigns connected' },
  { tab: 'peds', label: 'Pediatrics Add-on', hint: 'Growth, vaccines, calculators', keywords: 'pediatrics paediatrics growth centile who iap vaccine immunisation calculator bmi head circumference child chart' },
  { tab: 'system', label: 'Date & Time on this computer', hint: 'Clock and time zone check', keywords: 'date time clock zone timezone ist' },
  { tab: 'system', label: 'Startup & Background', hint: 'Auto-launch, tray', keywords: 'startup background tray autolaunch windows minimize' },
  { tab: 'system', label: 'Backup, Restore & Updates', hint: 'Backups, USB, app updates', keywords: 'backup restore update usb sqlite excel auto' },
  { tab: 'system', label: 'Factory Reset', hint: 'Erase this computer and start fresh', keywords: 'factory reset erase clear test data start fresh' },
  { tab: 'computers', label: 'How many computers', hint: 'One computer, or a main computer with others', keywords: 'computers single multi one more than one main computer host client station reception shared desk' },
  { tab: 'computers', label: 'What can Reception do?', hint: 'Which screens the front desk can open', keywords: 'reception access permission screens menu shared desk switch off discount limit one computer' },
  { tab: 'computers', label: 'Sign-in', hint: 'Own login for everyone, idle sign-out', keywords: 'sign in login password security require idle signout user audit' },
  { tab: 'computers', label: 'Who can open what', hint: 'Module access per staff role', keywords: 'role access permission module staff matrix customisable doctor nurse pharmacist lab' },
  { tab: 'computers', label: 'This computer\'s job', hint: 'Pharmacy counter, doctor cabin, lab bench…', keywords: 'this computer station role pharmacy counter reception lab ward menu show hide' },
  { tab: 'computers', label: 'Connect the computers — step by step', hint: 'Cable, Wi-Fi or direct cable · Windows settings · what to buy', keywords: 'connect network cable lan wifi wi-fi wireless router switch direct tutorial guide windows firewall private public sleep ip address amazon buy ups usb adapter checklist print onboarding multi computer' },
  { tab: 'computers', label: 'Check the connection', hint: 'Tells you what to fix on this computer', keywords: 'check test connection diagnose network cable wifi private public firewall sleep find main computer' },
  { tab: 'computers', label: 'Windows settings for the network', hint: 'Private network, firewall, never sleep, fixed address', keywords: 'windows settings private public network profile firewall allow access sleep never power adapter fixed ip address time antivirus' },
  { tab: 'computers', label: 'What to buy — LAN cable, switch, UPS', hint: 'Search links on Amazon.in', keywords: 'buy shopping amazon lan cable cat6 switch router ups usb lan adapter wifi adapter' },
  { tab: 'computers', label: 'Connecting the computers', hint: 'Main computer, join code, cable or Wi-Fi', keywords: 'network multi station lan server client cabin host connect diagram cable wifi join code' },
  { tab: 'subscription', label: 'Subscription & Modules', hint: 'Active plan, expiry, upgrade / renew', keywords: 'subscription licence license plan modules upgrade renew activate activation code expiry machine id lock unlock' },
  { tab: 'subscription', label: 'App Mode', hint: 'Which modules show in the sidebar', keywords: 'app mode module sidebar reception pharmacy doctor lab ipd' },
  { tab: 'subscription', label: 'Modules in use', hint: 'Which modules are on, not in the plan, or hidden', keywords: 'modules in use plan switched off hidden role limited' },
];

/** Where closely related things are kept — shown under a tab's one-line description. */
const TAB_ALSO: Partial<Record<SettingsTab, (go: (t: SettingsTab) => void) => React.ReactNode>> = {
  billing: (go) => <>Looking for the pharmacy&rsquo;s GST, its discount limit or credit? <LinkBtn onClick={() => go('pharmacy')}>Pharmacy</LinkBtn> · Wards, deposits, admission numbers? <LinkBtn onClick={() => go('ipd')}>In-Patient (IPD)</LinkBtn> · Lab and scan prices? <LinkBtn onClick={() => go('lab')}>Laboratory &amp; Radiology</LinkBtn></>,
  pharmacy: (go) => <>The clinic&rsquo;s GST registration (regular / composition) and GSTIN are set once under <LinkBtn onClick={() => go('billing')}>Billing &amp; GST</LinkBtn>. Drugs, stock, suppliers and registers are on the Pharmacy page itself.</>,
  whatsapp: () => <>Sending the messages happens on the Communication page (today&rsquo;s patients, one button per message). The Pro automation (reminders, inbox, campaigns) is set up there too.</>,
  lab: () => <>Tests and scans are added, priced and switched on or off here and on the Laboratory and Radiology pages (Test Catalog / Catalogue &amp; Prices).</>,
  ipd: (go) => <>The clinic&rsquo;s GST registration is under <LinkBtn onClick={() => go('billing')}>Billing &amp; GST</LinkBtn>; the pharmacy&rsquo;s charge-to-ward-bill switch is under <LinkBtn onClick={() => go('pharmacy')}>Pharmacy</LinkBtn>.</>,
  reception: () => <>Doctors&rsquo; own fees are set with each doctor under Doctors &amp; Templates.</>,
};
function LinkBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button type="button" className="font-semibold text-blue-700 dark:text-blue-300 hover:underline" onClick={onClick}>{children}</button>;
}

export function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>(() => {
    try { return tabFromStored(localStorage.getItem(SETTINGS_TAB_KEY)); } catch { return 'clinic'; }
  });
  useEffect(() => { try { localStorage.setItem(SETTINGS_TAB_KEY, tab); } catch { /* ignore */ } }, [tab]);
  const [search, setSearch] = useState('');
  // A "Settings" link on another page can ask for one group: scroll to it once it is drawn (the admin gate may still be showing for a moment).
  useEffect(() => {
    let want: string | null = null;
    try { want = sessionStorage.getItem(SETTINGS_GROUP_KEY); } catch { /* none */ }
    if (!want) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      const el = Array.from(document.querySelectorAll('[data-settings-group]')).find((e) => e.getAttribute('data-settings-group') === want);
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); try { sessionStorage.removeItem(SETTINGS_GROUP_KEY); } catch { /* ignore */ } window.clearInterval(timer); }
      else if (++tries > 40) window.clearInterval(timer);
    }, 300);
    return () => window.clearInterval(timer);
  }, [tab]);

  // Pre-load settings at the page level so every sub-component's useQuery
  // returns synchronously from cache — no blank-flash on any tab.
  const { isLoading: settingsLoading, isError: settingsError } = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.electronAPI.settings.get(),
    staleTime: 30_000,
  });
  const { has } = useLicensedModules();
  // Client PCs get clinic config FROM the host, so it's read-only here. Only the
  // System tab (network, backup, this-PC station) stays editable on a client.
  const { data: netStatus } = useQuery({ queryKey: ['network-status'], queryFn: () => window.electronAPI.network.status(), staleTime: 15_000 });
  const lockClinic = netStatus?.mode === 'client' && tab !== 'system' && tab !== 'computers';
  /** A module's tab is locked while the subscription does not include the module. */
  const isLocked = (t: SettingsTabDef) => !!t.module && !has(t.module);

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

        {/* Tab bar — grouped, so it is clear what is where; a module's tab shows a lock until the subscription includes it */}
        <div className="mb-4 rounded-lg bg-gray-100 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 p-1.5 space-y-1">
          {SETTINGS_GROUPS.map((g) => (
            <div key={g.id} className="flex flex-wrap items-center gap-1">
              <span className="w-[122px] shrink-0 pl-1.5 text-[9px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">{g.label}</span>
              {SETTINGS_TABS.filter((t) => t.group === g.id).map((t) => (
                <SettingsTabBtn key={t.id} active={tab === t.id} locked={isLocked(t)} onClick={() => setTab(t.id)} icon={TAB_ICON[t.id]}>{t.label}</SettingsTabBtn>
              ))}
            </div>
          ))}
        </div>

        <div className="mb-5">
          <TabIntro title={tabDef(tab).label} also={TAB_ALSO[tab]?.(setTab)}>{tabDef(tab).blurb}</TabIntro>
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

        {lockClinic && (
          <div className="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
            <Lock className="w-4 h-4 shrink-0 mt-0.5" />
            <span><b>Managed on the main computer.</b> This is a client PC — clinic settings are set on the Host and are read-only here. You can still change <b>System</b> settings for this computer.</span>
          </div>
        )}
        <fieldset disabled={lockClinic} className={cn('space-y-6 min-w-0 p-0 m-0 border-0', settingsLoading && 'hidden')}>
          {tab === 'clinic' && (
            <>
              <SetupGuideCard />
              <SettingsGroup title="Clinic Identity" subtitle="Name, logo, address, contact details printed on every OPD slip.">
                <ClinicInfo />
              </SettingsGroup>
              <SettingsGroup title="Letterhead & Logo" subtitle="How the top of every printed document looks — bills, OPD slip, lab, radiology, pharmacy. Put your logo beside the clinic name, or use a wide logo as the entire header.">
                <LetterheadSettings />
              </SettingsGroup>
              <SettingsGroup title="Prescription QR Codes" subtitle="Show 1 or 2 QR codes on the prescription page 2 — e.g. website link and Google Maps location.">
                <PrescriptionQr />
              </SettingsGroup>
            </>
          )}

          {tab === 'doctors' && (
            <>
              <SettingsGroup title="Doctors" subtitle="Add doctors, set their fees, signature, color tag, and slip template.">
                <DoctorsManagement />
              </SettingsGroup>
              <SettingsGroup title="Referrals" subtitle="Where your patients come from — Google, Self, Family, or the name of a referring doctor. Added here, they appear in the “Referral” list while booking an appointment and print on the OPD slip exactly as you type them.">
                <ReferringDoctorsManager />
              </SettingsGroup>
              <SettingsGroup title="OPD Slip Body Templates" subtitle="Per-specialty sections for the consultation panel and printed slip. Edit a template, then hit Preview to see exactly how it prints — right there.">
                <SlipTemplatesEditor />
              </SettingsGroup>
              <SettingsGroup title="Patient Language on Printed Slip" subtitle="A second language printed under each medicine on the OPD slip — the schedule (when & how to take it) in the patient's own language. The doctor's typed notes always print exactly as written.">
                <PatientLanguagePicker />
              </SettingsGroup>
              <SettingsGroup title="Consultation Quick-Fill Templates" subtitle="One-tap clinical text for a consultation. Shared for the clinic, or saved under a doctor’s name so only that doctor sees it.">
                <ClinicalTemplatesEditor />
              </SettingsGroup>
              <SettingsGroup title="Pay and Cuts" subtitle="How each doctor (and each outside referrer) is paid: a fixed amount, per visit, or a share — plus a cut on the services, medicines, tests and scans their patients use.">
                <DoctorPayAndCuts />
              </SettingsGroup>
            </>
          )}

          {tab === 'reception' && (
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
              <SettingsGroup title="Patients & Locations" subtitle="Default state, district, and bundled village list shown as autocomplete.">
                <DefaultLocation />
              </SettingsGroup>
              <SettingsGroup title="List Window (keeps big lists fast)" subtitle="How far back the Reception patient list and Discharge Summary list show by default. Search always finds everyone, however old.">
                <RecordsWindowSetting />
              </SettingsGroup>
              <SettingsGroup title="What to show" subtitle="Hide a page you do not use. Nothing is deleted — tick it again and it is back.">
                <WhatToShow tab="reception" />
              </SettingsGroup>
            </>
          )}

          {tab === 'billing' && <BillingTab />}

          {tab === 'accounts' && <AccountsSettingsTab />}

          {tab === 'pharmacy' && (isLocked(tabDef('pharmacy'))
            ? <LockedModule name="Pharmacy" what="the pharmacy" onOpenSubscription={() => setTab('subscription')} />
            : <PharmacyTab goTo={setTab} />)}

          {tab === 'lab' && (isLocked(tabDef('lab'))
            ? <LockedModule name="Laboratory" what="the lab and the scan desk" onOpenSubscription={() => setTab('subscription')} />
            : <LabTab />)}

          {tab === 'ipd' && (isLocked(tabDef('ipd'))
            ? <LockedModule name="In-Patient (IPD)" what="wards, admissions and discharge" onOpenSubscription={() => setTab('subscription')} />
            : <IpdTab goTo={setTab} />)}

          {tab === 'whatsapp' && (isLocked(tabDef('whatsapp'))
            ? <LockedModule name="WhatsApp" what="the messages patients get on WhatsApp" onOpenSubscription={() => setTab('subscription')} />
            : <WhatsAppTab />)}

          {tab === 'peds' && <PediatricsTab />}

          {tab === 'subscription' && (
            <>
              <SubscriptionTab />
              <SettingsGroup title="App Mode" subtitle="Pick which modules are visible in the sidebar (Reception, Pharmacy, Doctor, Lab, IPD).">
                <AppModeSelector />
              </SettingsGroup>
              <SettingsGroup title="Modules in Use" subtitle="A read-out of every module: in use, not in the plan, switched off, or hidden on this computer. (What this one computer is for is under Computers & staff.)">
                <div className="card p-5"><ModulesInUsePanel /></div>
              </SettingsGroup>
            </>
          )}

          {tab === 'system' && (
            <>
              <SettingsGroup title="Date & Time on this computer" subtitle="Every time CureDesk shows or prints — registration, bills, lab and radiology reports — comes from this computer's clock and time zone.">
                <ClockCheck />
              </SettingsGroup>
              <SettingsGroup title="Startup & Background" subtitle="Auto-launch with Windows, minimize to tray, start hidden.">
                <StartupBehavior />
              </SettingsGroup>
              <SettingsGroup title="Backup, Restore & Updates" subtitle="Where backups go, daily auto-backup, weekly USB reminder, restore, and app updates.">
                <BackupSettings />
              </SettingsGroup>
              <SettingsGroup title="Factory Reset" subtitle="Erase ALL CureDesk data on THIS computer and start fresh — for handing the PC to a new clinic, or clearing test data. Your backups are NOT touched. Admin only, with a double confirmation.">
                <HardResetPanel />
              </SettingsGroup>
            </>
          )}

          {tab === 'computers' && <ComputersTab />}

        </fieldset>
      </div>
    </AdminGate>
  );
}

function SettingsTabBtn({
  active, onClick, icon, children, locked = false,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
  /** The module is not in the subscription: the tab can still be opened, to say so. */
  locked?: boolean;
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
      {locked && <Lock className="w-3 h-3 opacity-60" aria-label="locked — not in the subscription" />}
    </button>
  );
}

/**
 * A titled settings section. Every group carries a "?" that explains, in plain
 * language, what this part of the app is for — looked up by title from
 * SETTINGS_HELP so the copy lives in one place and stays consistent.
 */

/**
 * Plain-language "what does this do?" for every settings section, shown by the
 * "?" beside each heading. Written for a clinic owner, not a developer: what it
 * is, when you'd use it, and what happens if it's wrong.
 */
const SETTINGS_HELP: Record<string, React.ReactNode> = {
  'Clinic Identity': <><p>Your clinic's name, address, phone, logo and registration number.</p><p><b>Where it shows:</b> printed on every OPD slip, prescription, bill and discharge summary — the letterhead at the top.</p><p>Fill this in first; everything you print looks unfinished until you do.</p></>,
  'Doctors': <><p>The doctors who see patients here. Each one gets a name, specialty, room number and default consultation fee.</p><p>A doctor added here appears in the appointment booking screen and on printed slips. Marking one inactive hides them from new bookings without deleting their past records.</p></>,
  'Fees, Queue Flow & Display': <><p>Default consultation fee, the follow-up "special" price, and whether reception uses the <b>queue flow</b> (send-to-billing) or takes payment upfront.</p><p>Turn queue flow OFF if your clinic collects money at registration — the Billing screen then stays mostly empty by design.</p></>,
  'Patient Registration Fee': <><p>A one-time charge for registering a brand-new patient (a "case paper" or file charge).</p><p>Set the amount and whether reception is asked about it every time, always charges it, or never does.</p></>,
  'Free Follow-up Policy': <><p>How long after a paid visit a patient may return free, and how many free visits they get.</p><p>CureDesk applies this automatically — when a returning patient is inside the window, the bill shows ₹0 and is marked a free follow-up, so your revenue reports stay honest.</p></>,
  'Patients & Locations': <><p>Your default state and district, plus the villages/areas you serve.</p><p>These pre-fill the registration form so reception types less, and they power the <b>Patient Origin</b> report showing which villages your patients come from.</p></>,
  'Services': <><p>The list of extra services you charge for — injections, dressings, nebulisation, vaccination and so on.</p><p>Whatever you list here appears as quick buttons on the <b>Services</b> screen for one-tap billing.</p></>,
  'Consultation Quick-Fill Templates': <><p>Saved blocks of text a doctor can insert into a consultation with one click — common complaints, examinations, advice.</p><p>Saves a busy doctor from retyping the same paragraph twenty times a day. Group them by department so each doctor sees their own.</p></>,
  'OPD Slip Body Templates': <><p>Controls what the printed OPD slip / prescription looks like below the letterhead — which sections appear and in what order.</p><p>Each doctor can be given a different template, so a paediatrician's slip can differ from an orthopaedic one.</p></>,
  'Prescription QR Codes': <><p>Up to two QR codes printed on your slips — typically a UPI payment code and a Google review link.</p><p>Patients scan to pay or to leave a review, without you printing anything separately.</p></>,
  'List Window (keeps big lists fast)': <><p>How far back the Reception and Discharge lists load by default — a week, a month, a quarter, or everything.</p><p>A clinic with years of history stays fast on a modest PC by loading a shorter window. Searching always reaches every record regardless of this setting.</p></>,
  'App Mode': <><p>A layout preset for the <b>base</b> modules — Reception, Pharmacy, Doctor, Lab.</p><p><b>Note:</b> paid add-ons you've activated (Laboratory, Pharmacy, IPD, Communication) always show regardless of this. To shape one computer's menu, use <b>This Computer&rsquo;s Job</b> in Settings → Computers &amp; staff instead — it&rsquo;s clearer and applies per-PC.</p></>,
  'Modules': <><p>Which parts of CureDesk your subscription includes. Green = active, locked = not in your plan.</p><p>Locked modules aren't crippled trials — they're simply not part of what you bought. Adding one takes a minute and never touches your data.</p></>,
  'Subscription & Modules': <><p>Your current plan, when it expires, and this computer's Machine ID.</p><p>To add a module or renew, share the Machine ID with us and paste back the code we send. New modules unlock instantly; patients, bills and records are untouched.</p></>,
  'Your Plan': <><p>What this clinic is licensed for and until when.</p><p>The <b>Machine ID</b> identifies this computer — a licence key is tied to it, so a key issued for one PC won't work on another. That's what stops one purchased key being shared between clinics.</p></>,
  'Need to upgrade or renew?': <><p>How to get more modules or extend your licence: call us with your Machine ID, and enter the code we send.</p><p>No reinstall, no data migration, no downtime.</p></>,
  'How many computers?': <><p>The one answer that decides how sign-in and access work — it is the same question the setup guide asks when CureDesk is first installed.</p><p><b>One computer:</b> it opens as <b>Reception</b> and nobody signs in; Settings, Users &amp; Access and deleting are locked behind the admin password. <b>More than one:</b> one main computer holds the data, the others connect to it, and everyone signs in with their own login.</p><p>Change it whenever the clinic changes. Going from one computer to several turns sign-in on.</p></>,
  'Sign-in': <><p><b>Everyone signs in with their own login</b> is the switch that makes staff accounts and roles actually do something. It is required when the clinic uses more than one computer.</p><p>With one computer leave it off: the computer opens as Reception and the admin password locks the admin screens.</p><p><b>Until sign-in is on, the roles you assign have no effect.</b></p></>,
  'What can Reception do?': <><p>With one computer nobody signs in — it opens as <b>Reception</b>. These switches decide which screens Reception can open (the doctor&rsquo;s consultation screen is on by default). Each switch saves at once.</p><p>The administrator always sees everything, and Settings, Users &amp; Access and deleting stay behind the admin password whatever you choose. The discount box limits what Reception may take off a medicine sale at the counter (blank = no limit).</p></>,
  'Who can open what': <><p>Which staff roles may open which screens — the matrix behind Doctor / Nurse / Pharmacist / Lab Tech.</p><p>Set it once on the main computer and it applies to every connected computer. Admin always sees everything; Users &amp; Settings stay admin-only so you can never lock yourself out.</p></>,
  "This Computer's Job": <><p>What this one computer is for — reception desk, doctor&rsquo;s cabin, pharmacy counter, lab bench, ward station. Its menu shrinks to match.</p><p>It changes <b>this computer only</b>. Settings and Users are never hidden, so you can always undo it.</p></>,
  'Connecting the Computers': <><p>A live picture of the computers connected right now — which one is the main computer and which are the others — and the join code for a new one.</p><p>If a computer is missing here it cannot reach the main computer: check the cable or Wi-Fi, and that CureDesk is open on the main computer.</p></>,
  'Multi-Station Setup Guide': <><p>How CureDesk behaves on several computers once they are connected: the day-to-day flow, how staff accounts work across PCs, subscription and backups, what happens when the main computer is off, renaming a computer, and what to do when something breaks.</p><p>To <b>connect</b> the computers — cable, Wi-Fi, the Windows settings, what to buy — use <b>Connect the computers — step by step</b> above.</p></>,
  'Connect the computers — step by step': <><p>The set-up itself, in eight short steps: choose cable, Wi-Fi or one cable between two computers; what to buy (with links to search for it); plug it in; the Windows settings on every computer; set up the main computer; connect each other computer; <b>check</b> that it works; add the people.</p><p>The <b>Check this computer</b> button looks at the computer you are sitting at and tells you in plain words what to fix. <b>Print the checklist</b> gives two A4 sheets to tick off while you work.</p></>,
  'Adding more computers later?': <><p>The step-by-step guide for connecting computers is here when you need it. Choosing <b>More than one computer</b> above moves it into the tab permanently; reading it now changes nothing.</p></>,
  'Backup, Restore & Updates': <><p>Where your backups are saved, how often they run automatically, and how to restore one.</p><p><b>Choose a Google Drive or OneDrive folder</b> so a copy also lives outside this computer — a disk failure would otherwise take your records and the backups together. Each backup is a full database copy plus an Excel file readable without CureDesk.</p></>,
  'Startup & Background': <><p>Whether CureDesk opens automatically when the computer starts, and whether it hides in the system tray instead of closing.</p><p>Handy on a reception PC that should always be running.</p></>,
};

function SettingsGroup({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  const help = SETTINGS_HELP[title];
  return (
    <div className="space-y-2" data-settings-group={title}>
      <div className="px-1">
        <div className="text-[11px] font-bold uppercase tracking-widest text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
          {title}
          {help && <HelpTip title={title}>{help}</HelpTip>}
        </div>
        <div className="text-[11px] text-gray-500 dark:text-slate-400">{subtitle}</div>
      </div>
      {children}
    </div>
  );
}

// `requires` = the PAID add-on modules a mode needs. A mode you aren't licensed
// for is shown locked, so App Mode can never claim more than your subscription.
const MODES: { value: AppMode; title: string; blurb: string; includes: string[]; requires: string[] }[] = [
  {
    value: 'reception',
    title: 'Reception Only',
    blurb: 'Front-desk flow: registration, appointments, billing, reports. No doctor screen, no pharmacy.',
    includes: ['Reception', 'Appointments', 'Billing', 'Accounts', 'Patient Log / Origin', 'Reports'],
    requires: [],
  },
  {
    value: 'reception_pharmacy',
    title: 'Reception + Pharmacy',
    blurb: 'Adds the pharmacy module — drug list, batch-tracked stock, dispensing, Schedule H register. Useful for chemist-counter only setups.',
    includes: ['Everything in Reception', 'Pharmacy: inventory + dispense + Schedule H register'],
    requires: ['pharmacy'],
  },
  {
    value: 'reception_doctor',
    title: 'Reception + Doctor',
    blurb: 'Adds the doctor consultation workflow — vitals, history, Rx, OPD slip. Patients send Rx to outside chemist.',
    includes: ['Everything in Reception', 'Doctor dashboards', 'Consultation + OPD slip'],
    requires: [],
  },
  {
    value: 'reception_pharmacy_doctor',
    title: 'Reception + Pharmacy + Doctor (recommended)',
    blurb: 'Most common single-clinic setup — front desk, in-house pharmacy that auto-fills from doctor Rx, full Schedule H compliance.',
    includes: ['Everything in Reception', 'Doctor consultation + OPD slip', 'Pharmacy with auto-deduct on Rx'],
    requires: ['pharmacy'],
  },
  {
    value: 'reception_pharmacy_doctor_lab',
    title: 'Reception + Pharmacy + Doctor + Lab',
    blurb: 'Polyclinic — adds the laboratory module: test catalog, orders, sample collection, result entry.',
    includes: ['Everything above', 'Lab test catalog', 'Lab orders + results'],
    requires: ['pharmacy', 'lab'],
  },
  {
    value: 'full',
    title: 'Full HMS (adds IPD)',
    blurb: 'Full hospital — in-patient admissions, ward/bed management, discharge summary.',
    includes: ['Everything above', 'In-Patient (IPD) admissions', 'Ward + bed tracking', 'Discharge summary'],
    requires: ['pharmacy', 'lab', 'ipd'],
  },
];

function AppModeSelector() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { has, isDev } = useLicensedModules();
  const MOD_LABEL: Record<string, string> = { pharmacy: 'Pharmacy', lab: 'Laboratory', ipd: 'In-Patient (IPD)' };
  const missingFor = (m: { requires: string[] }) => (isDev ? [] : m.requires.filter((r) => !has(r)));
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
  const currentMissing = missingFor(MODES.find((m) => m.value === current)!);

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-1">Application Mode</h2>
      <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-4">
        Pick which modules this station shows. Navigation adapts instantly — nothing gets deleted, just hidden. Options beyond your subscription are locked; add them in the Subscription tab.
      </p>
      <div className={cn('text-xs mb-4 px-3 py-2 rounded-lg border', currentMissing.length
        ? 'bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-200'
        : 'bg-blue-100 border-blue-300 text-blue-900 dark:bg-blue-900/40 dark:border-blue-700 dark:text-blue-100')}>
        Currently active mode: <span className="font-bold">{currentTitle}</span>
        {currentMissing.length > 0 && <> — your subscription doesn’t include {currentMissing.map((r) => MOD_LABEL[r] || r).join(' + ')}, so those screens stay hidden until you add them.</>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {MODES.map((m) => {
          const active = current === m.value;
          const pending = save.isPending && (save.variables as any)?.app_mode === m.value;
          const missing = missingFor(m);
          const locked = missing.length > 0;
          return (
            <div key={m.value} className="flex flex-col gap-1.5">
            <button
              type="button"
              disabled={save.isPending || locked}
              title={locked ? `Needs ${missing.map((r) => MOD_LABEL[r] || r).join(' + ')} — add it in the Subscription tab` : undefined}
              onClick={() => {
                if (locked || current === m.value) return;
                save.mutate({ app_mode: m.value });
              }}
              className={cn(
                'relative text-left rounded-xl p-4 transition overflow-hidden',
                locked
                  ? 'border-2 border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/40 opacity-60 cursor-not-allowed'
                  : active
                  ? 'border-4 border-blue-600 bg-blue-100 dark:bg-blue-900/50 dark:border-blue-400'
                  : 'border-2 border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-blue-400'
              )}
              style={active && !locked ? { boxShadow: '0 0 0 3px rgba(37, 99, 235, 0.3)' } : undefined}
            >
              {locked && (
                <div className="absolute top-2 right-2 flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider bg-gray-200 text-gray-600 dark:bg-slate-700 dark:text-slate-300">
                  <Lock className="w-3 h-3" /> Locked
                </div>
              )}
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
            <div className="px-1 flex items-center gap-2 flex-wrap">
              <ModuleTutorialButton mode={m.value} />
              {locked && <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">🔒 Needs {missing.map((r) => MOD_LABEL[r] || r).join(' + ')} — add it in Subscription</span>}
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
  drug_inventory: 'Drugs (legacy)', drug_master: 'Drug list', drug_stock_batches: 'Drug stock batches',
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

      {/* About */}
      <div className="mt-6 pt-5 border-t border-gray-200 dark:border-slate-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-2">About</h3>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[12px] text-gray-600 dark:text-slate-400">
            CureDesk HMS
            {(updateState as any)?.appVersion ? <> · <span className="font-mono">v{(updateState as any).appVersion}</span></> : null}
            <span className="mx-1">·</span> Part of the <b>Bridgr</b> ecosystem.
          </div>
          <button
            type="button"
            onClick={() => window.electronAPI.app.openExternal('https://bridgr.co.in').catch(() => { /* ignore */ })}
            className="btn-secondary text-xs whitespace-nowrap"
          >
            Explore the Bridgr ecosystem
          </button>
        </div>
      </div>


      <PreviewAsRolePanel />

      {/* Coming from paper / another system */}
      <MigrationPanel />

      {/* Standard drug catalogue (+ dev-only sample data) */}
      <SampleDataPanel />

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
          aspect="wide"
          maxDim={2400}
          placeholder="Click or drop"
          hint="Square or wide logo — JPG / PNG, max 5 MB. Saves immediately. A wide logo can be printed as the whole header: see Letterhead below."
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

// =====================================================================
// Letterhead & Logo — the top of every printed document, with a live preview.
// Two styles: logo beside the clinic details, or a wide logo as the WHOLE header
// (clinic name & tagline then are not printed — the image already carries them).
// =====================================================================
const LH_KEYS = ['lh_style', 'lh_logo_size', 'lh_show_name', 'lh_show_tagline', 'lh_show_contact', 'lh_banner_max_mm'] as const;

/** Shows an A4-width sheet scaled down to fit its container, so the preview is the real layout. */
function ScaledSheet({ children, heightMm }: { children: React.ReactNode; heightMm: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(520);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const sheetPx = (210 * 96) / 25.4;
  const k = Math.min(1, Math.max(0.2, w / sheetPx));
  return (
    <div ref={ref} className="w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-100 dark:bg-slate-800 overflow-hidden"
      style={{ height: ((heightMm * 96) / 25.4) * k }}>
      <div style={{ width: sheetPx, transform: `scale(${k})`, transformOrigin: 'top left' }}>{children}</div>
    </div>
  );
}

function LetterheadPreview({ settings, view }: { settings: Settings; view: 'bill' | 'opd' }) {
  const today = localISO();
  const sampleAppt: any = {
    id: 1, token_number: 12, appointment_date: today, appointment_time: '10:30',
    patient_name: 'Sample Patient', patient_uhid: 'PT-0001',
  };
  const sampleDoctor: any = { name: 'Dr. Sample', room_number: '101' };
  const bar = (w: string) => <div style={{ height: 7, width: w, background: '#e2e8f0', borderRadius: 4 }} />;
  return (
    <ScaledSheet heightMm={view === 'opd' ? 92 : 86}>
      <div className="paper" style={{ width: '210mm', padding: '12mm 14mm', background: '#ffffff', color: '#0f172a', boxSizing: 'border-box', minHeight: '100%' }}>
        {view === 'bill' ? (
          <>
            <PrintHeader settings={settings} />
            <div className="text-center my-3">
              <span className="inline-block px-4 py-1 rounded font-bold tracking-wide" style={{ background: '#eff6ff', color: '#1e3a8a', fontSize: 14 }}>SAMPLE BILL</span>
            </div>
            <div className="space-y-2.5 mt-4">{bar('70%')}{bar('92%')}{bar('55%')}{bar('80%')}</div>
          </>
        ) : (
          <OpdLetterhead appointment={sampleAppt} doctor={sampleDoctor} settings={settings} logoSize="large" />
        )}
      </div>
    </ScaledSheet>
  );
}

function LetterheadSettings() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { draft, set, reset, dirty, save, saving } = useSectionDraft(settings, [...LH_KEYS]);
  const [view, setView] = useState<'bill' | 'opd'>('bill');
  if (!settings) return null;

  const merged = { ...settings, ...draft } as Settings;
  const lh = resolveLetterhead(merged);
  const banner = lh.style === 'banner';
  const hasLogo = !!settings.clinic_logo;

  const Toggle = ({ k, label, hint }: { k: 'lh_show_name' | 'lh_show_tagline' | 'lh_show_contact'; label: string; hint?: string }) => (
    <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-slate-300 cursor-pointer">
      <input type="checkbox" className="mt-0.5" checked={merged[k] !== false} onChange={(e) => set(k, e.target.checked)} />
      <span>{label}{hint && <span className="block text-[11px] text-gray-500 dark:text-slate-400">{hint}</span>}</span>
    </label>
  );

  const StyleCard = ({ active, onClick, title, desc, mini }: { active: boolean; onClick: () => void; title: string; desc: string; mini: React.ReactNode }) => (
    <button type="button" onClick={onClick}
      className={cn('text-left rounded-lg border-2 p-3 transition',
        active ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30' : 'border-gray-200 dark:border-slate-700 hover:border-blue-300')}>
      <div className="h-9 mb-2 flex items-center">{mini}</div>
      <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">{title}</div>
      <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5 leading-snug">{desc}</div>
    </button>
  );
  const blk = (w: number | string, h = 6, c = '#94a3b8') => <div style={{ width: w, height: h, background: c, borderRadius: 3 }} />;

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-blue-600" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Letterhead</h2>
        </div>
        <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* ---- controls ---- */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <StyleCard
              active={!banner} onClick={() => set('lh_style', 'logo_text')}
              title="Logo + clinic name"
              desc="Your logo beside the clinic name, tagline and address."
              mini={<div className="flex items-center gap-2">{blk(30, 30, '#60a5fa')}<div className="space-y-1">{blk(54, 7, '#475569')}{blk(38, 5)}{blk(46, 5)}</div></div>}
            />
            <StyleCard
              active={banner} onClick={() => set('lh_style', 'banner')}
              title="Wide logo = whole header"
              desc="Your logo spans the full width. Clinic name & tagline are skipped — the image already carries them."
              mini={<div style={{ width: '100%', height: 26, background: '#60a5fa', borderRadius: 4 }} />}
            />
          </div>

          {banner && !hasLogo && (
            <div className="text-[12px] rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 px-3 py-2">
              No logo uploaded yet — add your wide logo under <b>Clinic Identity</b> above. Until then the classic header prints.
            </div>
          )}

          {!banner ? (
            <>
              <div>
                <label className="label">Logo size</label>
                <div className="grid grid-cols-5 gap-1.5">
                  {LOGO_SIZES.map((sz) => (
                    <button key={sz} type="button" onClick={() => set('lh_logo_size', sz)}
                      className={cn('py-1.5 rounded-lg border text-center transition-colors',
                        lh.logoSize === sz ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:border-blue-400')}>
                      <div className="text-[11px] font-semibold">{LOGO_SIZE_LABEL[sz]}</div>
                      <div className="text-[9px] opacity-80">{LOGO_MM[sz]} mm</div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Toggle k="lh_show_name" label="Print the clinic name" />
                <Toggle k="lh_show_tagline" label="Print the tagline" />
                <Toggle k="lh_show_contact" label="Print address, phone & registration no." />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="label">Tallest the banner may print</label>
                <select className="input" value={lh.bannerMaxMm} onChange={(e) => set('lh_banner_max_mm', Number(e.target.value))}>
                  <option value={25}>Compact — 25 mm</option>
                  <option value={40}>Standard — 40 mm</option>
                  <option value={60}>Tall — 60 mm</option>
                </select>
                <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-1">It always fills the full width; this only caps the height so a very tall image can't push the bill down the page.</p>
              </div>
              <div className="space-y-2">
                <Toggle k="lh_show_contact" label="Also print address, phone & registration no. under the banner" hint="Leave off if your logo image already shows them." />
              </div>
              <p className="text-[11px] text-gray-500 dark:text-slate-400">
                Tip: for the sharpest print use a wide image about <b>2480 × 400 px</b> (A4 width). GST / drug-licence numbers still print on bills — they're never hidden.
              </p>
            </>
          )}
        </div>

        {/* ---- live preview ---- */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold text-gray-700 dark:text-slate-300 uppercase tracking-wide">Live preview</div>
            <div className="flex gap-0.5 p-0.5 rounded-md bg-gray-100 dark:bg-slate-800/60 text-[11px] font-semibold">
              {([['bill', 'Bills & reports'], ['opd', 'OPD slip']] as const).map(([v, l]) => (
                <button key={v} type="button" onClick={() => setView(v)}
                  className={cn('px-2.5 py-1 rounded', view === v ? 'bg-white dark:bg-slate-900 text-blue-700 shadow-sm' : 'text-gray-500')}>{l}</button>
              ))}
            </div>
          </div>
          <LetterheadPreview settings={merged} view={view} />
          <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-2">
            This is the actual header that prints. Changes show here instantly; press <b>Save</b> to apply them to every document.
          </p>
        </div>
      </div>
    </section>
  );
}


/** What this PC thinks the time is — the first thing to check when a registered time "looks wrong". */
function ClockCheck() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const c = clockInfo(now);
  return (
    <section className="card p-5 space-y-3">
      <div className="flex items-center gap-4 flex-wrap">
        <div>
          <div className="text-2xl font-bold tabular-nums text-gray-900 dark:text-slate-100">{format(now, 'hh:mm:ss a')}</div>
          <div className="text-xs text-gray-500 dark:text-slate-400">{format(now, 'EEEE, do MMMM yyyy')}</div>
        </div>
        <div className="text-sm">
          <div className="font-semibold text-gray-900 dark:text-slate-100">{c.zone || 'Time zone unknown'}</div>
          <div className="text-gray-500 dark:text-slate-400">{c.offsetLabel}{c.isIndia ? ' · India Standard Time ✓' : ''}</div>
        </div>
      </div>
      {c.isIndia ? (
        <p className="text-[12px] text-emerald-700 dark:text-emerald-300">
          This PC is on India time. A patient registered right now shows the time on this clock.
        </p>
      ) : (
        <p className="text-[12px] rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 px-3 py-2">
          <b>This PC is not on India Standard Time (UTC+05:30).</b> Registered, billed and reported times will follow this clock, so they will
          look wrong to anyone on India time. Fix it in Windows → <b>Settings → Time &amp; language → Date &amp; time → Time zone</b>
          (choose “(UTC+05:30) Chennai, Kolkata, Mumbai, New Delhi”). If you are outside India you can ignore this.
        </p>
      )}
      <p className="text-[11px] text-gray-500 dark:text-slate-400">
        Compare the time above with your phone. If they match, every time CureDesk shows is correct; if they differ, change it in Windows — CureDesk follows the PC.
      </p>
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
            <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-1.5">Queue Flow (Waiting / In Progress / Done)<HelpTip title="Queue Flow"><><p>Turns the appointment list into a three-stage queue instead of a plain list.</p><p>Useful when several people are working the same queue and need to see who is already with the doctor. A single-doctor clinic usually does not need it.</p></></HelpTip></div>
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
        <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-1.5">Free Follow-up Policy<HelpTip title="Free Follow-up Policy"><><p>Whether a patient returning soon after a visit is seen again without paying a second consultation fee.</p><p>Set the window in days and how many free repeat visits it covers. Reception sees the free-visit status automatically, so nobody has to remember who is entitled to what.</p></></HelpTip></div>
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
          <li>Pharmacy: drug list, batches, sales, dispensing register, purchases, wholesalers</li>
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

/**
 * "Open the setup guide" — the first-run walk-through (clinic, doctors, fees, staff, pharmacy, wards), reopened any time.
 * Shows how many steps are still open; what was already saved is kept.
 */
function SetupGuideCard() {
  const { data: st } = useQuery({ queryKey: ['setup-status'], queryFn: () => window.electronAPI.setup.status() });
  if (!st) return null;
  const steps = Object.values(st.steps);
  const left = steps.filter((x) => x !== 'done').length;
  return (
    <section className="card p-4 border border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-900/15">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-blue-900 dark:text-blue-200">Setup guide</div>
          <div className="text-[12px] text-blue-800 dark:text-blue-300 mt-0.5">
            {left === 0
              ? 'Every step of the guide has been saved. Open it to review or change anything.'
              : `A short walk-through of the clinic details, doctors, fees, staff logins, pharmacy and wards. ${left} of ${steps.length} step${left === 1 ? ' is' : 's are'} not saved yet.`}
          </div>
        </div>
        <button className="btn-primary text-xs" onClick={() => window.dispatchEvent(new Event('caredesk:openSetupGuide'))}>
          Open the setup guide
        </button>
      </div>
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

/** Live schematic of the clinic network: the host in the middle, each connected
 *  computer branching off. Reads network:status every 5s. (Named per-PC list +
 *  role assignment lands with the server-side client registry — piece 4b/7.) */
function NetworkDiagram() {
  const { data: net } = useQuery({
    queryKey: ['network-status'],
    queryFn: () => window.electronAPI.network.status(),
    refetchInterval: 5000,
  });
  const mode = (net?.mode || 'local') as 'local' | 'server' | 'client';
  const clients = net?.clients ?? 0;
  const lanIp = net?.lanIp || null;
  const port = net?.listenPort || (net as any)?.port || 4321;
  const serverUrl = (net as any)?.client?.serverUrl || net?.serverUrl || '';
  const clientState = (net as any)?.client?.state;
  const clientList = (((net as any)?.clientList) || []) as { name: string; ip: string; since: number; live?: boolean }[];
  const liveClients = ((net as any)?.liveClients ?? clients) as number;
  const line = 'bg-slate-300 dark:bg-slate-600';
  const borderLine = 'border-slate-300 dark:border-slate-600';

  const Card = ({ emoji, title, sub, tone }: { emoji: string; title: string; sub?: string; tone: 'host' | 'client' | 'muted' }) => (
    <div className={cn('rounded-xl border-2 px-4 py-3 text-center shadow-sm min-w-[132px]',
      tone === 'host' && 'border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/25',
      tone === 'client' && 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20',
      tone === 'muted' && 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/40')}>
      <div className="text-2xl leading-none mb-1">{emoji}</div>
      <div className="text-[12px] font-bold text-gray-900 dark:text-slate-100">{title}</div>
      {sub && <div className="text-[10px] text-gray-500 dark:text-slate-400 font-mono mt-0.5 break-all">{sub}</div>}
    </div>
  );

  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 overflow-x-auto">
      {mode === 'local' && (
        <div className="flex flex-col items-center gap-3 py-4">
          <Card emoji="🖥️" title="This PC only" sub="single-station" tone="muted" />
          <div className="text-[12px] text-gray-500 dark:text-slate-400 text-center">Not networked. Choose <b>Host</b> below to let other PCs connect to this one.</div>
        </div>
      )}

      {mode === 'server' && (
        <div className="flex flex-col items-center">
          <Card emoji="🖥️" title="Main Computer (Host)" sub={lanIp ? `${lanIp}:${port}` : `port ${port}`} tone="host" />
          <div className={cn('w-0.5 h-6', line)} />
          {clients > 0 ? (
            <div className={cn('flex flex-wrap justify-center gap-6 pt-6 border-t-2', borderLine)}>
              {(clientList.length ? clientList : Array.from({ length: clients }, (_, i) => ({ name: `Computer ${i + 1}`, ip: '', since: 0 }))).map((c, i) => (
                <div key={i} className="relative">
                  <div className={cn('absolute -top-6 left-1/2 -translate-x-1/2 w-0.5 h-6', line)} />
                  <Card emoji="💻" title={c.name} sub={c.ip || 'connected'} tone="client" />
                </div>
              ))}
            </div>
          ) : (
            <div className={cn('pt-6 border-t-2 text-center max-w-xs', borderLine)}>
              <div className="text-[12px] text-gray-500 dark:text-slate-400">No computers connected yet. Share the <b>join code</b> below on a cabin PC to connect it.</div>
            </div>
          )}
          <div className="mt-4 text-[12px] font-semibold text-blue-700 dark:text-blue-300">{clients} computer{clients === 1 ? '' : 's'} connected</div>
          {clients > 0 && liveClients < clients && (
            <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-300 max-w-sm text-center leading-relaxed">
              {clients - liveClients} of them {clients - liveClients === 1 ? 'is' : 'are'} working normally but not receiving
              <b> live updates</b> — their screens refresh on their own schedule instead of the instant something changes here.
              Usually harmless; re-pairing that PC restores it.
            </div>
          )}
          {clientList.length > 0 && (
            <div className="mt-4 w-full max-w-md">
              <div className="text-[10px] uppercase tracking-wide font-bold text-gray-500 dark:text-slate-400 mb-1.5">Connected Computers</div>
              <div className="rounded-lg border border-gray-200 dark:border-slate-700 divide-y divide-gray-100 dark:divide-slate-800">
                {clientList.map((c, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 text-[12px]">
                    <span className="font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-1.5">
                      <span className={cn('w-1.5 h-1.5 rounded-full', (c as any).live === false ? 'bg-amber-500' : 'bg-emerald-500')}
                        title={(c as any).live === false
                          ? 'Working, but not receiving live updates — its screens refresh a little slower'
                          : 'Connected with live updates'} />
                      {c.name}
                    </span>
                    <span className="font-mono text-gray-500 dark:text-slate-400">{c.ip}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {mode === 'client' && (
        <div className="flex flex-col items-center">
          <Card emoji="🖥️" title="Main Computer (Host)" sub={serverUrl.replace(/^https?:\/\//, '') || 'the clinic host'} tone="host" />
          <div className={cn('w-0.5 h-8', clientState === 'connected' ? 'bg-emerald-400' : 'bg-red-400')} />
          <Card emoji="💻" title="This computer" sub={clientState === 'connected' ? 'connected' : 'reconnecting…'} tone="client" />
          <div className={cn('mt-4 text-[12px] font-semibold', clientState === 'connected' ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-400')}>
            {clientState === 'connected' ? 'Connected to the main computer' : 'Trying to reach the main computer…'}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Show the HOST's sleep protection.
 *
 * The host holds the database, so if it sleeps every other PC loses access at
 * the same moment and it looks like the network died. CureDesk now blocks sleep
 * automatically while it hosts (a runtime power-save block: the machine stays
 * awake, the screen still turns off), so the normal state here is REASSURING,
 * not a warning.
 *
 * The one gap the runtime block cannot cover is the window between the PC
 * booting and CureDesk launching. If the Windows setting itself still says
 * "sleep after N minutes", we offer to make it permanent so even that window is
 * safe — but as a quiet secondary option, not an alarm, because the live block
 * already has the clinic covered.
 */
function HostSleepWarning() {
  const [busy, setBusy] = useState(false);
  const { data: power, refetch } = useQuery({
    queryKey: ['host-power'],
    queryFn: () => window.electronAPI.network.hostPower(),
    refetchInterval: 15_000,
  });
  if (!power) return null;

  // Active runtime block — the everyday case for a running host.
  if (power.preventionActive) {
    return (
      <div className="rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2 text-[12px] text-emerald-800 dark:text-emerald-200">
        <div className="font-semibold">✓ This PC is being kept awake while it hosts the clinic</div>
        <div className="mt-0.5">The screen still turns off to save power — only sleep is blocked, so the other computers never lose access.</div>
        {power.known && power.sleepsOnAC && (
          <div className="mt-2 flex items-center gap-2 flex-wrap opacity-90">
            <span>Windows itself is still set to sleep after {power.sleepAfterMinutes} min, which only matters in the few seconds after this PC boots before CureDesk opens.</span>
            <button
              className="btn-secondary text-xs"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await window.electronAPI.network.disableHostSleep();
                  if (!r.ok) alert(r.error || 'Could not change the Windows setting.');
                  await refetch();
                } finally { setBusy(false); }
              }}
            >
              {busy ? 'Applying…' : 'Make it permanent too'}
            </button>
          </div>
        )}
      </div>
    );
  }

  // Fallback: the block isn't active (server not started yet, or it failed) AND
  // Windows will sleep. Then it IS a warning, with the direct fix.
  if (power.known && power.sleepsOnAC) {
    return (
      <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-[12px] text-amber-800 dark:text-amber-200">
        <div className="font-semibold">⚠ This PC is set to sleep after {power.sleepAfterMinutes} minutes</div>
        <div className="mt-0.5">
          It hosts the clinic's records, so while it sleeps <b>every other computer loses access</b>. Start hosting (Server mode) to
          keep it awake automatically, or make the change permanent now.
        </div>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <button
            className="btn-secondary text-xs"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await window.electronAPI.network.disableHostSleep();
                if (!r.ok) alert(r.error || 'Could not change the setting.');
                await refetch();
              } finally { setBusy(false); }
            }}
          >
            {busy ? 'Applying…' : 'Keep this PC awake'}
          </button>
          <span className="opacity-80">The monitor still turns off — only sleep is disabled.</span>
        </div>
      </div>
    );
  }
  return null;
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
        <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-1.5">Network Mode<HelpTip title="Network Mode"><><p>What this computer is in a multi-PC clinic: on its own, the <b>main computer</b> other PCs connect to, or a <b>station</b> that connects to the main one.</p><p>Only one PC should be the main computer — it holds the database everyone shares.</p></></HelpTip></div>
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
          <HostSleepWarning />
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

/** Friendly Client setup panel — auto-discovery + 5-char join code, with
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
      if (list.length === 0) setMsg({ ok: false, text: 'No CureDesk servers found on this network. Make sure the host PC is running and on the same router (cable or Wi-Fi, not a Guest network).' });
    } catch (e: any) {
      setMsg({ ok: false, text: `Scan failed: ${e?.message || e}` });
    } finally {
      setDiscovering(false);
    }
  };

  const connectWithCode = async () => {
    if (!pickedServer) { setMsg({ ok: false, text: 'Pick a discovered server first (or enter URL manually below).' }); return; }
    // Case matters — strip separators only, never change the letters.
    const cleaned = code.replace(/[^A-Za-z0-9]/g, '');
    if (cleaned.length !== 5) { setMsg({ ok: false, text: 'Join code is 5 characters, and capital and small letters are different.' }); return; }
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
          {discovering ? 'Scanning the network…' : (discovered.length > 0 ? '🔄 Rescan' : '🔍 Scan for clinic servers on this network')}
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
              className="input font-mono text-2xl tracking-[0.3em] text-center flex-1"
              placeholder="5-character code"
              maxLength={5}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') connectWithCode(); }}
            />
            <button
              type="button"
              className="btn-primary"
              onClick={connectWithCode}
              disabled={busy || code.replace(/[^A-Za-z0-9]/g, '').length !== 5}
            >
              {busy ? 'Connecting…' : '🚀 Connect'}
            </button>
          </div>
          <div className="text-[10px] text-gray-500 mt-1">
            On the host PC: Settings → Computers & staff → Connecting the Computers → big blue "Join Code" panel.
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
        This part explains how the computers work together once they are connected. To <b>connect</b> them — cable or Wi-Fi, the Windows settings,
        what to buy — use <b>Connect the computers — step by step</b> above.
      </div>

      <button
        className="btn-secondary text-xs w-fit"
        onClick={() => window.electronAPI.app.openExternal('https://curedesk.co.in/multi-station.html').catch(() => { /* ignore */ })}
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
          <li><b>One router</b> in the clinic. Both PCs must connect to the SAME router — by network cable (best) or by Wi-Fi.
            A normal home/office router is fine — no special hardware needed. (Only two computers? One cable between them works too.)</li>
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
            (One-time. This only opens your clinic’s own network, NOT the internet.)</li>
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
          <li>The wizard scans the network (cable or Wi-Fi) for ~5 seconds. The main PC should appear as a clickable card
            (e.g. <span className="font-mono">CureDesk HMS · v0.3.0 · 192.168.1.100:4321</span>). Click it.</li>
          <li>If the scan finds nothing, click <b>"Type code manually"</b> instead and enter the main PC's IP
            (find it on the main PC's join-code screen — bottom row, "This PC's IP").</li>
          <li>Type the 5-character join code from the main PC&rsquo;s screen (e.g. <span className="font-mono">7k3Pq</span>) → click <b>Connect</b>. <b>Capital and small letters are different</b> — type it exactly as shown.</li>
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
          flowing between the PCs over your clinic network.</p>
      </GuideSection>

      <GuideSection
        id="accounts" open={open === 'accounts'} onToggle={toggle}
        title="Staff accounts across computers — create each person ONCE"
        tone="violet"
      >
        <p>Staff accounts live on the <b>main computer</b>. Create a person once there and they can sign in
          at <b>any</b> station — reception, cabin, pharmacy, lab.</p>
        <div className="mt-2 rounded-lg border border-violet-200 dark:border-violet-800 p-3 space-y-1.5">
          <div><b>To add a staff member:</b> on the MAIN PC → Users &amp; Access → <b>Add User</b> → pick their role.</div>
          <div><b>To let them actually sign in:</b> Settings → <b>Computers &amp; staff</b> → turn on
            <b> "Everyone signs in with their own login"</b> (it is on automatically when the clinic uses more than one computer). Until this is on,
            the computer opens as Reception and roles do nothing — this is the single most common point of confusion.</div>
          <div><b>To remove someone:</b> set their status to Inactive on the main PC. It applies everywhere at once.</div>
        </div>
        <p className="mt-2"><b>If the main computer is unreachable</b>, a station can still sign in with an account
          created on <i>that</i> PC — an emergency login so you can reach Settings and repair the connection.
          A wrong password never falls back to it; that only happens when the host genuinely can't be reached.</p>
        <p className="mt-2">The <b>admin PIN</b> stays on each computer deliberately, so any station can unlock
          Settings to fix its own network configuration even when the host is down.</p>
      </GuideSection>

      <GuideSection
        id="station" open={open === 'station'} onToggle={toggle}
        title="Giving each computer its own menu (reception / pharmacy / lab…)"
        tone="blue"
      >
        <p>A pharmacy counter doesn't need the IPD ward map; a lab bench doesn't need Accounts. Tell each PC
          what it's for and its menu shrinks to match.</p>
        <p className="mt-2"><b>Where:</b> Settings → Computers &amp; staff → <b>This Computer&rsquo;s Job</b> → pick a card
          (Everything / Reception desk / Doctor cabin / Pharmacy counter / Lab bench / Ward station).
          A live preview shows exactly what that PC will show before you commit.</p>
        <div className="mt-2 rounded-lg bg-blue-50/60 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-3 space-y-1">
          <div>✔ It affects <b>only that computer</b> — nobody else's screen changes.</div>
          <div>✔ <b>Settings and Users are never hidden</b>, so you can always undo it on the machine itself.</div>
          <div>✔ Default is <b>Everything</b>, so nothing disappears unless you choose it.</div>
        </div>
        <p className="mt-2">This is separate from <b>roles</b>: the computer decides the menu, the person's role
          decides what they may do. Use both together — a pharmacy PC where the pharmacist signs in.</p>
      </GuideSection>

      <GuideSection
        id="licence-backup" open={open === 'licence-backup'} onToggle={toggle}
        title="Subscription & backups in a multi-PC clinic"
        tone="emerald"
      >
        <p><b>One subscription covers the whole clinic.</b> The licence key is activated on the
          <b> main computer</b> only. Connected stations inherit it automatically — they never ask for a key,
          and you never buy extra licences per PC.</p>
        <p className="mt-2"><b>Backups run on the main computer</b>, because that's where the clinic's data
          actually lives. Set the backup folder there (ideally a Google Drive / OneDrive folder) using the
          <b> Backup</b> button in the sidebar. Backing up on a client PC would only save a copy of that PC's
          local settings — not your patient records.</p>
        <p className="mt-2">So: <b>licence on the host, backups on the host.</b> Stations need neither.</p>
      </GuideSection>

      <GuideSection
        id="hostdown" open={open === 'hostdown'} onToggle={toggle}
        title="What happens if the main computer is switched off?"
        tone="amber"
      >
        <p>Every station reads and writes its data from the main computer. If that PC is off or off-network,
          each station shows a full-screen <b>"Can't reach the main computer"</b> message and waits, retrying
          automatically. It reconnects on its own the moment the host is back — nothing is lost.</p>
        <div className="mt-2 space-y-1">
          <div><b>So keep the main computer on</b> during clinic hours. Treat it like the server it is:
            plugged in, not sleeping, ideally on a UPS.</div>
          <div><b>Tip:</b> set the main PC to never sleep (Windows → Power &amp; sleep → Sleep: Never).
            A sleeping host looks identical to a broken network to every station.</div>
          <div><b>If the host is dead for good:</b> restore its latest backup onto any PC, set that PC to
            Host, and re-pair the stations with a fresh join code.</div>
        </div>
      </GuideSection>

      <GuideSection
        id="rename" open={open === 'rename'} onToggle={toggle}
        title="Renaming a station / re-pairing later"
        tone="slate"
      >
        <p><b>To rename this PC:</b> Settings → Computers &amp; staff → Connecting the Computers → edit the <b>"Station / room name"</b>
          field at the top → click Save changes. Sidebar pill updates immediately.</p>
        <p className="mt-2"><b>To add a NEW cabin PC later:</b></p>
        <ol className="list-decimal pl-5 space-y-1 mt-1">
          <li>On the MAIN PC, open Settings → Computers &amp; staff → Connecting the Computers. Find the big rotating join code panel.</li>
          <li>If the code has expired, click <b>"New code"</b>.</li>
          <li>On the new cabin PC, install CureDesk → in the wizard pick "Connect to existing clinic" → enter the code.</li>
        </ol>
        <p className="mt-2"><b>To switch a cabin to a different role:</b> Settings → Computers &amp; staff → Connecting the Computers → click
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
              <li>Make sure both PCs are on the <b>same router</b> — cable or Wi-Fi, but not a “Guest” network, and not different routers.</li>
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
              <li>The main PC may be off, sleeping, or the cable / Wi-Fi dropped. Wait 5 seconds — the cabin auto-reconnects.</li>
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
            <p>On every cabin PC: Settings → Computers &amp; staff → Connecting the Computers → click <b>Local</b> → Save → restart app.
              On the main PC: do the same. Each PC's local data stays put. (To consolidate the cabin's local
              data into the main PC's DB, use the export/import flow under "Bringing existing data to the server PC".)</p>
          </Trouble>
          <Trouble q="The main PC's join-code screen disappeared.">
            <p>It's still active. Open Settings → Computers &amp; staff → Connecting the Computers → scroll to the big rotating code panel.
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
          <li><b>Patient data never leaves your clinic network.</b> No cloud, no internet calls.
            CureDesk only opens an internet connection for daily update checks (which can be turned off).</li>
          <li>The main PC's server requires a <b>shared secret token</b>. Cabin PCs without the token can't
            read or write data. The token is auto-generated and stored on each PC after pairing.</li>
          <li>The 5-character join code is <b>short-lived (10 minutes)</b> and rotates — so even if a code
            is overheard, it can't be used after expiry.</li>
          <li><b>Anyone on the same network with the token can use any feature.</b> Per-station role enforcement
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
      toast('Backup ready — copy that folder to the server PC, then on the server use Settings → System → Backup, Restore & Updates → Restore');
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
  // No dash, case preserved — see WelcomeWizard.
  const display = jc?.code || '·····';
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
      <div className="text-[11px] text-blue-800/80 dark:text-blue-200/80 text-center -mt-2 mb-1">Type it exactly — <b>capital and small letters are different</b>.</div>
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
        <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-1.5">Quick-pick services<HelpTip title="Quick-pick services"><><p>The buttons that appear on the Services screen — injections, dressings, vaccination and anything else you charge for regularly.</p><p>Putting your common ones here saves reception typing the same description several times a day.</p></></HelpTip></div>
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
        <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-1.5">Slip Body Templates<HelpTip title="Slip Body Templates"><><p>What gets printed on the patient slip below the clinic letterhead.</p><p>Use this for standing instructions, timings or anything you want on every slip without writing it each time.</p></></HelpTip></div>
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

                {/* Logo on this template. Size and the wide-logo option are clinic-wide —
                    Settings → Clinic → Letterhead — so every document matches. */}
                <div>
                  <label className="label">Logo on this slip</label>
                  <div className="flex gap-2">
                    {([['large', 'Show'], ['none', 'Hide']] as const).map(([val, lbl]) => (
                      <button key={val} onClick={() => updateLayout({ logoSize: val })}
                        className={cn('flex-1 py-1.5 text-xs rounded-lg border font-medium transition-colors',
                          (layout.logoSize === 'none') === (val === 'none')
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:border-blue-400')}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-500 dark:text-slate-400 mt-1">
                    Size &amp; wide-logo layout: <b>Settings → Clinic → Letterhead</b>.
                  </p>
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
    { drug_name: 'Crocin Syrup 60ml', generic_name: 'Paracetamol 120 mg/5 ml', dosage: '5 ml', frequency: 'TID', duration: '3 days', instructions: 'After food' },
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
        <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-1.5">Patient Registration Fee<HelpTip title="Patient Registration Fee"><><p>A one-time charge when a brand-new patient is registered, separate from the consultation fee.</p><p>Charged only on the first ever visit. Leave it off if your clinic does not charge for making a file.</p></></HelpTip></div>
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

/**
 * Referrals: where patients come from — Google, Self, Family, an outside doctor's name… A plain managed
 * list (add / edit / remove). Names are free text and print exactly as typed (no "Dr." is added); type
 * "Dr. Ramesh Kumar" when it is a doctor. The chosen one prints on the OPD slip and populates the "Referral"
 * dropdown when booking an appointment.
 */
function ReferringDoctorsManager() {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Partial<ReferringDoctor> | null>(null);
  const [confirmDel, setConfirmDel] = useState<ReferringDoctor | null>(null);

  const { data: list = [] } = useQuery({
    queryKey: ['referring-doctors-all'],
    queryFn: () => window.electronAPI.referringDoctors.list(false),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['referring-doctors'] });
    qc.invalidateQueries({ queryKey: ['referring-doctors-all'] });
  };

  const saveMut = useMutation({
    mutationFn: (d: Partial<ReferringDoctor>) =>
      d.id ? window.electronAPI.referringDoctors.update(d.id, d) : window.electronAPI.referringDoctors.create(d),
    onSuccess: () => { refresh(); toast('Referral saved'); setEditing(null); },
    onError: (e: any) => toast(e?.message || 'Could not save', 'error'),
  });

  const delMut = useMutation({
    mutationFn: (id: number) => window.electronAPI.referringDoctors.delete(id),
    onSuccess: () => { refresh(); toast('Referral removed'); setConfirmDel(null); },
    onError: (e: any) => toast(e?.message || 'Could not remove', 'error'),
  });

  const save = () => {
    if (!editing) return;
    if (!String(editing.name || '').trim()) { toast('Name is required', 'error'); return; }
    saveMut.mutate(editing);
  };

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <UserIcon className="w-4 h-4 text-blue-600" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Referrals</h2>
        </div>
        <button className="btn-primary" onClick={() => setEditing({ is_active: 1 })}>
          <Plus className="w-4 h-4" /> Add Referral
        </button>
      </div>

      {list.length === 0 ? (
        <p className="text-[13px] text-gray-500 dark:text-slate-400 py-2">
          No referrals yet. Add where your patients come from — Google, Self, Family, a doctor who sends you patients — and they’ll appear in the “Referral” list while booking an appointment, and print on the OPD slip exactly as typed.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-gray-200 dark:border-slate-700 text-xs uppercase text-gray-500 dark:text-slate-400">
              <th className="py-2 px-2">Referral</th>
              <th className="py-2 px-2">Qualification</th>
              <th className="py-2 px-2">Place / Clinic</th>
              <th className="py-2 px-2 w-32">Phone</th>
              <th className="py-2 px-2 w-20">Status</th>
              <th className="py-2 px-2"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((d) => (
              <tr key={d.id} className="border-b border-gray-100 dark:border-slate-800">
                <td className="py-2 px-2 font-medium text-gray-900 dark:text-slate-100">{d.name}</td>
                <td className="py-2 px-2 text-gray-600 dark:text-slate-300">{d.qualification || '—'}</td>
                <td className="py-2 px-2 text-gray-600 dark:text-slate-300">{d.place || '—'}</td>
                <td className="py-2 px-2 text-gray-600 dark:text-slate-300">{d.phone || '—'}</td>
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
                    onClick={() => setConfirmDel(d)}
                    title="Remove this referral"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit Referral' : 'Add Referral'} size="md">
        {editing && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Referral *">
                <input className="input" autoFocus value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Google, Self, Family, Dr. Ramesh Kumar" />
              </Field>
              <Field label="Qualification">
                <input className="input" value={editing.qualification || ''} onChange={(e) => setEditing({ ...editing, qualification: e.target.value })} placeholder="Optional — for a doctor, e.g. MBBS, MD" />
              </Field>
              <Field label="Place / Clinic">
                <input className="input" value={editing.place || ''} onChange={(e) => setEditing({ ...editing, place: e.target.value })} placeholder="e.g. City Clinic, Hubli" />
              </Field>
              <Field label="Phone">
                <input className="input" value={editing.phone || ''} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} placeholder="Optional" />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
              <input type="checkbox" checked={editing.is_active !== 0} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked ? 1 : 0 })} />
              Active (show in the “Referral” list)
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn-primary" onClick={save} disabled={saveMut.isPending}>
                {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!confirmDel} onClose={() => setConfirmDel(null)} title="Remove referral?" size="sm">
        {confirmDel && (
          <div className="space-y-4">
            <p className="text-[13px] text-gray-600 dark:text-slate-300">
              Remove <b>{confirmDel.name}</b> from the Referral list? Appointments already booked with this referral keep their printed “Referral” line — only the pick-list entry is removed.
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setConfirmDel(null)}>Cancel</button>
              <button className="btn-danger" onClick={() => delMut.mutate(confirmDel.id)} disabled={delMut.isPending}>
                {delMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Remove
              </button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
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
/**
 * "What does this computer do?" — the one control that shapes this PC's menu.
 * Station-local (never synced from the host), so the pharmacy counter can be a
 * pharmacy counter without changing anybody else's screen. Owner screens are
 * never hidden by it, so the fix is always reachable on the machine itself.
 */
function ThisComputerPanel() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const current = ((settings as any)?.station_role || 'everything') as StationRole;
  const [busy, setBusy] = useState(false);

  const pick = async (role: StationRole) => {
    setBusy(true);
    try {
      await window.electronAPI.settings.save({ station_role: role } as any);
      qc.invalidateQueries();
      toast(`This computer is now set to: ${STATION_LABEL[role]}`, 'success');
    } catch (e: any) { toast(e?.message || 'Could not save', 'error'); }
    finally { setBusy(false); }
  };

  // Live preview of the menu this station produces.
  const preview = MENU_PREVIEW.filter((m) => stationShows(m.path, current)).map((m) => m.label);

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">This computer</h3>
      <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-3">
        What is this PC used for? It decides which menu items appear <b>on this computer only</b> —
        other computers in the clinic are unaffected. Settings and Users are never hidden.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {STATION_ROLES.map((r) => (
          <button key={r} type="button" disabled={busy} onClick={() => pick(r)}
            className={cn('rounded-lg border-2 p-2.5 text-left text-[12px] transition disabled:opacity-50',
              current === r ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/25' : 'border-gray-200 dark:border-slate-700 hover:border-blue-400')}>
            <div className="font-bold text-gray-900 dark:text-slate-100">{STATION_LABEL[r]}</div>
            {current === r && <div className="text-[10px] text-blue-700 dark:text-blue-300 mt-0.5">✓ current</div>}
          </button>
        ))}
      </div>
      <div className="mt-3 rounded-lg bg-gray-50 dark:bg-slate-800/60 p-3">
        <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400 mb-1">This computer will show</div>
        <div className="text-[12px] text-gray-700 dark:text-slate-200 leading-relaxed">
          {preview.join(' · ')}{current !== 'everything' ? <span className="text-gray-400"> · (plus Settings &amp; Users for the owner)</span> : null}
        </div>
      </div>
    </div>
  );
}

/** Loads the standard drug catalogue — a real setup action for a real clinic.
 *
 *  The fictional-sample-data loader used to live here too, one button away from
 *  a live database. A clinic that clicked it would have 50 invented patients and
 *  103 invented bills mixed into its real records with no way to tell them apart.
 *  It is now dev-only: it still exists for our own demos when the app is run from
 *  source, and simply is not present in a build a clinic installs. */
function SampleDataPanel() {
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<'sample' | 'catalog' | null>(null);
  const [result, setResult] = useState<string | null>(null);

  /**
   * The undo for demo data. Unlike the loader, this IS shown in clinic builds —
   * a clinic that loaded fictional patients before going live is exactly who
   * needs to get rid of them, and refusing to help would leave them stuck with
   * invented records in their real database forever. It only ever appears when
   * such records actually exist.
   */
  const { data: sampleCount } = useQuery({
    queryKey: ['sample-data-count'],
    queryFn: () => window.electronAPI.admin.sampleDataCount(),
  });
  const fakePatients = sampleCount?.ok ? (sampleCount.patients ?? 0) : 0;

  const removeSample = async () => {
    if (!window.confirm(
      `Permanently remove ${fakePatients} fictional sample patient(s) and every bill, pharmacy sale, lab order and IPD admission belonging to them?\n\n` +
      'Only records with an MMC#### number are removed — your real patients (PT-…) are not touched.\n\nThis cannot be undone.'
    )) return;
    setBusy('sample');
    try {
      const r = await window.electronAPI.admin.removeSampleData();
      if (r.ok) {
        setResult(`\u2705 ${r.note}`);
        qc.invalidateQueries();
        toast(`Removed ${r.removed} sample patients`, 'success');
      } else { setResult('\u274c ' + (r.error || 'Failed')); toast(r.error || 'Failed', 'error'); }
    } catch (e: any) { setResult('\u274c ' + (e?.message || 'Failed')); }
    finally { setBusy(null); }
  };

  const loadSample = async () => {
    // Typed confirmation rather than a plain OK: this ships in the real installer
    // so demos can use it, which means a clinic can also reach it. One careless
    // click should not put 50 invented patients into live records.
    // NOT window.prompt(): Electron does not implement it and throws
    // "prompt() is not supported", which took down the whole renderer.
    // promptDialog is the app's own in-window replacement.
    const typed = await promptDialog(
      'This adds ~50 FICTIONAL patients with visits, bills, pharmacy sales, lab orders and IPD admissions.\n\n' +
      'It is for demos only — never run it on a clinic that has started using CureDesk for real.\n' +
      'You can undo it afterwards with "Remove sample patients" just below.\n\n' +
      'Type DEMO to confirm:',
      { placeholder: 'DEMO', confirmLabel: 'Load demo data' }
    );
    if ((typed || '').trim().toUpperCase() !== 'DEMO') return;
    setBusy('sample');
    try {
      const r = await window.electronAPI.admin.loadSampleData();
      if (r.ok) {
        setResult(`✅ Added ${r.patients} patients · ${r.bills} bills · ${r.sales} pharmacy sales · ${r.labOrders} lab orders · ${r.admissions} IPD admissions. Open Analytics to see the charts.`);
        qc.invalidateQueries();
        toast('Sample data loaded', 'success');
      } else { setResult('❌ ' + (r.error || 'Failed')); toast(r.error || 'Failed', 'error'); }
    } catch (e: any) { setResult('❌ ' + (e?.message || 'Failed')); }
    finally { setBusy(null); }
  };

  const loadCatalog = async () => {
    setBusy('catalog');
    try {
      const r = await window.electronAPI.pharmacy.loadStandardCatalog();
      const bits = [r.added ? `added ${r.added} new drug${r.added === 1 ? '' : 's'}` : '', r.corrected ? `corrected the composition of ${r.corrected}` : '',
        r.rescheduled ? `corrected the schedule (H → H1) of ${r.rescheduled}` : ''].filter(Boolean);
      setResult(`✅ Drug catalogue (${r.total} drugs): ${bits.length ? bits.join(' and ') : 'nothing to change — your list is already up to date'}.${r.kept ? ` ${r.kept} you have edited ${r.kept === 1 ? 'was' : 'were'} left exactly as you set ${r.kept === 1 ? 'it' : 'them'}.` : ''}`);
      qc.invalidateQueries({ queryKey: ['pharmacy-drugs'] });
      toast(bits.length ? `Drug list updated (${bits.join(', ')})` : 'Drug list already up to date', 'success');
    } catch (e: any) { setResult('❌ ' + (e?.message || 'Failed')); toast('Failed', 'error'); }
    finally { setBusy(null); }
  };

  return (
    <div className="mt-6 pt-5 border-t border-gray-200 dark:border-slate-700">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Standard drug catalogue</h3>
      <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-3">
        Adds the built-in list of about 300 commonly used medicines (paediatric and adult, with the strength of each ingredient —
        for liquids per ml, like 250 mg/5 ml) to your Drug List. Only drugs you don’t already have are added, and a drug you have
        not edited gets its composition filled in, and a medicine that is Schedule H1 by law but was listed as H is corrected (only if you never changed its schedule) —
        anything you changed is left exactly as it is, and prices and stock stay yours to set.
      </p>
      <div className="flex gap-2 flex-wrap">
        <button className="btn-secondary text-xs" onClick={loadCatalog} disabled={busy !== null}>{busy === 'catalog' ? 'Loading…' : 'Load standard drug catalogue'}</button>
      </div>

      {/* Always rendered, whatever the count. Hiding this when nothing was found
          made "no demo data here" indistinguishable from "the feature is
          missing" — which is exactly how it read to someone hunting for it. */}
      <div className="mt-4 pt-4 border-t border-gray-200 dark:border-slate-700">
        <div className="text-[12.5px] font-semibold text-gray-900 dark:text-slate-100">Demo / sample data</div>
        {sampleCount && !sampleCount.ok ? (
          <p className="text-[11.5px] text-red-600 dark:text-red-400 mt-1">
            Could not check for sample data: {sampleCount.error || 'unknown error'}
          </p>
        ) : fakePatients > 0 ? (
          <div className="mt-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3">
            <div className="text-[12px] font-bold text-amber-900 dark:text-amber-100">
              {fakePatients} fictional sample patient{fakePatients === 1 ? '' : 's'} found
            </div>
            <p className="text-[11.5px] text-amber-900/90 dark:text-amber-100/90 mt-1 leading-relaxed">
              These are demo records (numbered <code>MMC1000</code> onward), not real patients. They inflate your
              Analytics and your revenue figures. Removing them deletes their bills, pharmacy sales, lab orders and
              admissions too — your real patients (<code>PT-…</code>) are never touched.
            </p>
            <button className="btn-secondary text-xs mt-2 border-amber-400 text-amber-900 dark:text-amber-100"
              onClick={removeSample} disabled={busy !== null}>
              {busy === 'sample' ? 'Removing…' : `Remove ${fakePatients} sample patient${fakePatients === 1 ? '' : 's'}`}
            </button>
          </div>
        ) : (
          <p className="text-[11.5px] text-gray-500 dark:text-slate-400 mt-1 leading-relaxed">
            No sample patients in this database. Demo records are numbered
            <code className="mx-1">MMC1000</code> onward; real patients are <code>PT-…</code>.
          </p>
        )}

        {/* Loading demo data — for showing the app to a prospective clinic. */}
        <div className="mt-2.5 flex items-center gap-2 flex-wrap">
          <button className="btn-secondary text-xs" onClick={loadSample} disabled={busy !== null}>
            {busy === 'sample' ? 'Working…' : 'Load 50 demo patients + activity'}
          </button>
          <span className="text-[11px] text-gray-500 dark:text-slate-400">
            For demos only — asks you to type <b>DEMO</b> first, and is fully removable above.
          </span>
        </div>
      </div>
      {result && <div className="text-[11px] text-gray-600 dark:text-slate-300 mt-2 leading-relaxed">{result}</div>}
    </div>
  );
}


/**
 * "Modules this clinic uses" — the whole picture on one screen.
 *
 * A module can be missing for four different reasons (not in the plan, switched
 * off for the clinic, not part of this computer's layout, or narrowed by this
 * PC's station role) and each has a different fix. Owners were left guessing
 * which one applied. This lists every module with its state and the actual
 * reason, so "why can't I see Pharmacy?" is answered in one glance.
 */
function ModulesInUsePanel() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { data: license } = useQuery({ queryKey: ['license'], queryFn: () => window.electronAPI.license.status(), staleTime: 60_000 });

  const overrides = parseRoleAccess((settings as any)?.role_access_json);
  const currentMode = ((settings as any)?.app_mode || 'reception_pharmacy_doctor') as AppMode;

  const REASON_TEXT: Record<string, { label: string; tone: string; fix: string }> = {
    ok:         { label: 'In use',        tone: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200', fix: '' },
    licence:    { label: 'Not in plan',   tone: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200',    fix: 'Paid add-on — add it to your subscription to switch it on.' },
    module_off: { label: 'Switched off',  tone: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',        fix: 'You turned this off for the clinic. Turn it back on in its settings section.' },
    app_mode:   { label: 'Not in layout', tone: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',                fix: 'Your app mode does not include this module.' },
    station:    { label: 'Hidden here',   tone: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',                fix: 'This computer is set to a specific job, so this module is hidden on THIS PC only.' },
    owner_only: { label: 'Owner only',    tone: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300',             fix: '' },
    role:       { label: 'Role limited',  tone: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300',             fix: '' },
    no_user:    { label: 'Signed out',    tone: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300',             fix: '' },
  };

  // Evaluated as the OWNER, so this reports the clinic's configuration rather
  // than whatever the person reading it happens to be allowed to open.
  const rows = ACCESS_MODULES.map((m) => {
    const st = moduleState(m.path, {
      user: { role: 'admin', id: 1 },
      adminUnlocked: true,
      licensedModules: license?.modules,
      settings,
      overrides,
      defaults: m.defaults,
      inCurrentMode: MODE_ROUTES[m.path] ? MODE_ROUTES[m.path]!.has(currentMode) : true,
    });
    return { ...m, state: st };
  });
  const live = rows.filter((r) => r.state.allowed).length;

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-1.5">
        Modules this clinic uses
        <HelpTip title="Modules this clinic uses">
          <p>Every module in CureDesk and whether this clinic can use it right now.</p>
          <p>A module can be unavailable for different reasons — not in your subscription, switched off by you, or hidden on this particular computer. This names which one applies, so you know what to change.</p>
        </HelpTip>
      </h3>
      <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-3">
        <b>{live}</b> of {rows.length} available to this clinic. Shown as the owner sees them — an individual staff
        member may see fewer, depending on their role.
      </p>
      <div className="grid sm:grid-cols-2 gap-1.5">
        {rows.map((r) => {
          const info = REASON_TEXT[r.state.reason] || REASON_TEXT.ok;
          return (
            <div key={r.path}
              className={cn('rounded-lg border p-2.5 flex items-start gap-2',
                r.state.allowed ? 'border-gray-200 dark:border-slate-700' : 'border-dashed border-gray-300 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-900/40')}>
              <span className={cn('shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded', info.tone)}>{info.label}</span>
              <div className="min-w-0">
                <div className={cn('text-[12.5px] font-semibold', r.state.allowed ? 'text-gray-900 dark:text-slate-100' : 'text-gray-500 dark:text-slate-400')}>
                  {r.label}
                </div>
                {!r.state.allowed && info.fix && (
                  <div className="text-[11px] text-gray-500 dark:text-slate-400 leading-relaxed mt-0.5">{info.fix}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * "Preview as role" — what a staff account will actually be able to open.
 *
 * Handing someone an account was previously an act of faith: you picked a role,
 * saved, and found out what it could reach when that person told you. This runs
 * the SAME evaluator the sidebar and URL guard use, so what it shows is exactly
 * what they will get — including modules blocked by licence or by this
 * computer's station role, which role settings alone would not reveal.
 */
function PreviewAsRolePanel() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { data: license } = useQuery({ queryKey: ['license'], queryFn: () => window.electronAPI.license.status(), staleTime: 60_000 });
  const [role, setRole] = useState<Role>('receptionist');

  const overrides = parseRoleAccess((settings as any)?.role_access_json);
  const currentMode = ((settings as any)?.app_mode || 'reception_pharmacy_doctor') as AppMode;

  const rows = ACCESS_MODULES.map((m) => {
    const st = moduleState(m.path, {
      user: { role, id: 2 },
      adminUnlocked: false,
      licensedModules: license?.modules,
      settings,
      overrides,
      defaults: m.defaults,
      inCurrentMode: MODE_ROUTES[m.path] ? MODE_ROUTES[m.path]!.has(currentMode) : true,
    });
    return { ...m, allowed: st.allowed, reason: st.reason };
  });
  const can = rows.filter((r) => r.allowed);
  const cannot = rows.filter((r) => !r.allowed);

  return (
    <div className="mt-6 pt-5 border-t border-gray-200 dark:border-slate-700">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-1.5">
        Preview as role
        <HelpTip title="Preview as role">
          <p>Pick a role to see exactly which screens someone with that role will be able to open on this computer.</p>
          <p>Check this before you hand out an account — it saves creating a login, signing in as them, and discovering something is missing.</p>
        </HelpTip>
      </h3>
      <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-2">
        Exactly what a staff member with this role will see when they sign in <b>on this computer</b>.
      </p>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {ASSIGNABLE_ROLES.map((r) => (
          <button key={r.role} onClick={() => setRole(r.role)}
            className={cn('px-2.5 py-1 rounded-full text-[11.5px] font-semibold border transition',
              role === r.role
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white dark:bg-slate-800 border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 hover:border-blue-400')}>
            {r.label}
          </button>
        ))}
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/20 p-3">
          <div className="text-[11px] font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-200 mb-1.5">Can open ({can.length})</div>
          {can.length === 0
            ? <div className="text-[11.5px] text-emerald-900/70 dark:text-emerald-100/70">Nothing — this role cannot open any module here.</div>
            : <div className="flex flex-wrap gap-1">
                {can.map((r) => <span key={r.path} className="text-[11px] bg-white dark:bg-slate-800 rounded px-1.5 py-0.5 text-emerald-900 dark:text-emerald-100">{r.label}</span>)}
              </div>}
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-3">
          <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1.5">Cannot open ({cannot.length})</div>
          {cannot.length === 0
            ? <div className="text-[11.5px] text-gray-500">Nothing is hidden from this role.</div>
            : <div className="flex flex-wrap gap-1">
                {cannot.map((r) => (
                  <span key={r.path} title={`Reason: ${r.reason}`}
                    className="text-[11px] bg-gray-100 dark:bg-slate-800 rounded px-1.5 py-0.5 text-gray-500 dark:text-slate-400">{r.label}</span>
                ))}
              </div>}
        </div>
      </div>
      <p className="text-[10.5px] text-gray-400 mt-2">
        Settings and Users &amp; Access are always owner-only and are never part of a staff role.
      </p>
    </div>
  );
}

/**
 * Bringing an existing clinic's patient list in.
 *
 * A clinic switching from paper or another system has years of patients, and
 * "start typing them again" is the reason software gets abandoned in week one.
 * This gives them the exact column layout to prepare and points at the import.
 */
function MigrationPanel() {
  const toast = useToast();

  const downloadTemplate = () => {
    const header = 'first_name,last_name,phone,gender,dob,place,district,blood_group,notes';
    const example = [
      'Ramesh,Kulkarni,9812345678,M,1980-05-14,Mulgund,Gadag,B+,Long-standing hypertension',
      'Sunita,Patil,9845012345,F,1992-11-02,Gadag,Gadag,O+,',
    ];
    const blob = new Blob([[header, ...example].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'curedesk-patient-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast('Template downloaded — fill it in, keeping the first row exactly as it is', 'success');
  };

  return (
    <div className="mt-6 pt-5 border-t border-gray-200 dark:border-slate-700">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-1.5">
        Moving your existing patients in
        <HelpTip title="Moving your existing patients in">
          <p>If you are switching from paper registers or other software, you do not have to retype your patient list.</p>
          <p>Download the template, fill in one patient per row, and send it to us — we load it for you and check it before it goes anywhere near your live data.</p>
        </HelpTip>
      </h3>
      <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-3 leading-relaxed max-w-2xl">
        Coming from paper registers or other software? You don&rsquo;t have to retype anything. Prepare your patient
        list in the template below — one patient per row — and we&rsquo;ll import it for you.
        <b> UHIDs are generated by CureDesk</b>, so leave numbering to us; everything else carries across.
      </p>
      <div className="flex flex-wrap gap-2 items-center">
        <button className="btn-secondary text-xs" onClick={downloadTemplate}>
          <Download className="w-3.5 h-3.5" /> Download CSV template
        </button>
        <span className="text-[11px] text-gray-500 dark:text-slate-400">
          {/* Compile-time gate (not a runtime check) so the real email literal is
              dead-code-eliminated from the public demo bundle, not just hidden. */}
          {(typeof __IS_DEMO__ !== 'undefined' && __IS_DEMO__)
            ? <>Then send it to your CureDesk support contact.</>
            : <>Then email it to <b>mulgundsunil@gmail.com</b> — or send it over WhatsApp.</>}
        </span>
      </div>
      <div className="mt-3 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50/60 dark:bg-blue-900/20 p-3 text-[11.5px] text-blue-900 dark:text-blue-100 leading-relaxed">
        <b>Before you import into a live clinic:</b> take a backup first (the Backup button in the sidebar). An import
        adds records; a backup is what lets you undo it if the file turns out to have a problem.
      </div>
    </div>
  );
}

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
  { key: 'peds', name: 'Pediatrics', desc: 'Growth charts, vaccines — free for paediatricians', base: true },
  { key: 'analytics', name: 'Analytics & Reports', desc: 'Revenue, module P&L, insights', base: true },
  // Paid add-ons — licence-gated.
  { key: 'lab', name: 'Laboratory', desc: 'Test orders, results, 170+ catalog' },
  { key: 'pharmacy', name: 'Pharmacy', desc: 'Dispensing, FEFO inventory, sales' },
  { key: 'ipd', name: 'In-Patient (IPD)', desc: 'Admissions, wards, discharge, TPA' },
  { key: 'whatsapp', name: 'WhatsApp Basic', desc: 'One-click send with name-filled templates' },
  { key: 'whatsapp_pro', name: 'WhatsApp Pro', desc: 'AiSensy (WhatsApp Business API) — auto-reminders, 2-way inbox, campaigns' },
];

const SUB_BASE_PRICE = 8999;
const SUB_ADDON_PRICES: Record<string, { name: string; price: number; note?: string; group?: string }> = {
  lab: { name: 'Laboratory', price: 999 },
  pharmacy: { name: 'Pharmacy', price: 1999 },
  ipd: { name: 'In-Patient (IPD)', price: 4999 },
  whatsapp: { name: 'WhatsApp Basic', price: 999, note: 'click-to-send', group: 'wa' },
  whatsapp_pro: { name: 'WhatsApp Pro', price: 1999, note: 'AiSensy', group: 'wa' },
};
/** The names a clinic knows a set of modules by — WhatsApp Pro already carries Basic, so only the higher one is named. */
const addonNames = (mods: string[]) => (mods.includes('whatsapp_pro') ? mods.filter((m) => m !== 'whatsapp') : mods).map((k) => SUB_ADDON_PRICES[k]?.name || k).join(' + ');

function SubscriptionTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<'online' | 'paste' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

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
  // Module codes: each module bought on its own has its own code and its own end date (the main licence's date is the one above).
  const addons = lic.addons || [];
  type AddonRow = (typeof addons)[number];
  const mainModules: string[] = lic.payload?.modules || [];
  const addonFor = (k: string): AddonRow | undefined => mainModules.includes(k) ? undefined
    : addons.filter((a) => a.modules.includes(k)).sort((a, b) => Date.parse(b.expires_at) - Date.parse(a.expires_at))[0];
  const addonText = (a: AddonRow) => {
    const d = format(parseISO(a.expires_at), 'd MMM yyyy');
    return a.state === 'valid' ? (a.daysLeft <= 30 ? `valid until ${d} — ${a.daysLeft} day${a.daysLeft === 1 ? '' : 's'} left` : `valid until ${d}`)
      : a.state === 'grace' ? `expired ${d} — ${a.graceDaysLeft} grace day${a.graceDaysLeft === 1 ? '' : 's'} left`
      : `expired on ${d} — switched off`;
  };
  const addonTone = (a: AddonRow) => a.state === 'expired' ? 'text-red-600 dark:text-red-400'
    : a.state === 'grace' || a.daysLeft <= 30 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400';
  const isActive = (k: string, base?: boolean) => isDev || base || modules.includes(k);
  // Live "new annual total" = base + owned/picked add-ons. WhatsApp Basic & Pro
  // are one mutually-exclusive line — count only the higher tier, never both.
  const want = (k: string) => modules.includes(k) || picked.has(k);
  const waPrice = want('whatsapp_pro') ? 1999 : want('whatsapp') ? 999 : 0;
  const newTotal = SUB_BASE_PRICE + waPrice
    + (['lab', 'pharmacy', 'ipd'] as const).filter((k) => want(k)).reduce((s, k) => s + SUB_ADDON_PRICES[k].price, 0);

  const planTone =
    lic.state === 'locked' ? { bg: 'bg-red-50 dark:bg-red-900/20', text: 'text-red-700 dark:text-red-300', label: 'Expired — read-only' }
    : lic.state === 'grace' ? { bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-700 dark:text-amber-300', label: `Expired — ${lic.graceDaysLeft} grace day(s) left` }
    : isDev ? { bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-600 dark:text-slate-300', label: 'Development build — not enforced' }
    : { bg: 'bg-emerald-50 dark:bg-emerald-900/20', text: 'text-emerald-700 dark:text-emerald-300', label: lic.daysLeft != null ? `Active — ${lic.daysLeft} day(s) left` : 'Active' };

  const copyId = async () => { if (await copyText(machineId)) { setCopied(true); setTimeout(() => setCopied(false), 1500); } };

  // The ticks in the upgrade box are only a PRICE ESTIMATE — they are forgotten whenever the box closes, so nothing ticked earlier can
  // look "selected" for a later upgrade. What actually unlocks is exactly what is written inside the code that is applied.
  const closeUpgrade = () => { setOpen(false); setPicked(new Set()); setErr(null); };
  const nameOf = (k: string) => SUB_ADDON_PRICES[k]?.name || k;

  const done = async (r: any, again?: (opts: { confirmRemoval: boolean }) => Promise<any>) => {
    if (r?.ok) {
      const now: string[] = r.status?.modules || [];
      const unlocked = now.filter((k) => SUB_ADDON_PRICES[k] && !modules.includes(k));
      const askedNotIncluded = [...picked].filter((k) => !now.includes(k));
      qc.invalidateQueries({ queryKey: ['license'] });
      qc.invalidateQueries({ queryKey: ['settings'] });
      if (r.addon) {
        // a module code ADDS to the plan (nothing else changes) and has its own end date
        const until = format(parseISO(r.addon.expires_at), 'd MMM yyyy');
        toast(unlocked.length ? `Unlocked: ${addonNames(unlocked)} — valid until ${until}` : `${addonNames(r.addon.modules)} renewed — valid until ${until}`, 'success');
      } else {
        toast(unlocked.length ? `Unlocked: ${addonNames(unlocked)}` : 'Licence updated — no new modules in this code', 'success');
      }
      if (askedNotIncluded.length) {
        toast(`You ticked ${askedNotIncluded.map(nameOf).join(', ')}, but this code does not include ${askedNotIncluded.length > 1 ? 'them' : 'it'} — a code unlocks only what is written inside it. Ask us for a code that includes ${askedNotIncluded.length > 1 ? 'them' : 'it'}.`, 'info');
      }
      closeUpgrade(); setCode(''); setToken('');
    } else if (r?.needsConfirm && again) {
      // The new code would switch OFF a paid module this computer has today — never silently.
      if (window.confirm(`${r.error}\n\nApply this code anyway?`)) await done(await again({ confirmRemoval: true }));
      else setErr('Not applied — your current modules are unchanged.');
    } else {
      setErr(r?.error || 'Activation failed.');
    }
  };
  const applyOnline = async () => {
    setErr(null); if (!code.trim()) { setErr('Enter the activation code you were given.'); return; }
    setBusy('online');
    try { const go = (o?: { confirmRemoval: boolean }) => window.electronAPI.license.activateOnline(code.trim(), o); await done(await go(), go); }
    catch (e: any) { setErr(e?.message || 'Activation failed.'); }
    finally { setBusy(null); }
  };
  const applyPaste = async () => {
    setErr(null); if (!token.trim()) { setErr('Paste the code you were sent.'); return; }
    setBusy('paste');
    try { const go = (o?: { confirmRemoval: boolean }) => window.electronAPI.license.activate(token.trim(), o); await done(await go(), go); }
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
          {addons.length > 0 && (
            <div className="rounded-lg border border-gray-200 dark:border-slate-700 divide-y divide-gray-100 dark:divide-slate-700 text-[12px]">
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Module codes — each module has its own end date</div>
              {addons.map((a) => (
                <div key={a.license_id} className="px-3 py-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5">
                  <b className="text-gray-900 dark:text-slate-100">{addonNames(a.modules)}</b>
                  <span className={cn('font-medium', addonTone(a))}>{addonText(a)}</span>
                </div>
              ))}
            </div>
          )}
          {!isDev && (
            <button className="btn-primary" onClick={() => { setErr(null); setPicked(new Set()); setOpen(true); }}>
              <KeyRound className="w-4 h-4" /> Enter upgrade / renewal / module code
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
                  {!m.base && !isDev && (() => { const a = addonFor(m.key); return a ? <div className={cn('text-[11px] font-medium mt-0.5', addonTone(a))}>Module code · {addonText(a)}</div> : null; })()}
                  {!on && <button onClick={() => { setErr(null); setPicked(new Set([m.key])); setOpen(true); }} className="text-[11px] font-semibold text-blue-600 hover:underline mt-1">{addonFor(m.key) ? 'Renew this module →' : 'Upgrade to activate →'}</button>}
                </div>
              </div>
            );
          })}
        </div>
      </SettingsGroup>

      <SettingsGroup title="Need to upgrade or renew?" subtitle="Adding a module or extending your licence takes under a minute — no reinstall, no data loss.">
        <div className="card p-5 text-[13px] text-gray-700 dark:text-slate-200 space-y-2">
          <p>Call or message us and tell us which modules you want (or that you’re renewing). We’ll generate an activation code tied to <b>this computer’s Machine ID</b> and send it over. Enter it above, and the new modules unlock instantly — your patients, bills and records stay exactly as they are.</p>
          <p className="text-[12px] text-gray-500 dark:text-slate-400">Adding one module (Laboratory, Pharmacy, IPD or WhatsApp) gives you a separate <b>module code</b> with its own end date. Enter it the same way — it adds to your plan and changes nothing else, and you can renew each module on its own.</p>
          <div className="flex flex-wrap gap-4 pt-1 font-semibold">
            {c.phone && <span>📞 {c.phone}</span>}
            {c.email && <span>✉ {c.email}</span>}
          </div>
        </div>
      </SettingsGroup>

      <Modal open={open} onClose={() => busy === null && closeUpgrade()} title="Upgrade / renew subscription" size="md">
        <div className="space-y-4">
          <p className="text-[13px] text-gray-600 dark:text-slate-300">Pick the modules you want to see the price, share the Machine ID below when you call, then enter the code we send you (a licence code, or a module code for one module).</p>

          {/* Priced module picker + live "new total" — mirrors the website. */}
          <div>
            <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-900/10 px-3 py-2 mb-1.5 flex items-center justify-between text-[13px]">
              <span className="text-gray-700 dark:text-slate-200">Included plan <span className="text-gray-400">· OPD · Pediatrics (free) · Analytics · Billing</span></span>
              <span className="font-bold text-indigo-700 dark:text-indigo-300">₹{SUB_BASE_PRICE.toLocaleString('en-IN')}</span>
            </div>
            <div className="space-y-1.5">
              {Object.entries(SUB_ADDON_PRICES).map(([key, a]) => {
                const have = modules.includes(key);
                const viaCode = have ? addonFor(key) : undefined;
                const on = have || picked.has(key);
                return (
                  <label key={key} className={cn('flex items-center justify-between rounded-lg border p-2.5 text-[13px]', have ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-900/10' : 'border-gray-200 dark:border-slate-700 cursor-pointer hover:border-indigo-300')}>
                    <span className="flex items-center gap-2">
                      <input type="checkbox" checked={on} disabled={have}
                        onChange={(e) => setPicked((p) => {
                          const n = new Set(p);
                          if (e.target.checked) {
                            n.add(key);
                            const g = SUB_ADDON_PRICES[key].group; // WhatsApp Basic/Pro are one-or-the-other
                            if (g) Object.keys(SUB_ADDON_PRICES).forEach((k2) => { if (k2 !== key && SUB_ADDON_PRICES[k2].group === g) n.delete(k2); });
                          } else n.delete(key);
                          return n;
                        })} />
                      <span className="font-medium text-gray-900 dark:text-slate-100">{a.name}</span>
                      {a.note && <span className="text-[10px] text-gray-400">{a.note}</span>}
                    </span>
                    <span className={cn('font-semibold', have ? 'text-emerald-600' : 'text-indigo-700 dark:text-indigo-300')}>{have ? (viaCode ? `✓ Included · ${addonText(viaCode)}` : '✓ Included') : `+₹${a.price.toLocaleString('en-IN')}`}</span>
                  </label>
                );
              })}
            </div>
            <div className="flex justify-between items-center mt-2 rounded-lg bg-slate-900 text-white px-3 py-2">
              <span className="text-[12px]">New annual total</span>
              <span className="text-[15px] font-extrabold">₹{newTotal.toLocaleString('en-IN')} <span className="text-[10px] font-semibold opacity-70">/ yr</span></span>
            </div>
            <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-1.5">Prices are per year. <b>This list is only a price estimate — ticking a module here never unlocks it.</b> A code unlocks exactly the modules written inside it, nothing more.</p>
          </div>

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
            <label className="label">{lic.onlineAvailable ? 'Or paste a licence or module code' : 'Licence or module code'}</label>
            <textarea className="input font-mono text-[11px] leading-tight" rows={3} value={token} placeholder="Paste the whole code exactly as we sent it — nothing added, nothing missing…" onChange={(e) => setToken(e.target.value)} />
            <button className="btn-primary w-full justify-center mt-2" disabled={busy !== null || !token.trim()} onClick={applyPaste}>
              {busy === 'paste' ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} Apply code
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
// Billing & GST, Pharmacy, Laboratory & Radiology, In-Patient — one tab each (they were all inside "Billing & IPD")
// =====================================================================
function SettingsLoading() {
  return <div className="card p-8 text-center text-sm text-gray-500"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>;
}

/** The clinic's own billing: GST registration, invoice numbers, round-off, the price list, staff discount limits. */
function BillingTab() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { draft, set, reset, dirty, saving, save } = useSectionDraft(settings, BILLING_KEYS);
  if (!settings) return <SettingsLoading />;
  return (
    <div className="space-y-5">
      <SectionSaveBar note={<>Changes here apply across the clinic. The charge list saves on its own; the switches and boxes need <b>Save</b>.</>}
        dirty={dirty} saving={saving} onReset={reset} onSave={save} />
      <BillingSettings draft={draft} set={set as any} />
    </div>
  );
}

/** Everything about the pharmacy, in one place. Unlocked only while the subscription includes Pharmacy. */
function PharmacyTab({ goTo }: { goTo: (t: SettingsTab) => void }) {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { draft, set, reset, dirty, saving, save } = useSectionDraft(settings, PHARMACY_KEYS);
  const { has } = useLicensedModules();
  if (!settings) return <SettingsLoading />;
  return (
    <div className="space-y-5">
      <SectionSaveBar note={<>Every pharmacy setting is on this page. The switches and boxes need <b>Save</b>.</>} dirty={dirty} saving={saving} onReset={reset} onSave={save} />
      <PharmacyGstCard draft={draft} set={set as any} saved={settings} goBilling={() => goTo('billing')} />
      <PharmacyDiscountLimits draft={draft} set={set as any} />
      <PharmacyCredit draft={draft} set={set as any} hasIpd={has('ipd')} />
    </div>
  );
}

/** Computers & staff: how many computers, who signs in, what each person (or the shared Reception desk) may open, and how the computers connect. */
function ComputersTab() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { data: netStatus } = useQuery({ queryKey: ['network-status'], queryFn: () => window.electronAPI.network.status(), staleTime: 15_000 });
  const { draft, set, reset, dirty, saving, save } = useSectionDraft(settings, COMPUTERS_KEYS, { extraInvalidateKeys: [['setup-status'], ['network-status']] });
  const reception = useReceptionAccess();
  const [previewGuide, setPreviewGuide] = useState(false);
  if (!settings) return <SettingsLoading />;

  const isClient = netStatus?.mode === 'client';
  const here = thisComputer(settings);
  const savedMode = computersMode(settings);
  const mode: ComputersMode = draft.computers_mode === 'single' || draft.computers_mode === 'multi' ? draft.computers_mode : savedMode;
  const signIn = !!draft.require_login;

  const pick = (m: ComputersMode) => {
    if (m === mode) return;
    if (m === 'single' && here === 'main') {
      toast('This computer is the main computer of a network. To go back to one computer, first switch it to stand-alone under “Connecting the computers” below — the other computers will stop working.', 'error');
      return;
    }
    set('computers_mode', m as any);
    if (m === 'multi') set('require_login', true as any);                       // more than one computer = everyone signs in with their own login
    if (m === 'single' && savedMode === 'multi') set('require_login', false as any);   // back to one computer: nobody has to sign in
  };
  const onSave = () => {
    const loginChanged = signIn !== !!settings.require_login;
    if (loginChanged && signIn && !window.confirm('Turn on sign-in?\n\nEveryone will need their own username and password from now on. Make sure you know the Admin login (username: admin) before continuing.')) return;
    try { localStorage.setItem('caredesk-require-login', signIn ? '1' : '0'); } catch { /* the setting itself is what counts */ }
    save();
    if (loginChanged) setTimeout(() => window.location.reload(), 500);          // sign-in changes the app's entry gate
  };
  const showNetwork = mode === 'multi' || here !== 'alone';

  return (
    <div className="space-y-5">
      <SectionSaveBar note={<>These are the same questions asked when the clinic was first set up — change them whenever the clinic changes.</>} dirty={dirty} saving={saving} onReset={reset} onSave={onSave} />

      <SettingsGroup title="How many computers?" subtitle="This one answer decides how sign-in, access and the network work.">
        <div className="card p-5 space-y-3">
          <ModeChoice value={mode} onChange={pick} disabled={isClient}
            disabledWhy={isClient ? 'This is an extra computer — how many computers the clinic uses is decided on the main computer.' : undefined} />
          <div className="text-[12px] text-gray-600 dark:text-slate-300">
            <b>This computer is:</b> {here === 'alone' ? 'the only computer' : here === 'main' ? 'the main computer (the others connect to it)' : 'an extra computer, connected to the main computer'}.
          </div>
        </div>
      </SettingsGroup>

      {!isClient && (
        <SettingsGroup title="Sign-in" subtitle="Whether people sign in with their own login.">
          <div className="card p-5 space-y-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" className="mt-1" checked={signIn} disabled={mode === 'multi' && !!settings.require_login} onChange={(e) => set('require_login', e.target.checked as any)} />
              <div>
                <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100">Everyone signs in with their own login{mode === 'multi' ? ' — required with more than one computer' : ''}</div>
                <Explain>
                  Each person has a username, a password and a role. They see only what their role allows, and every bill and sale records who made it. The Admin login can sign in on any computer.
                  {mode === 'single' && !signIn ? ' With one computer this is not needed: the computer opens as Reception and the admin password locks the admin screens.' : ''}
                </Explain>
              </div>
            </label>
            {signIn && (
              <div className="pl-7 border-l-2 border-blue-200 dark:border-blue-900">
                <label className="label">Sign out automatically after idle (minutes)</label>
                <input type="number" min={0} max={240} className="input max-w-[140px]" value={draft.session_timeout_minutes ?? 0}
                  onChange={(e) => set('session_timeout_minutes', Math.max(0, Number(e.target.value) || 0) as any)} />
                <Explain>0 = never. Useful on a shared reception computer.</Explain>
              </div>
            )}
            {signIn && !settings.require_login && (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-[11px] text-amber-800 dark:text-amber-200">
                Before saving, make sure every person has a login under <b>Users &amp; Access</b>. You can always sign in as <b>admin</b> to add or fix logins.
              </div>
            )}
            <div><button className="btn-secondary text-xs" onClick={() => navigate('/users')}>Open Users &amp; Access (staff logins, admin password)</button></div>
          </div>
        </SettingsGroup>
      )}

      {!isClient && mode === 'single' && !signIn && (
        <SettingsGroup title="What can Reception do?" subtitle="This computer opens as Reception. Switch off any screen Reception should not open — each switch saves at once.">
          <div className="card p-5 space-y-4">
            <ReceptionAccessList roleAccessJson={reception.json} onToggle={reception.toggle} disabled={!reception.ready} />
            <div className="border-t border-gray-100 dark:border-slate-800 pt-3">
              <SharedDeskDiscountBox value={draft.shared_desk_discount_pct} onChange={(v) => set('shared_desk_discount_pct', v as any)} />
              <Explain>Needs <b>Save</b>. Discounts on bills follow Billing &amp; GST → Discounts.</Explain>
            </div>
          </div>
        </SettingsGroup>
      )}

      {!isClient && (signIn || mode === 'multi') && (
        <SettingsGroup title="Who can open what" subtitle="Which module each staff role can open — applies on every connected computer. The admin always sees everything.">
          <RoleAccessEditor />
        </SettingsGroup>
      )}

      {!showNetwork && (
        <SettingsGroup title="Adding more computers later?" subtitle="Cable, Wi-Fi, the Windows settings, what to buy — the step-by-step guide is here whenever you need it.">
          <div className="card p-5 space-y-3">
            <div className="text-[12.5px] text-gray-700 dark:text-slate-300">
              When the clinic gets a second computer, choose <b>“More than one computer”</b> above — the guide then sits in this tab. You can read it now without changing anything.
            </div>
            <button type="button" className="btn-secondary text-xs" onClick={() => setPreviewGuide((v) => !v)}>{previewGuide ? 'Hide the guide' : 'Show the step-by-step guide'}</button>
            {previewGuide && <ConnectGuide />}
          </div>
        </SettingsGroup>
      )}

      {showNetwork && (
        <>
          <SettingsGroup title="Connect the computers — step by step" subtitle="Cable, Wi-Fi or one cable between two computers · the Windows settings on every computer · what to buy · a check that tells you what to fix.">
            <div className="card p-5"><ConnectGuide showHeader /></div>
          </SettingsGroup>
          <SettingsGroup title="This Computer's Job" subtitle="What this one computer is for — it changes this computer's menu only (for example a pharmacy counter that shows just the pharmacy).">
            <div className="card p-5"><ThisComputerPanel /></div>
          </SettingsGroup>
          <SettingsGroup title="Connecting the Computers" subtitle="Which computers are connected right now, which one is the main computer, and the join code for a new one.">
            <NetworkDiagram />
            <RelaunchWizardButton />
            <NetworkModeSettings />
          </SettingsGroup>
          <SettingsGroup title="Multi-Station Setup Guide" subtitle="How the computers work together day to day — staff accounts, backups, what happens when the main computer is off, renaming, and fixing problems.">
            <NetworkSetupGuide />
          </SettingsGroup>
        </>
      )}
    </div>
  );
}

/** WhatsApp: the wording of the one-click messages, the Google review link, the country code for patients' numbers, and the Pro automation status. */
function WhatsAppTab() {
  const navigate = useNavigate();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  useWhatsAppTemplates();                                   // also carries an old per-computer copy of the wording into the saved setting, once
  const { draft, set, reset, dirty, saving, save } = useSectionDraft(settings, WHATSAPP_KEYS);
  const { has } = useLicensedModules();
  const saved = settings?.whatsapp_templates_json ?? '';
  // What is typed in the boxes. Kept apart from the saved text so a box can be emptied while retyping (an empty message means "the built-in wording").
  const [texts, setTexts] = useState<Record<string, string>>(() => resolveWaTemplates(saved));
  const [focusKey, setFocusKey] = useState<string | null>(null);
  useEffect(() => { setTexts(resolveWaTemplates(saved)); }, [saved]);        // after a save, or when the saved wording arrives
  if (!settings) return <SettingsLoading />;

  const change = (key: string, text: string) => {
    const next = { ...texts, [key]: text };
    setTexts(next);
    set('whatsapp_templates_json', serializeWaTemplates(next) as any);
  };
  const resetAll = () => { reset(); setTexts(resolveWaTemplates(saved)); };
  // A preview with sample values (and this clinic's own name, phone and address), so the wording can be judged as the patient will read it.
  const sample: Record<string, string> = Object.fromEntries(WHATSAPP_PLACEHOLDERS.map((p) => [p.token.slice(2, -2), p.sample]));
  const ctx = { ...sample, clinic_name: settings.clinic_name || sample.clinic_name, clinic_phone: settings.clinic_phone || sample.clinic_phone, clinic_address: settings.clinic_address || sample.clinic_address,
    review_link: (draft.google_review_url || '').trim() || 'https://g.page/r/your-review-link' };
  const connectedOn = String((settings as any).aisensy_connected_on || '').trim();

  return (
    <div className="space-y-5">
      <SectionSaveBar note={<>The wording, the review link and the country code need <b>Save</b>.</>} dirty={dirty} saving={saving} onReset={resetAll} onSave={save} />

      <div className="card p-5 space-y-4">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">What each message says</div>
          <Explain>
            The seven one-click messages on the Communication page. CureDesk opens WhatsApp with the message already typed and you press Send. <b>Variables you can use:</b>{' '}
            <span className="font-mono">{WA_VARIABLES}</span> — and <span className="font-mono">{'{{review_link}}'}</span> (the Google review link below). Emoji are removed from every
            message automatically, so strange characters can never appear — write plain text. A message you leave as it is follows any improvement made to the built-in wording later.
          </Explain>
        </div>
        {WA_TEMPLATE_TYPES.map((t) => (
          <div key={t.key}>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-gray-700 dark:text-slate-200">{t.icon} {t.label}</label>
              <button type="button" className="text-[10px] text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400 font-medium"
                onClick={() => change(t.key, DEFAULT_WA_TEMPLATES[t.key])}>Reset to the built-in wording</button>
            </div>
            <textarea className="input w-full text-xs font-mono leading-relaxed" rows={5} value={texts[t.key] ?? ''}
              onFocus={() => setFocusKey(t.key)} onChange={(e) => change(t.key, e.target.value)} />
            {focusKey === t.key && (
              <div className="mt-1.5 rounded-lg px-3 py-2 text-[12px] whitespace-pre-wrap text-gray-800 dark:text-slate-100 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                <div className="text-[9px] uppercase tracking-widest font-bold text-emerald-700 dark:text-emerald-300 mb-1">How it reads (sample patient)</div>
                {renderTemplate(texts[t.key] || DEFAULT_WA_TEMPLATES[t.key], ctx as any)}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="card p-5 space-y-3">
        <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Google review link</div>
        <input className="input w-full" placeholder="https://g.page/r/…/review" value={draft.google_review_url ?? ''} onChange={(e) => set('google_review_url', e.target.value)} />
        <Explain>Used by the Google Review message (and the Pro automatic review request). Open your clinic on Google Maps → Share → the review link.</Explain>
      </div>

      <div className="card p-5 space-y-3">
        <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Phone numbers</div>
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-gray-700 dark:text-slate-200">Country code</span>
          <span className="text-gray-500">+</span>
          <input className="input w-20 font-mono" inputMode="numeric" maxLength={4} value={draft.whatsapp_country_code ?? '91'}
            onChange={(e) => set('whatsapp_country_code', e.target.value.replace(/\D/g, ''))} />
        </div>
        <Explain>Put in front of a patient&rsquo;s 10-digit number when the message is opened in WhatsApp. 91 for India — change it only if your patients&rsquo; numbers are from another country.</Explain>
      </div>

      <div className="card p-5 space-y-2">
        <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-1.5">WhatsApp Pro — automatic messages</div>
        {has('whatsapp_pro') ? (
          <>
            <div className="text-[13px] text-gray-800 dark:text-slate-200">
              {connectedOn ? <>Connected on <b>{connectedOn}</b>. Reminders, the inbox and campaigns run through AiSensy.</> : <>Not connected yet. The Communication page walks you through signing up with AiSensy and sending your contacts and templates across.</>}
            </div>
            <button className="btn-secondary text-xs" onClick={() => navigate('/whatsapp')}>Open the Communication page</button>
          </>
        ) : (
          <Explain>Automatic reminders, a two-way inbox and campaigns are the <b>WhatsApp Pro</b> upgrade. Add it under Subscription &amp; Modules whenever you want it.</Explain>
        )}
      </div>
    </div>
  );
}

/** The lab and the scan desk (radiology rides on the Laboratory module): when a bill is raised, and the two price lists. */
function LabTab() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { draft, set, reset, dirty, saving, save } = useSectionDraft(settings, LAB_KEYS);
  if (!settings) return <SettingsLoading />;
  return (
    <div className="space-y-5">
      <SectionSaveBar note={<>The two switches need <b>Save</b>. The test and scan lists save on their own.</>} dirty={dirty} saving={saving} onReset={reset} onSave={save} />
      {/* Lab auto-billing */}
      <div className="card p-5">
        <AccrualToggle label="Auto-raise a bill when a lab test is ordered"
          help="When a doctor or reception orders lab tests, an unpaid bill is created automatically from the test prices, so lab revenue lands in billing instead of being missed. Reception collects it at the counter. Turn off if you bill lab work another way."
          value={draft.lab_auto_bill ?? true} onChange={(v) => set('lab_auto_bill', v)} />
      </div>

      {/* Radiology auto-billing */}
      <div className="card p-5">
        <AccrualToggle label="Auto-raise a bill when a scan is ordered (Radiology)"
          help="When a doctor or the Radiology desk orders X-Ray, ultrasound, CT or MRI, a bill is created automatically from the scan prices — unpaid if it is to be collected later, or paid on the spot when the desk takes the money while raising the request. Turn off if you bill radiology another way."
          value={draft.radiology_auto_bill ?? true} onChange={(v) => set('radiology_auto_bill', v)} />
      </div>

      <LabSettingsCard />
      <RadiologyCatalogCard />

      <div data-settings-group="What to show"><WhatToShow tab="lab" /></div>
    </div>
  );
}

/** Wards and beds, the daily charges, deposits, numbering, GST on ward bills, insurance, admission requests, the discharge summary. */
function IpdTab({ goTo }: { goTo: (t: SettingsTab) => void }) {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { draft, set, reset, dirty, saving, save } = useSectionDraft(settings, IPD_KEYS);
  if (!settings) return <SettingsLoading />;
  const clinicGst = !!settings.gst_enabled && (settings.gst_registration_type ?? 'unregistered') !== 'composition';   // the clinic's registration is on the Billing & GST tab: read as saved
  return (
    <div className="space-y-5">
      <SectionSaveBar note={<>Wards and beds save on their own; the switches and boxes below need <b>Save</b>.</>} dirty={dirty} saving={saving} onReset={reset} onSave={save} />

      <WardsBedsEditor />

      {/* IPD auto-accrual */}
      <div className="card p-5 space-y-4">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-1.5">IPD Charges &amp; Accrual<HelpTip title="IPD Charges & Accrual"><><p>Which charges post themselves to an admitted patient&rsquo;s running bill, and when.</p><p>Anything posted automatically can still be edited or removed on the bill itself, so these switches set the default rather than locking anything in.</p></></HelpTip></div>
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

      {/* Numbering + GST on ward bills */}
      <div className="card p-5 space-y-4">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Admission numbers &amp; GST on ward bills</div>
        </div>
        <div className="max-w-xs">
          <label className="label">Admission number prefix</label>
          <input className="input" value={draft.ip_number_prefix || 'IP'} onChange={(e) => set('ip_number_prefix', e.target.value)} />
          <Explain>Admissions are numbered like <code>{(draft.ip_number_prefix || 'IP')}/2026-27/0001</code>.</Explain>
        </div>
        {clinicGst ? (
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" className="mt-1" checked={draft.ipd_gst_enabled ?? true} onChange={(e) => set('ipd_gst_enabled', e.target.checked)} />
            <div>
              <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100">Charge GST on in-patient bills</div>
              <Explain>
                On (recommended for a registered clinic): the medicines on an in-patient's bill carry their GST, shown as CGST + SGST inside
                the MRP — the patient pays the MRP, never more. Bed, nursing and doctor charges stay exempt unless you mark that charge taxable
                (Billing &amp; GST → Charge Heads). Off: in-patient bills carry no GST at all. It applies to every bill still open; a bill already closed at discharge keeps what it was.
              </Explain>
            </div>
          </label>
        ) : (
          <Explain>GST on in-patient bills is available once the clinic is GST-registered (a regular registration) — set that under{' '}
            <LinkBtn onClick={() => goTo('billing')}>Billing &amp; GST</LinkBtn>.</Explain>
        )}
      </div>

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

      <div data-settings-group="What to show"><WhatToShow tab="ipd" /></div>
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
      <div className="flex items-center justify-between sticky top-0 z-10 bg-white/90 dark:bg-slate-900/90 backdrop-blur py-2 -my-2 px-1 rounded">
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
  // A test left at zero is carried out but never billed — worth counting out
  // loud, because the standard catalogue ships deliberately unpriced.
  const unpriced = tests.filter((t: any) => t.is_active === 1 && !(t.price > 0)).length;

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
        <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-1.5"><FlaskConical className="w-4 h-4 text-fuchsia-500" /> Laboratory catalogue (pathology tests)</div>
        <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
          The tests your lab offers, with prices — used across OPD/IPD orders, billing and analytics.
          {tests.length > 0 ? <> Currently <b>{tests.length}</b> tests · <b>{active}</b> active.</> : <> No tests loaded yet.</>}
        </div>
        {unpriced > 0 && (
          <div className="mt-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-2.5 text-[11.5px] text-amber-900 dark:text-amber-100 leading-relaxed">
            <b>{unpriced} active test{unpriced === 1 ? '' : 's'} still priced at ₹0.</b> The standard catalogue ships without prices
            because every clinic charges its own rates. A ₹0 test is carried out but never added to the patient&rsquo;s bill —
            set your rates below for the tests you actually offer, and switch the rest off.
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary text-xs" disabled={busy} onClick={loadStd} title="Adds about 160 common Indian pathology tests (skips ones you already have)">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Load standard catalog (~160 tests)
        </button>
        <button className="btn-primary text-xs" onClick={() => navigate('/lab')}>
          <Pencil className="w-3.5 h-3.5" /> Manage tests &amp; prices
        </button>
      </div>
      <div className="text-[11px] text-gray-500 dark:text-slate-400">
        Covers pathology (haematology, biochemistry, serology, microbiology, histopathology…). Scans (X-ray, ultrasound, CT, MRI) have their own catalogue, just below.
        Set prices, enable/disable and add your own tests under <b>Laboratory → Test Catalog</b>.
      </div>
    </div>
  );
}

/** The scan price list (X-ray, ultrasound, CT, MRI) — a summary and the two things done most: load the standard list, open the page to price it. */
function RadiologyCatalogCard() {
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const { data: scans = [] } = useQuery({ queryKey: ['radiology-tests', false], queryFn: () => window.electronAPI.radiology.listTests(false) });
  const active = scans.filter((t: any) => t.is_active === 1).length;
  const unpriced = scans.filter((t: any) => t.is_active === 1 && !(t.price > 0)).length;

  const loadStd = async () => {
    setBusy(true);
    try {
      const r = await window.electronAPI.radiology.loadStandardCatalog();
      if (r.ok) { qc.invalidateQueries({ queryKey: ['radiology-tests'] }); toast(r.added > 0 ? `Added ${r.added} standard scans — set your prices in the catalogue` : 'The standard catalogue is already loaded', 'success'); }
      else toast(r.error || 'Could not load the catalogue', 'error');
    } catch (e: any) { toast(e?.message || 'Failed', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div className="card p-5 space-y-3">
      <div>
        <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-1.5"><ScanLine className="w-4 h-4 text-sky-500" /> Radiology catalogue</div>
        <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
          The scans your desk offers — X-ray, ultrasound, CT, MRI — with prices; used across orders, billing and analytics.
          {scans.length > 0 ? <> Currently <b>{scans.length}</b> scans · <b>{active}</b> active.</> : <> No scans loaded yet.</>}
        </div>
        {unpriced > 0 && (
          <div className="mt-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-2.5 text-[11.5px] text-amber-900 dark:text-amber-100 leading-relaxed">
            <b>{unpriced} active scan{unpriced === 1 ? '' : 's'} still priced at ₹0.</b> A ₹0 scan is carried out but never added to the patient&rsquo;s bill —
            set your rates for the scans you actually offer, and switch the rest off.
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary text-xs" disabled={busy} onClick={loadStd} title="Adds about 55 common X-ray, ultrasound, CT and MRI scans (skips ones you already have)">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Load standard catalogue (~55 scans)
        </button>
        <button className="btn-primary text-xs" onClick={() => navigate('/radiology')}>
          <Pencil className="w-3.5 h-3.5" /> Manage scans &amp; prices
        </button>
      </div>
      <div className="text-[11px] text-gray-500 dark:text-slate-400">Set prices, switch scans on or off and add your own under <b>Radiology → Catalogue &amp; Prices</b>.</div>
    </div>
  );
}

function PatientLanguagePicker() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const { draft, set, reset, dirty, saving, save } = useSectionDraft(settings, ['print_patient_language']);
  if (!settings) return <div className="card p-6 text-center"><Loader2 className="w-4 h-4 animate-spin mx-auto text-gray-400" /></div>;
  return (
    <div className="card p-5 space-y-3">
      <div className="max-w-md">
        <label className="label">Language printed for the patient</label>
        <select className="input" value={draft.print_patient_language ?? 'kn'} onChange={(e) => set('print_patient_language', e.target.value as any)}>
          {PATIENT_LANGS.map((l) => (
            <option key={l.code} value={l.code}>
              {l.en}{l.native !== '—' ? ` — ${l.native}` : ''}{!l.pack ? ' (English only for now)' : l.needsReview ? ' (verify wording)' : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="text-[11px] text-gray-500 dark:text-slate-400 leading-relaxed">
        Only standard timing, frequency, duration and food instructions are translated — e.g. <b>1-0-1</b>, <b>BD</b>, <b>“after food”</b>, <b>“5 days”</b>. Anything the app can’t confidently translate simply prints in English, so a patient never sees a wrong instruction. Languages marked <b>“verify wording”</b> are best-effort — have a native speaker confirm them before you rely on them; ones marked <b>“English only for now”</b> await a local word-list.
      </div>
      <div className="flex items-center gap-2">
        {dirty && <button className="btn-ghost text-xs" onClick={reset}>Reset</button>}
        <button className="btn-primary text-xs" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}</button>
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


