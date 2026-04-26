import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, RefreshCcw, Save } from 'lucide-react';
import { cn } from '../lib/utils';
import { useToast } from '../hooks/useToast';
import { WhatsAppIcon } from './WhatsAppIcon';
import {
  DEFAULT_WHATSAPP_TEMPLATE,
  WHATSAPP_PLACEHOLDERS,
  renderTemplate,
} from '../lib/whatsapp';
import type { Settings } from '../types';

/**
 * Simple two-pane editor for the click-to-WhatsApp template.
 * Left = preview (what the patient sees). Right = textarea you edit.
 * Variables get filled in automatically — no need to know placeholder syntax.
 */
export function WhatsAppMessaging({ defaultOpen = true }: { defaultOpen?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(defaultOpen);

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.electronAPI.settings.get(),
  });

  const [template, setTemplate] = useState<string>('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (settings) setTemplate(settings.whatsapp_template || DEFAULT_WHATSAPP_TEMPLATE);
  }, [settings?.whatsapp_template]);

  const dirty =
    settings != null &&
    template !== (settings.whatsapp_template || DEFAULT_WHATSAPP_TEMPLATE);

  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => window.electronAPI.settings.save(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast('Saved');
    },
  });

  if (!settings) return null;

  // Build the preview context — real clinic values + sample patient/visit data.
  const sampleCtx = Object.fromEntries(
    WHATSAPP_PLACEHOLDERS.map((p) => [p.token.replace(/[{}]/g, '').trim(), p.sample])
  );
  sampleCtx['clinic_name'] = settings.clinic_name || sampleCtx['clinic_name'];
  sampleCtx['clinic_phone'] = settings.clinic_phone || sampleCtx['clinic_phone'];
  sampleCtx['clinic_address'] = settings.clinic_address || sampleCtx['clinic_address'];
  const previewMessage = renderTemplate(template, sampleCtx);

  // Insert a placeholder at the cursor position (or at the end if no focus).
  const insertAtCursor = (token: string) => {
    const ta = textareaRef.current;
    if (!ta) {
      setTemplate((t) => t + token);
      return;
    }
    const start = ta.selectionStart ?? template.length;
    const end = ta.selectionEnd ?? template.length;
    const next = template.slice(0, start) + token + template.slice(end);
    setTemplate(next);
    // Restore caret to right after the inserted token on next render.
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + token.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  // The 6 variables the user is most likely to want — friendly labels.
  const QUICK_VARS: { label: string; token: string }[] = [
    { label: 'Patient name', token: '{{patient_name}}' },
    { label: 'Doctor', token: '{{doctor_name}}' },
    { label: 'Date', token: '{{date}}' },
    { label: 'Time', token: '{{time}}' },
    { label: 'Token #', token: '{{token}}' },
    { label: 'Room number', token: '{{room}}' },
    { label: 'Visit ID', token: '{{visit_id}}' },
    { label: 'Clinic name', token: '{{clinic_name}}' },
    { label: 'Clinic phone', token: '{{clinic_phone}}' },
    { label: 'Clinic address', token: '{{clinic_address}}' },
  ];

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
            WhatsApp Message
          </span>
          <span className="text-[11px] text-gray-500 dark:text-slate-400">
            What gets sent when you click the WhatsApp button on an appointment
          </span>
        </div>
        <ChevronDown className={cn('w-4 h-4 transition', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="border-t border-gray-200 dark:border-slate-700 p-4">
          {/* === Two-pane editor: edit left, preview right === */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* EDIT */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="label mb-0">✏️ Your message</label>
                <button
                  type="button"
                  className="text-[11px] text-gray-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 inline-flex items-center gap-1"
                  onClick={() => setTemplate(DEFAULT_WHATSAPP_TEMPLATE)}
                  title="Restore the recommended message"
                >
                  <RefreshCcw className="w-3 h-3" /> Reset
                </button>
              </div>
              <textarea
                ref={textareaRef}
                className="input text-[13px]"
                rows={16}
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                spellCheck={false}
                style={{ fontFamily: 'inherit', lineHeight: 1.5 }}
              />
            </div>

            {/* PREVIEW */}
            <div>
              <div className="label mb-1.5">📱 Preview — exactly what the patient sees</div>
              <div
                className="rounded-lg p-3 min-h-[420px]"
                style={{ background: '#0b141a' }}
              >
                <div
                  className="rounded-2xl rounded-tr-sm p-3 whitespace-pre-wrap text-[13px] leading-snug shadow-md inline-block max-w-full"
                  style={{ background: '#dcf8c6', color: '#0b1f0f' }}
                >
                  {whatsappFormat(previewMessage)}
                  <div className="text-right text-[10px] mt-1.5" style={{ color: '#5b7e63' }}>
                    10:30 AM ✓✓
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* === Variable chips — small, single line === */}
          <div className="mt-4 pt-3 border-t border-gray-200 dark:border-slate-700">
            <div className="text-[11px] text-gray-600 dark:text-slate-300 mb-1.5">
              Click to insert a variable — it auto-fills with the real value when you send:
            </div>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_VARS.map((v) => (
                <button
                  key={v.token}
                  type="button"
                  onClick={() => insertAtCursor(v.token)}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition"
                >
                  + {v.label}
                </button>
              ))}
            </div>
          </div>

          {/* === Save bar === */}
          <div className="flex items-center justify-end gap-2 pt-4 mt-3 border-t border-gray-200 dark:border-slate-700">
            {dirty && (
              <span className="text-[11px] text-amber-700 dark:text-amber-300 font-semibold mr-auto">
                ● Unsaved changes
              </span>
            )}
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={!dirty}
              onClick={() => setTemplate(settings.whatsapp_template || DEFAULT_WHATSAPP_TEMPLATE)}
            >
              Discard
            </button>
            <button
              type="button"
              className="btn-success text-xs"
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate({ whatsapp_template: template })}
            >
              <Save className="w-3.5 h-3.5" /> {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Render WhatsApp formatting (*bold*, _italic_) as actual HTML in the preview
 * so the user sees the real visual output, not raw asterisks.
 */
function whatsappFormat(text: string): React.ReactNode {
  // Process *bold* and _italic_ in a simple linear pass.
  const parts: React.ReactNode[] = [];
  const re = /(\*[^*\n]+\*)|(_[^_\n]+_)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text))) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const segment = match[0];
    if (segment.startsWith('*')) {
      parts.push(<b key={key++}>{segment.slice(1, -1)}</b>);
    } else if (segment.startsWith('_')) {
      parts.push(<i key={key++}>{segment.slice(1, -1)}</i>);
    }
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}
