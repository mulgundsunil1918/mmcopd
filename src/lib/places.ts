// Curated list of villages, towns, and taluk headquarters in and around Gadag district, Karnataka.
// Covers Gadag + 3 neighbouring districts (Haveri, Koppal, Dharwad).
// This is best-effort from general knowledge — receptionist can add any missing place via
// Settings -> Default Location & Known Villages, and any place typed during registration is
// remembered and auto-suggested next time.

export const KARNATAKA_PLACES: Record<string, string[]> = {
  Gadag: [
    'Gadag', 'Betageri', 'Mulgund', 'Hulkoti', 'Lakshmeshwar', 'Shirahatti', 'Naregal',
    'Ron', 'Nargund', 'Gajendragad', 'Mundargi', 'Dambal', 'Hombal', 'Soratur', 'Konnur',
    'Annigeri', 'Yelisirur', 'Magadi', 'Hadagali', 'Kalakeri', 'Mevundi', 'Adavi Somapur',
    'Belur', 'Doni', 'Kotumachgi', 'Surungi', 'Hirewaddatti', 'Hammigi', 'Binkadakatti',
    'Sambhapur', 'Antur', 'Hosa Kalakeri',
  ],
  Haveri: [
    'Haveri', 'Ranebennur', 'Hangal', 'Byadgi', 'Savanur', 'Shiggaon', 'Hirekerur',
    'Akki Alur', 'Bankapur', 'Karjagi', 'Tadas', 'Devihosur', 'Galaganath', 'Kaginele',
    'Kadakol', 'Karadagi', 'Tumminakatti', 'Negalur', 'Kabbur', 'Halgeri',
  ],
  Koppal: [
    'Koppal', 'Gangavathi', 'Yelburga', 'Kushtagi', 'Anegundi', 'Munirabad', 'Karatagi',
    'Kanakagiri', 'Kukanoor', 'Hanamasagar', 'Hitnal', 'Hosabandi Harlapur', 'Mangalore (Koppal)',
    'Tavargere', 'Kinnal', 'Kavalur', 'Bhagyanagar',
  ],
  Dharwad: [
    'Dharwad', 'Hubballi', 'Kalghatgi', 'Kundgol', 'Navalgund', 'Annigeri', 'Alnavar',
    'Kolivad', 'Mishrikoti', 'Saunshi', 'Garag', 'Yaragatti', 'Marewad', 'Tegur',
    'Tadakod', 'Hebsur', 'Mansur', 'Uppinabetageri', 'Amargol',
  ],
};

// Flat de-duplicated list (case-insensitive on dedupe), ready to feed a <datalist>
export const ALL_NEARBY_PLACES: string[] = (() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const district of Object.keys(KARNATAKA_PLACES)) {
    for (const p of KARNATAKA_PLACES[district]) {
      const k = p.trim().toLowerCase();
      if (!seen.has(k)) { seen.add(k); out.push(p); }
    }
  }
  return out;
})();

// Districts of Karnataka relevant for the suggester. The dropdown can fall back to
// the broader INDIAN_STATES list for state, but for district autocomplete this is enough.
export const KARNATAKA_DISTRICTS: string[] = [
  'Bagalkot', 'Ballari', 'Belagavi', 'Bengaluru Rural', 'Bengaluru Urban', 'Bidar',
  'Chamarajanagar', 'Chikkaballapur', 'Chikkamagaluru', 'Chitradurga', 'Dakshina Kannada',
  'Davanagere', 'Dharwad', 'Gadag', 'Hassan', 'Haveri', 'Kalaburagi', 'Kodagu', 'Kolar',
  'Koppal', 'Mandya', 'Mysuru', 'Raichur', 'Ramanagara', 'Shivamogga', 'Tumakuru',
  'Udupi', 'Uttara Kannada', 'Vijayanagara', 'Vijayapura', 'Yadgir',
];
