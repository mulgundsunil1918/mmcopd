// Bill import — which medicine does a line of the supplier's bill mean? The matcher is what stands between a ChatGPT-read bill and the clinic's stock,
// so it is tested hard, with the owner's own examples and the real new drug list:
//   · "PACETOMOL 650" is Paracetamol 650 — offered as a close spelling for a person to confirm, never as Paracetamol 500;
//   · "Dolo 650 TAB 15S" is simply Dolo 650; "Pan-D", "PAN D" and "PAND" are one name, and Pan 40 is not Pan-D;
//   · "Ascoril LS" is Ascoril LS; "Ascoril D" is NOT matched to it; a bare "Ascoril" lists every variant and chooses none;
//   · numbers and variant words never bend (650 ≠ 500, DDS ≠ Duo, 10% ≠ 5%), spelling may;
//   · a remembered name is matched for the supplier it was confirmed for, and only offered for another;
//   · what ChatGPT's lookup says is advisory: it can offer a candidate and flag a composition that disagrees, never choose.
import { PHARMACY_CATALOG } from '../../src/data/pharmacy-catalog';
import { aliasKey, compositionAgreement, makeMatcher, strengthNumbers, strengthPer, tokenize, wordSimilarity, type DrugRef } from '../../src/lib/billImport/match';
import { ok, eq, section, finish } from './lib';

const drugs: DrugRef[] = PHARMACY_CATALOG.map((d, i) => ({ id: i + 1, name: d.name, generic_name: d.generic_name, form: d.form, strength: d.strength }));
const none = { brand: '', generic: '', strength: '', form: '' };
const nameOf = (id: number | null) => (id == null ? null : drugs.find((d) => d.id === id)!.name);
const idOf = (name: string) => drugs.find((d) => d.name === name)!.id;
const matcher = makeMatcher(drugs, []);
const m = (printed: string, lookup = none, supplier: number | null = 1) => matcher.match(printed, lookup, supplier);
const names = (r: { candidates: { name: string }[] }) => r.candidates.map((c) => c.name);

section('1 · reading a name');
const t1 = tokenize('DOLO 650MG TAB 15\'S');
eq(`${t1.words.join(',')} | ${t1.nums.join(',')} | ${t1.form}`, 'dolo | 650 | Tablet', '"DOLO 650MG TAB 15\'S" → word dolo, number 650, form Tablet (the pack count 15\'s is dropped)');
const t2 = tokenize('Calpol 250 SYP 60 ML');
eq(`${t2.words.join(',')} | ${t2.nums.join(',')} | vols ${t2.vols.join(',')} | ${t2.form}`, 'calpol | 250 | vols 60 | Syrup', '"Calpol 250 SYP 60 ML" → 60 ml is a pack volume, not part of the name');
const t3 = tokenize('Paracetamol 250 mg/5 ml Suspension');
eq(`${t3.nums.join(',')} | per ${t3.per.join(',')} | vols ${t3.vols.length}`, '250 | per 5 | vols 0', '"250 mg/5 ml": 250 is the strength, 5 ml is what it is "per"');
eq(tokenize('PAN-D').words.join(','), 'pan,d', 'Pan-D → pan, d');
eq(tokenize('Ciplox 500 Cap').form, 'Capsule', '"Cap" says Capsule');
eq(tokenize('Normal Saline 0.9% 500ml').vols.join(','), '500', '"500ml" of a saline bag is a volume of the product');
eq(strengthNumbers('200 mg + 28.5 mg/5 ml').join(','), '28.5,200', 'a strength\'s amounts: 200 and 28.5 (not the 5 ml)');
eq(strengthPer('250 mg/5 ml').join(',') + '|' + strengthPer('100 mg/ml').join(',') + '|' + strengthPer('500 mg').length, '5|1|0', '"per" volume: 5 ml, 1 ml, none');
eq(aliasKey('PCM 650 TAB 10X10'), 'pcm 650', 'a remembered name ignores the pack and TAB: "PCM 650 TAB 10X10" → "pcm 650"');
eq(aliasKey('pcm-650  tab'), aliasKey('PCM 650 TAB'), '…and capitals, hyphens and spaces');

