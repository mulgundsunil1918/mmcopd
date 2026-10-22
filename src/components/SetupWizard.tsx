/**
 * First-run setup guide — walks a freshly installed clinic through everything it needs before the first patient:
 * clinic details, doctors, fees, staff logins, pharmacy and wards. Every screen saves straight away (so closing the app
 * half-way loses nothing) and every screen can be skipped — "I'll do it later" — EXCEPT the clinic name, which prints on
 * every bill, slip and report and which the software cannot be used without.
 *
 * It is shown only for a fresh install (main/setup.ts decides — never for a clinic that already has data, never on a
 * client PC). A skipped guide leaves a small reminder strip on every page and can be reopened from Settings.
 *
 * The data goes through the same channels the Settings screens use, so there is one way each thing is stored.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, ArrowRight, BedDouble, Check, CheckCircle2, Hospital, Loader2, Pill, Plus, Receipt, SkipForward, Stethoscope, UserPlus, Users, X,
} from 'lucide-react';
import { NumberInput } from './NumberInput';
import { useToast } from '../hooks/useToast';
import { useLicensedModules } from '../hooks/useLicensedModules';
import { cn, formatINR } from '../lib/utils';
import type { SetupStatus, SetupStepKey } from '../lib/billingPortal';

type StepId = SetupStepKey | 'finish';
interface StepDef { id: StepId; title: string; icon: typeof Hospital; blurb: string }

const ALL_STEPS: StepDef[] = [
  { id: 'clinic', title: 'Your clinic', icon: Hospital, blurb: 'The name and contact details that print on every bill, slip and report.' },
  { id: 'doctors', title: 'Doctors', icon: Stethoscope, blurb: 'Who sees patients here, and what each charges.' },
  { id: 'fees', title: 'Fees & billing', icon: Receipt, blurb: 'Registration fee, free follow-ups, bill numbering and GST.' },
  { id: 'staff', title: 'Staff & sign-in', icon: Users, blurb: 'Logins for reception, pharmacy, nurses — and whether people must sign in.' },
  { id: 'pharmacy', title: 'Pharmacy', icon: Pill, blurb: 'How medicines are sold: paid now, on credit, or on an in-patient bill.' },
  { id: 'inpatient', title: 'Wards & beds', icon: BedDouble, blurb: 'The wards you admit patients to, their daily rates and beds.' },
  { id: 'finish', title: 'Finish', icon: CheckCircle2, blurb: 'A summary, and what is worth doing next.' },
];

const ROLE_LABEL: Record<string, string> = {
  receptionist: 'Reception', doctor: 'Doctor', nurse: 'Nurse', ward_incharge: 'Ward in-charge', pharmacist: 'Pharmacist',
  lab_tech: 'Lab technician', radiology_tech: 'Radiology technician', manager: 'Manager',
};
const WARD_TYPES = [
  { value: 'general', label: 'General' }, { value: 'semi_private', label: 'Semi-private' }, { value: 'private', label: 'Private' },
  { value: 'icu', label: 'ICU' }, { value: 'maternity', label: 'Maternity' }, { value: 'daycare', label: 'Day care' },
];

const clean = (s: string) => s.trim().replace(/\s+/g, ' ');

export function SetupWizard({ status, onJoinExisting }: { status: SetupStatus; onJoinExisting: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { has } = useLicensedModules();

  const defs = useMemo(
    () => ALL_STEPS.filter((s) => (s.id === 'pharmacy' ? has('pharmacy') : s.id === 'inpatient' ? has('ipd') : true)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [has('pharmacy'), has('ipd')],
  );
  // Start at the first step not yet saved (so a restarted or reopened guide resumes where it left off); all saved → the summary.
  const firstOpen = defs.findIndex((d) => d.id !== 'finish' && status.steps[d.id as SetupStepKey] !== 'done');
  const [idx, setIdx] = useState(firstOpen === -1 ? defs.length - 1 : firstOpen);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cur = defs[Math.min(idx, defs.length - 1)];
  const stepState = (id: StepId) => (id === 'finish' ? 'todo' : status.steps[id as SetupStepKey]);

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });

  const refresh = async () => {
    await Promise.all(['setup-status', 'settings', 'clinic-name-title', 'doctors', 'wards', 'users'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  };
  const remember = async (id: SetupStepKey, outcome: 'done' | 'skipped') => {
    const r = await window.electronAPI.setup.markStep(id, outcome);
    if (!r.ok) throw new Error(r.error);
  };

  /** Each step registers how to save itself (the moment it appears); "Save & continue" calls it, then moves on. */
  const [saver, setSaver] = useState<{ run: () => Promise<boolean>; ready: boolean } | null>(null);

  const open = (i: number) => { setErr(null); setIdx(Math.max(0, Math.min(defs.length - 1, i))); };
  const go = (d: number) => open(idx + d);

  const saveAndNext = async () => {
    if (!saver || busy) return;
    setBusy(true); setErr(null);
    try {
      const ok = await saver.run();
      if (!ok) return;
      if (cur.id !== 'finish') await remember(cur.id as SetupStepKey, 'done');
      await refresh();
      go(1);
    } catch (e: any) {
      setErr(e?.message || 'Could not save this step.');
    } finally { setBusy(false); }
  };

  const skipStep = async () => {
    if (busy || cur.id === 'clinic' || cur.id === 'finish') return;
    setBusy(true); setErr(null);
    try { await remember(cur.id as SetupStepKey, 'skipped'); await refresh(); go(1); }
    catch (e: any) { setErr(e?.message || 'Could not skip this step.'); }
    finally { setBusy(false); }
  };

  /** "I'll set up later": allowed from anywhere once the clinic has a name. */
  const skipAll = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await window.electronAPI.setup.setStatus('skipped');
      if (!r.ok) {
        // The clinic name is the one thing nothing works without — take the person to it.
        open(defs.findIndex((d) => d.id === 'clinic'));
        setErr(r.error);
        return;
      }
      toast('Setup skipped — you can finish it any time from Settings → Open the setup guide', 'success');
      await refresh();
    } catch (e: any) { setErr(e?.message || 'Could not skip setup.'); }
    finally { setBusy(false); }
  };

  const finish = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await window.electronAPI.setup.setStatus('done');
      if (!r.ok) { open(defs.findIndex((d) => d.id === 'clinic')); setErr(r.error); return; }
      toast('Your clinic is set up — welcome!', 'success');
      await refresh();
      navigate('/reception');
    } catch (e: any) { setErr(e?.message || 'Could not finish.'); }
    finally { setBusy(false); }
  };

  const isFinish = cur.id === 'finish';
  const Icon = cur.icon;

  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center bg-slate-900/70 backdrop-blur p-4 sm:p-6 no-print" role="dialog" aria-modal="true" aria-label="Set up your clinic">
      <div className="card w-full max-w-4xl max-h-[94vh] flex flex-col overflow-hidden">
        {/* ===== header: where we are ===== */}
        <div className="px-6 pt-5 pb-4 border-b border-gray-200 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center"><Icon className="w-5 h-5" /></span>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-blue-700 dark:text-blue-300 font-semibold">
                Set up your clinic · step {Math.min(idx, defs.length - 1) + 1} of {defs.length}
              </div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-slate-100 leading-tight">{cur.title}</h2>
              <p className="text-xs text-gray-500 dark:text-slate-400">{cur.blurb}</p>
            </div>
          </div>
          <ol className="flex flex-wrap gap-1.5 mt-4" aria-label="Steps">
            {defs.map((d, i) => {
              const st = stepState(d.id);
              const here = i === idx;
              return (
                <li key={d.id}>
                  <button type="button" onClick={() => open(i)} disabled={busy}
                    className={cn('px-2.5 py-1 rounded-full text-[11px] font-medium border inline-flex items-center gap-1 transition',
                      here ? 'bg-blue-600 text-white border-blue-600'
                        : st === 'done' ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-800'
                        : st === 'skipped' ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800'
                        : 'bg-white text-gray-600 border-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700')}>
                    {st === 'done' && !here && <Check className="w-3 h-3" />}
                    {st === 'skipped' && !here && <SkipForward className="w-3 h-3" />}
                    {d.title}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        {/* ===== the step ===== */}
        <div className="px-6 py-5 overflow-y-auto flex-1">
          {cur.id === 'clinic' && <ClinicStep status={status} settings={settings} register={setSaver} onJoin={onJoinExisting} />}
          {cur.id === 'doctors' && <DoctorsStep settings={settings} register={setSaver} />}
          {cur.id === 'fees' && <FeesStep settings={settings} register={setSaver} />}
          {cur.id === 'staff' && <StaffStep settings={settings} register={setSaver} />}
          {cur.id === 'pharmacy' && <PharmacyStep settings={settings} register={setSaver} ipd={has('ipd')} />}
          {cur.id === 'inpatient' && <WardsStep register={setSaver} />}
          {cur.id === 'finish' && <FinishStep defs={defs} status={status} onOpen={(id) => open(defs.findIndex((d) => d.id === id))} has={has} />}
          {err && <div className="mt-4 text-[13px] rounded-lg border border-red-200 bg-red-50 text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-200 px-3 py-2" role="alert">{err}</div>}
        </div>

        {/* ===== footer: back / skip step / save, and the "later" escape below ===== */}
        <div className="px-6 pt-3 pb-4 border-t border-gray-200 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-900/40">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <button type="button" className="btn-ghost text-xs" onClick={() => go(-1)} disabled={busy || idx === 0}>
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
            <div className="flex items-center gap-2">
              {!isFinish && cur.id !== 'clinic' && (
                <button type="button" className="btn-secondary text-xs" onClick={skipStep} disabled={busy}
                  title="Leave this for later — you can come back to it from Settings">
                  Skip this step
                </button>
              )}
              {isFinish ? (
                <button type="button" className="btn-primary" onClick={finish} disabled={busy}>
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Finish &amp; start working
                </button>
              ) : (
                <button type="button" className="btn-primary" onClick={saveAndNext} disabled={busy || !saver || !saver.ready}>
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Save &amp; continue <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-dashed border-gray-300 dark:border-slate-700 flex items-center justify-center gap-3 flex-wrap">
            <button type="button" onClick={skipAll} disabled={busy}
              className="text-xs font-semibold text-gray-600 dark:text-slate-300 hover:text-blue-700 dark:hover:text-blue-300 underline underline-offset-2">
              Skip setup for now — I&rsquo;ll do it later
            </button>
            <span className="text-[11px] text-gray-400">You can reopen this any time from Settings → Open the setup guide. Only the clinic name is required.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================= small pieces */

type Register = (s: { run: () => Promise<boolean>; ready: boolean } | null) => void;

function Field({ label, hint, children, required }: { label: string; hint?: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="label">{label}{required && <span className="text-red-500"> *</span>}</label>
      {children}
      {hint && <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-1">{hint}</div>}
    </div>
  );
}

function ToggleBox({ label, help, checked, onChange }: { label: string; help: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-gray-200 dark:border-slate-700 bg-white/60 dark:bg-slate-900/40 px-3 py-2.5">
      <input type="checkbox" className="mt-1 w-4 h-4 accent-blue-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <div>
        <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100">{label}</div>
        <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">{help}</div>
      </div>
    </label>
  );
}

/* ================================================================= 1 · clinic */

function ClinicStep({ status, settings, register, onJoin }: { status: SetupStatus; settings: any; register: Register; onJoin: () => void }) {
  const [f, setF] = useState({ name: status.clinic_name, tagline: '', phone: '', email: '', address: '', reg: '' });
  const [touched, setTouched] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!settings || loaded) return;
    setF((p) => ({ ...p, tagline: settings.clinic_tagline || '', phone: settings.clinic_phone || '', email: settings.clinic_email || '', address: settings.clinic_address || '', reg: settings.clinic_registration_no || '' }));
    setLoaded(true);
  }, [settings, loaded]);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const name = clean(f.name);
  const emailBad = !!f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim());

  useEffect(() => {
    register({
      ready: name.length > 0 && !emailBad,
      run: async () => {
        setTouched(true);
        if (!name) return false;
        if (emailBad) return false;
        await window.electronAPI.settings.save({
          clinic_name: name.slice(0, 80), clinic_tagline: clean(f.tagline).slice(0, 120), clinic_phone: f.phone.trim().slice(0, 40),
          clinic_email: f.email.trim().slice(0, 120), clinic_address: f.address.trim().slice(0, 300), clinic_registration_no: f.reg.trim().slice(0, 60),
        });
        return true;
      },
    });
  }, [f, name, emailBad]);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-900/20 px-4 py-3 text-[13px] text-blue-900 dark:text-blue-100">
        <b>Welcome to CureDesk.</b> This takes a few minutes. Each screen saves as you go, and you can skip any of them and finish later —
        the only thing needed to start is your clinic&rsquo;s name.
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Clinic name" required
          hint={name ? 'Printed at the top of every bill, prescription slip and report.' : 'Required — type your clinic’s name to continue. It is the one thing the software cannot be used without.'}>
          <input className={cn('input', touched && !name && 'border-red-400')} autoFocus maxLength={80} value={f.name} placeholder="e.g. Sri Sai Children's Clinic"
            onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Tagline (optional)" hint="A line under the name — e.g. “Child & Family Care”.">
          <input className="input" maxLength={120} value={f.tagline} onChange={(e) => set('tagline', e.target.value)} />
        </Field>
        <Field label="Phone (optional)">
          <input className="input" maxLength={40} inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="Email (optional)">
          <input className={cn('input', emailBad && 'border-red-400')} maxLength={120} type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
          {emailBad && <div className="text-[11px] text-red-600 mt-1">That email address does not look right.</div>}
        </Field>
        <div className="md:col-span-2">
          <Field label="Address (optional)">
            <textarea className="input" rows={2} maxLength={300} value={f.address} onChange={(e) => set('address', e.target.value)} />
          </Field>
        </div>
        <Field label="Registration number (optional)" hint="Your clinic or nursing-home registration, if you want it printed.">
          <input className="input" maxLength={60} value={f.reg} onChange={(e) => set('reg', e.target.value)} />
        </Field>
      </div>
      <button type="button" onClick={onJoin} className="text-[12px] text-blue-700 dark:text-blue-300 underline underline-offset-2">
        This PC is an extra computer for a clinic that is already set up on another PC →
      </button>
    </div>
  );
}

/* ================================================================= 2 · doctors */

function DoctorsStep({ settings, register }: { settings: any; register: Register }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: doctors = [] } = useQuery({ queryKey: ['doctors', 'all'], queryFn: () => window.electronAPI.doctors.list(false) });
  const blank = { name: '', specialty: '', qualifications: '', registration_no: '', phone: '', room: '', fee: Number(settings?.consultation_fee) || 250 };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof typeof blank, v: any) => setF((p) => ({ ...p, [k]: v }));
  const name = clean(f.name);

  const add = async () => {
    if (!name) { setMsg("Type the doctor's name first."); return false; }
    setBusy(true); setMsg(null);
    try {
      await window.electronAPI.doctors.create({
        name, specialty: clean(f.specialty), qualifications: clean(f.qualifications) || null, registration_no: f.registration_no.trim() || null,
        phone: f.phone.trim() || null, room_number: f.room.trim() || null, default_fee: Number(f.fee) || 0,
      });
      await qc.invalidateQueries({ queryKey: ['doctors'] });
      toast(`${name} added`, 'success');
      setF({ ...blank, fee: f.fee });
      return true;
    } catch (e: any) { setMsg(e?.message || 'Could not add the doctor.'); return false; }
    finally { setBusy(false); }
  };

  useEffect(() => {
    register({
      // A doctor typed but not yet added is added by "Save & continue"; with nobody added at all there is nothing to save.
      ready: doctors.length > 0 || name.length > 0,
      run: async () => (name ? add() : true),
    });
  }, [doctors.length, f]);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      {doctors.length > 0 && (
        <div>
          <div className="label">Added so far</div>
          <ul className="flex flex-wrap gap-2">
            {doctors.map((d: any) => (
              <li key={d.id} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-[12px] text-emerald-900 dark:text-emerald-100">
                <Stethoscope className="w-3.5 h-3.5" /> <b>{d.name}</b>{d.specialty ? ` · ${d.specialty}` : ''} · {formatINR(d.default_fee)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-4 space-y-3 bg-white/60 dark:bg-slate-900/40">
        <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100 inline-flex items-center gap-1.5"><UserPlus className="w-4 h-4" /> {doctors.length ? 'Add another doctor' : 'Add a doctor'}</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Name" required><input className="input" value={f.name} maxLength={80} placeholder="Dr. Anita Patil" onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Speciality"><input className="input" value={f.specialty} maxLength={60} placeholder="Paediatrics" onChange={(e) => set('specialty', e.target.value)} /></Field>
          <Field label="Qualifications"><input className="input" value={f.qualifications} maxLength={80} placeholder="MBBS, MD" onChange={(e) => set('qualifications', e.target.value)} /></Field>
          <Field label="Medical registration no."><input className="input" value={f.registration_no} maxLength={40} onChange={(e) => set('registration_no', e.target.value)} /></Field>
          <Field label="Phone"><input className="input" value={f.phone} maxLength={30} inputMode="tel" onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label="Room / cabin"><input className="input" value={f.room} maxLength={20} placeholder="Cabin 1" onChange={(e) => set('room', e.target.value)} /></Field>
          <Field label="Consultation fee (₹)" hint="What this doctor charges for a visit.">
            <NumberInput className="input" value={f.fee} onChange={(n) => set('fee', n)} />
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" className="btn-secondary text-xs" onClick={add} disabled={busy || !name}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add this doctor
          </button>
          {msg && <span className="text-[12px] text-red-600">{msg}</span>}
        </div>
      </div>
      <p className="text-[11px] text-gray-500 dark:text-slate-400">
        More details — signature, working hours, prescription-slip templates — are in Settings → Doctors whenever you need them.
      </p>
    </div>
  );
}

/* ================================================================= 3 · fees & billing */

function FeesStep({ settings, register }: { settings: any; register: Register }) {
  const [f, setF] = useState<any>(null);
  useEffect(() => {
    if (!settings || f) return;
    setF({
      registration_fee_enabled: !!settings.registration_fee_enabled, registration_fee_amount: Number(settings.registration_fee_amount) || 100,
      followup_enabled: !!settings.followup_enabled, followup_window_days: Number(settings.followup_window_days) || 7, followup_free_visits: Number(settings.followup_free_visits) || 2,
      invoice_prefix: settings.invoice_prefix || 'INV',
      gst_enabled: !!settings.gst_enabled, clinic_gstin: settings.clinic_gstin || '', clinic_legal_name: settings.clinic_legal_name || '',
    });
  }, [settings, f]);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const prefix = clean(String(f?.invoice_prefix ?? '')).toUpperCase();
  const gstinBad = !!f?.gst_enabled && !!f?.clinic_gstin?.trim() && !/^[0-9A-Za-z]{15}$/.test(f.clinic_gstin.trim());

  useEffect(() => {
    register({
      ready: !!f && !gstinBad && prefix.length > 0,
      run: async () => {
        await window.electronAPI.settings.save({
          registration_fee_enabled: !!f.registration_fee_enabled, registration_fee_amount: Math.max(0, Number(f.registration_fee_amount) || 0),
          followup_enabled: !!f.followup_enabled, followup_window_days: Math.max(1, Math.min(90, Number(f.followup_window_days) || 7)),
          followup_free_visits: Math.max(1, Math.min(10, Number(f.followup_free_visits) || 2)),
          invoice_prefix: prefix.slice(0, 10),
          gst_enabled: !!f.gst_enabled, clinic_gstin: f.gst_enabled ? f.clinic_gstin.trim().toUpperCase() : (settings.clinic_gstin || ''),
          clinic_legal_name: f.gst_enabled ? clean(f.clinic_legal_name) : (settings.clinic_legal_name || ''),
        } as any);
        return true;
      },
    });
  }, [f, prefix, gstinBad]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (!f) return <div className="py-10 text-center text-sm text-gray-500"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>;
  return (
    <div className="space-y-4">
      <ToggleBox label="Charge a one-time registration fee for new patients" checked={f.registration_fee_enabled} onChange={(v) => set('registration_fee_enabled', v)}
        help="Taken once, the first time a patient is registered." />
      {f.registration_fee_enabled && (
        <div className="pl-7 max-w-xs"><Field label="Registration fee (₹)"><NumberInput className="input" value={f.registration_fee_amount} onChange={(n) => set('registration_fee_amount', n)} /></Field></div>
      )}
      <ToggleBox label="Free follow-up visits" checked={f.followup_enabled} onChange={(v) => set('followup_enabled', v)}
        help="A patient who returns soon after a paid visit is seen again without paying another consultation fee." />
      {f.followup_enabled && (
        <div className="pl-7 grid grid-cols-2 gap-4 max-w-md">
          <Field label="Within (days)" hint="From their last paid visit."><NumberInput className="input" value={f.followup_window_days} min={1} max={90} onChange={(n) => set('followup_window_days', n)} /></Field>
          <Field label="Number of free visits"><NumberInput className="input" value={f.followup_free_visits} min={1} max={10} onChange={(n) => set('followup_free_visits', n)} /></Field>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Bill number prefix" hint={`Bills will read like ${prefix || 'INV'}-2026-27/0001.`}>
          <input className="input uppercase" maxLength={10} value={f.invoice_prefix} onChange={(e) => set('invoice_prefix', e.target.value)} />
        </Field>
      </div>
      <ToggleBox label="My clinic is registered for GST" checked={f.gst_enabled} onChange={(v) => set('gst_enabled', v)}
        help="Leave this off if you do not charge GST — consultations are exempt in India, and most small clinics need nothing here." />
      {f.gst_enabled && (
        <div className="pl-7 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="GSTIN" hint="15 characters.">
            <input className={cn('input uppercase', gstinBad && 'border-red-400')} maxLength={15} value={f.clinic_gstin} onChange={(e) => set('clinic_gstin', e.target.value)} />
            {gstinBad && <div className="text-[11px] text-red-600 mt-1">A GSTIN has exactly 15 letters and digits.</div>}
          </Field>
          <Field label="Legal name (if different)"><input className="input" maxLength={80} value={f.clinic_legal_name} onChange={(e) => set('clinic_legal_name', e.target.value)} /></Field>
        </div>
      )}
    </div>
  );
}

/* ================================================================= 4 · staff */

function StaffStep({ settings, register }: { settings: any; register: Register }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => window.electronAPI.auth.listUsers() });
  const { data: doctors = [] } = useQuery({ queryKey: ['doctors', 'all'], queryFn: () => window.electronAPI.doctors.list(false) });
  const [requireLogin, setRequireLogin] = useState<boolean | null>(null);
  useEffect(() => { if (settings && requireLogin === null) setRequireLogin(!!settings.require_login); }, [settings, requireLogin]);
  const blank = { display: '', username: '', password: '', role: 'receptionist', doctor_id: '' };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof typeof blank, v: string) => setF((p) => ({ ...p, [k]: v }));
  const username = f.username.trim().toLowerCase().replace(/\s+/g, '');

  const add = async () => {
    if (!username) { setMsg('Choose a username.'); return false; }
    if (f.password.length < 4) { setMsg('Choose a password of at least 4 characters.'); return false; }
    setBusy(true); setMsg(null);
    try {
      await window.electronAPI.auth.createUser({
        username, password: f.password, role: f.role as any, display_name: clean(f.display) || username,
        ...(f.role === 'doctor' && f.doctor_id ? { doctor_id: Number(f.doctor_id) } : {}),
      });
      await qc.invalidateQueries({ queryKey: ['users'] });
      toast(`Login "${username}" created`, 'success');
      setF(blank);
      return true;
    } catch (e: any) { setMsg(e?.message || 'Could not create the login.'); return false; }
    finally { setBusy(false); }
  };

  useEffect(() => {
    register({
      ready: requireLogin !== null,
      run: async () => {
        if (username || f.password) { if (!(await add())) return false; }
        if (requireLogin !== !!settings?.require_login) await window.electronAPI.settings.save({ require_login: !!requireLogin });
        return true;
      },
    });
  }, [requireLogin, f, settings]);  // eslint-disable-line react-hooks/exhaustive-deps

  const others = (users as any[]).filter((u) => u.role !== 'admin' || (u.username && u.username !== 'admin'));
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 dark:border-slate-700 px-4 py-3 text-[12px] text-gray-700 dark:text-slate-300 bg-white/60 dark:bg-slate-900/40">
        You already have an <b>administrator</b> login (the one you chose when you first opened the software). Add logins here for the people who
        will work in the clinic, each with the role that matches their job. What each role is allowed to open can be changed later in
        Settings → Role-Based Access.
      </div>
      {others.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {others.map((u: any) => (
            <li key={u.id} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-[12px] text-emerald-900 dark:text-emerald-100">
              <Users className="w-3.5 h-3.5" /> <b>{u.display_name || u.username}</b> · {ROLE_LABEL[u.role] || u.role}
            </li>
          ))}
        </ul>
      )}
      <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-4 space-y-3 bg-white/60 dark:bg-slate-900/40">
        <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100 inline-flex items-center gap-1.5"><UserPlus className="w-4 h-4" /> Add a staff login</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Name"><input className="input" maxLength={60} value={f.display} placeholder="Ravi Kumar" onChange={(e) => set('display', e.target.value)} /></Field>
          <Field label="Role">
            <select className="input" value={f.role} onChange={(e) => set('role', e.target.value)}>
              {Object.entries(ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Username" hint="Lower-case, no spaces."><input className="input" maxLength={30} value={f.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" /></Field>
          <Field label="Password" hint="At least 4 characters. They can change it after signing in."><input className="input" type="password" value={f.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" /></Field>
          {f.role === 'doctor' && (doctors as any[]).length > 0 && (
            <Field label="Which doctor is this?" hint="Links the login to the doctor's own patient list.">
              <select className="input" value={f.doctor_id} onChange={(e) => set('doctor_id', e.target.value)}>
                <option value="">— choose —</option>
                {(doctors as any[]).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button type="button" className="btn-secondary text-xs" onClick={add} disabled={busy || !username || !f.password}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add this login
          </button>
          {msg && <span className="text-[12px] text-red-600">{msg}</span>}
        </div>
      </div>
      <ToggleBox label="Everyone must sign in" checked={!!requireLogin} onChange={setRequireLogin}
        help="From the next time the software starts, each person signs in with their own login, and every bill and sale records who made it. Leave it off for a one-computer clinic where one person does everything — you can switch it on later in Settings → Security." />
    </div>
  );
}

/* ================================================================= 5 · pharmacy */

function PharmacyStep({ settings, register, ipd }: { settings: any; register: Register; ipd: boolean }) {
  const [f, setF] = useState<any>(null);
  useEffect(() => { if (settings && !f) setF({ credit: !!settings.pharmacy_credit_enabled, ipdCharge: !!settings.pharmacy_ipd_charge_enabled }); }, [settings, f]);
  useEffect(() => {
    register({
      ready: !!f,
      run: async () => {
        await window.electronAPI.settings.save({ pharmacy_credit_enabled: !!f.credit, pharmacy_ipd_charge_enabled: ipd ? !!f.ipdCharge : false } as any);
        return true;
      },
    });
  }, [f, ipd]);  // eslint-disable-line react-hooks/exhaustive-deps
  if (!f) return <div className="py-10 text-center text-sm text-gray-500"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 dark:border-slate-700 px-4 py-3 text-[12px] text-gray-700 dark:text-slate-300 bg-white/60 dark:bg-slate-900/40">
        A starter list of common medicines (names and prices only — no stock) comes with the software. Put your real stock in from <b>Pharmacy → Purchases</b> (your supplier bills) — that
        also gives you the true cost of every strip, and so your real profit.
      </div>
      <ToggleBox label="Allow medicines on credit (the patient pays later)" checked={f.credit} onChange={(v) => setF((p: any) => ({ ...p, credit: v }))}
        help="At the counter a registered patient can take medicines and pay part now, or nothing, and the rest later. A walk-in guest can never take credit — it must be clear who owes the money." />
      {ipd && (
        <ToggleBox label="Allow charging medicines to an admitted patient's bill" checked={f.ipdCharge} onChange={(v) => setF((p: any) => ({ ...p, ipdCharge: v }))}
          help="Medicines for an in-patient can go onto that stay's running bill and are collected with the rest of it at discharge, priced at the batch's selling price (its MRP when none was set), a price that cannot be typed over." />
      )}
      <p className="text-[11px] text-gray-500 dark:text-slate-400">Both are off unless you tick them, and you can change them any time in Settings → Billing &amp; IPD.</p>
    </div>
  );
}

/* ================================================================= 6 · wards */

function WardsStep({ register }: { register: Register }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: wards = [] } = useQuery({ queryKey: ['wards'], queryFn: () => window.electronAPI.wards.list(true) });
  const blank = { name: '', type: 'general', rate: 0, nursing: 0, beds: 4 };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof typeof blank, v: any) => setF((p) => ({ ...p, [k]: v }));
  const name = clean(f.name);

  const add = async () => {
    if (!name) { setMsg('Type the ward name first.'); return false; }
    const beds = Math.max(0, Math.min(60, Math.floor(Number(f.beds) || 0)));
    setBusy(true); setMsg(null);
    try {
      const w = await window.electronAPI.wards.save({ name, ward_type: f.type, per_day_rate: Number(f.rate) || 0, nursing_per_day: Number(f.nursing) || 0 });
      if (!w.ok) { setMsg(w.error); return false; }
      // Bed numbers GE-1, GE-2 … from the ward's first letters: unique within the ward and easy to say aloud.
      const prefix = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'B';
      for (let i = 1; i <= beds; i++) {
        const b = await window.electronAPI.beds.save({ ward_id: w.id, bed_number: `${prefix}-${i}` });
        if (!b.ok) { setMsg(`Ward added, but a bed could not be: ${b.error}`); break; }
      }
      await Promise.all([qc.invalidateQueries({ queryKey: ['wards'] }), qc.invalidateQueries({ queryKey: ['beds-map'] })]);
      toast(`${name} added${beds ? ` with ${beds} bed${beds === 1 ? '' : 's'}` : ''}`, 'success');
      setF({ ...blank, type: f.type });
      return true;
    } catch (e: any) { setMsg(e?.message || 'Could not add the ward.'); return false; }
    finally { setBusy(false); }
  };

  useEffect(() => {
    register({ ready: (wards as any[]).length > 0 || name.length > 0, run: async () => (name ? add() : true) });
  }, [(wards as any[]).length, f]);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      {(wards as any[]).length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {(wards as any[]).map((w) => (
            <li key={w.id} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-[12px] text-emerald-900 dark:text-emerald-100">
              <BedDouble className="w-3.5 h-3.5" /> <b>{w.name}</b> · {formatINR(w.per_day_rate)}/day
            </li>
          ))}
        </ul>
      )}
      <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-4 space-y-3 bg-white/60 dark:bg-slate-900/40">
        <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100 inline-flex items-center gap-1.5"><Plus className="w-4 h-4" /> {(wards as any[]).length ? 'Add another ward' : 'Add a ward'}</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Ward name" required><input className="input" maxLength={60} value={f.name} placeholder="General Ward" onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Type">
            <select className="input" value={f.type} onChange={(e) => set('type', e.target.value)}>
              {WARD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Number of beds" hint="They are numbered for you (GE-1, GE-2 …)."><NumberInput className="input" value={f.beds} min={0} max={60} onChange={(n) => set('beds', n)} /></Field>
          <Field label="Bed charge per day (₹)"><NumberInput className="input" value={f.rate} onChange={(n) => set('rate', n)} /></Field>
          <Field label="Nursing charge per day (₹)" hint="0 if it is included in the bed charge."><NumberInput className="input" value={f.nursing} onChange={(n) => set('nursing', n)} /></Field>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" className="btn-secondary text-xs" onClick={add} disabled={busy || !name}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add this ward
          </button>
          {msg && <span className="text-[12px] text-red-600">{msg}</span>}
        </div>
      </div>
      <p className="text-[11px] text-gray-500 dark:text-slate-400">Bed and nursing charges are posted to an admitted patient&rsquo;s bill every day by themselves. Edit wards, rates and beds any time in Settings → Billing &amp; IPD.</p>
    </div>
  );
}

/* ================================================================= 7 · finish */

function FinishStep({ defs, status, onOpen, has }: { defs: StepDef[]; status: SetupStatus; onOpen: (id: StepId) => void; has: (m: string) => boolean }) {
  const rows = defs.filter((d) => d.id !== 'finish');
  const todo = rows.filter((d) => status.steps[d.id as SetupStepKey] !== 'done').length;
  return (
    <div className="space-y-4">
      <div className={cn('rounded-xl border px-4 py-3 text-[13px]',
        todo === 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-100'
          : 'border-amber-200 bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-100')}>
        {todo === 0
          ? <><b>Everything is set up.</b> You are ready for the first patient.</>
          : <><b>{todo} step{todo === 1 ? '' : 's'} left for later.</b> Nothing is lost — you can finish them any time from Settings → Open the setup guide.</>}
      </div>
      <ul className="divide-y divide-gray-100 dark:divide-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 bg-white/60 dark:bg-slate-900/40">
        {rows.map((d) => {
          const st = status.steps[d.id as SetupStepKey];
          const I = d.icon;
          return (
            <li key={d.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                st === 'done' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200')}>
                {st === 'done' ? <Check className="w-4 h-4" /> : <I className="w-4 h-4" />}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-gray-900 dark:text-slate-100">{d.title}</div>
                <div className="text-[11px] text-gray-500 dark:text-slate-400">{st === 'done' ? 'Saved' : st === 'skipped' ? 'Skipped — for later' : 'Not done yet'}</div>
              </div>
              {st !== 'done' && <button type="button" className="btn-secondary text-[11px] py-1 px-2" onClick={() => onOpen(d.id)}>Do it now</button>}
            </li>
          );
        })}
      </ul>
      <div>
        <div className="label">Worth doing next</div>
        <ul className="text-[12px] text-gray-700 dark:text-slate-300 space-y-1 list-disc pl-5">
          <li><b>Letterhead &amp; logo</b> — Settings → Clinic, to put your logo on printed paper.</li>
          {has('pharmacy') && <li><b>Opening stock</b> — Pharmacy → Purchases, from your supplier bills.</li>}
          {has('lab') && <li><b>Test prices</b> — Lab → Catalogue &amp; Prices, and Radiology → Catalogue &amp; Prices. A test left at ₹0 is done but never charged for.</li>}
          <li><b>Backups</b> — the software backs up on its own to the folder you chose; copy that folder to a pen drive now and then.</li>
        </ul>
      </div>
    </div>
  );
}

/** The slim strip shown on every page after the guide was skipped, until it is finished or switched off. */
export function SetupReminder({ onOpen, onStop }: { onOpen: () => void; onStop: () => void }) {
  // Make room for the strip: the app's own layout is pushed down by its height (see Layout.tsx) rather than covered.
  useEffect(() => {
    document.documentElement.style.setProperty('--top-strip', '32px');
    return () => { document.documentElement.style.removeProperty('--top-strip'); };
  }, []);
  return (
    <div className="no-print fixed top-0 left-0 right-0 z-[140] h-8 bg-blue-600 text-white px-4 text-xs flex items-center justify-center gap-3 shadow">
      <span>Setup is not finished — some of your clinic&rsquo;s details are still empty.</span>
      <button onClick={onOpen} className="bg-white text-blue-700 px-3 py-0.5 rounded font-bold hover:bg-blue-50">Continue setup</button>
      <button onClick={onStop} className="inline-flex items-center gap-1 text-blue-100 hover:text-white underline underline-offset-2" title="Stop showing this reminder">
        <X className="w-3 h-3" /> Don&rsquo;t remind me
      </button>
    </div>
  );
}
