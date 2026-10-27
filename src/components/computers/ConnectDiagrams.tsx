/**
 * Small pictures of the three ways to connect the clinic's computers — drawn here (not images), so they are sharp at any size, follow the light and dark
 * themes, and show this clinic's own words ("Main computer"). Used in the "Connect your computers" guide (Setup, Settings, Help).
 */
import { DIRECT_ADDRESSES, type Connection } from '../../lib/connectGuide';

const LINE = 'stroke-blue-600 dark:stroke-blue-400';
const TXT = 'fill-slate-800 dark:fill-slate-100';
const SUB = 'fill-slate-500 dark:fill-slate-400';
const BODY = 'fill-white stroke-slate-500 dark:fill-slate-800 dark:stroke-slate-400';

/** A computer: a screen on a stand, with a name under it. The main computer is picked out in blue. */
function Pc({ x, y, label, sub, main }: { x: number; y: number; label: string; sub?: string; main?: boolean }) {
  return (
    <g transform={`translate(${x - 26} ${y})`}>
      <rect width="52" height="34" rx="4" strokeWidth="2"
        className={main ? 'fill-blue-50 stroke-blue-600 dark:fill-blue-950 dark:stroke-blue-400' : BODY} />
      <rect x="6" y="6" width="40" height="22" rx="1.5" className={main ? 'fill-blue-200 dark:fill-blue-800' : 'fill-slate-100 dark:fill-slate-700'} />
      <path d="M26 34v6M15 42h22" strokeWidth="2" strokeLinecap="round" className="stroke-slate-500 dark:stroke-slate-400" fill="none" />
      <text x="26" y="58" textAnchor="middle" fontSize="10.5" fontWeight="700" className={TXT}>{label}</text>
      {sub && <text x="26" y="70" textAnchor="middle" fontSize="9" className={SUB}>{sub}</text>}
    </g>
  );
}

/** The router (or switch): a flat box with its lights. */
function Router({ x, y, wifi, label }: { x: number; y: number; wifi?: boolean; label: string }) {
  return (
    <g transform={`translate(${x - 36} ${y})`}>
      {wifi && (
        <g fill="none" strokeWidth="2" strokeLinecap="round" className={LINE}>
          <path d="M26 -4a14 14 0 0 1 20 0" /><path d="M20 -11a23 23 0 0 1 32 0" /><path d="M14 -18a32 32 0 0 1 44 0" opacity=".55" />
        </g>
      )}
      <rect width="72" height="20" rx="4" strokeWidth="2" className={BODY} />
      <circle cx="12" cy="10" r="2.2" className="fill-emerald-500" /><circle cx="21" cy="10" r="2.2" className="fill-emerald-500" /><circle cx="30" cy="10" r="2.2" className="fill-slate-300 dark:fill-slate-600" />
      <path d="M44 10h20" strokeWidth="2" strokeLinecap="round" className="stroke-slate-300 dark:stroke-slate-600" />
      <text x="80" y="14" fontSize="10.5" fontWeight="700" className={TXT}>{label}</text>
    </g>
  );
}

function Internet({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M10 22a8 8 0 0 1 2-15.7A11 11 0 0 1 33 8a7.5 7.5 0 0 1 1 15z" strokeWidth="2" strokeLinejoin="round" className="fill-slate-100 stroke-slate-400 dark:fill-slate-700 dark:stroke-slate-500" />
      <text x="22" y="37" textAnchor="middle" fontSize="9.5" className={SUB}>Internet</text>
    </g>
  );
}

export function ConnectionDiagram({ kind, className }: { kind: Connection; className?: string }) {
  return (
    <svg viewBox="0 0 360 178" role="img" className={className ?? 'w-full h-auto'}
      aria-label={kind === 'cable' ? 'Computers joined by network cables to a router or switch'
        : kind === 'wifi' ? 'Computers joined to the router by Wi-Fi; the main computer by a cable'
        : 'Two computers joined by one network cable'}>
      {kind === 'cable' && (
        <>
          <Internet x={22} y={14} />
          <path d="M60 28 L144 42" strokeWidth="2" strokeDasharray="3 4" className="stroke-slate-400 dark:stroke-slate-500" fill="none" />
          <Router x={180} y={32} label="Router or switch" />
          <g fill="none" strokeWidth="2.5" strokeLinecap="round" className={LINE}>
            <path d="M160 52 L72 108" /><path d="M180 52 L180 108" /><path d="M200 52 L288 108" />
          </g>
          <Pc x={66} y={108} label="Reception" />
          <Pc x={180} y={108} label="Main computer" sub="holds the data" main />
          <Pc x={294} y={108} label="Doctor" />
        </>
      )}
      {kind === 'wifi' && (
        <>
          <Internet x={22} y={14} />
          <path d="M60 28 L144 42" strokeWidth="2" strokeDasharray="3 4" className="stroke-slate-400 dark:stroke-slate-500" fill="none" />
          <Router x={180} y={32} wifi label="Wi-Fi router" />
          <g fill="none" strokeWidth="2.5" strokeLinecap="round" className={LINE}>
            <path d="M180 52 L180 108" />
            <path d="M160 50 L72 108" strokeDasharray="2 6" /><path d="M200 50 L288 108" strokeDasharray="2 6" />
          </g>
          <Pc x={66} y={108} label="Reception" sub="Wi-Fi" />
          <Pc x={180} y={108} label="Main computer" sub="on a cable if you can" main />
          <Pc x={294} y={108} label="Doctor" sub="Wi-Fi" />
        </>
      )}
      {kind === 'direct' && (
        <>
          <path d="M96 62 L264 62" fill="none" strokeWidth="3" strokeLinecap="round" className={LINE} />
          <text x="180" y="52" textAnchor="middle" fontSize="10.5" fontWeight="700" className={TXT}>one network cable</text>
          <text x="180" y="82" textAnchor="middle" fontSize="9" className={SUB}>no router, no switch</text>
          <Pc x={66} y={44} label="Main computer" sub={DIRECT_ADDRESSES.main} main />
          <Pc x={294} y={44} label="Other computer" sub={DIRECT_ADDRESSES.other} />
          <text x="180" y="150" textAnchor="middle" fontSize="9.5" className={SUB}>Each computer gets its own fixed address (shown in the steps).</text>
        </>
      )}
    </svg>
  );
}