section('2 · how alike two words are');
ok(wordSimilarity('pacetomol', 'paracetamol') >= 0.86, 'pacetomol ~ paracetamol (a spelling slip)');
ok(wordSimilarity('cetrizine', 'cetirizine') >= 0.86, 'cetrizine ~ cetirizine');
ok(wordSimilarity('augmentn', 'augmentin') >= 0.86, 'augmentn ~ augmentin');
ok(wordSimilarity('azithral', 'azithromycin') === 0, 'a brand is not an ingredient: azithral ≠ azithromycin');
eq(wordSimilarity('d', 'ls'), 0, 'short variant words never match loosely: D ≠ LS');
eq(wordSimilarity('ls', 'ds'), 0, '…LS ≠ DS');
eq(wordSimilarity('forte', 'plus'), 0, '…Forte ≠ Plus');
eq(wordSimilarity('dds', 'duo'), 0, '…DDS ≠ Duo');
eq(wordSimilarity('650', '500'), 0, '…and numbers are never compared as words');

section('3 · exact matches');
for (const [printed, want] of [
  ['DOLO 650 TAB 15S', 'Dolo 650'], ['Dolo-650', 'Dolo 650'], ['dolo 650', 'Dolo 650'], ['DOLO 650MG TABLET', 'Dolo 650'],
  ['PAN 40', 'Pan 40'], ['Pan-40 Tab 15\'s', 'Pan 40'], ['PAN-D', 'Pan-D'], ['PAN D', 'Pan-D'], ['PAND', 'Pan-D'],
  ['Calpol 250 SYP 60ML', 'Calpol 250 Syrup'], ['CALPOL 250 SYRUP', 'Calpol 250 Syrup'],
  ['ASCORIL LS', 'Ascoril LS Syrup'], ['Ascoril LS Syrup 100 ml', 'Ascoril LS Syrup'],
  ['Augmentin Duo', 'Augmentin Duo Syrup'], ['AUGMENTIN DDS 30ML', 'Augmentin DDS Syrup'], ['AUGMENTIN 625', 'Augmentin 625'],
  ['Paracetamol 650', 'Paracetamol 650 mg Tablet'], ['PARACETAMOL 500MG TAB', 'Paracetamol 500 mg Tablet'],
  ['Paracetamol 250mg/5ml Susp 60ml', 'Paracetamol 250 mg/5 ml Suspension'], ['PARACETAMOL 125 MG/5 ML SUSPENSION', 'Paracetamol 125 mg/5 ml Suspension'],
  ['Cetirizine 10mg tab', 'Cetirizine'], ['Cetirizine 5mg/5ml syrup', 'Cetirizine 5 mg/5 ml Syrup'],
  ['Zerodol-P', 'Zerodol-P'], ['ZERODOL SP', 'Zerodol-SP'], ['Zerodol MR', 'Zerodol MR'],
  ['Normal Saline 0.9% 500ml', 'Normal Saline 0.9% 500ml'], ['DEXTROSE 5% 500ML', 'Dextrose 5% 500ml'], ['Dextrose 10% 500 ml', 'Dextrose 10% 500ml'],
  ['VICKS ACTION 500', 'Vicks Action 500'], ['Vicks Action 500 Advanced', 'Vicks Action 500 Advanced'],
  ['Amoxicillin 125mg/5ml dry syrup', 'Amoxicillin 125 mg/5 ml Dry Syrup'], ['Cefixime 100mg/5ml dry syrup 30ml', 'Cefixime 100 mg/5 ml Dry Syrup'], ['COTRIMOXAZOLE DS', 'Cotrimoxazole DS Tablet'],
] as [string, string][]) {
  const r = m(printed);
  ok(r.kind === 'exact' && r.certain && nameOf(r.drug_id) === want, `"${printed}" → ${want} (${r.kind}${r.drug_id ? ' → ' + nameOf(r.drug_id) : ' → ' + names(r).slice(0, 3).join(' / ')})`);
}

