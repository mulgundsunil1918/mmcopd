/**
 * Multi-language helper for printed prescriptions (patient-facing OPD slip).
 *
 * Doctors type frequency / duration / timing in English shorthand
 * (1-0-1, BD, "15 days", "after food"); this renders the equivalent in the
 * clinic's chosen Indian language to print underneath, so the patient (or their
 * family) understands the schedule even if they don't read English.
 *
 * Generalised from the original Kannada-only helper. Same forgiving contract:
 * anything it can't confidently translate is skipped, so the printed line never
 * shows a wrong or garbled instruction. The set of translated terms is a small,
 * fixed vocabulary (dose timing, standard frequencies, durations, food timing)
 * — NOT the doctor's free-typed notes, which are never machine-translated.
 *
 * Adding / fixing a language is a one-object edit in PACKS below. Entries flagged
 * `needsReview` in PATIENT_LANGS are best-effort and should be confirmed by a
 * native speaker before clinical use; languages with no pack fall back to English.
 */

export type PatientLang =
  | 'none'
  | 'as' | 'bn' | 'gu' | 'hi' | 'kn' | 'kok' | 'mai' | 'ml' | 'mr' | 'ne'
  | 'or' | 'pa' | 'sa' | 'sd' | 'ta' | 'te' | 'ur'
  | 'brx' | 'doi' | 'ks' | 'mni' | 'sat';

/**
 * The picker list (Settings). `native` is shown in its own script; `needsReview`
 * marks best-effort packs; languages with `pack:false` have no translations yet
 * and print English only until a native word-list is supplied.
 */
export const PATIENT_LANGS: { code: PatientLang; en: string; native: string; needsReview?: boolean; pack: boolean }[] = [
  { code: 'none', en: 'English only', native: '—', pack: true },
  { code: 'hi',  en: 'Hindi',      native: 'हिन्दी',     pack: true },
  { code: 'kn',  en: 'Kannada',    native: 'ಕನ್ನಡ',      pack: true },
  { code: 'ta',  en: 'Tamil',      native: 'தமிழ்',      pack: true },
  { code: 'te',  en: 'Telugu',     native: 'తెలుగు',     pack: true },
  { code: 'ml',  en: 'Malayalam',  native: 'മലയാളം',    pack: true },
  { code: 'mr',  en: 'Marathi',    native: 'मराठी',      pack: true },
  { code: 'gu',  en: 'Gujarati',   native: 'ગુજરાતી',    pack: true },
  { code: 'bn',  en: 'Bengali',    native: 'বাংলা',      pack: true },
  { code: 'pa',  en: 'Punjabi',    native: 'ਪੰਜਾਬੀ',     pack: true },
  { code: 'or',  en: 'Odia',       native: 'ଓଡ଼ିଆ',      pack: true },
  { code: 'as',  en: 'Assamese',   native: 'অসমীয়া',    pack: true },
  { code: 'ur',  en: 'Urdu',       native: 'اردو',       pack: true },
  { code: 'ne',  en: 'Nepali',     native: 'नेपाली',     pack: true },
  { code: 'sa',  en: 'Sanskrit',   native: 'संस्कृतम्',   pack: true },
  { code: 'kok', en: 'Konkani',    native: 'कोंकणी',     pack: true, needsReview: true },
  { code: 'mai', en: 'Maithili',   native: 'मैथिली',     pack: true, needsReview: true },
  { code: 'sd',  en: 'Sindhi',     native: 'سنڌي',       pack: true, needsReview: true },
  { code: 'doi', en: 'Dogri',      native: 'डोगरी',      pack: true, needsReview: true },
  // No reliable pack yet — printed English-only until a native word-list is added.
  { code: 'brx', en: 'Bodo',       native: 'बड़ो',       pack: false, needsReview: true },
  { code: 'ks',  en: 'Kashmiri',   native: 'کٲشُر',      pack: false, needsReview: true },
  { code: 'mni', en: 'Manipuri',   native: 'ꯃꯤꯇꯩꯂꯣꯟ',   pack: false, needsReview: true },
  { code: 'sat', en: 'Santali',    native: 'ᱥᱟᱱᱛᱟᱲᱤ',    pack: false, needsReview: true },
];

