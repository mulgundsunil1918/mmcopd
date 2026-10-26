/**
 * Which medicine on the clinic's Drug List does a line of a supplier's bill mean?
 *
 * This is the part where "no mistakes" is won or lost, so it is deliberately cautious and always shows its reasoning:
 *
 *   exact       the same words and the same numbers (after ignoring TAB / SYP / 15's / 60 ML / capitals / hyphens) → matched, nothing to confirm
 *   alias       a name this clinic confirmed before for this supplier ("PACETOMOL 650" → Paracetamol 650 mg) → matched
 *   close       the same, except a word is spelt a little differently (Pacetomol / Paracetamol, Cetrizine / Cetirizine) or the bill names another
 *               form (the bill says Cap, the list says Tablet) → a person must confirm
 *   ingredient  the same ingredient and strength under ANOTHER brand (Dolo 650 for Paracetamol 650) → offered, never chosen for you
 *   lookup      matched through what ChatGPT's internet lookup found (brand / generic / strength) → offered, a person must confirm
 *   ambiguous   the bill gives only part of a name ("Ascoril" when the list has Ascoril LS and Ascoril D…) → every possibility is listed
 *   none        nothing in the list → the screen offers "Add as a new medicine"
 *
 * Two rules never bend. NUMBERS must agree exactly (650 is never 500, 5 ml is never 10 ml). VARIANT WORDS must agree exactly (LS, D, Plus, Forte,
 * DS, DDS, XR, SR, Junior, Drops …): spelling may be loose on a brand or ingredient word, never on a number or a variant. So "Ascoril D" is never
 * quietly matched to "Ascoril LS", and "Paracetamol 500" never to "Paracetamol 650".
 */
import { FORM_FAMILIES } from './template';

export interface DrugRef { id: number; name: string; generic_name: string | null; form: string | null; strength: string | null; is_active?: number | null; /** 'consumable' for a syringe, a cannula…; absent or 'medicine' otherwise. */ item_type?: string | null }
export interface AliasRef { alias: string; drug_id: number; supplier_id: number | null }
export interface LookupInfo { brand: string; generic: string; strength: string; form: string }

export type MatchKind = 'exact' | 'alias' | 'close' | 'ingredient' | 'lookup' | 'ambiguous' | 'none';
export type CandidateKind = 'exact' | 'alias' | 'close' | 'ingredient' | 'lookup' | 'brand';
export interface Candidate { id: number; name: string; composition: string; kind: CandidateKind; score: number; reason: string }
export interface MatchResult {
  kind: MatchKind;
  /** The drug chosen for the line (null when a person has to choose). */
  drug_id: number | null;
  /** True when nothing needs confirming: an exact or a remembered match. */
  certain: boolean;
  candidates: Candidate[];
  /** Does what ChatGPT's lookup says the medicine is agree with the matched drug's composition? */
  composition: 'agree' | 'differ' | 'unknown';
}

// ---------------------------------------------------------------------------------------------------------------- reading a name
const UNIT = '(?:mg|mcg|ug|gm|kg|g|iu|lakh|units?|ml|l)';
/** Words that only say what the pack is, never which medicine it is. */
const NOISE = new Set(['tab', 'tabs', 'tablet', 'tablets', 'cap', 'caps', 'capsule', 'capsules', 'syp', 'syr', 'syrup', 'susp', 'suspension', 'inj', 'injection',
  'drops', 'drop', 'gel', 'cream', 'oint', 'ointment', 'lotion', 'sol', 'solution', 'spray', 'inhaler', 'respules', 'sachet', 'powder', 'dry', 'liquid', 'oral',
  'ip', 'bp', 'usp', 'of', 'the', 'and', 'with', 'pack', 'strip', 'strips', 'bottle', 'vial', 'amp', 'ampoule', 'nos', 'no', 'pcs', 'pc', 'tube', 'infusion',
  'shampoo', 'mouth', 'paint', 'eye', 'ear', 'nasal', 'for', 'new']);
const ORAL_LIQUID = new Set(['Syrup', 'Suspension', 'Solution']);

export interface Toks { words: string[]; nums: number[]; /** the numbers written WITHOUT a unit (650, 40, 15) — a pack size can hide among these; one with a unit (650 mg) is a strength */ bare: number[]; vols: number[]; per: number[]; form: string; compact: string }

