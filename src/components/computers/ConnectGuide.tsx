/**
 * "Connect your computers" — the step-by-step guide for a clinic that uses more than one computer: choose cable / Wi-Fi / one cable between two computers,
 * what to buy (with Amazon.in search links), how to plug it in, the Windows settings every computer needs, setting up the main computer and each other
 * computer, a "Check this computer" button, and adding the people.
 *
 * ONE component for every place it appears — the first-start Setup guide, Settings → Computers & staff and the Help page — so they say the same thing. The
 * words are in lib/connectGuide.ts (so a test can hold them to their rules); the judging of "Check this computer" is in lib/connectCheck.ts.
 * Nothing here changes a computer's settings except the one answer "how is this computer connected" (saved with the computer), and the optional
 * "never sleep" button, which uses the same call as the main-computer power warning.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, Cable, Check, CheckCircle2, ChevronDown, Copy, ExternalLink, Info, Loader2, Monitor, Plug, Printer, Search, ShoppingCart, Wifi, X, XCircle,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  CONNECTIONS, DIRECT_ADDRESSES, GUIDE_STEPS, WIN_PAGE_URI, WINDOWS_STEPS, WORKING_SIGNS, amazonSearchUrl, connectionInfo, firewallCommands, parseConnection, shoppingFor, windowsStepsFor,
  type Connection, type WinStep,
} from '../../lib/connectGuide';
import { assessComputer, describeChoice, summarizeCheck, type CheckRow, type NetFacts } from '../../lib/connectCheck';
import { thisComputer, type ThisComputer } from '../../lib/computers';
import { copyText } from '../../lib/clipboard';
import { useToast } from '../../hooks/useToast';
import { ConnectionDiagram } from './ConnectDiagrams';
import { ConnectChecklistPrint } from './ConnectChecklistPrint';

// ---------------------------------------------------------------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------------------------------------------------------------

/** Per-computer ticks ("I have done this"). A convenience only — losing them harms nothing — so they live in browser storage, never in the clinic's data. */
function useTicks(key: string) {
  const [ticks, setTicks] = useState<Record<string, boolean>>(() => {
    try { const o = JSON.parse(localStorage.getItem(key) || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
  });
  const toggle = useCallback((id: string) => {
    setTicks((cur) => {
      const next = { ...cur, [id]: !cur[id] };
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* the tick just is not remembered */ }
      return next;
    });
  }, [key]);
  return [ticks, toggle] as const;
}

const isWindows = () => { try { return /windows/i.test(navigator.userAgent); } catch { return false; } };

/** Open an address in the person's own browser / Windows Settings (only the addresses main/external-url.ts allows). */
async function openLink(url: string) {
  try {
    const r = await window.electronAPI.app.openExternal(url);
    if (r && r.ok === false) throw new Error(r.error || 'not opened');
  } catch { /* a link that cannot open is not worth an error box */ }
}

/** How THIS computer is connected, and the one call that saves it (with this computer, never the main one's). */
export function useConnectionChoice() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.electronAPI.settings.get() });
  const choice = parseConnection((settings as any)?.network_connection);
  const choose = async (c: Connection) => {
    try {
      await window.electronAPI.settings.save({ network_connection: c } as any);
      await qc.invalidateQueries({ queryKey: ['settings'] });
    } catch (e: any) { toast(e?.message || 'Could not save that choice', 'error'); }
  };
  return { choice, choose, settings, ready: !!settings };
}

const ICON: Record<Connection, typeof Cable> = { cable: Cable, wifi: Wifi, direct: Plug };

// ---------------------------------------------------------------------------------------------------------------------------------
// step 1 — the choice
// ---------------------------------------------------------------------------------------------------------------------------------