type Pack = {
  // Dose-time words, indexed morning / afternoon / evening / night.
  t: [string, string, string, string];
  od: string; bd: string; tds: string; qid: string;
  hs: string; sos: string; stat: string; weekly: string; eod: string;
  // Duration unit words (rendered as "<n> <word>").
  day: string; week: string; month: string; year: string;
  before: string; after: string; withFood: string; withLiquid: string; lukewarm: string;
};

const PACKS: Partial<Record<PatientLang, Pack>> = {
  hi: { t: ['सुबह', 'दोपहर', 'शाम', 'रात'], od: 'दिन में एक बार', bd: 'दिन में दो बार', tds: 'दिन में तीन बार', qid: 'दिन में चार बार', hs: 'सोते समय', sos: 'ज़रूरत पड़ने पर', stat: 'तुरंत', weekly: 'सप्ताह में एक बार', eod: 'एक दिन छोड़कर', day: 'दिन', week: 'सप्ताह', month: 'महीना', year: 'साल', before: 'खाने से पहले', after: 'खाने के बाद', withFood: 'खाने के साथ', withLiquid: 'दूध/पानी के साथ', lukewarm: 'गुनगुने पानी के साथ' },
  kn: { t: ['ಬೆಳಿಗ್ಗೆ', 'ಮಧ್ಯಾಹ್ನ', 'ಸಂಜೆ', 'ರಾತ್ರಿ'], od: 'ದಿನಕ್ಕೆ ಒಮ್ಮೆ', bd: 'ದಿನಕ್ಕೆ ಎರಡು ಬಾರಿ', tds: 'ದಿನಕ್ಕೆ ಮೂರು ಬಾರಿ', qid: 'ದಿನಕ್ಕೆ ನಾಲ್ಕು ಬಾರಿ', hs: 'ಮಲಗುವ ಮುನ್ನ', sos: 'ಅಗತ್ಯವಿದ್ದಾಗ', stat: 'ತಕ್ಷಣ', weekly: 'ವಾರಕ್ಕೊಮ್ಮೆ', eod: 'ದಿನ ಬಿಟ್ಟು ದಿನ', day: 'ದಿನ', week: 'ವಾರ', month: 'ತಿಂಗಳು', year: 'ವರ್ಷ', before: 'ಊಟಕ್ಕೆ ಮೊದಲು', after: 'ಊಟದ ನಂತರ', withFood: 'ಊಟದ ಜೊತೆ', withLiquid: 'ಹಾಲು/ನೀರಿನೊಂದಿಗೆ', lukewarm: 'ಬಿಸಿ ನೀರಿನೊಂದಿಗೆ' },
  ta: { t: ['காலை', 'மதியம்', 'மாலை', 'இரவு'], od: 'ஒரு நாளைக்கு ஒரு முறை', bd: 'ஒரு நாளைக்கு இரண்டு முறை', tds: 'ஒரு நாளைக்கு மூன்று முறை', qid: 'ஒரு நாளைக்கு நான்கு முறை', hs: 'படுக்கும் முன்', sos: 'தேவைப்படும் போது', stat: 'உடனடியாக', weekly: 'வாரம் ஒரு முறை', eod: 'ஒரு நாள் விட்டு', day: 'நாள்', week: 'வாரம்', month: 'மாதம்', year: 'ஆண்டு', before: 'உணவுக்கு முன்', after: 'உணவுக்குப் பின்', withFood: 'உணவுடன்', withLiquid: 'பால்/தண்ணீருடன்', lukewarm: 'வெதுவெதுப்பான நீருடன்' },
  te: { t: ['ఉదయం', 'మధ్యాహ్నం', 'సాయంత్రం', 'రాత్రి'], od: 'రోజుకు ఒకసారి', bd: 'రోజుకు రెండుసార్లు', tds: 'రోజుకు మూడుసార్లు', qid: 'రోజుకు నాలుగుసార్లు', hs: 'పడుకునే ముందు', sos: 'అవసరమైనప్పుడు', stat: 'వెంటనే', weekly: 'వారానికి ఒకసారి', eod: 'రోజు విడిచి రోజు', day: 'రోజు', week: 'వారం', month: 'నెల', year: 'సంవత్సరం', before: 'భోజనానికి ముందు', after: 'భోజనం తర్వాత', withFood: 'భోజనంతో', withLiquid: 'పాలు/నీటితో', lukewarm: 'గోరువెచ్చని నీటితో' },
  ml: { t: ['രാവിലെ', 'ഉച്ചയ്ക്ക്', 'വൈകുന്നേരം', 'രാത്രി'], od: 'ദിവസത്തിൽ ഒരിക്കൽ', bd: 'ദിവസത്തിൽ രണ്ടുതവണ', tds: 'ദിവസത്തിൽ മൂന്നുതവണ', qid: 'ദിവസത്തിൽ നാലുതവണ', hs: 'ഉറങ്ങുന്നതിന് മുമ്പ്', sos: 'ആവശ്യമുള്ളപ്പോൾ', stat: 'ഉടനടി', weekly: 'ആഴ്ചയിൽ ഒരിക്കൽ', eod: 'ദിവസം ഇടവിട്ട്', day: 'ദിവസം', week: 'ആഴ്ച', month: 'മാസം', year: 'വർഷം', before: 'ഭക്ഷണത്തിന് മുമ്പ്', after: 'ഭക്ഷണത്തിന് ശേഷം', withFood: 'ഭക്ഷണത്തോടൊപ്പം', withLiquid: 'പാൽ/വെള്ളത്തോടൊപ്പം', lukewarm: 'ഇളംചൂടുവെള്ളത്തോടൊപ്പം' },
  mr: { t: ['सकाळी', 'दुपारी', 'संध्याकाळी', 'रात्री'], od: 'दिवसातून एकदा', bd: 'दिवसातून दोनदा', tds: 'दिवसातून तीनदा', qid: 'दिवसातून चारदा', hs: 'झोपण्यापूर्वी', sos: 'गरज असेल तेव्हा', stat: 'ताबडतोब', weekly: 'आठवड्यातून एकदा', eod: 'एक दिवसाआड', day: 'दिवस', week: 'आठवडा', month: 'महिना', year: 'वर्ष', before: 'जेवणापूर्वी', after: 'जेवणानंतर', withFood: 'जेवणासोबत', withLiquid: 'दूध/पाण्यासोबत', lukewarm: 'कोमट पाण्यासोबत' },
  gu: { t: ['સવારે', 'બપોરે', 'સાંજે', 'રાત્રે'], od: 'દિવસમાં એક વાર', bd: 'દિવસમાં બે વાર', tds: 'દિવસમાં ત્રણ વાર', qid: 'દિવસમાં ચાર વાર', hs: 'સૂતાં પહેલાં', sos: 'જરૂર પડ્યે', stat: 'તરત જ', weekly: 'અઠવાડિયામાં એક વાર', eod: 'એક દિવસના અંતરે', day: 'દિવસ', week: 'અઠવાડિયું', month: 'મહિનો', year: 'વર્ષ', before: 'જમતાં પહેલાં', after: 'જમ્યા પછી', withFood: 'ભોજન સાથે', withLiquid: 'દૂધ/પાણી સાથે', lukewarm: 'હૂંફાળા પાણી સાથે' },
  bn: { t: ['সকাল', 'দুপুর', 'বিকাল', 'রাত'], od: 'দিনে একবার', bd: 'দিনে দুইবার', tds: 'দিনে তিনবার', qid: 'দিনে চারবার', hs: 'ঘুমানোর আগে', sos: 'প্রয়োজনে', stat: 'তৎক্ষণাৎ', weekly: 'সপ্তাহে একবার', eod: 'একদিন অন্তর', day: 'দিন', week: 'সপ্তাহ', month: 'মাস', year: 'বছর', before: 'খাবারের আগে', after: 'খাবারের পরে', withFood: 'খাবারের সাথে', withLiquid: 'দুধ/জলের সাথে', lukewarm: 'হালকা গরম জলের সাথে' },
  pa: { t: ['ਸਵੇਰੇ', 'ਦੁਪਹਿਰੇ', 'ਸ਼ਾਮ', 'ਰਾਤ'], od: 'ਦਿਨ ਵਿੱਚ ਇੱਕ ਵਾਰ', bd: 'ਦਿਨ ਵਿੱਚ ਦੋ ਵਾਰ', tds: 'ਦਿਨ ਵਿੱਚ ਤਿੰਨ ਵਾਰ', qid: 'ਦਿਨ ਵਿੱਚ ਚਾਰ ਵਾਰ', hs: 'ਸੌਣ ਤੋਂ ਪਹਿਲਾਂ', sos: 'ਲੋੜ ਪੈਣ ’ਤੇ', stat: 'ਤੁਰੰਤ', weekly: 'ਹਫ਼ਤੇ ਵਿੱਚ ਇੱਕ ਵਾਰ', eod: 'ਇੱਕ ਦਿਨ ਛੱਡ ਕੇ', day: 'ਦਿਨ', week: 'ਹਫ਼ਤਾ', month: 'ਮਹੀਨਾ', year: 'ਸਾਲ', before: 'ਖਾਣੇ ਤੋਂ ਪਹਿਲਾਂ', after: 'ਖਾਣੇ ਤੋਂ ਬਾਅਦ', withFood: 'ਖਾਣੇ ਨਾਲ', withLiquid: 'ਦੁੱਧ/ਪਾਣੀ ਨਾਲ', lukewarm: 'ਕੋਸੇ ਪਾਣੀ ਨਾਲ' },
  or: { t: ['ସକାଳ', 'ମଧ୍ୟାହ୍ନ', 'ସନ୍ଧ୍ୟା', 'ରାତି'], od: 'ଦିନକୁ ଥରେ', bd: 'ଦିନକୁ ଦୁଇଥର', tds: 'ଦିନକୁ ତିନିଥର', qid: 'ଦିନକୁ ଚାରିଥର', hs: 'ଶୋଇବା ପୂର୍ବରୁ', sos: 'ଆବଶ୍ୟକ ହେଲେ', stat: 'ତୁରନ୍ତ', weekly: 'ସପ୍ତାହକୁ ଥରେ', eod: 'ଦିନ ଛାଡ଼ି ଦିନ', day: 'ଦିନ', week: 'ସପ୍ତାହ', month: 'ମାସ', year: 'ବର୍ଷ', before: 'ଖାଇବା ପୂର୍ବରୁ', after: 'ଖାଇବା ପରେ', withFood: 'ଖାଦ୍ୟ ସହିତ', withLiquid: 'କ୍ଷୀର/ପାଣି ସହିତ', lukewarm: 'ଉଷୁମ ପାଣି ସହିତ' },
  as: { t: ['ৰাতিপুৱা', 'দুপৰীয়া', 'আবেলি', 'ৰাতি'], od: 'দিনে এবাৰ', bd: 'দিনে দুবাৰ', tds: 'দিনে তিনিবাৰ', qid: 'দিনে চাৰিবাৰ', hs: 'শোৱাৰ আগত', sos: 'প্ৰয়োজন হ’লে', stat: 'তৎক্ষণাৎ', weekly: 'সপ্তাহত এবাৰ', eod: 'এদিন অন্তৰত', day: 'দিন', week: 'সপ্তাহ', month: 'মাহ', year: 'বছৰ', before: 'খোৱাৰ আগত', after: 'খোৱাৰ পিছত', withFood: 'খাদ্যৰ সৈতে', withLiquid: 'গাখীৰ/পানীৰ সৈতে', lukewarm: 'লেতে গৰম পানীৰ সৈতে' },
  ur: { t: ['صبح', 'دوپہر', 'شام', 'رات'], od: 'دن میں ایک بار', bd: 'دن میں دو بار', tds: 'دن میں تین بار', qid: 'دن میں چار بار', hs: 'سوتے وقت', sos: 'ضرورت پڑنے پر', stat: 'فوراً', weekly: 'ہفتے میں ایک بار', eod: 'ایک دن چھوڑ کر', day: 'دن', week: 'ہفتہ', month: 'مہینہ', year: 'سال', before: 'کھانے سے پہلے', after: 'کھانے کے بعد', withFood: 'کھانے کے ساتھ', withLiquid: 'دودھ/پانی کے ساتھ', lukewarm: 'نیم گرم پانی کے ساتھ' },
  ne: { t: ['बिहान', 'दिउँसो', 'साँझ', 'राति'], od: 'दिनमा एक पटक', bd: 'दिनमा दुई पटक', tds: 'दिनमा तीन पटक', qid: 'दिनमा चार पटक', hs: 'सुत्नु अघि', sos: 'आवश्यक परेमा', stat: 'तुरुन्तै', weekly: 'हप्तामा एक पटक', eod: 'एक दिन बिराएर', day: 'दिन', week: 'हप्ता', month: 'महिना', year: 'वर्ष', before: 'खाना अघि', after: 'खाना पछि', withFood: 'खानासँग', withLiquid: 'दूध/पानीसँग', lukewarm: 'मनतातो पानीसँग' },
  sa: { t: ['प्रातः', 'मध्याह्ने', 'सायम्', 'रात्रौ'], od: 'दिने एकवारम्', bd: 'दिने द्विवारम्', tds: 'दिने त्रिवारम्', qid: 'दिने चतुर्वारम्', hs: 'शयनात् पूर्वम्', sos: 'आवश्यकतायाम्', stat: 'तत्क्षणम्', weekly: 'सप्ताहे एकवारम्', eod: 'एकदिनान्तरम्', day: 'दिनम्', week: 'सप्ताहः', month: 'मासः', year: 'वर्षम्', before: 'भोजनात् पूर्वम्', after: 'भोजनानन्तरम्', withFood: 'भोजनेन सह', withLiquid: 'दुग्ध/जलेन सह', lukewarm: 'कोष्णजलेन सह' },
  // ---- best-effort, flagged needsReview ----
  kok: { t: ['सकाळीं', 'दनपारां', 'सांजे', 'रातीं'], od: 'दिसाक एक फावट', bd: 'दिसाक दोन फावटी', tds: 'दिसाक तीन फावटी', qid: 'दिसाक चार फावटी', hs: 'निदपा आदीं', sos: 'गरज आसल्यार', stat: 'ताबडतोब', weekly: 'सप्तकांत एक फावट', eod: 'एक दीस सोडून', day: 'दीस', week: 'सप्तक', month: 'म्हयनो', year: 'वर्स', before: 'जेवणा आदीं', after: 'जेवणा उपरांत', withFood: 'जेवणा वांगडा', withLiquid: 'दूद/उदका वांगडा', lukewarm: 'कोमट उदका वांगडा' },
  mai: { t: ['भोर', 'दुपहर', 'साँझ', 'राति'], od: 'दिनमे एक बेर', bd: 'दिनमे दू बेर', tds: 'दिनमे तीन बेर', qid: 'दिनमे चारि बेर', hs: 'सुतबा सँ पहिने', sos: 'जरूरत पड़ला पर', stat: 'तुरंत', weekly: 'सप्ताहमे एक बेर', eod: 'एक दिन छोड़ि क', day: 'दिन', week: 'सप्ताह', month: 'महिना', year: 'वर्ष', before: 'खेनाइ सँ पहिने', after: 'खेनाइक बाद', withFood: 'भोजनक संग', withLiquid: 'दूध/पानिक संग', lukewarm: 'गुनगुना पानिक संग' },
  sd: { t: ['صبح', 'منجهند', 'شام', 'رات'], od: 'ڏينهن ۾ هڪ ڀيرو', bd: 'ڏينهن ۾ ٻه ڀيرا', tds: 'ڏينهن ۾ ٽي ڀيرا', qid: 'ڏينهن ۾ چار ڀيرا', hs: 'سمهڻ کان اڳ', sos: 'ضرورت وقت', stat: 'فوراً', weekly: 'هفتي ۾ هڪ ڀيرو', eod: 'هڪ ڏينهن ڇڏي', day: 'ڏينهن', week: 'هفتو', month: 'مهينو', year: 'سال', before: 'کاڌي کان اڳ', after: 'کاڌي کان پوءِ', withFood: 'کاڌي سان', withLiquid: 'کير/پاڻي سان', lukewarm: 'ڪوسي پاڻي سان' },
  doi: { t: ['सवेर', 'दपैहर', 'त्रिकाल', 'रात'], od: 'दिने च इक बारी', bd: 'दिने च दो बारी', tds: 'दिने च त्रै बारी', qid: 'दिने च चार बारी', hs: 'सौंण थमां पैह्लें', sos: 'लोड़ पौने पर', stat: 'फ़ौरन', weekly: 'हफ्ते च इक बारी', eod: 'इक दिन छड्डी नै', day: 'दिन', week: 'हफ्ता', month: 'म्हीना', year: 'ब’रा', before: 'खाने थमां पैह्लें', after: 'खाने बाद', withFood: 'खाने कन्नै', withLiquid: 'दुद्ध/पानी कन्नै', lukewarm: 'कोसे पानी कन्नै' },
};