/** A name, taken apart: its words (variants included), its identity numbers, its volumes, the form it names. Pack counts (15's, 10x10) are dropped. */
export function tokenize(text: string): Toks {
  let s = ` ${String(text ?? '').toLowerCase().replace(/×/g, 'x').replace(/[()\[\]{},;:]/g, ' ')} `;
  // pack counts: 10x10, 1 x 10, 15's, 10s, "10 tabs", "strip of 10"
  s = s.replace(/\b\d+\s*x\s*\d+\b/g, ' ').replace(/\b\d+\s*['’`]\s*s\b|\b\d+s\b/g, ' ');
  // "per" volumes — the "/5 ml" of 250 mg/5 ml: part of the STRENGTH, not the pack
  const per: number[] = [];
  const toMl = (n: string, u: string) => (u === 'l' ? Number(n) * 1000 : Number(n));
  s = s.replace(/(?:\/|\bper\b)\s*(\d*(?:\.\d+)?)\s*(ml|l)\b/g, (_m, n: string, u: string) => { per.push(toMl(n || '1', u)); return ' '; });
  // volumes of the pack or product: 60 ml, 0.5 l, 500ml
  const vols: number[] = [];
  s = s.replace(/(\d+(?:\.\d+)?)\s*(ml|l)\b/g, (_m, n: string, u: string) => { vols.push(toMl(n, u)); return ' '; });
  // numbers with their unit: 650mg, 0.5 %, 12 lakh
  const nums: number[] = [];
  const bare: number[] = [];
  s = s.replace(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:${UNIT.replace('|ml|l', '')}(?![a-z])|%)`, 'g'), (_m, n: string) => { nums.push(Number(n)); return ' '; });
  // what is left: letters and bare numbers
  const words: string[] = [];
  let form = '';
  for (const m of s.match(/[a-z]+|\d+(?:\.\d+)?/g) ?? []) {
    if (/^\d/.test(m)) { nums.push(Number(m)); bare.push(Number(m)); continue; }
    const fam = FORM_FAMILIES[m];
    if (fam && !form) form = fam;
    if (NOISE.has(m)) continue;
    words.push(m);
  }
  return { words, nums: [...new Set(nums)].sort((a, b) => a - b), bare: [...new Set(bare)], vols: [...new Set(vols)].sort((a, b) => a - b), per: [...new Set(per)].sort((a, b) => a - b), form, compact: words.join('') };
}

/** The amounts of each ingredient in a strength ("200 mg + 28.5 mg/5 ml" → 200, 28.5): the denominator volume after "/" is left out. */
export function strengthNumbers(strength: string | null | undefined): number[] {
  const s = String(strength ?? '').toLowerCase().replace(/\/\s*\d*(?:\.\d+)?\s*(?:ml|l|g|dose)\b/g, ' ').replace(/\/\s*(?:ml|dose)\b/g, ' ');
  return [...new Set((s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number))].sort((a, b) => a - b);
}

/** The "per" volume of a strength ("250 mg/5 ml" → 5; "100 mg/ml" → 1; no volume → none). */
export function strengthPer(strength: string | null | undefined): number[] {
  const s = String(strength ?? '').toLowerCase();
  const out: number[] = [];
  s.replace(/\/\s*(\d*(?:\.\d+)?)\s*(ml|l)\b/g, (_m, n: string, u: string) => { out.push((u === 'l' ? 1000 : 1) * Number(n || '1')); return ' '; });
  return [...new Set(out)];
}

/** What a name is remembered by: its words and identity numbers — not its pack size, and not TAB / SYP (the form is checked when the name is matched, so Calpol 250 Syrup and Calpol 250 Drops stay apart). */
export function aliasKey(printed: string): string {
  const t = tokenize(printed);
  return [...t.words, ...t.nums.map(String)].join(' ');
}

// ---------------------------------------------------------------------------------------------------------------- how alike two words are
function jaro(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length, lb = b.length;
  if (!la || !lb) return 0;
  const win = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const ma = new Array<boolean>(la).fill(false), mb = new Array<boolean>(lb).fill(false);
  let m = 0;
  for (let i = 0; i < la; i++) {
    for (let j = Math.max(0, i - win); j < Math.min(lb, i + win + 1); j++) {
      if (!mb[j] && a[i] === b[j]) { ma[i] = mb[j] = true; m++; break; }
    }
  }
  if (!m) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < la; i++) { if (ma[i]) { while (!mb[k]) k++; if (a[i] !== b[k]) t++; k++; } }
  return (m / la + m / lb + (m - t / 2) / m) / 3;
}
function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b);
  let p = 0;
  while (p < 4 && p < a.length && p < b.length && a[p] === b[p]) p++;
  return j + p * 0.1 * (1 - j);
}
function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
const skeleton = (w: string) => w.replace(/[aeiouy]/g, '');

/**
 * 1 = the same word; between 0.86 and 1 = a spelling slip (Cetrizine / Cetirizine, Pacetomol / Paracetamol); 0 = a different word.
 * Words under 4 letters (D, LS, DS, XR, SR, Plus is longer…) are NEVER fuzzy: a variant word must be right, not "close".
 */
export function wordSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 4 || b.length < 4) return 0;
  if (/\d/.test(a) || /\d/.test(b)) return 0;
  const jw = jaroWinkler(a, b);
  const edit = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  let best = jw >= 0.9 && edit >= 0.7 ? jw : 0;
  // a slip that drops letters inside a long word: the consonants still line up (pacetomol / paracetamol → pctml / prctml)
  if (a.length >= 6 && b.length >= 6 && a[0] === b[0] && a[a.length - 1] === b[b.length - 1]) {
    const sa = skeleton(a), sb = skeleton(b);
    if (sa.length >= 4 && sb.length >= 4) {
      const sk = 1 - levenshtein(sa, sb) / Math.max(sa.length, sb.length);
      if (sk >= 0.8 && Math.abs(a.length - b.length) <= 3) best = Math.max(best, 0.86 + (sk - 0.8) * 0.2);
    }
  }
  return best >= 0.86 ? Math.min(best, 0.99) : 0;
}

// ---------------------------------------------------------------------------------------------------------------- a drug, ready to compare
interface Sig { d: DrugRef; name: Toks; generic: string[]; genericCompact: string; strengthNums: number[]; perAll: number[]; form: string; composition: string }
const compositionOf = (d: DrugRef) => [d.generic_name, d.form, d.strength].filter((x) => x && x !== '—').join(' · ');
function signatureOf(d: DrugRef): Sig {
  const g = tokenize(d.generic_name ?? '');
  const name = tokenize(d.name);
  return { d, name, generic: g.words, genericCompact: g.compact, strengthNums: strengthNumbers(d.strength), perAll: [...new Set([...name.per, ...strengthPer(d.strength)])], form: String(d.form ?? ''), composition: compositionOf(d) };
}
const sameSet = (a: readonly (string | number)[], b: readonly (string | number)[]) => a.length === b.length && a.every((x) => b.includes(x));
const subset = (a: readonly (string | number)[], b: readonly (string | number)[]) => a.every((x) => b.includes(x));

/** Does the number part agree? The name's numbers must all be on the bill; every number on the bill must be in the name or the strength. */
function numbersAgree(printed: number[], sig: Sig): boolean {
  if (!subset(sig.name.nums, printed)) return false;
  return subset(printed, [...sig.name.nums, ...sig.strengthNums]);
}
function formsAgree(printedForm: string, sig: Sig): boolean {
  if (!printedForm || !sig.form) return true;
  const a = printedForm, b = FORM_FAMILIES[sig.form.toLowerCase()] ?? sig.form;
  return a === b || (ORAL_LIQUID.has(a) && ORAL_LIQUID.has(b));
}

/** Words against words: all equal, or all equal bar spelling slips. Returns the average similarity (1 = identical) or 0. */
function wordsAlike(printed: string[], printedCompact: string, cand: string[], candCompact: string): { sim: number; slips: number } | null {
  if (printedCompact && printedCompact === candCompact) return { sim: 1, slips: 0 };      // Pan-D / PAND / Pan D
  if (printed.length !== cand.length || printed.length === 0) return null;
  const free = [...cand];
  let total = 0, slips = 0;
  for (const w of printed) {
    let bi = -1, bs = 0;
    free.forEach((c, i) => { const s = wordSimilarity(w, c); if (s > bs) { bs = s; bi = i; } });
    if (bi < 0) return null;
    free.splice(bi, 1);
    total += bs; if (bs < 1) slips++;
  }
  return { sim: total / printed.length, slips };
}

// ---------------------------------------------------------------------------------------------------------------- composition agreement
export function compositionAgreement(lookup: LookupInfo, d: DrugRef): 'agree' | 'differ' | 'unknown' {
  const ln = strengthNumbers(lookup.strength);
  const dn = strengthNumbers(d.strength);
  const lg = tokenize(lookup.generic).words, dg = tokenize(d.generic_name ?? '').words;
  if (!ln.length && !lg.length) return 'unknown';
  if (ln.length && dn.length && !sameSet(ln, dn)) return 'differ';
  if (lg.length && dg.length) {
    const overlap = lg.filter((w) => dg.some((x) => wordSimilarity(w, x) > 0)).length;
    if (overlap === 0) return 'differ';
    if (overlap < Math.min(lg.length, dg.length)) return 'differ';
  }
  return (ln.length && dn.length) || (lg.length && dg.length) ? 'agree' : 'unknown';
}

// ---------------------------------------------------------------------------------------------------------------- the matcher
export interface Matcher { match: (printed: string, lookup: LookupInfo, supplierId: number | null) => MatchResult }

/** Prepare the clinic's drug list once, then match many lines. */
export function makeMatcher(drugs: DrugRef[], aliases: AliasRef[] = []): Matcher {
  const sigs = drugs.filter((d) => d.is_active !== 0).map(signatureOf);
  const byId = new Map(sigs.map((s) => [s.d.id, s]));
  const aliasBy = new Map<string, AliasRef[]>();
  for (const a of aliases) { const l = aliasBy.get(a.alias) ?? []; l.push(a); aliasBy.set(a.alias, l); }

  const cand = (s: Sig, kind: CandidateKind, score: number, reason: string): Candidate => ({ id: s.d.id, name: s.d.name, composition: s.composition, kind, score, reason });

  /** Run the comparison for one set of "printed" tokens (the bill's name, or the looked-up brand). */
  function compare(p: Toks, extraNums: number[], opts: { fromLookup?: boolean } = {}) {
    const exact: Sig[] = [], close: { s: Sig; sim: number; why: string }[] = [], brand: Sig[] = [], ingredient: Sig[] = [], partial: Sig[] = [];
    const nums = [...new Set([...p.nums, ...extraNums])].sort((a, b) => a - b);
    for (const s of sigs) {
      // a volume in the product's name (Normal Saline 500ml) must be on the bill; a "per 5 ml" on the bill must agree with the strength — pack sizes are ignored
      const volOk = (s.name.vols.length === 0 || sameSet(s.name.vols, p.vols)) && (p.per.length === 0 || s.perAll.length === 0 || sameSet(p.per, s.perAll));
      const numOk = numbersAgree(nums, s);
      const alike = wordsAlike(p.words, p.compact, s.name.words, s.name.compact);
      // the bill carries an extra bare whole number the name does not explain (Dolo 650 15 → 15 is probably the pack): close, never exact
      const explained = [...s.name.nums, ...s.strengthNums];
      const unexplained = nums.filter((n) => !explained.includes(n));
      // …but only when the bill ALSO carries a number the drug does explain (Dolo 650 + 15), or the drug has no numbers at all (Combiflam 20): a bare
      // number that REPLACES the drug's own (Ciplox 100 vs Ciplox 500, Cetirizine 20 vs 10 mg) is another strength, never a pack size
      const extraOnly = !numOk && !!alike && volOk && subset(s.name.nums, nums) && unexplained.every((n) => Number.isInteger(n) && p.bare.includes(n))
        && (explained.length === 0 || nums.some((n) => explained.includes(n)));
      if (alike && extraOnly) { close.push({ s, sim: alike.sim * 0.9, why: `the bill has an extra number (${nums.filter((n) => ![...s.name.nums, ...s.strengthNums].includes(n)).join(', ')}) — probably the pack size` }); continue; }
      if (alike && numOk && volOk) {
        const formOk = formsAgree(p.form, s);
        if (alike.slips === 0 && formOk) exact.push(s);
        else close.push({ s, sim: alike.sim * (formOk ? 1 : 0.95), why: alike.slips > 0 ? 'the spelling is a little different' : `the bill says ${p.form}, your list says ${s.form}` });
        continue;
      }
      // the bill gives only part of the name (a brand with no variant): every row that contains those words
      if (p.words.length && s.name.words.length > p.words.length && p.words.every((w) => s.name.words.some((x) => x === w || wordSimilarity(w, x) > 0)) && (nums.length === 0 ? true : numbersAgree(nums, s))) { partial.push(s); continue; }
      // same brand word, different variant or strength: shown for information only
      if (p.words.length && s.name.words[0] && p.words[0] === s.name.words[0]) brand.push(s);
      // same ingredient and strength, another brand
      if (p.words.length && s.generic.length && wordsAlike(p.words, p.compact, s.generic, s.genericCompact) && nums.length && subset(nums, [...s.name.nums, ...s.strengthNums]) && sameSet(nums, s.strengthNums.length ? s.strengthNums : nums)) ingredient.push(s);
    }
    void opts;
    return { exact, close, brand, ingredient, partial, nums };
  }

  return {
    match(printed, lookup, supplierId) {
      const p = tokenize(printed);
      const key = aliasKey(printed);
      const candidates: Candidate[] = [];

      // 1 · a name this clinic already confirmed for this supplier
      const remembered = (aliasBy.get(key) ?? []).filter((a) => byId.has(a.drug_id));
      const formFits = (a: AliasRef) => formsAgree(p.form, byId.get(a.drug_id)!);
      const mine = remembered.find((a) => a.supplier_id !== null && a.supplier_id === supplierId && formFits(a));
      if (mine) {
        const s = byId.get(mine.drug_id)!;
        return { kind: 'alias', drug_id: s.d.id, certain: true, candidates: [cand(s, 'alias', 100, 'you matched this name before for this supplier')], composition: compositionAgreement(lookup, s.d) };
      }

      const r = compare(p, []);
      // 2 · exactly the same words and numbers
      if (r.exact.length === 1) {
        const s = r.exact[0];
        return { kind: 'exact', drug_id: s.d.id, certain: true, candidates: [cand(s, 'exact', 100, 'the same name')], composition: compositionAgreement(lookup, s.d) };
      }
      if (r.exact.length > 1) {
        for (const s of r.exact) candidates.push(cand(s, 'exact', 99, 'the same name — more than one drug in the list has it'));
        return { kind: 'ambiguous', drug_id: null, certain: false, candidates, composition: 'unknown' };
      }
      // an alias another supplier's bill taught us: offered, to be confirmed
      for (const a of remembered.filter(formFits)) { const s = byId.get(a.drug_id)!; candidates.push(cand(s, 'alias', 90, 'you matched this name for another supplier')); }

      // 3 · the same except a spelling slip / the form
      const close = [...r.close].sort((a, b) => b.sim - a.sim);
      for (const c of close) candidates.push(cand(c.s, 'close', Math.round(c.sim * 100), c.why));
      const claimed = new Set(candidates.map((c) => c.id));
      // 4 · the same ingredient and strength under another brand
      for (const s of r.ingredient.filter((x) => !claimed.has(x.d.id))) { candidates.push(cand(s, 'ingredient', 50, `same medicine (${s.composition}) but another brand`)); claimed.add(s.d.id); }
      // 5 · the bill names only part of it
      for (const s of r.partial.filter((x) => !claimed.has(x.d.id))) { candidates.push(cand(s, 'brand', 40, 'the bill does not say which variant — this is one of them')); claimed.add(s.d.id); }

      // 6 · what ChatGPT's lookup found
      const lp = tokenize(lookup.brand);
      if (!r.exact.length && !close.length && lp.words.length) {
        const lr = compare(lp, strengthNumbers(lookup.strength));
        for (const s of [...lr.exact, ...lr.close.map((c) => c.s)].filter((x) => !claimed.has(x.d.id))) {
          candidates.push(cand(s, 'lookup', 60, `ChatGPT's lookup says ${lookup.brand}${lookup.strength ? ` ${lookup.strength}` : ''}`)); claimed.add(s.d.id);
        }
      }
      if (!claimed.size && lookup.generic && strengthNumbers(lookup.strength).length) {
        const lg = tokenize(lookup.generic);
        for (const s of sigs) {
          if (claimed.has(s.d.id)) continue;
          if (wordsAlike(lg.words, lg.compact, s.generic, s.genericCompact) && sameSet(strengthNumbers(lookup.strength), s.strengthNums)) {
            candidates.push(cand(s, 'lookup', 55, `ChatGPT's lookup says ${lookup.generic} ${lookup.strength}`)); claimed.add(s.d.id);
          }
        }
      }
      // same brand word, other variant: information only, last
      for (const s of r.brand.filter((x) => !claimed.has(x.d.id)).slice(0, 4)) { candidates.push(cand(s, 'brand', 20, 'same brand, a DIFFERENT variant or strength — not the same medicine')); claimed.add(s.d.id); }

      candidates.sort((a, b) => b.score - a.score);
      const top = candidates.slice(0, 8);
      const only = top.filter((c) => c.kind === 'close');
      if (only.length >= 1 && top[0].kind === 'close' && (only.length === 1 || top[0].score - top[1].score >= 4)) {
        const s = byId.get(top[0].id)!;
        return { kind: 'close', drug_id: s.d.id, certain: false, candidates: top, composition: compositionAgreement(lookup, s.d) };
      }
      if (top.length === 0) return { kind: 'none', drug_id: null, certain: false, candidates: [], composition: 'unknown' };
      const lead = top[0].kind;
      const kind: MatchKind = lead === 'close' ? 'close' : lead === 'lookup' ? 'lookup' : lead === 'ingredient' ? 'ingredient' : lead === 'alias' ? 'alias' : 'ambiguous';
      return { kind, drug_id: null, certain: false, candidates: top, composition: 'unknown' };
    },
  };
}
