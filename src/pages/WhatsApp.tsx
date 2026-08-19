import { useState, useEffect, useRef } from 'react';
import { PageHelp } from '../components/PageHelp';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare, Plug, PlugZap, RefreshCw, Zap, ListChecks,
  CheckCircle2, XCircle, AlertCircle, Clock, Send, Inbox,
  CheckCheck, User, Megaphone, Plus, Trash2, Play, Eye,
  ChevronDown, Sparkles, Star, BookOpen, ChevronRight, X, BarChart2,
  Smartphone, Cloud, FileText, Calendar, Pill, Receipt, TestTube, RotateCcw, Cake, ThumbsUp, Syringe,
  Copy, Download, ExternalLink, Users,
} from 'lucide-react';
import { cn, fmtDateTime } from '../lib/utils';
import { copyText } from '../lib/clipboard';
import { useToast } from '../hooks/useToast';
import { useLicensedModules } from '../hooks/useLicensedModules';
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

// ── Connect tab ───────────────────────────────────────────────────────────────

// ── Templates tab ─────────────────────────────────────────────────────────────

// ── Automation tab ────────────────────────────────────────────────────────────

// ── Queue tab ─────────────────────────────────────────────────────────────────

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

// ── Inbox tab ─────────────────────────────────────────────────────────────────

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
// Bumped v1 → v2 to ABANDON any saved copy from earlier builds. Those saves
// carried emoji-corrupted text (shown as "�" in WhatsApp) in forms that on-load
// repair could not always catch — including a split surrogate pair, which is not
// the U+FFFD character in the string but still encodes to "�" in the wa.me link.
// A new key means the old broken save is simply never read again; templates
// start from the clean built-ins (and any clean custom text is migrated across).
const M1_TEMPLATES_KEY = 'curedesk_wa_m1_templates_v2';
const M1_TEMPLATES_KEY_OLD = 'curedesk_wa_m1_templates_v1';

/**
 * Is this string safe to send as-is, or does it carry corrupted emoji?
 * Corrupt if it contains the replacement character (U+FFFD, "�") OR any LONE
 * surrogate (half of an emoji's code-unit pair) — the latter is invisible as a
 * character but turns into "�" the moment it is URL-encoded for WhatsApp.
 */
function isEmojiSafe(s: string): boolean {
  if (s.includes('�')) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) {           // high surrogate — must be followed by a low one
      const n = s.charCodeAt(i + 1);
      if (!(n >= 0xDC00 && n <= 0xDFFF)) return false;
      i++;
    } else if (c >= 0xDC00 && c <= 0xDFFF) {    // lone low surrogate
      return false;
    }
  }
  return true;
}
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
  const readClean = (key: string): Record<string, string> => {
    try {
      const saved = localStorage.getItem(key);
      if (!saved) return {};
      const parsed = JSON.parse(saved) as Record<string, unknown>;
      const clean: Record<string, string> = {};
      // Keep only entries that are safe (no "�", no lone surrogate). Corrupted
      // entries are dropped so the clean built-in default takes their place.
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string' && isEmojiSafe(v)) clean[k] = v;
      }
      return clean;
    } catch { return {}; }
  };
  try {
    // Prefer the new key. If it's empty, migrate CLEAN entries out of the old
    // v1 key one time — corrupted v1 entries are left behind and never used.
    const current = localStorage.getItem(M1_TEMPLATES_KEY);
    const clean = current !== null ? readClean(M1_TEMPLATES_KEY) : readClean(M1_TEMPLATES_KEY_OLD);
    const merged = { ...DEFAULT_M1_TEMPLATES, ...clean };
    // Persist under the new key so this evaluation happens once, and remove the
    // old (possibly corrupted) copy so it can never resurface.
    try {
      localStorage.setItem(M1_TEMPLATES_KEY, JSON.stringify(merged));
      localStorage.removeItem(M1_TEMPLATES_KEY_OLD);
    } catch { /* ignore */ }
    return merged;
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
    let tpl = templates[typeKey] ?? DEFAULT_M1_TEMPLATES[typeKey] ?? '';
    // Last-line guarantee against the "�" WhatsApp corruption. The built-in
    // templates are UTF-8 clean (verified in the bundle), so anything unsafe here
    // (a "�" OR a split-surrogate emoji) came from a corrupted saved/older copy.
    // Fall back to the clean built-in for this type so a replacement character
    // can never reach WhatsApp, no matter where the corruption crept in.
    if (!isEmojiSafe(tpl) && DEFAULT_M1_TEMPLATES[typeKey]) tpl = DEFAULT_M1_TEMPLATES[typeKey];
    return renderTemplate(tpl, ctx);
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

// ── Dashboard tab (kept for reference, now replaced by two-module view) ───────

// ── Main page ─────────────────────────────────────────────────────────────────
export function WhatsApp() {
  const [activeModule, setActiveModule] = useState<ActiveModule>('module1');
  const [showGuide, setShowGuide] = useState(false);
  const { whatsappPro } = useLicensedModules();  // Module 2 (automation) is a Pro feature

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
              <PageHelp page="communication" />
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
        {activeModule === 'module2' && (whatsappPro ? <AiSensyHub /> : <ProAutomationLocked />)}
      </div>
    </div>
  );
}