section('4 · the owner\'s examples: a slip in spelling is offered, never silently accepted');
const pac = m('PACETOMOL 650');
eq(pac.kind, 'close', '"PACETOMOL 650" is a close spelling…');
eq(nameOf(pac.drug_id), 'Paracetamol 650 mg Tablet', '…of Paracetamol 650 mg Tablet');
ok(!pac.certain, '…and a person must still confirm it');
ok(names(pac).includes('Dolo 650'), 'Dolo 650 (same medicine, another brand) is offered as an alternative');
ok(pac.candidates.find((c) => c.name === 'Dolo 650')?.kind === 'ingredient', '…marked as "same ingredient, another brand"');
ok(!names(pac).includes('Paracetamol 500 mg Tablet'), 'Paracetamol 500 is NOT offered — the number differs');
ok(m('Cefixime 100 mg/5 ml DS').drug_id === null, '"DS" is never ignored (it can mean double strength): a printed "… DS" is not quietly read as dry syrup');
const extra = m('DOLO 650 15');
ok(extra.kind === 'close' && nameOf(extra.drug_id) === 'Dolo 650' && !extra.certain && /extra number/.test(extra.candidates[0].reason), '"DOLO 650 15": the 15 is not explained, so Dolo 650 is offered to confirm, never matched silently');
ok(m('CETIRIZINE 20MG').drug_id === null, '"CETIRIZINE 20MG" (a strength with its unit) is not mistaken for a pack size');
const ceti = m('Cetrizine 10mg');
ok(ceti.kind === 'close' && nameOf(ceti.drug_id) === 'Cetirizine' && !ceti.certain, '"Cetrizine 10mg" → Cetirizine, to be confirmed');
const augm = m('Augmentn 625');
ok(augm.kind === 'close' && nameOf(augm.drug_id) === 'Augmentin 625', '"Augmentn 625" → Augmentin 625, to be confirmed');
const cap = m('Ciplox 500 Cap');
ok(cap.kind === 'close' && nameOf(cap.drug_id) === 'Ciplox 500', '"Ciplox 500 Cap" (the list says Tablet) → Ciplox 500, to be confirmed');
ok(/cap|tablet/i.test(cap.candidates[0].reason), `…and says why (${cap.candidates[0].reason})`);

section('5 · variants: Ascoril LS, Ascoril D, and a bare Ascoril');
const asD = m('ASCORIL D');
ok(asD.kind !== 'exact' && asD.kind !== 'close' && asD.drug_id === null, '"Ascoril D" is NOT matched to Ascoril LS');
ok(asD.candidates.every((c) => c.kind === 'brand'), '…Ascoril LS is shown only as "same brand, a DIFFERENT variant"');
const asBare = m('ASCORIL');
ok(asBare.kind === 'ambiguous' && asBare.drug_id === null && names(asBare).includes('Ascoril LS Syrup'), 'a bare "Ascoril" lists the variants and chooses none');
const augBare = m('AUGMENTIN');
ok(augBare.drug_id === null && ['Augmentin 625', 'Augmentin Duo Syrup', 'Augmentin DDS Syrup'].every((n) => names(augBare).includes(n)), 'a bare "Augmentin" lists 625, Duo and DDS and chooses none');
ok(m('AUGMENTIN DUO').drug_id !== m('AUGMENTIN DDS').drug_id, 'Duo and DDS are different drugs');
const calBare = m('CALPOL');
ok(calBare.drug_id === null && names(calBare).includes('Calpol 250 Syrup'), 'a bare "Calpol" offers Calpol 250 Syrup and chooses nothing');
ok(m('Pan-O').drug_id === null, '"Pan-O" is not quietly read as Pan-D (a one-letter variant never bends)');
ok(m('PAN 40').drug_id !== idOf('Pan-D'), 'Pan 40 is not Pan-D');

section('6 · numbers never bend');
for (const [printed, notWant] of [['Paracetamol 500', 'Paracetamol 650 mg Tablet'], ['Azithral 250', 'Azithral 500'], ['DOLO 500', 'Dolo 650'], ['Dextrose 5% 100ml', 'Dextrose 5% 500ml'], ['Telma 80', 'Telma 40'], ['Cetirizine 20mg', 'Cetirizine']] as [string, string][]) {
  const r = m(printed);
  ok(nameOf(r.drug_id) !== notWant && !r.candidates.some((c) => c.name === notWant && c.kind !== 'brand'), `"${printed}" is not ${notWant}`);
}
eq(nameOf(m('DOLO 500').drug_id), 'Dolo 500', '"DOLO 500" is its own row, Dolo 500');
ok(m('Azithral 250').candidates.some((c) => c.name === 'Azithral 500' && c.kind === 'brand'), '"Azithral 250" shows Azithral 500 only as "same brand, different strength"');
ok(nameOf(m('Cefixime 100 mg/5 ml').drug_id) === 'Cefixime 100 mg/5 ml Dry Syrup' && nameOf(m('Cefixime 50 mg/5 ml').drug_id) === 'Cefixime 50 mg/5 ml Dry Syrup', '50 mg/5 ml and 100 mg/5 ml cefixime are two different rows');

section('7 · nothing in the list');
for (const printed of ['Alprax 10 Tab', 'Fabiana imbricata 30c', 'Kali arsenicosum 200', '1/2 dram plastic', 'Belladonna 30']) {
  const r = m(printed);
  ok(r.drug_id === null && (r.kind === 'none' || r.candidates.every((c) => c.kind === 'brand' || c.kind === 'ingredient')), `"${printed}" → not in the list (${r.kind})`);
}
eq(m('Belladonna 30').kind, 'none', '"Belladonna 30" has nothing near it in the list');

