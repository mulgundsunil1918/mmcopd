import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, RefreshCcw, Save, Eye, Info } from 'lucide-react';
import { cn } from '../lib/utils';
import { useToast } from '../hooks/useToast';
import { WhatsAppIcon } from './WhatsAppIcon';
import {
  DEFAULT_WHATSAPP_TEMPLATE,
  WHATSAPP_PLACEHOLDERS,
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

  // Sample preview values — what the receptionist will see when sending.
  const sampleCtx = Object.fromEntries(
    WHATSAPP_PLACEHOLDERS.map((p) => [p.token.replace(/[{}]/g, '').trim(), p.sample])
  );
  // Override clinic-related samples with actual settings so preview feels real.
  sampleCtx['clinic_name'] = settings.clinic_name || sampleCtx['clinic_name'];
  sampleCtx['clinic_phone'] = settings.clinic_phone || sampleCtx['clinic_phone'];
  sampleCtx['clinic_address'] = settings.clinic_address || sampleCtx['clinic_address'];
  const previewMessage = renderTemplate(template, sampleCtx);

  const insertPlaceholder = (token: string) => {
    setTemplate((prev) => prev + token);
  };

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
        <div className="border-t border-gray-200 dark:border-slate-700 p-4 space-y-4">
          {/* How it works */}
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-900/20 p-3 text-xs text-gray-800 dark:text-slate-200">
            <div className="font-semibold text-emerald-900 dark:text-emerald-200 mb-1 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5" /> How it works
            </div>
            <ul className="list-disc pl-5 space-y-0.5 text-[11px]">
              <li>On every appointment row there is a green <b>WhatsApp</b> button.</li>
              <li>Clicking it opens WhatsApp Web/Desktop with the message below already typed, addressed to the patient's phone.</li>
              <li>The receptionist reviews and hits <b>Send</b>. No SMS provider, no DLT, no recurring cost.</li>
              <li>Customise the message wording below — placeholders auto-fill with patient/doctor/visit details.</li>
            </ul>
          </div>

          {/* Country code */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">Country Code</label>
              <input
                className="input"
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="91"
              />
              <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-0.5">
                Prepended to 10-digit numbers. Default <b>91</b> (India).
              </div>
            </div>
          </div>

          {/* Placeholder cheatsheet */}
          <div>
            <div className="label">Available placeholders (click to insert)</div>
            <div className="flex flex-wrap gap-1.5">
              {WHATSAPP_PLACEHOLDERS.map((p) => (
                <button
                  key={p.token}
                  type="button"
                  onClick={() => insertPlaceholder(p.token)}
                  title={p.help + ' — sample: ' + p.sample}
                  className="text-[11px] font-mono px-2 py-1 rounded border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900/50"
                >
                  {p.token}
                </button>
              ))}
            </div>
          </div>

          {/* Template editor */}
          <div>
            <div className="flex items-center justify-between">
              <label className="label">Message Template</label>
              <button
                type="button"
                className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                onClick={() => setTemplate(DEFAULT_WHATSAPP_TEMPLATE)}
                title="Reset to the default template shipped with the app"
              >
                <RefreshCcw className="w-3 h-3" /> Reset to default
              </button>
            </div>
            <textarea
              className="input font-mono text-[12px]"
              rows={11}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              spellCheck={false}
            />
            <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-0.5">
              Use <code>*bold*</code>, <code>_italic_</code>, <code>~strike~</code> — WhatsApp formatting works inside the message.
            </div>
          </div>

          {/* Live preview */}
          <div>
            <div className="label flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5" /> Live preview (with sample data)
            </div>
            <div
              className="rounded-lg p-3 whitespace-pre-wrap text-[12px] leading-snug shadow-inner"
              style={{ background: '#dcf8c6', color: '#0b1f0f', border: '1px solid #b8e2a3' }}
            >
              {previewMessage}
            </div>
          </div>

          {/* Save bar */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-200 dark:border-slate-700">
            {dirty && (
              <span className="text-[11px] text-amber-700 dark:text-amber-300">
                Unsaved changes
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
