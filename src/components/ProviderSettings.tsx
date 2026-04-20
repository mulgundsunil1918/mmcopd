import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, MessageSquare, ExternalLink, Youtube, BookOpen } from 'lucide-react';
import { cn } from '../lib/utils';
import { useToast } from '../hooks/useToast';
import type { Settings } from '../types';

export function ProviderSettings({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(defaultOpen);

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => window.electronAPI.settings.save(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast('Settings saved');
    },
  });

  if (!settings) return null;

  return (
    <div className="card">
      <button
        type="button"
        className="w-full flex items-center justify-between p-4 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-blue-600" />
          <span className="font-semibold text-sm text-gray-900 dark:text-slate-100">Provider Settings (SMS / WhatsApp)</span>
          <span className="text-[11px] text-gray-500 dark:text-slate-400">
            SMS: {settings.sms_enabled ? 'On' : 'Off'} · WhatsApp: {settings.whatsapp_enabled ? 'On' : 'Off'}
          </span>
        </div>
        <ChevronDown className={cn('w-4 h-4 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t border-gray-200 dark:border-slate-700 p-4 space-y-4">
          <SetupGuide />

          <label className="flex items-center gap-2 text-sm text-gray-900 dark:text-slate-100">
            <input
              type="checkbox"
              checked={settings.sms_enabled}
              onChange={(e) => save.mutate({ sms_enabled: e.target.checked })}
            />
            <span>Enable SMS (Twilio)</span>
          </label>
          {settings.sms_enabled && (
            <div className="grid grid-cols-2 gap-3 pl-6">
              <LazyInput label="Account SID" value={settings.sms_account_sid || ''} onSave={(v) => save.mutate({ sms_account_sid: v })} />
              <LazyInput label="Auth Token" value={settings.sms_auth_token || ''} onSave={(v) => save.mutate({ sms_auth_token: v })} type="password" />
              <LazyInput label="From Number" value={settings.sms_from_number || ''} onSave={(v) => save.mutate({ sms_from_number: v })} />
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-gray-900 dark:text-slate-100">
            <input
              type="checkbox"
              checked={settings.whatsapp_enabled}
              onChange={(e) => save.mutate({ whatsapp_enabled: e.target.checked })}
            />
            <span>Enable WhatsApp</span>
          </label>
          {settings.whatsapp_enabled && (
            <div className="grid grid-cols-2 gap-3 pl-6">
              <LazyInput label="API URL" value={settings.whatsapp_api_url || ''} onSave={(v) => save.mutate({ whatsapp_api_url: v })} />
              <LazyInput label="API Key" value={settings.whatsapp_api_key || ''} onSave={(v) => save.mutate({ whatsapp_api_key: v })} type="password" />
            </div>
          )}

          <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2 dark:text-amber-300 dark:bg-amber-900/20 dark:border-amber-800">
            Providers are stubbed. When enabled, notifications are queued with status "pending". Actual sending will be wired in Stage 3.
          </div>
        </div>
      )}
    </div>
  );
}

function SetupGuide() {
  const [tab, setTab] = useState<'sms' | 'whatsapp'>('sms');
  return (
    <div className="rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-900/20 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-blue-200 dark:border-blue-900">
        <div className="flex items-center gap-2 text-sm font-semibold text-blue-900 dark:text-blue-200">
          <BookOpen className="w-4 h-4" /> Setup guide — how to get provider keys
        </div>
        <div className="flex gap-1 text-xs">
          <button
            className={`px-2 py-0.5 rounded ${tab === 'sms' ? 'bg-blue-600 text-white' : 'text-blue-800 dark:text-blue-200'}`}
            onClick={() => setTab('sms')}
          >
            SMS (Twilio)
          </button>
          <button
            className={`px-2 py-0.5 rounded ${tab === 'whatsapp' ? 'bg-emerald-600 text-white' : 'text-emerald-800 dark:text-emerald-200'}`}
            onClick={() => setTab('whatsapp')}
          >
            WhatsApp
          </button>
        </div>
      </div>
      <div className="p-3 text-xs text-gray-800 dark:text-slate-200 space-y-2">
        {tab === 'sms' ? (
          <>
            <ol className="list-decimal pl-5 space-y-1">
              <li>Sign up at <ExtLink href="https://www.twilio.com/try-twilio">twilio.com/try-twilio</ExtLink> (free trial gives test credit).</li>
              <li>Verify your mobile number on Twilio.</li>
              <li>In the Twilio console, buy a low-cost number (India numbers require KYC; trial number works for test sends).</li>
              <li>Copy your <b>Account SID</b> and <b>Auth Token</b> from the Twilio dashboard.</li>
              <li>Paste them below along with the purchased <b>From Number</b>.</li>
              <li>Flip the "Enable SMS" toggle — new appointments will queue messages with status <i>pending</i>. Actual sending is wired in Stage 3.</li>
            </ol>
            <div className="flex flex-wrap gap-3 pt-1">
              <ExtLink href="https://www.twilio.com/docs/sms/quickstart/node" icon="docs">Twilio SMS Quickstart (docs)</ExtLink>
              <ExtLink href="https://www.youtube.com/results?search_query=Twilio+SMS+tutorial+beginners+2024" icon="youtube">YouTube: Twilio SMS tutorial</ExtLink>
            </div>
          </>
        ) : (
          <>
            <p className="text-[11px] text-gray-700 dark:text-slate-300">
              Two common paths — pick whichever is easier for you:
            </p>
            <div>
              <div className="font-semibold text-emerald-800 dark:text-emerald-300">Path A — Meta WhatsApp Cloud API (official, free tier)</div>
              <ol className="list-decimal pl-5 space-y-1 mt-1">
                <li>Create a Meta Business account at <ExtLink href="https://business.facebook.com/">business.facebook.com</ExtLink>.</li>
                <li>Go to <ExtLink href="https://developers.facebook.com/apps/">Meta for Developers</ExtLink> → <b>Create App</b> → Business → add <b>WhatsApp</b> product.</li>
                <li>Get a temporary access token from the WhatsApp → API Setup page.</li>
                <li>Note your <b>Phone Number ID</b> and the graph API URL: <code className="px-1 rounded bg-white/60 dark:bg-black/30">https://graph.facebook.com/v19.0/&lt;phone-id&gt;/messages</code></li>
                <li>Paste the URL + access token below.</li>
              </ol>
            </div>
            <div>
              <div className="font-semibold text-emerald-800 dark:text-emerald-300 mt-2">Path B — Twilio WhatsApp Sandbox (fastest for testing)</div>
              <ol className="list-decimal pl-5 space-y-1 mt-1">
                <li>Same Twilio signup as SMS.</li>
                <li>Go to Messaging → Try it out → Send a WhatsApp message.</li>
                <li>Send the join code from your phone to the sandbox number.</li>
                <li>Use Twilio endpoint <code className="px-1 rounded bg-white/60 dark:bg-black/30">https://api.twilio.com/2010-04-01/Accounts/&lt;SID&gt;/Messages.json</code> as the API URL and Auth Token as the key.</li>
              </ol>
            </div>
            <div className="flex flex-wrap gap-3 pt-1">
              <ExtLink href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" icon="docs">Meta WhatsApp Cloud API docs</ExtLink>
              <ExtLink href="https://www.twilio.com/docs/whatsapp/quickstart/node" icon="docs">Twilio WhatsApp Quickstart</ExtLink>
              <ExtLink href="https://www.youtube.com/results?search_query=WhatsApp+Cloud+API+setup+tutorial" icon="youtube">YouTube: WhatsApp Cloud API setup</ExtLink>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ExtLink({ href, children, icon }: { href: string; children: React.ReactNode; icon?: 'docs' | 'youtube' }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-blue-300 hover:underline"
    >
      {icon === 'youtube' ? <Youtube className="w-3.5 h-3.5 text-red-500" /> : icon === 'docs' ? <BookOpen className="w-3.5 h-3.5" /> : <ExternalLink className="w-3.5 h-3.5" />}
      {children}
    </a>
  );
}

function LazyInput({ label, value, onSave, type = 'text' }: { label: string; value: string; onSave: (v: string) => void; type?: string }) {
  const [v, setV] = useState(value);
  return (
    <div>
      <label className="label">{label}</label>
      <input
        type={type}
        className="input"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== value && onSave(v)}
      />
    </div>
  );
}
