/**
 * Import a supplier's bill — the three steps a person follows:
 *   1. copy the instructions for ChatGPT,
 *   2. give ChatGPT the bill together with those instructions and download the Excel it makes,
 *   3. upload that Excel here (and, if you like, the bill picture) — then the checking screen opens.
 * Nothing here changes stock; reading the file only produces a draft to check.
 */
import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Clipboard, ClipboardCheck, ExternalLink, FileSpreadsheet, FileText, Image as ImageIcon, Loader2, Upload } from 'lucide-react';
import { HelpTip } from '../../HelpTip';
import { cn } from '../../../lib/utils';
import { copyText } from '../../../lib/clipboard';
import { base64ToBlob, fileToBase64 } from '../../../lib/base64';
import { TEMPLATE_FILE_NAME, buildPrompt, looksLikeExcel, NOT_EXCEL_MESSAGE } from '../../../lib/billImport';
import type { ParseResult } from '../../../lib/billImport';
import { Banner, Stepper } from './ui';

export interface PhotoPick { file: File; url: string }
export interface Parsed { result: Extract<ParseResult, { ok: true }>; photo: PhotoPick | null; fileName: string }

const download = (base64: string, name: string) => {
  const blob = base64ToBlob(base64, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};

const prettySize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** The reminder shown on every step: a digital copy beats a photograph, and nothing is trusted without being checked. */
function Disclaimer() {
  return (
    <Banner tone="amber" title="Before you start: ask your dealer for a digital copy of the bill">
      <p>
        Ask the dealer to send a <b>digital soft copy (PDF or Excel)</b> of the bill — it is read far more accurately than a photograph. A sharp, flat,
        well-lit photo of every page also works.
      </p>
      <p>
        ChatGPT can still make mistakes. That is why you will check every line on the next screen, and <b>nothing reaches your stock until you type IMPORT</b>.
      </p>
    </Banner>
  );
}

function PickBox({ icon: Icon, title, hint, accept, file, onPick, onClear, optional }: {
  icon: typeof Upload; title: string; hint: string; accept: string; file: File | null; onPick: (f: File) => void; onClear: () => void; optional?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={cn('rounded-xl border-2 border-dashed p-4 text-center transition',
        over ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : file ? 'border-emerald-400 bg-emerald-50/50 dark:bg-emerald-900/10' : 'border-gray-300 dark:border-slate-600')}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) onPick(f); }}
    >
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ''; }} />
      {file ? (
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          <div className="text-left min-w-0">
            <div className="text-sm font-semibold truncate max-w-[260px]" title={file.name}>{file.name}</div>
            <div className="text-[11px] text-gray-500 dark:text-slate-400">{prettySize(file.size)}</div>
          </div>
          <button type="button" className="btn-ghost text-xs px-2 py-1" onClick={() => ref.current?.click()}>Change</button>
          <button type="button" className="btn-ghost text-xs px-2 py-1 text-red-600" onClick={onClear}>Remove</button>
        </div>
      ) : (
        <button type="button" className="w-full" onClick={() => ref.current?.click()}>
          <Icon className="w-7 h-7 mx-auto text-gray-400" />
          <div className="mt-1 text-sm font-semibold text-gray-800 dark:text-slate-100">{title}{optional && <span className="ml-1 text-[11px] font-normal text-gray-500 dark:text-slate-400">(optional)</span>}</div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400">{hint}</div>
        </button>
      )}
    </div>
  );
}

