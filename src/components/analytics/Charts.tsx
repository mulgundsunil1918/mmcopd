/**
 * Lightweight, dependency-free SVG/flex charts for the Analytics page — donut,
 * vertical bar, and line/area trend. No chart library: the app is offline-first
 * and already hand-rolls SVG (see the growth charts), so these follow suit.
 *
 * Colours come from a colourblind-safe categorical palette in FIXED order (never
 * cycled/recoloured by rank), validated with the data-viz palette checker. Every
 * chart ships value labels + a legend, which is the "relief" the validator asks
 * for on the couple of light-surface hues that dip below 3:1 — so identity is
 * never carried by colour alone.
 */
import { cn } from '../../lib/utils';

/** Validated categorical palette (light hues; render well on white AND slate cards). */
export const CHART_COLORS = [
  '#2a78d6', // blue
  '#1baf7a', // aqua-green
  '#eb6834', // orange
  '#8b5cf6', // violet
  '#eda100', // yellow
  '#e87ba4', // magenta
  '#0ea5e9', // sky
  '#e34948', // red
];
export const colorAt = (i: number) => CHART_COLORS[i % CHART_COLORS.length];

type Row = { label: string; value: number; color?: string };

/** Card shell matching the rest of Analytics. */
function ChartCard({ title, subtitle, full, children }: { title: string; subtitle?: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn('card p-4', full && 'lg:col-span-2')}>
      <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">{title}</div>
      {subtitle && <div className="text-[11px] text-gray-500 dark:text-slate-400 mb-1">{subtitle}</div>}
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Empty() {
  return <div className="text-xs text-gray-500 dark:text-slate-400 italic py-6 text-center">No data.</div>;
}

/** Fold a long list down to `keep` slices + an "Other" bucket, so a pie never has 12 wedges. */
function foldOther(rows: Row[], keep: number): Row[] {
  if (rows.length <= keep) return rows;
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, keep);
  const rest = sorted.slice(keep).reduce((s, r) => s + r.value, 0);
  if (rest > 0) head.push({ label: 'Other', value: rest, color: '#94a3b8' });
  return head;
}

