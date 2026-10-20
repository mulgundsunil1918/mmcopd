// Tiny assertion helpers shared by the e2e suites. Output is plain text a person can read.
export const stats = { pass: 0, fail: 0, skipped: 0, findings: 0 };
export const section = (title: string) => console.log(`\n== ${title} ==`);
export const ok = (c: any, m: string) => { if (c) { stats.pass++; console.log('  ✓', m); } else { stats.fail++; console.log('  ✗ FAIL:', m); } };
export const eq = (a: any, b: any, m: string) => ok(a === b, `${m}  (got ${JSON.stringify(a)}${a === b ? '' : `, expected ${JSON.stringify(b)}`})`);
export const near = (a: number | null | undefined, b: number, m: string, eps = 0.005) => ok(typeof a === 'number' && Math.abs(a - b) <= eps, `${m}  (got ${a}${typeof a === 'number' && Math.abs(a - b) <= eps ? '' : `, expected ${b}`})`);
export const note = (m: string) => console.log('  ·', m);
/** A finding the audit wants on record: prints as a DEFECT line and counts as a failure until fixed. */
export const defect = (c: any, m: string) => { if (c) { stats.pass++; console.log('  ✓', m); } else { stats.fail++; console.log('  ✗ DEFECT:', m); } };
/** Something the audit found that is deliberately NOT changed (a missing feature or a design decision) — reported, not failed. */
export const finding = (m: string) => { stats.findings++; console.log('  ⚑ FINDING:', m); };
export const finish = () => {
  console.log(`\n${stats.fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${stats.pass} passed, ${stats.fail} failed${stats.findings ? `, ${stats.findings} finding(s) reported` : ''}`);
  process.exit(stats.fail === 0 ? 0 : 1);
};
