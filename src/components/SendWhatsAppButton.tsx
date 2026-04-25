import { useQuery } from '@tanstack/react-query';
import { WhatsAppIcon } from './WhatsAppIcon';
import { useToast } from '../hooks/useToast';
import { buildContext, buildWhatsAppUrl, renderTemplate, DEFAULT_WHATSAPP_TEMPLATE } from '../lib/whatsapp';
import { cn } from '../lib/utils';
import type { AppointmentWithJoins } from '../types';

type Variant = 'pill' | 'icon' | 'full';

export function SendWhatsAppButton({
  appointment,
  variant = 'pill',
  className,
}: {
  appointment: AppointmentWithJoins;
  variant?: Variant;
  className?: string;
}) {
  const toast = useToast();
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => window.electronAPI.settings.get(),
  });

  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!settings) return;
    if (!appointment.patient_phone || !appointment.patient_phone.replace(/\D/g, '')) {
      toast('Patient phone number is empty — cannot send WhatsApp', 'error');
      return;
    }
    const ctx = buildContext(appointment, settings);
    const template = settings.whatsapp_template || DEFAULT_WHATSAPP_TEMPLATE;
    const message = renderTemplate(template, ctx);
    const cc = settings.whatsapp_country_code || '91';
    const url = buildWhatsAppUrl(appointment.patient_phone, message, cc);
    if (!url) {
      toast(`Invalid phone number: ${appointment.patient_phone}`, 'error');
      return;
    }
    const res = await window.electronAPI.app.openExternal(url);
    if (!res.ok) {
      toast(res.error || 'Could not open WhatsApp', 'error');
    } else {
      toast('Opened WhatsApp — review the message and hit send', 'info');
    }
  };

  const tooltip = `Send appointment confirmation to ${appointment.patient_name} via WhatsApp`;

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={onClick}
        title={tooltip}
        aria-label={tooltip}
        className={cn(
          'inline-flex items-center justify-center w-7 h-7 rounded-md transition',
          'hover:bg-emerald-50 dark:hover:bg-emerald-900/30 active:scale-95',
          className
        )}
      >
        <WhatsAppIcon className="w-4 h-4" />
      </button>
    );
  }
  if (variant === 'full') {
    return (
      <button
        type="button"
        onClick={onClick}
        title={tooltip}
        className={cn(
          'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition active:scale-95',
          className
        )}
        style={{ backgroundColor: '#25D366' }}
      >
        <WhatsAppIcon className="w-4 h-4" filled={false} /> Send WhatsApp
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={tooltip}
      className={cn(
        'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold transition',
        'border border-emerald-500 text-emerald-700 dark:text-emerald-300 dark:border-emerald-700',
        'hover:bg-emerald-50 dark:hover:bg-emerald-900/30 active:scale-95',
        className
      )}
    >
      <WhatsAppIcon className="w-3.5 h-3.5" /> WhatsApp
    </button>
  );
}