section('8 · remembered names');
const withAlias = makeMatcher(drugs, [{ alias: aliasKey('PCM 650'), drug_id: idOf('Dolo 650'), supplier_id: 7 }]);
const a7 = withAlias.match('PCM 650 TAB 10X10', none, 7);
ok(a7.kind === 'alias' && a7.certain && nameOf(a7.drug_id) === 'Dolo 650', 'a name confirmed for supplier 7 is matched for supplier 7, nothing to confirm');
const a8 = withAlias.match('PCM 650 TAB', none, 8);
ok(a8.drug_id === null && a8.candidates.some((c) => c.name === 'Dolo 650' && c.kind === 'alias') && !a8.certain, '…but only OFFERED for another supplier');
const gone = makeMatcher(drugs.filter((d) => d.name !== 'Dolo 650'), [{ alias: aliasKey('PCM 650'), drug_id: idOf('Dolo 650'), supplier_id: 7 }]);
ok(gone.match('PCM 650', none, 7).kind !== 'alias', 'a remembered name whose drug has been deleted is ignored');
const inactive = makeMatcher(drugs.map((d) => (d.name === 'Dolo 650' ? { ...d, is_active: 0 } : d)), []);
ok(inactive.match('DOLO 650', none, 1).drug_id !== idOf('Dolo 650'), 'an inactive drug is never matched');

section('9 · ChatGPT\'s lookup is advisory');
const lk = m('CALPOL', { brand: 'Calpol 250 Suspension', generic: 'Paracetamol', strength: '250 mg/5 ml', form: 'Suspension' });
ok(lk.drug_id === null && lk.candidates[0].name === 'Calpol 250 Syrup' && lk.candidates[0].kind === 'lookup', 'a bare "CALPOL" + lookup "Calpol 250 Suspension 250 mg/5 ml" OFFERS Calpol 250 Syrup — and chooses nothing');
const lk2 = m('XYZ SYRUP', { brand: '', generic: 'Paracetamol', strength: '250 mg/5 ml', form: 'Syrup' });
ok(lk2.drug_id === null && lk2.candidates.some((c) => c.kind === 'lookup' && /Paracetamol/.test(c.composition)), 'an unknown name with a lookup of Paracetamol 250 mg/5 ml offers the matching rows');
const agree = compositionAgreement({ brand: '', generic: 'Ambroxol + Levosalbutamol + Guaifenesin', strength: '30 mg + 1 mg + 50 mg/5 ml', form: 'Syrup' }, drugs.find((d) => d.name === 'Ascoril LS Syrup')!);
const differ = compositionAgreement({ brand: '', generic: 'Ambroxol + Levosalbutamol + Guaifenesin', strength: '15 mg + 0.5 mg + 25 mg/5 ml', form: 'Syrup' }, drugs.find((d) => d.name === 'Ascoril LS Syrup')!);
eq(agree, 'agree', 'a lookup that matches the row\'s composition agrees');
eq(differ, 'differ', 'a lookup with other amounts DIFFERS (a different variant was meant)');
eq(compositionAgreement(none, drugs[0]), 'unknown', 'no lookup → unknown');
eq(m('ASCORIL LS', { brand: 'Ascoril LS', generic: 'Ambroxol + Levosalbutamol + Guaifenesin', strength: '15 mg + 0.5 mg + 25 mg/5 ml', form: 'Syrup' }).composition, 'differ', 'the match result carries that warning');
eq(compositionAgreement({ brand: '', generic: 'Cetirizine', strength: '10 mg', form: 'Tablet' }, drugs.find((d) => d.name === 'Levocet')!), 'differ', 'a different ingredient differs');

section('10 · speed');
const t0 = Date.now();
const many = makeMatcher(Array.from({ length: 3000 }, (_, i) => ({ id: i + 1, name: `Brand${i} ${100 + (i % 900)}`, generic_name: `Generic${i % 300}`, form: 'Tablet', strength: `${100 + (i % 900)} mg` })), []);
for (let i = 0; i < 40; i++) many.match(`Brand${i * 7} ${100 + ((i * 7) % 900)} tab`, none, 1);
ok(Date.now() - t0 < 4000, `40 lines against a 3,000-drug list in ${Date.now() - t0} ms`);

finish();