export function GuideSteps({ waitingCount, onParsed, onOpenWaiting, isDemo }: {
  waitingCount: number; onParsed: (p: Parsed) => void; onOpenWaiting: () => void; isDemo: boolean;
}) {
  const [step, setStep] = useState(1);
  const [copied, setCopied] = useState(false);
  const [excel, setExcel] = useState<File | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const prompt = buildPrompt();

  const copy = async () => {
    if (await copyText(prompt)) { setCopied(true); setTimeout(() => setCopied(false), 2500); }
  };
  const pickExcel = (f: File) => {
    setProblems([]);
    if (!/\.(xlsx|xls|xlsm)$/i.test(f.name)) { setExcel(null); setProblems([NOT_EXCEL_MESSAGE]); return; }
    setExcel(f);
  };
  const pickPhoto = (f: File) => {
    if (!/^image\//.test(f.type) && f.type !== 'application/pdf' && !/\.(jpe?g|png|webp|gif|heic|pdf|bmp|tiff?)$/i.test(f.name)) { setProblems(['The bill picture must be a photo (JPG, PNG…) or a PDF.']); return; }
    if (f.size > 20 * 1024 * 1024) { setProblems(['That bill picture is over 20 MB. Use a smaller picture or a PDF.']); return; }
    setProblems([]);
    setPhoto(f);
  };

  const read = async () => {
    if (!excel) return;
    setBusy(true); setProblems([]);
    try {
      if (!looksLikeExcel(new Uint8Array(await excel.slice(0, 8).arrayBuffer()))) { setProblems([NOT_EXCEL_MESSAGE]); return; }
      const result = await window.electronAPI.purchaseImport.parse(await fileToBase64(excel));
      if (!result.ok) { setProblems(result.problems); return; }
      onParsed({ result, photo: photo ? { file: photo, url: URL.createObjectURL(photo) } : null, fileName: excel.name });
    } catch (e: any) {
      setProblems([String(e?.message || e || 'That file could not be read.')]);
    } finally { setBusy(false); }
  };

  const trySample = async () => {
    setBusy(true); setProblems([]);
    try {
      const result = await window.electronAPI.purchaseImport.parse(await window.electronAPI.purchaseImport.template(true));
      if (!result.ok) { setProblems(result.problems); return; }
      onParsed({ result, photo: null, fileName: TEMPLATE_FILE_NAME });
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <Stepper step={step} labels={['Copy the instructions', 'Ask ChatGPT', 'Upload the Excel']} onGo={setStep} />
      <Disclaimer />

      {step === 1 && (
        <div className="space-y-3">
          <h3 className="text-base font-bold text-gray-900 dark:text-slate-100">Step 1 of 3 · Copy the instructions for ChatGPT</h3>
          <p className="text-sm text-gray-700 dark:text-slate-300">
            ChatGPT will read your bill for you. First give it its instructions — click <b>Copy</b>. They tell ChatGPT to copy the bill <b>exactly as printed</b>,
            never to guess, to leave a blank (and say why) when it cannot read something, and to look up each medicine’s brand, generic name and strength on the internet.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <button className="btn-primary" onClick={copy}>
              {copied ? <ClipboardCheck className="w-4 h-4" /> : <Clipboard className="w-4 h-4" />} {copied ? 'Copied — now go to step 2' : 'Copy the instructions'}
            </button>
            <HelpTip title="What are these instructions?">
              <p>A long message that you paste into ChatGPT together with the picture of your bill. It tells ChatGPT how to read an Indian wholesaler’s bill, which columns mean what, and the exact Excel layout CureDesk can read.</p>
              <p>You don’t have to read it. It never leaves your computer except when you paste it into ChatGPT yourself.</p>
            </HelpTip>
          </div>
          <details className="rounded-lg border border-gray-200 dark:border-slate-700">
            <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-gray-600 dark:text-slate-300">Read the instructions</summary>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap px-3 pb-3 text-[11px] leading-relaxed text-gray-700 dark:text-slate-300">{prompt}</pre>
          </details>
          <div className="text-xs text-gray-500 dark:text-slate-400 flex flex-wrap gap-x-4 gap-y-1">
            <button type="button" className="underline hover:text-blue-600" onClick={async () => download(await window.electronAPI.purchaseImport.template(false), TEMPLATE_FILE_NAME)}>
              Download the empty Excel form
            </button>
            <button type="button" className="underline hover:text-blue-600" onClick={async () => download(await window.electronAPI.purchaseImport.template(true), 'CureDesk-sample-bill.xlsx')}>
              Download a sample bill
            </button>
            <span>(the sample is made up — only to see how this works; don’t import it into a real pharmacy)</span>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <h3 className="text-base font-bold text-gray-900 dark:text-slate-100">Step 2 of 3 · Give ChatGPT the bill</h3>
          <ol className="space-y-2.5 text-sm text-gray-700 dark:text-slate-300">
            {[
              <>Open <b>ChatGPT</b> and start a new chat. <button type="button" className="inline-flex items-center gap-1 text-blue-600 hover:underline" onClick={() => window.electronAPI.app.openExternal('https://chatgpt.com/')}>Open chatgpt.com <ExternalLink className="w-3 h-3" /></button></>,
              <>Click the <b>＋</b> (paperclip) and attach the bill — the PDF, or a photo of <b>every page</b>. Photos: flat, sharp, bright, nothing cut off.</>,
              <><b>Paste</b> the instructions you copied (Ctrl + V) and press Send.</>,
              <>Switch on <b>Search</b> (the globe button under the message box) so ChatGPT can look each medicine up on the internet.</>,
              <>Wait for the answer. ChatGPT gives a link to an Excel file called <b>{TEMPLATE_FILE_NAME}</b> — click it to download. If it only shows a table, type: <i>“Please give me the Excel file to download.”</i></>,
              <>If it stops half-way, type <i>“continue”</i>. You don’t need to check its work in Excel — you will check everything in CureDesk.</>,
            ].map((t, i) => (
              <li key={i} className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-800 dark:bg-blue-900/40 dark:text-blue-200">{i + 1}</span><span className="pt-0.5">{t}</span></li>
            ))}
          </ol>
          <div className="flex items-center gap-2">
            <button className="btn-secondary" onClick={copy}>{copied ? <ClipboardCheck className="w-4 h-4" /> : <Clipboard className="w-4 h-4" />} {copied ? 'Copied' : 'Copy the instructions again'}</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <h3 className="text-base font-bold text-gray-900 dark:text-slate-100">Step 3 of 3 · Upload the Excel</h3>
          <div className="grid md:grid-cols-2 gap-3">
            <PickBox icon={FileSpreadsheet} title="Choose the Excel from ChatGPT" hint="or drop it here · .xlsx" accept=".xlsx,.xls,.xlsm" file={excel} onPick={pickExcel} onClear={() => { setExcel(null); setProblems([]); }} />
            <PickBox icon={photo?.type === 'application/pdf' ? FileText : ImageIcon} title="The bill’s picture or PDF" hint="shown beside the lines and kept with the purchase" accept="image/*,application/pdf,.pdf,.heic" file={photo} onPick={pickPhoto} onClear={() => setPhoto(null)} optional />
          </div>
          {problems.length > 0 && (
            <Banner tone="red" title={problems.length === 1 ? 'This file cannot be used yet' : `This file cannot be used yet — ${problems.length} things to sort out`}>
              <ul className="list-disc pl-5 space-y-0.5">{problems.slice(0, 12).map((p, i) => <li key={i}>{p}</li>)}</ul>
              {problems.length > 12 && <p>…and {problems.length - 12} more.</p>}
            </Banner>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            <button className="btn-primary" disabled={!excel || busy} onClick={read}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} {busy ? 'Reading…' : 'Read the Excel and check it'}
            </button>
            <span className="text-[11px] text-gray-500 dark:text-slate-400">Reading only shows you what is in the file. Nothing is added to your stock yet.</span>
          </div>
          {isDemo && (
            <div className="text-xs text-gray-600 dark:text-slate-300">
              Just want to see how it works? <button type="button" className="underline text-blue-600" disabled={busy} onClick={trySample}>Try it with a sample bill</button>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between pt-1 border-t border-gray-100 dark:border-slate-800">
        <div>
          {waitingCount > 0 && (
            <button type="button" className="text-xs text-blue-700 dark:text-blue-300 underline" onClick={onOpenWaiting}>
              Waiting to finish ({waitingCount})
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary" disabled={step === 1} onClick={() => setStep((s) => Math.max(1, s - 1))}><ArrowLeft className="w-4 h-4" /> Back</button>
          {step < 3 && <button className="btn-primary" onClick={() => setStep((s) => Math.min(3, s + 1))}>Next <ArrowRight className="w-4 h-4" /></button>}
        </div>
      </div>
    </div>
  );
}