function pack(lang: PatientLang): Pack | null {
  return (PACKS[lang] as Pack | undefined) || null;
}

/** "1-0-1" / "1-1-1" / "0-0-1" / "1-0-0-1" → time-of-day words for each dose. */
function fromDosePattern(freq: string, p: Pack): string | null {
  const m = freq.trim().match(/^(\d+(?:\.\d+)?)([\-\/·](\d+(?:\.\d+)?)){1,3}$/);
  if (!m) return null;
  const parts = freq.trim().split(/[\-\/·]/).map((x) => Number(x));
  if (parts.some((n) => Number.isNaN(n))) return null;
  // 3 slots → morning/afternoon/night; 4 slots → morning/afternoon/evening/night.
  const slots = parts.length === 4 ? [p.t[0], p.t[1], p.t[2], p.t[3]]
    : parts.length === 3 ? [p.t[0], p.t[1], p.t[3]] : null;
  if (!slots) return null;
  const on = parts.map((n, i) => (n > 0 ? slots[i] : null)).filter(Boolean) as string[];
  return on.length ? on.join('-') : null;
}

const FREQ_WORDS = (p: Pack): [RegExp, string][] => [
  [/\bmorning\b/i, p.t[0]],
  [/\b(afternoon|noon)\b/i, p.t[1]],
  [/\bevening\b/i, p.t[2]],
  [/\b(night|nite)\b/i, p.t[3]],
  [/\b(once daily|once a day|\bOD\b|\bQD\b)\b/i, p.od],
  [/\b(twice daily|twice a day|\bBD\b|\bBID\b)\b/i, p.bd],
  [/\b(thrice daily|three times|\bTDS\b|\bTID\b)\b/i, p.tds],
  [/\b(four times|\bQID\b|\bQDS\b)\b/i, p.qid],
  [/\b(at bedtime|bed ?time|\bHS\b|\bQHS\b)\b/i, p.hs],
  [/\b(SOS|when required|if needed|PRN)\b/i, p.sos],
  [/\b(stat|immediately)\b/i, p.stat],
  [/\b(weekly|once a week)\b/i, p.weekly],
  [/\b(alternate day|every other day|\bEOD\b)\b/i, p.eod],
];