// Where clinics sign up for AiSensy. Swap this for your AiSensy PARTNER/referral
// link so you earn commission when a clinic signs up from inside CureDesk.
const AISENSY_SIGNUP = 'https://aisensy.com';

/** WhatsApp Pro automation is delivered through AiSensy (external WhatsApp BSP).
 *  This is the guided handoff for Pro clinics: sign up, then CureDesk hands over
 *  their contacts (CSV) and ready-made templates. No API keys, no server. */
function AiSensyHub() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const clinicName = (settings as any)?.clinic_name || 'our clinic';
  const cc = (settings as any)?.whatsapp_country_code || '91';
  const reviewLink = (settings as any)?.google_review_url || '<your Google review link>';
  const open = (u: string) => { window.electronAPI.app.openExternal(u).catch(() => { /* ignore */ }); };
  // A partner/referral link set at build or in Settings wins over the plain site.
  const signupUrl = ((settings as any)?.aisensy_signup_url || '').trim() || AISENSY_SIGNUP;

  // The handoff needs a finish line. Without it the setup steps shout at a clinic
  // that finished onboarding months ago, and nobody can tell whether the person
  // who set this up ever actually completed it.
  const connectedOn = ((settings as any)?.aisensy_connected_on || '').trim();
  const setConnected = async (on: boolean) => {
    try {
      await window.electronAPI.settings.save({ aisensy_connected_on: on ? new Date().toISOString().slice(0, 10) : '' } as any);
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast(on ? 'Marked as live — automation is running in AiSensy' : 'Setup steps shown again', 'success');
    } catch (e: any) { toast(e?.message || 'Could not save', 'error'); }
  };

  // Ready-made message templates. AiSensy uses numbered {{1}}, {{2}}… variables in
  // its approved WhatsApp templates; the "fills" line tells staff what maps where.
  const templates = [
    { key: 'reminder', label: 'Appointment reminder',
      body: `Namaste {{1}} 🙏\nThis is a reminder for your appointment at ${clinicName} on {{2}} at {{3}}.\nPlease arrive 10 minutes early. Reply here for any change.`,
      fills: '{{1}} patient name · {{2}} date · {{3}} time' },
    { key: 'review', label: 'Review / feedback request',
      body: `Namaste {{1}} 🙏\nThank you for visiting ${clinicName}. We’d love your feedback — please leave us a quick review here: ${reviewLink}`,
      fills: '{{1}} patient name' },
    { key: 'discharge', label: 'Discharge follow-up',
      body: `Namaste {{1}} 🙏\nWishing you a speedy recovery after your treatment at ${clinicName}. For any concern, reply here or call us. Take care!`,
      fills: '{{1}} patient name' },
  ];

  const copyTpl = async (key: string, body: string) => {
    if (await copyText(body)) { setCopiedKey(key); setTimeout(() => setCopiedKey(null), 1500); toast('Template copied — paste it into AiSensy', 'info'); }
    else toast('Could not copy', 'error');
  };

  const exportContacts = async () => {
    setExporting(true);
    try {
      const res = await window.electronAPI.patients.allList({ limit: 5000, sort: 'registered_desc' });
      const rows: any[] = (res as any)?.rows || [];
      const esc = (s: any) => { const t = String(s ?? ''); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
      const normPhone = (p: string) => { const d = String(p || '').replace(/\D/g, ''); if (!d) return ''; return d.length === 10 ? cc + d : d; };
      const contacts = rows
        .map((r) => ({ name: `${r.first_name || ''} ${r.last_name || ''}`.trim(), phone: normPhone(r.phone), uhid: r.uhid || '' }))
        .filter((c) => c.phone);
      const lines = ['name,phone,uhid', ...contacts.map((c) => [esc(c.name), c.phone, esc(c.uhid)].join(','))];
      const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `curedesk-contacts-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`Exported ${contacts.length} contacts — import this CSV in AiSensy`, 'success');
    } catch (e: any) {
      toast(e?.message || 'Export failed', 'error');
    } finally { setExporting(false); }
  };

  const Step = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
    <div className="rounded-xl border border-indigo-100 dark:border-indigo-900/50 bg-white dark:bg-slate-900 p-4">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-[12px] font-bold flex items-center justify-center shrink-0">{n}</span>
        <div className="text-[13px] font-bold text-gray-900 dark:text-slate-100">{title}</div>
      </div>
      <div className="text-[12px] text-gray-600 dark:text-slate-300 leading-relaxed pl-8">{children}</div>
    </div>
  );

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Header */}
      <div className="rounded-xl p-4 flex gap-4 items-start" style={{ background: 'linear-gradient(135deg,#eef2ff,#e0e7ff)' }}>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 bg-indigo-500">☁️</div>
        <div className="flex-1">
          <p className="font-bold text-indigo-900 text-sm">WhatsApp Automation — powered by AiSensy</p>
          <p className="text-xs text-indigo-800/80 leading-relaxed mt-0.5">
            Auto-reminders, a shared team inbox, and broadcast campaigns run on the official WhatsApp Business API through
            <b> AiSensy</b>, using your own clinic number. CureDesk hands over your contacts and templates — you run the
            automation in AiSensy. No API keys to manage here.
          </p>
          <button onClick={() => open(signupUrl)}
            className="mt-2.5 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-semibold shadow"
            style={{ background: 'linear-gradient(135deg,#4f46e5,#4338ca)' }}>
            <ExternalLink className="w-4 h-4" /> {connectedOn ? 'Open my AiSensy dashboard' : 'Open AiSensy to sign up'}
          </button>
        </div>
      </div>

      {connectedOn ? (
        /* Done. The steps collapse to a single line so the working cards below
           (contacts + templates, which stay useful forever) come first. */
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-900/20 p-3 flex items-center gap-2.5 flex-wrap">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="text-[12px] text-emerald-900 dark:text-emerald-100">
            <b>AiSensy is live for {clinicName}</b> — set up on {connectedOn}. Reminders and campaigns run from your AiSensy dashboard.
          </span>
          <button onClick={() => setConnected(false)}
            className="ml-auto text-[11px] font-semibold text-emerald-800 dark:text-emerald-200 hover:underline">
            Show setup steps again
          </button>
        </div>
      ) : (
        <>
          {/* 3 steps */}
          <div className="grid sm:grid-cols-3 gap-3">
            <Step n={1} title="Create your AiSensy account">
              Sign up with your clinic’s WhatsApp number (the button above). It’s a one-time setup.
            </Step>
            <Step n={2} title="Connect your number">
              Follow AiSensy’s onboarding to verify your WhatsApp Business number on the official API.
            </Step>
            <Step n={3} title="Import & automate">
              Bring in your patients and templates from the two cards below, then switch on reminders in AiSensy.
            </Step>
          </div>
          <div className="flex justify-end">
            <button onClick={() => setConnected(true)} className="btn-secondary text-xs">
              <CheckCircle2 className="w-3.5 h-3.5" /> I’ve finished — mark AiSensy as live
            </button>
          </div>
        </>
      )}

      {/* Export contacts */}
      <div className="card p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-[13px] font-bold text-gray-900 dark:text-slate-100 flex items-center gap-2"><Users className="w-4 h-4 text-indigo-600" /> Bring your patients into AiSensy</div>
            <p className="text-[12px] text-gray-600 dark:text-slate-400 mt-1 max-w-md">
              Download your patient contacts as a CSV (name, phone, UHID — country code added automatically), then use
              AiSensy’s <b>bulk contact import</b>. Nothing leaves this computer except the file you choose to upload.
            </p>
          </div>
          <button onClick={exportContacts} disabled={exporting} className="btn-primary text-sm shrink-0">
            <Download className="w-4 h-4" /> {exporting ? 'Exporting…' : 'Download contacts CSV'}
          </button>
        </div>
      </div>

      {/* Templates */}
      <div className="card p-4">
        <div className="text-[13px] font-bold text-gray-900 dark:text-slate-100 flex items-center gap-2 mb-1"><FileText className="w-4 h-4 text-indigo-600" /> Ready-made message templates</div>
        <p className="text-[12px] text-gray-600 dark:text-slate-400 mb-3">
          Copy these into AiSensy’s <b>template creator</b> for approval. They already use AiSensy’s numbered
          <code className="mx-1 px-1 rounded bg-gray-100 dark:bg-slate-800">{'{{1}}'}</code> variables.
        </p>
        <div className="space-y-2.5">
          {templates.map((t) => (
            <div key={t.key} className="rounded-lg border border-gray-200 dark:border-slate-700 p-3">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-[12px] font-semibold text-gray-800 dark:text-slate-100">{t.label}</span>
                <button onClick={() => copyTpl(t.key, t.body)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded border border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-800">
                  {copiedKey === t.key ? <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
                </button>
              </div>
              <pre className="text-[11.5px] text-gray-700 dark:text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">{t.body}</pre>
              <div className="text-[10.5px] text-gray-400 mt-1.5">Fills: {t.fills}</div>
            </div>
          ))}
        </div>
      </div>

      {/* FAQ */}
      <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-4 text-[12px] text-gray-600 dark:text-slate-300 leading-relaxed">
        <div className="font-bold text-gray-900 dark:text-slate-100 mb-1">What is AiSensy, and what does it cost?</div>
        AiSensy is an official WhatsApp Business partner. Your clinic pays AiSensy directly — a monthly plan plus WhatsApp’s
        per-conversation charges (billed by Meta). CureDesk never handles those payments. Your patient data stays on this
        computer; you only upload the contacts file you export above.
        <button onClick={() => open(signupUrl)} className="ml-1 text-indigo-600 dark:text-indigo-400 font-semibold hover:underline">See AiSensy plans →</button>
      </div>
    </div>
  );
}

/** Shown for Module 2 when the clinic isn't on WhatsApp Pro. Automation is handled
 *  by AiSensy (external BSP), so this is a guided handoff rather than in-app setup. */
function ProAutomationLocked() {
  return (
    <div className="max-w-xl mx-auto text-center rounded-2xl border-2 border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-900/20 p-8">
      <div className="w-14 h-14 rounded-2xl bg-indigo-500/15 flex items-center justify-center text-2xl mx-auto mb-3">☁️</div>
      <h2 className="text-lg font-extrabold text-indigo-900 dark:text-indigo-100">WhatsApp Automation is a Pro feature</h2>
      <p className="text-[13px] text-indigo-800/80 dark:text-indigo-200/80 mt-2 leading-relaxed">
        Auto-reminders, a shared inbox, and broadcast campaigns run on the official WhatsApp Business API,
        delivered through our automation partner <b>AiSensy</b>. Module 1 (click-to-send) keeps working on your plan —
        upgrade to <b>WhatsApp Pro</b> to switch automation on.
      </p>
      <button
        type="button"
        onClick={() => window.electronAPI.app.openExternal('https://bridgr.co.in').catch(() => { /* ignore */ })}
        className="btn-primary mt-4"
      >
        Talk to us about WhatsApp Pro
      </button>
    </div>
  );
}