// ── Donut / pie ───────────────────────────────────────────────────────────────
export function DonutChart({ title, subtitle, rows, formatValue, full, maxSlices = 6 }: {
  title: string; subtitle?: string; rows: Row[]; formatValue?: (v: number) => string; full?: boolean; maxSlices?: number;
}) {
  const data = foldOther(rows.filter((r) => r.value > 0), maxSlices);
  const total = data.reduce((s, r) => s + r.value, 0);
  const fmt = (v: number) => (formatValue ? formatValue(v) : v.toLocaleString('en-IN'));

  const R = 54, C = 2 * Math.PI * R, cx = 70, cy = 70, stroke = 24, gap = 3;
  let acc = 0;

  return (
    <ChartCard title={title} subtitle={subtitle} full={full}>
      {total === 0 ? <Empty /> : (
        <div className="flex items-center gap-4 flex-wrap">
          <svg width="140" height="140" viewBox="0 0 140 140" className="shrink-0" role="img" aria-label={title}>
            {/* track */}
            <circle cx={cx} cy={cy} r={R} fill="none" strokeWidth={stroke} className="stroke-gray-100 dark:stroke-slate-800" />
            {data.map((r, i) => {
              const frac = r.value / total;
              const len = frac * C;
              const dash = `${Math.max(0.001, len - gap)} ${C - Math.max(0.001, len - gap)}`;
              const el = (
                <circle key={i} cx={cx} cy={cy} r={R} fill="none"
                  stroke={r.color || colorAt(i)} strokeWidth={stroke} strokeLinecap="butt"
                  strokeDasharray={dash} strokeDashoffset={-acc}
                  transform={`rotate(-90 ${cx} ${cy})`}>
                  <title>{`${r.label}: ${fmt(r.value)} (${Math.round(frac * 100)}%)`}</title>
                </circle>
              );
              acc += len;
              return el;
            })}
            <text x={cx} y={cy - 4} textAnchor="middle" className="fill-gray-900 dark:fill-slate-100" style={{ fontSize: 17, fontWeight: 700 }}>
              {data.length}
            </text>
            <text x={cx} y={cy + 12} textAnchor="middle" className="fill-gray-400" style={{ fontSize: 9, letterSpacing: 0.5 }}>
              {data.length === 1 ? 'CATEGORY' : 'CATEGORIES'}
            </text>
          </svg>
          <ul className="flex-1 min-w-[140px] space-y-1.5">
            {data.map((r, i) => (
              <li key={i} className="flex items-center gap-2 text-xs">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: r.color || colorAt(i) }} />
                <span className="text-gray-700 dark:text-slate-200 truncate flex-1" title={r.label}>{r.label}</span>
                <span className="text-gray-900 dark:text-slate-100 font-semibold tabular-nums">{fmt(r.value)}</span>
                <span className="text-gray-400 tabular-nums w-9 text-right">{Math.round((r.value / total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ChartCard>
  );
}

// ── Vertical bars ───────────────────────────────────────────────────────────
export function VBarChart({ title, subtitle, rows, formatValue, full, colorful = true, singleColor }: {
  title: string; subtitle?: string; rows: Row[]; formatValue?: (v: number) => string; full?: boolean; colorful?: boolean; singleColor?: string;
}) {
  const data = rows.filter((r) => r != null);
  const max = Math.max(1, ...data.map((r) => r.value));
  const fmt = (v: number) => (formatValue ? formatValue(v) : v.toLocaleString('en-IN'));
  const dense = data.length > 14;

  return (
    <ChartCard title={title} subtitle={subtitle} full={full}>
      {data.length === 0 ? <Empty /> : (
        <>
          <div className="flex items-end gap-1.5 h-44" style={{ paddingTop: 14 }}>
            {data.map((r, i) => {
              const pct = (r.value / max) * 100;
              const c = r.color || (colorful ? colorAt(i) : (singleColor || '#2a78d6'));
              return (
                <div key={i} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full" title={`${r.label}: ${fmt(r.value)}`}>
                  {!dense && <div className="text-[9px] text-gray-600 dark:text-slate-300 font-semibold tabular-nums mb-1 whitespace-nowrap">{fmt(r.value)}</div>}
                  <div className="w-full rounded-t transition-all" style={{ height: `${Math.max(2, pct)}%`, background: `linear-gradient(180deg, ${c}, ${c}cc)` }} />
                </div>
              );
            })}
          </div>
          <div className="flex gap-1.5 mt-1.5">
            {data.map((r, i) => (
              <div key={i} className="flex-1 min-w-0 text-center text-[9px] text-gray-500 dark:text-slate-400 truncate" title={r.label}>
                {dense ? (i % 2 === 0 ? r.label : '') : r.label}
              </div>
            ))}
          </div>
        </>
      )}
    </ChartCard>
  );
}

// ── Line + area trend ─────────────────────────────────────────────────────────
export function TrendChart({ title, subtitle, rows, formatValue, full, color = '#2a78d6' }: {
  title: string; subtitle?: string; rows: Row[]; formatValue?: (v: number) => string; full?: boolean; color?: string;
}) {
  const data = rows.filter((r) => r != null);
  const fmt = (v: number) => (formatValue ? formatValue(v) : v.toLocaleString('en-IN'));
  const W = 640, H = 200, padL = 8, padR = 8, padT = 14, padB = 22;
  const max = Math.max(1, ...data.map((r) => r.value));
  const n = data.length;
  const x = (i: number) => padL + (n <= 1 ? (W - padL - padR) / 2 : (i / (n - 1)) * (W - padL - padR));
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  const pts = data.map((r, i) => `${x(i)},${y(r.value)}`);
  const linePath = pts.length ? `M ${pts.join(' L ')}` : '';
  const areaPath = pts.length ? `M ${x(0)},${H - padB} L ${pts.join(' L ')} L ${x(n - 1)},${H - padB} Z` : '';
  const gid = `grad-${title.replace(/\W/g, '')}`;
  const peak = data.reduce((m, r, i) => (r.value > data[m].value ? i : m), 0);
  const labelEvery = Math.ceil(n / 6);

  return (
    <ChartCard title={title} subtitle={subtitle} full={full}>
      {data.length === 0 ? <Empty /> : (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="none" style={{ height: 200 }} role="img" aria-label={title}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {/* baseline */}
          <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} className="stroke-gray-200 dark:stroke-slate-700" strokeWidth="1" />
          {areaPath && <path d={areaPath} fill={`url(#${gid})`} />}
          {linePath && <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
          {data.map((r, i) => (
            <circle key={i} cx={x(i)} cy={y(r.value)} r={i === peak ? 4 : 2.5} fill={color} stroke="#fff" strokeWidth={i === peak ? 1.5 : 0} vectorEffect="non-scaling-stroke">
              <title>{`${r.label}: ${fmt(r.value)}`}</title>
            </circle>
          ))}
          {/* peak label */}
          <text x={x(peak)} y={Math.max(12, y(data[peak].value) - 8)} textAnchor="middle" className="fill-gray-700 dark:fill-slate-200" style={{ fontSize: 11, fontWeight: 700 }}>
            {fmt(data[peak].value)}
          </text>
          {/* x labels */}
          {data.map((r, i) => ((i % labelEvery === 0 || i === n - 1) ? (
            <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="fill-gray-400" style={{ fontSize: 9 }}>
              {r.label}
            </text>
          ) : null))}
        </svg>
      )}
    </ChartCard>
  );
}