/** The three ways to connect. `compact` = just the three buttons (used in the Setup guide); otherwise full cards with the good and the watch-outs. */
export function ConnectionPicker({ value, onChange, compact, disabled }: { value: Connection | ''; onChange: (c: Connection) => void; compact?: boolean; disabled?: boolean }) {
  return (
    <div className={cn('grid gap-3', compact ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 lg:grid-cols-3')} role="radiogroup" aria-label="How is this computer connected?">
      {CONNECTIONS.map((c) => {
        const Icon = ICON[c.id];
        const on = value === c.id;
        return (
          <button key={c.id} type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => onChange(c.id)}
            className={cn('text-left rounded-xl border-2 transition disabled:opacity-60', compact ? 'p-3' : 'p-4',
              on ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-slate-700 hover:border-blue-400')}>
            <div className="flex items-center gap-2">
              <span className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', on ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300')}><Icon className="w-4 h-4" /></span>
              <span className="min-w-0">
                <span className="block text-[13px] font-bold text-gray-900 dark:text-slate-100 leading-snug">{c.title}</span>
                <span className={cn('inline-block text-[10px] uppercase tracking-wide font-semibold mt-0.5', c.id === 'cable' ? 'text-emerald-700 dark:text-emerald-300' : 'text-gray-500 dark:text-slate-400')}>{c.tag}</span>
              </span>
              {on && <Check className="w-4 h-4 text-blue-600 ml-auto shrink-0" />}
            </div>
            {!compact && (
              <div className="mt-2.5 space-y-2 text-[12px] text-gray-700 dark:text-slate-300">
                <ul className="space-y-1">{c.good.map((g) => <li key={g} className="flex gap-1.5"><Check className="w-3.5 h-3.5 mt-0.5 text-emerald-600 shrink-0" /><span>{g}</span></li>)}</ul>
                <ul className="space-y-1">{c.watch.map((g) => <li key={g} className="flex gap-1.5"><Info className="w-3.5 h-3.5 mt-0.5 text-amber-600 shrink-0" /><span>{g}</span></li>)}</ul>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// step 2 — what to buy
// ---------------------------------------------------------------------------------------------------------------------------------

function ShoppingList({ choice }: { choice: Connection | '' }) {
  const shown: Connection = choice || 'cable';
  const items = shoppingFor(shown);
  return (
    <div className="space-y-3">
      {!choice && <div className="text-[12px] text-amber-800 dark:text-amber-200 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2">Choose how the computers will connect in step 1 to see the list for your choice. This is the list for a network cable.</div>}
      <ul className="divide-y divide-gray-100 dark:divide-slate-800 rounded-lg border border-gray-200 dark:border-slate-700">
        {items.map((i) => (
          <li key={i.id} className="flex items-start gap-3 p-3">
            <ShoppingCart className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-gray-900 dark:text-slate-100">{i.title}{i.optional && <span className="ml-2 text-[10px] uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400">if you need it</span>}</div>
              <div className="text-[12px] text-gray-600 dark:text-slate-300 mt-0.5">{i.why}</div>
            </div>
            <button type="button" className="btn-secondary text-xs shrink-0" onClick={() => openLink(amazonSearchUrl(i.query))} title={`Opens an Amazon.in search for “${i.query}” in your browser`}>
              <Search className="w-3.5 h-3.5" /> Search on Amazon.in
            </button>
          </li>
        ))}
      </ul>
      <div className="text-[11px] text-gray-500 dark:text-slate-400">These open a plain search in your browser — choose whatever make, length and price suits you, from any seller. Any ordinary Cat5e or Cat6 cable and any gigabit switch will do.</div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// step 3 — plugging in
// ---------------------------------------------------------------------------------------------------------------------------------

const PLUG: Record<Connection, string[]> = {
  cable: [
    'Put the router (and the switch, if you use one) where every cable can reach — on a shelf, not shut in a cupboard.',
    'Using a switch? Run one cable from a free LAN socket on the router to the switch. The computers then plug into the switch.',
    'Push one end of a cable into the computer’s network socket (the square socket with a network symbol) and the other end into a free LAN socket on the router or switch. It clicks when it is in. Do this for every computer.',
    'The small lights beside the socket should come on or blink within a few seconds. In Windows the symbol at the bottom-right of the screen changes from Wi-Fi bars to a small computer.',
    'Keep cables out of walkways and do not bend them sharply.',
  ],
  wifi: [
    'Put the router in the middle of the clinic, up high and in the open — walls and cupboards weaken the signal.',
    'On every computer join the clinic’s Wi-Fi (the same name everywhere) — the Windows steps below show how.',
    'The main computer matters most: if you can, put it on a network cable to the router and use Wi-Fi only for the others.',
  ],
  direct: [
    'Push one end of the cable into the network socket of the main computer and the other end into the network socket of the other computer. It clicks when it is in.',
    'The small lights beside the sockets should come on.',
    'Now give each computer its fixed address (the Windows steps below). Without it Windows waits and then picks an address CureDesk cannot use.',
  ],
};

// ---------------------------------------------------------------------------------------------------------------------------------
// step 4 — the Windows settings
// ---------------------------------------------------------------------------------------------------------------------------------

function CommandBox({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-gray-50 dark:bg-slate-800 text-[11px] font-semibold text-gray-600 dark:text-slate-300">
        <span>{label}</span>
        <button type="button" className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-300 hover:underline"
          onClick={async () => { if (await copyText(text)) { setCopied(true); setTimeout(() => setCopied(false), 1500); } }}>
          {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
        </button>
      </div>
      <pre className="px-3 py-2 text-[11px] leading-relaxed font-mono overflow-x-auto bg-white dark:bg-slate-900 text-gray-800 dark:text-slate-200 whitespace-pre-wrap break-all">{text}</pre>
    </div>
  );
}

function WindowsStepCard({ step, ver, open, onToggle, ticked, onTick, choice, n }: {
  step: WinStep; ver: 'win11' | 'win10'; open: boolean; onToggle: () => void; ticked: boolean; onTick: () => void; choice: Connection; n: number;
}) {
  const clicks = ver === 'win11' ? step.win11 : step.win10;
  return (
    <li id={`win-${step.id}`} className={cn('rounded-xl border transition', ticked ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-900/10' : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900/40')}>
      <div className="flex items-start gap-3 p-3">
        <button type="button" role="checkbox" aria-checked={ticked} onClick={onTick} title={ticked ? 'Done — click to undo' : 'Tick when you have done this'}
          className={cn('mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center shrink-0', ticked ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300 dark:border-slate-600 hover:border-blue-500')}>
          {ticked && <Check className="w-3.5 h-3.5" />}
        </button>
        <button type="button" onClick={onToggle} className="flex-1 min-w-0 text-left" aria-expanded={open}>
          <span className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold text-gray-900 dark:text-slate-100">{n}. {step.title}</span>
            <span className={cn('text-[10px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded', step.need === 'required' ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200' : 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300')}>{step.need === 'required' ? 'Needed' : 'Recommended'}</span>
            <span className="text-[10px] uppercase tracking-wide font-semibold text-blue-700 dark:text-blue-300">{step.who === 'main' ? 'Main computer' : 'Every computer'}</span>
          </span>
          {!open && <span className="block text-[12px] text-gray-500 dark:text-slate-400 mt-0.5 line-clamp-1">{step.why}</span>}
        </button>
        <button type="button" onClick={onToggle} aria-label={open ? 'Hide the steps' : 'Show the steps'} className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-slate-200">
          <ChevronDown className={cn('w-4 h-4 transition-transform', open && 'rotate-180')} />
        </button>
      </div>
      {open && (
        <div className="px-4 pb-4 pl-11 space-y-2 text-[12.5px] text-gray-700 dark:text-slate-300">
          <p><b>Why:</b> {step.why}</p>
          <ol className="list-decimal pl-5 space-y-1.5">{clicks.map((c, i) => <li key={i}>{c}</li>)}</ol>
          {step.id === 'address-direct' && (
            <table className="text-[12px] border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden">
              <tbody>
                <tr className="bg-gray-50 dark:bg-slate-800"><th className="text-left px-3 py-1.5">&nbsp;</th><th className="px-3 py-1.5 text-left">IP address</th><th className="px-3 py-1.5 text-left">Subnet mask</th><th className="px-3 py-1.5 text-left">Gateway / DNS</th></tr>
                <tr><td className="px-3 py-1.5 font-semibold">Main computer</td><td className="px-3 py-1.5 font-mono">{DIRECT_ADDRESSES.main}</td><td className="px-3 py-1.5 font-mono">{DIRECT_ADDRESSES.mask}</td><td className="px-3 py-1.5 text-gray-500">leave empty</td></tr>
                <tr><td className="px-3 py-1.5 font-semibold">Other computer</td><td className="px-3 py-1.5 font-mono">{DIRECT_ADDRESSES.other}</td><td className="px-3 py-1.5 font-mono">{DIRECT_ADDRESSES.mask}</td><td className="px-3 py-1.5 text-gray-500">leave empty</td></tr>
              </tbody>
            </table>
          )}
          {step.open && isWindows() && (
            <div><button type="button" className="btn-secondary text-xs" onClick={() => openLink(WIN_PAGE_URI[step.open!.page])}><ExternalLink className="w-3.5 h-3.5" /> {step.open.label}</button></div>
          )}
          {step.commands?.map((c) => <CommandBox key={c.label} label={c.label} text={step.id === 'firewall' ? firewallCommands(choice) : c.text} />)}
          {step.note && <p className="text-[12px] text-gray-600 dark:text-slate-400 rounded-lg bg-gray-50 dark:bg-slate-800/60 px-3 py-2"><b>Good to know:</b> {step.note}</p>}
        </div>
      )}
    </li>
  );
}

function WindowsSteps({ choice, openId, setOpenId }: { choice: Connection | ''; openId: string | null; setOpenId: (id: string | null) => void }) {
  const shown: Connection = choice || 'cable';
  const steps = useMemo(() => windowsStepsFor(shown), [shown]);
  const [ver, setVer] = useState<'win11' | 'win10'>(() => { try { return localStorage.getItem('caredesk-win-version') === 'win10' ? 'win10' : 'win11'; } catch { return 'win11'; } });
  const pick = (v: 'win11' | 'win10') => { setVer(v); try { localStorage.setItem('caredesk-win-version', v); } catch { /* ignore */ } };
  const [ticks, toggle] = useTicks('caredesk-connect-windows');
  const doneCount = steps.filter((s) => ticks[s.id]).length;
  return (
    <div className="space-y-3">
      {!choice && <div className="text-[12px] text-amber-800 dark:text-amber-200 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2">Choose how the computers will connect in step 1 — the settings differ a little. This is the list for a network cable.</div>}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[12px] text-gray-600 dark:text-slate-300">Do these on <b>every</b> computer (the ones marked “Main computer” only on the main one). Tick each as you go — {doneCount} of {steps.length} done.</div>
        <div className="inline-flex rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden text-[12px]" role="group" aria-label="Which Windows">
          {(['win11', 'win10'] as const).map((v) => (
            <button key={v} type="button" onClick={() => pick(v)} aria-pressed={ver === v}
              className={cn('px-3 py-1.5 font-semibold', ver === v ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800')}>
              {v === 'win11' ? 'Windows 11' : 'Windows 10'}
            </button>
          ))}
        </div>
      </div>
      <div className="text-[11px] text-gray-500 dark:text-slate-400 -mt-1">Not sure which? Windows 11 has the Start button in the middle of the bottom bar; Windows 10 has it at the far left.</div>
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <WindowsStepCard key={s.id} step={s} n={i + 1} ver={ver} choice={shown} open={openId === s.id} onToggle={() => setOpenId(openId === s.id ? null : s.id)} ticked={!!ticks[s.id]} onTick={() => toggle(s.id)} />
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// step 7 — Check this computer
// ---------------------------------------------------------------------------------------------------------------------------------

const STATUS_STYLE: Record<CheckRow['status'], { icon: typeof Check; cls: string; box: string }> = {
  ok: { icon: CheckCircle2, cls: 'text-emerald-600 dark:text-emerald-400', box: 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-900/10' },
  info: { icon: Info, cls: 'text-blue-600 dark:text-blue-400', box: 'border-blue-200 dark:border-blue-900/60 bg-blue-50/60 dark:bg-blue-900/10' },
  warn: { icon: AlertTriangle, cls: 'text-amber-600 dark:text-amber-400', box: 'border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-900/10' },
  bad: { icon: XCircle, cls: 'text-red-600 dark:text-red-400', box: 'border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-900/10' },
};

type DiagStep = { id: string; label: string; ok: boolean; detail: string; hint?: string };

export function ConnectionCheck({ choice, here, onShow }: { choice: Connection | ''; here: ThisComputer; onShow?: (step: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<'check' | 'find' | 'test' | null>(null);
  const [facts, setFacts] = useState<NetFacts | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [found, setFound] = useState<{ ip: string; version?: string }[] | null>(null);
  const [diag, setDiag] = useState<{ ok: boolean; steps: DiagStep[] } | null>(null);

  const rows = useMemo(() => (facts ? assessComputer(facts, { choice, here }) : []), [facts, choice, here]);
  const summary = useMemo(() => summarizeCheck(rows), [rows]);

  const run = async () => {
    setBusy('check'); setErr(null);
    try { setFacts(await window.electronAPI.network.checkComputer()); }
    catch (e: any) { setErr(e?.message || 'CureDesk could not look at this computer.'); }
    finally { setBusy(null); }
  };
  const find = async () => {
    setBusy('find'); setFound(null);
    try { const r = await window.electronAPI.network.findHosts(); setFound(r.hosts ?? []); }
    catch { setFound([]); }
    finally { setBusy(null); }
  };
  const test = async () => {
    setBusy('test'); setDiag(null);
    try { const r = await window.electronAPI.network.diagnose(); setDiag({ ok: r.ok, steps: r.steps as DiagStep[] }); }
    catch (e: any) { setDiag({ ok: false, steps: [{ id: 'err', label: 'The check could not run', ok: false, detail: e?.message || 'Unknown error' }] }); }
    finally { setBusy(null); }
  };
  const neverSleep = async () => {
    const r = await window.electronAPI.network.disableHostSleep();
    toast(r.ok ? 'This computer is now set to never sleep' : (r.error || 'Windows did not accept the change'), r.ok ? 'success' : 'error');
    qc.invalidateQueries({ queryKey: ['host-power'] });
    await run();
  };

  return (
    <div className="space-y-3">
      <div className="text-[12.5px] text-gray-700 dark:text-slate-300">
        CureDesk looks at <b>this computer</b> — how it is connected, the Windows network type{here === 'main' ? ', the sleep setting and whether the others can reach it' : ''} — and tells you in plain words what to fix.
        You chose: <b>{describeChoice(choice)}</b>.
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary text-xs" disabled={busy !== null} onClick={run}>{busy === 'check' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Check this computer</button>
        {here !== 'main' && <button type="button" className="btn-secondary text-xs" disabled={busy !== null} onClick={find}>{busy === 'find' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />} Look for the main computer</button>}
        {here === 'other' && <button type="button" className="btn-secondary text-xs" disabled={busy !== null} onClick={test}>{busy === 'test' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Monitor className="w-3.5 h-3.5" />} Test the link to the main computer</button>}
      </div>
      {err && <div className="text-[12px] text-red-700 dark:text-red-300 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2">{err}</div>}

      {facts && (
        <div className="space-y-2">
          <div className={cn('rounded-lg px-3 py-2 text-[13px] font-bold flex items-center gap-2', summary.level === 'ok' ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100' : summary.level === 'warn' ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100' : 'bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-100')}>
            {summary.level === 'ok' ? <CheckCircle2 className="w-4 h-4" /> : summary.level === 'warn' ? <AlertTriangle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {summary.headline}
          </div>
          <ul className="space-y-2">
            {rows.map((r) => {
              const st = STATUS_STYLE[r.status];
              const Icon = st.icon;
              return (
                <li key={r.id} className={cn('rounded-lg border px-3 py-2 flex gap-2.5', st.box)}>
                  <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', st.cls)} />
                  <div className="min-w-0 flex-1 text-[12.5px]">
                    <div className="font-semibold text-gray-900 dark:text-slate-100">{r.title}</div>
                    <div className="text-gray-700 dark:text-slate-300">{r.detail}</div>
                    {r.fix && <div className="text-gray-900 dark:text-slate-100 mt-0.5"><b>What to do:</b> {r.fix}</div>}
                    <div className="flex flex-wrap gap-2 mt-1.5">
                      {r.action === 'disable-sleep' && <button type="button" className="btn-secondary text-xs" onClick={neverSleep}>Set this computer to never sleep</button>}
                      {r.step && onShow && <button type="button" className="text-[12px] font-semibold text-blue-700 dark:text-blue-300 hover:underline inline-flex items-center gap-1" onClick={() => onShow(r.step!)}>Show me how <ArrowRight className="w-3 h-3" /></button>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="text-[11px] text-gray-500 dark:text-slate-400">
            {here === 'main' ? 'To prove the network between the computers, open this same page on another computer and press “Check this computer” there — or look for “connected” above.' : 'This looks at this computer only. The main computer has its own check.'}
          </div>
        </div>
      )}

      {found && (
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 px-3 py-2 text-[12.5px]">
          {found.length === 0 ? (
            <div><b>No main computer found on this network.</b> Make sure CureDesk is open on the main computer, both computers are on the same router (not a Guest Wi-Fi) and the steps under “Windows settings” are done on both — then try again. You can also type the main computer’s address by hand when you connect.</div>
          ) : (
            <div><b>Found the main computer:</b>{' '}{found.map((h, i) => <span key={h.ip} className="font-mono">{i ? ', ' : ''}{h.ip}{h.version ? ` (CureDesk ${h.version})` : ''}</span>)}. That means the two computers can see each other.</div>
          )}
        </div>
      )}

      {diag && (
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 px-3 py-2 text-[12.5px] space-y-1.5">
          <div className={cn('font-bold', diag.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300')}>{diag.ok ? 'The link to the main computer works.' : 'The link to the main computer has a problem.'}</div>
          {diag.steps.map((s) => (
            <div key={s.id} className="flex gap-2">
              {s.ok ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-emerald-600 shrink-0" /> : <XCircle className="w-3.5 h-3.5 mt-0.5 text-red-600 shrink-0" />}
              <div><b>{s.label}</b> — {s.detail}{!s.ok && s.hint && <div className="text-gray-700 dark:text-slate-300"><b>What to do:</b> {s.hint}</div>}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// the guide
// ---------------------------------------------------------------------------------------------------------------------------------

const openWizard = (start: 'host' | 'join') => {
  try { sessionStorage.removeItem('caredesk:welcome-dismissed'); localStorage.removeItem('caredesk:welcome-dismissed'); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('caredesk:openWelcomeWizard', { detail: { start } }));
};

function Para({ children }: { children: React.ReactNode }) { return <p className="text-[12.5px] text-gray-700 dark:text-slate-300">{children}</p>; }
function Steps({ items }: { items: React.ReactNode[] }) {
  return <ol className="list-decimal pl-5 space-y-1.5 text-[12.5px] text-gray-700 dark:text-slate-300">{items.map((t, i) => <li key={i}>{t}</li>)}</ol>;
}

export function ConnectGuide({ showHeader = true }: { showHeader?: boolean }) {
  const navigate = useNavigate();
  const { choice, choose, settings } = useConnectionChoice();
  const here = thisComputer(settings as any);
  const [open, setOpen] = useState<string | null>('choose');
  const [winOpen, setWinOpen] = useState<string | null>(null);
  const [ticks, toggleTick] = useTicks('caredesk-connect-steps');
  const [printing, setPrinting] = useState(false);
  const { data: joinCode } = useQuery({ queryKey: ['join-code'], queryFn: () => window.electronAPI.network.joinCode(), enabled: here === 'main', refetchInterval: 15_000 });

  /** "Show me how" from a check result: open the step (and, for a Windows step, the card) and bring it into view. */
  const show = (id: string) => {
    const isWin = WINDOWS_STEPS.some((s) => s.id === id);
    setOpen(isWin ? 'windows' : id);
    if (isWin) setWinOpen(id);
    setTimeout(() => { try { document.getElementById(isWin ? `win-${id}` : `connect-step-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* ignore */ } }, 80);
  };
  const next = (id: string) => { const i = GUIDE_STEPS.findIndex((s) => s.id === id); const n = GUIDE_STEPS[i + 1]; if (n) { setOpen(n.id); setTimeout(() => document.getElementById(`connect-step-${n.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); } };

  const body = (id: string): React.ReactNode => {
    switch (id) {
      case 'choose': return (
        <div className="space-y-3">
          <Para>This is about <b>this</b> computer. The computers do not all have to be connected the same way — the main computer on a cable and the others on Wi-Fi works well, as long as they are all on the same router.</Para>
          <ConnectionPicker value={choice} onChange={choose} />
          {choice && <div className="max-w-xl mx-auto"><ConnectionDiagram kind={choice} /></div>}
        </div>
      );
      case 'buy': return <ShoppingList choice={choice} />;
      case 'plug': return (
        <div className="space-y-3">
          {!choice && <div className="text-[12px] text-amber-800 dark:text-amber-200 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2">Choose how the computers will connect in step 1. These steps are for a network cable.</div>}
          <div className="max-w-xl"><ConnectionDiagram kind={choice || 'cable'} /></div>
          <Steps items={PLUG[choice || 'cable']} />
        </div>
      );
      case 'windows': return <WindowsSteps choice={choice} openId={winOpen} setOpenId={setWinOpen} />;
      case 'main': return (
        <div className="space-y-3">
          <Steps items={[
            'Choose the computer that is switched on all day and is the most dependable — usually the reception computer. It holds all the clinic’s data; the others borrow it.',
            <>Install CureDesk on it and open it. In the Setup guide answer <b>“More than one computer”</b>, then press <b>“This is the main computer”</b> (or use the button below).</>,
            'Give it a name, for example “Reception Desk”. CureDesk then shows a join code — five letters and numbers (capital and small letters are different). The other computers need it. It lasts 10 minutes; press “New code” for another.',
            'When Windows asks about the firewall, tick Private networks and press Allow access.',
            'Leave CureDesk open on this computer during clinic hours.',
          ]} />
          {here === 'main' ? (
            <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-900/10 px-3 py-2 text-[12.5px] flex items-center gap-2 flex-wrap">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" /> <b>This is the main computer.</b>
              {joinCode?.code ? <>Join code: <span className="font-mono font-bold tracking-wider">{joinCode.code}</span>{joinCode.lanIp ? <> · address <span className="font-mono">{joinCode.lanIp}</span></> : null}</> : <span className="text-gray-600 dark:text-slate-400">The code appears under Connecting the Computers.</span>}
            </div>
          ) : here === 'other' ? (
            <div className="text-[12px] text-gray-600 dark:text-slate-400">This computer is an extra computer, so it cannot also be the main one. Do this step on the main computer.</div>
          ) : (
            <button type="button" className="btn-primary text-xs" onClick={() => openWizard('host')}><Monitor className="w-3.5 h-3.5" /> Set this computer up as the main computer</button>
          )}
        </div>
      );
      case 'others': return (
        <div className="space-y-3">
          <Steps items={[
            'Install the same CureDesk on the other computer and open it.',
            <>In the Setup guide choose <b>“More than one computer”</b> → <b>“This computer joins a clinic that is already set up”</b> (or use the button below).</>,
            'CureDesk looks for the main computer by itself — pick it from the list. If it finds nothing, choose “Type the code manually” and type the main computer’s address (shown on its join-code screen).',
            'Type the join code exactly as shown — capital and small letters are different.',
            'Name this computer (for example “Doctor Cabin 1” or “Pharmacy”) and restart CureDesk once.',
          ]} />
          {here === 'other' ? (
            <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-900/10 px-3 py-2 text-[12.5px] flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-600" /> <b>This computer is connected to the main computer.</b></div>
          ) : here === 'main' ? (
            <div className="text-[12px] text-gray-600 dark:text-slate-400">This is the main computer. Do this step on each of the other computers.</div>
          ) : (
            <button type="button" className="btn-primary text-xs" onClick={() => openWizard('join')}><Monitor className="w-3.5 h-3.5" /> Connect this computer to the main one</button>
          )}
        </div>
      );
      case 'check': return <ConnectionCheck choice={choice} here={here} onShow={show} />;
      case 'people': return (
        <div className="space-y-3">
          <Steps items={[
            <>On the main computer open <b>Users &amp; Access → Add User</b>. Give each person their own username, a password and a role (Reception, Doctor, Nurse, Pharmacist …).</>,
            'Each person then signs in on any computer with their own login. The Admin can sign in anywhere; the clinic’s Settings are changed on the main computer.',
            <>On each computer open <b>Settings → Computers &amp; staff → This Computer’s Job</b> and choose what it is for (reception desk, doctor’s cabin, pharmacy counter …). Its menu then shows only what it needs.</>,
          ]} />
          <div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary text-xs" onClick={() => navigate('/users')}>Open Users &amp; Access</button></div>
          <div className="rounded-lg bg-gray-50 dark:bg-slate-800/60 px-3 py-2 text-[12px] text-gray-700 dark:text-slate-300">
            <div className="font-semibold mb-1">How you know it works</div>
            <ul className="list-disc pl-5 space-y-0.5">{WORKING_SIGNS.map((w) => <li key={w}>{w}</li>)}</ul>
          </div>
        </div>
      );
      default: return null;
    }
  };

  return (
    <section className="space-y-3" aria-label="Connect your computers">
      {printing && <ConnectChecklistPrint choice={choice} onClose={() => setPrinting(false)} />}
      {showHeader && (
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 max-w-2xl">
            <div className="text-[15px] font-bold text-gray-900 dark:text-slate-100">Connect your computers — step by step</div>
            <div className="text-[12.5px] text-gray-600 dark:text-slate-300 mt-0.5">
              The computers talk to each other over the clinic’s own network — nothing goes over the internet. Join them with a network cable (best), with Wi-Fi, or — with only two computers — with one cable between them. Each step takes a couple of minutes.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary text-xs" onClick={() => setPrinting(true)}><Printer className="w-3.5 h-3.5" /> Print the checklist</button>
            <button type="button" className="btn-secondary text-xs" onClick={() => openLink('https://curedesk.co.in/multi-station.html')} title="Opens the illustrated Setup & Recovery guide in your browser"><ExternalLink className="w-3.5 h-3.5" /> Illustrated guide online</button>
          </div>
        </div>
      )}
      <ol className="space-y-2">
        {GUIDE_STEPS.map((s, i) => {
          const isOpen = open === s.id;
          const done = !!ticks[s.id];
          return (
            <li key={s.id} id={`connect-step-${s.id}`} className={cn('rounded-xl border-2 transition', isOpen ? 'border-blue-300 dark:border-blue-800 bg-white dark:bg-slate-900/40' : 'border-gray-200 dark:border-slate-700 bg-white/60 dark:bg-slate-900/20')}>
              <button type="button" onClick={() => setOpen(isOpen ? null : s.id)} aria-expanded={isOpen} className="w-full flex items-center gap-3 px-4 py-3 text-left">
                <span className={cn('w-7 h-7 rounded-full flex items-center justify-center text-[13px] font-bold shrink-0', done ? 'bg-emerald-500 text-white' : isOpen ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-200')}>
                  {done ? <Check className="w-4 h-4" /> : i + 1}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[14px] font-semibold text-gray-900 dark:text-slate-100">{s.title}</span>
                  <span className="block text-[12px] text-gray-500 dark:text-slate-400">{s.blurb}</span>
                </span>
                <ChevronDown className={cn('w-4 h-4 text-gray-400 transition-transform shrink-0', isOpen && 'rotate-180')} />
              </button>
              {isOpen && (
                <div className="px-4 pb-4 space-y-3 border-t border-gray-100 dark:border-slate-800 pt-3">
                  {body(s.id)}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <button type="button" className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-gray-600 dark:text-slate-300 hover:text-emerald-700 dark:hover:text-emerald-300" onClick={() => toggleTick(s.id)}>
                      <span className={cn('w-4 h-4 rounded border-2 flex items-center justify-center', done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300 dark:border-slate-600')}>{done && <Check className="w-3 h-3" />}</span>
                      {done ? 'Done' : 'I have done this step'}
                    </button>
                    {i < GUIDE_STEPS.length - 1 && <button type="button" className="btn-secondary text-xs" onClick={() => next(s.id)}>Next step <ArrowRight className="w-3.5 h-3.5" /></button>}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="rounded-xl bg-gray-50 dark:bg-slate-800/50 px-4 py-3 text-[12.5px] text-gray-700 dark:text-slate-300">
        <div className="font-semibold text-gray-900 dark:text-slate-100 mb-1">Something not working? Check these five first</div>
        <ol className="list-decimal pl-5 space-y-0.5">
          <li>Are both computers on the <b>same router</b> — and not on a “Guest” Wi-Fi?</li>
          <li>Is the network set to <b>Private</b> in Windows? <button type="button" className="text-blue-700 dark:text-blue-300 font-semibold hover:underline" onClick={() => show('profile')}>Show me</button></li>
          <li>Was the Windows <b>firewall</b> question answered “Allow access”? <button type="button" className="text-blue-700 dark:text-blue-300 font-semibold hover:underline" onClick={() => show('firewall')}>Show me</button></li>
          <li>Is the <b>main computer on</b>, awake, and CureDesk open on it?</li>
          <li>Was the <b>join code</b> typed exactly (capitals matter) and within 10 minutes?</li>
        </ol>
      </div>
    </section>
  );
}

/**
 * The guide in a window of its own, for the Setup guide (where there is no room beside the questions). Sits above the Setup guide and the print sheet.
 * Drawn on <body>, not inside the Setup guide: that window is "no-print", and a print sheet (the checklist) inside a no-print window prints blank.
 */
export function ConnectGuideDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[270] flex items-center justify-center bg-slate-900/70 backdrop-blur p-4 sm:p-6" role="dialog" aria-modal="true" aria-label="Connect your computers">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-slate-700">
          <div className="text-[15px] font-bold text-gray-900 dark:text-slate-100 flex items-center gap-2"><Cable className="w-4 h-4 text-blue-600" /> Connect your computers</div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 overflow-auto"><ConnectGuide showHeader /></div>
      </div>
    </div>,
    document.body,
  );
}