export function freqLang(freq: string | null | undefined, lang: PatientLang): string {
  const p = pack(lang);
  if (!freq || !p) return '';
  const pat = fromDosePattern(freq, p);
  if (pat) return pat;
  const hits: string[] = [];
  for (const [re, word] of FREQ_WORDS(p)) if (re.test(freq)) hits.push(word);
  return hits.join(' · ');
}

export function durationLang(dur: string | null | undefined, lang: PatientLang): string {
  const p = pack(lang);
  if (!dur || !p) return '';
  const m = dur.match(/(\d+)\s*(days?|d|weeks?|wks?|w|months?|mon|m|years?|yrs?|y)\b/i);
  if (!m) return '';
  const n = m[1];
  const u = m[2].toLowerCase();
  if (u.startsWith('w')) return `${n} ${p.week}`;
  if (u.startsWith('mon') || u === 'm' || u.startsWith('month')) return `${n} ${p.month}`;
  if (u.startsWith('y')) return `${n} ${p.year}`;
  return `${n} ${p.day}`;
}

const INSTR_WORDS = (p: Pack): [RegExp, string][] => [
  [/\b(before food|before meals?|empty ?stomach|a\.?c\.?)\b/i, p.before],
  [/\b(after food|after meals?|p\.?c\.?)\b/i, p.after],
  [/\b(with food|with meals?)\b/i, p.withFood],
  [/\bwith (milk|water)\b/i, p.withLiquid],
  [/\blukewarm water\b/i, p.lukewarm],
];

export function instructionsLang(instr: string | null | undefined, lang: PatientLang): string {
  const p = pack(lang);
  if (!instr || !p) return '';
  const hits: string[] = [];
  for (const [re, word] of INSTR_WORDS(p)) if (re.test(instr)) hits.push(word);
  return hits.join(' · ');
}

/** One combined patient-language line for a prescription row, or '' if nothing translated. */
export function rxLangLine(
  r: { frequency?: string | null; duration?: string | null; instructions?: string | null },
  lang: PatientLang,
): string {
  if (lang === 'none' || !pack(lang)) return '';
  const parts = [freqLang(r.frequency, lang), durationLang(r.duration, lang), instructionsLang(r.instructions, lang)].filter(Boolean);
  return parts.join(' · ');
}

/** Does this language have a translation pack (so the second print line is worth showing)? */
export function hasPack(lang: PatientLang): boolean {
  return lang !== 'none' && !!pack(lang);
}
