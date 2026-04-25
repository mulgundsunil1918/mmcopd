import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, RefreshCcw, Save, Eye, Info, AlertCircle, Plus, Sparkles } from 'lucide-react';
import { cn } from '../lib/utils';
import { useToast } from '../hooks/useToast';
import { WhatsAppIcon } from './WhatsAppIcon';
import {
  DEFAULT_WHATSAPP_TEMPLATE,
  WHATSAPP_PLACEHOLDERS,
  TEMPLATE_SNIPPETS,
  renderTemplate,
} from '../lib/whatsapp';
import type { Settings } from '../types';

export function WhatsAppMessaging({ defaultOpen = true }: { defaultOpen?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(defaultOpen);

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.electronAPI.settings.get(),
  });

  const [template, setTemplate] = useState<string>('');
  const [countryCode, setCountryCode] = useState<string>('91');

  useEffect(() => {
    if (settings) {
      setTemplate(settings.whatsapp_template || DEFAULT_WHATSAPP_TEMPLATE);
      setCountryCode(settings.whatsapp_country_code || '91');
    }
  }, [settings?.whatsapp_template, settings?.whatsapp_country_code]);

  const dirty =
    settings != null &&
    (template !== (settings.whatsapp_template || DEFAULT_WHATSAPP_TEMPLATE) ||
      countryCode !== (settings.whatsapp_country_code || '91'));

  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => window.electronAPI.settings.save(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast('WhatsApp template saved');
    },
  });

  if (!settings) return null;

  // Live values come from real clinic settings — these get filled in for
  // every message we send. The non-clinic placeholders (patient_name, doctor, etc.)
  // come from each appointment at send time, so we use sample values for preview.
  const liveValues: Record<string, string> = {
    clinic_name: settings.clinic_name || '',
    clinic_phone: settings.clinic_phone || '',
    clinic_address: settings.clinic_address || '',
  };
  // Settings that show empty in the message — flag them as warnings.
  const emptyClinicValues = Object.entries(liveValues)
    .filter(([, v]) => !v || v.trim() === '')
    .map(([k]) => k);

  // Build preview context: real clinic values + sample patient/doctor data.
  const sampleCtx = Object.fromEntries(
    WHATSAPP_PLACEHOLDERS.map((p) => [p.token.replace(/[{}]/g, '').trim(), p.sample])
  );
  sampleCtx['clinic_name'] = liveValues.clinic_name || sampleCtx['clinic_name'];
  sampleCtx['clinic_phone'] = liveValues.clinic_phone || sampleCtx['clinic_phone'];
  sampleCtx['clinic_address'] = liveValues.clinic_address || sampleCtx['clinic_address'];
  const previewMessage = renderTemplate(template, sampleCtx);

  return (
    <div className="card">
      <button
        type="button"
        className="w-full flex items-center justify-between p-4 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <WhatsAppIcon className="w-4 h-4" />
          <span className="font-semibold text-sm text-gray-900 dark:text-slate-100">
            WhatsApp Messaging
          </span>
          <span className="text-[11px] text-gray-500 dark:text-slate-400">
            Click-to-WhatsApp · Free · No DLT / API needed
          </span>
        </div>
        <ChevronDown className={cn('w-4 h-4 transition', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="border-t border-gray-200 dark:border-slate-700 p-4 space-y-5">
          {/* How it works */}
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-900/20 p-3 text-xs text-gray-800 dark:text-slate-200">
            <div className="font-semibold text-emerald-900 dark:text-emerald-200 mb-1 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5" /> How it works
            </div>
            <ul className="list-disc pl-5 space-y-0.5 text-[11px]">
              <li>Every appointment row has a green <b>WhatsApp</b> button.</li>
              <li>Clicking it opens WhatsApp Web/Desktop with the message below already typed, addressed to the patient's phone.</li>
              <li>Receptionist reviews and hits <b>Send</b>. No SMS provider, no DLT, no recurring cost.</li>
            </ul>
          </div>

          {/* Empty-value warnings */}
          {emptyClinicValues.length > 0 && (
            <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-900 dark:text-amber-200">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold mb-0.5">These placeholders will be empty in the message:</div>
                  <div>{emptyClinicValues.map((k) => `{{${k}}}`).join(', ')}</div>
                  <div className="mt-1 text-[11px]">Fix it in <b>Settings → Clinic Information</b> at the top of this page.</div>
                </div>
              </div>
            </div>
          )}

          {/* === Quick add snippets === */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="label mb-0 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-emerald-600" /> Quick Add — click to drop a ready-made block
              </label>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {TEMPLATE_SNIPPETS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setTemplate((prev) => prev + s.insert)}
                  className="text-left rounded-lg border-2 border-emerald-200 dark:border-emerald-900 bg-white dark:bg-slate-800 hover:border-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 p-2.5 transition active:scale-[0.99]"
                >
                  <div className="text-xs font-bold text-emerald-800 dark:text-emerald-300 inline-flex items-center gap-1.5">
                    <Plus className="w-3.5 h-3.5" /> {s.label}
                  </div>
                  <div className="text-[10px] text-gray-600 dark:text-slate-400 mt-0.5">{s.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* === Placeholder cards (each shows current/sample value) === */}
          <div>
            <label className="label">Or insert a single placeholder — these auto-fill on send</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {WHATSAPP_PLACEHOLDERS.map((p) => {
                const key = p.token.replace(/[{}]/g, '').trim();
                const liveValue = liveValues[key];
                const isEmpty = key in liveValues && (!liveValue || String(liveValue).trim() === '');
                return (
                  <button
                    key={p.token}
                    type="button"
                    onClick={() => setTemplate((prev) => prev + ' ' + p.token)}
                    title={p.help}
                    className={cn(
                      'text-left rounded-lg border p-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition',
                      isEmpty
                        ? 'border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-900/10'
                        : 'border-blue-200 dark:border-blue-900 bg-blue-50/40 dark:bg-blue-900/10'
                    )}
                  >
                    <div className="text-[11px] font-mono font-semibold text-blue-800 dark:text-blue-300">{p.token}</div>
                    <div className="text-[10px] text-gray-600 dark:text-slate-400">{p.help}</div>
                    <div className={cn('text-[10px] mt-0.5 truncate', isEmpty ? 'text-amber-700 dark:text-amber-300' : 'text-gray-700 dark:text-slate-200')}>
                      {isEmpty ? '⚠ empty — set in Clinic Info' : `→ ${liveValue ?? p.sample}`}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* === Template editor === */}
          <div>
            <div className="flex items-center justify-between">
              <label className="label">Message Template</label>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-gray-500 dark:text-slate-400">{template.length} chars</span>
                <button
                  type="button"
                  className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                  onClick={() => setTemplate(DEFAULT_WHATSAPP_TEMPLATE)}
                  title="Reset to the recommended template shipped with the app"
                >
                  <RefreshCcw className="w-3 h-3" /> Reset to recommended
                </button>
              </div>
            </div>
            <textarea
              className="input font-mono text-[12px]"
              rows={13}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              spellCheck={false}
            />
            <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-0.5">
              Use <code>*bold*</code>, <code>_italic_</code>, <code>~strike~</code> — WhatsApp formatting works inside the message.
            </div>
          </div>

          {/* === Live preview === */}
          <div>
            <div className="label flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5" /> Live preview — exactly what the patient sees
            </div>
            <div className="flex justify-end">
              <div
                className="rounded-2xl rounded-tr-sm p-3 whitespace-pre-wrap text-[12px] leading-snug shadow-md max-w-md"
                style={{ background: '#dcf8c6', color: '#0b1f0f', border: '1px solid #b8e2a3' }}
              >
                {previewMessage}
                <div className="text-right text-[9px] mt-1.5" style={{ color: '#5b7e63' }}>
                  10:30 AM ✓✓
                </div>
              </div>
            </div>
          </div>

          {/* === Country code === */}
          <div>
            <label className="label">Country Code (prefix to 10-digit numbers)</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-700 dark:text-slate-200">+</span>
              <input
                className="input w-24 font-mono"
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="91"
              />
              <span className="text-[11px] text-gray-500 dark:text-slate-400">
                Default <b>91</b> for India. Patient stored as <code>9876543210</code> sent as <code>+91 9876543210</code>.
              </span>
            </div>
          </div>

          {/* === Save bar === */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-200 dark:border-slate-700">
            {dirty && (
              <span className="text-[11px] text-amber-700 dark:text-amber-300 font-semibold">
                ● Unsaved changes
              </span>
            )}
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={!dirty}
              onClick={() => {
                setTemplate(settings.whatsapp_template || DEFAULT_WHATSAPP_TEMPLATE);
                setCountryCode(settings.whatsapp_country_code || '91');
              }}
            >
              Discard
            </button>
            <button
              type="button"
              className="btn-success text-xs"
              disabled={!dirty || save.isPending}
              onClick={() =>
                save.mutate({
                  whatsapp_template: template,
                  whatsapp_country_code: countryCode || '91',
                })
              }
            >
              <Save className="w-3.5 h-3.5" /> Save Template
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
