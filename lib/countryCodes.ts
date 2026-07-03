// BWF/IOC 3-letter country codes → English country name, for the nations that
// turn up in badminton draws. BWF stamps each player/team with one of these
// codes (e.g. "THA"); this map lets the player search resolve a typed country
// name or code back to that code so it can match. Keys are lowercase codes.
export const COUNTRY_NAMES: Record<string, string> = {
  tha: 'Thailand',
  ina: 'Indonesia',
  mas: 'Malaysia',
  sgp: 'Singapore',
  vie: 'Vietnam',
  phi: 'Philippines',
  mya: 'Myanmar',
  cam: 'Cambodia',
  lao: 'Laos',
  bru: 'Brunei',
  jpn: 'Japan',
  chn: 'China',
  tpe: 'Chinese Taipei',
  hkg: 'Hong Kong',
  mac: 'Macau',
  kor: 'Korea',
  prk: 'North Korea',
  mgl: 'Mongolia',
  ind: 'India',
  sri: 'Sri Lanka',
  mdv: 'Maldives',
  nep: 'Nepal',
  pak: 'Pakistan',
  ban: 'Bangladesh',
  bhu: 'Bhutan',
  kaz: 'Kazakhstan',
  uzb: 'Uzbekistan',
  iri: 'Iran',
  uae: 'United Arab Emirates',
  ksa: 'Saudi Arabia',
  qat: 'Qatar',
  bhr: 'Bahrain',
  kuw: 'Kuwait',
  oma: 'Oman',
  jor: 'Jordan',
  lbn: 'Lebanon',
  isr: 'Israel',
  den: 'Denmark',
  eng: 'England',
  sco: 'Scotland',
  wal: 'Wales',
  irl: 'Ireland',
  ger: 'Germany',
  fra: 'France',
  esp: 'Spain',
  ned: 'Netherlands',
  bel: 'Belgium',
  por: 'Portugal',
  ita: 'Italy',
  sui: 'Switzerland',
  aut: 'Austria',
  swe: 'Sweden',
  fin: 'Finland',
  nor: 'Norway',
  isl: 'Iceland',
  pol: 'Poland',
  cze: 'Czechia',
  svk: 'Slovakia',
  slo: 'Slovenia',
  cro: 'Croatia',
  hun: 'Hungary',
  rou: 'Romania',
  bul: 'Bulgaria',
  gre: 'Greece',
  ukr: 'Ukraine',
  rus: 'Russia',
  est: 'Estonia',
  ltu: 'Lithuania',
  lat: 'Latvia',
  tur: 'Turkey',
  aze: 'Azerbaijan',
  arm: 'Armenia',
  geo: 'Georgia',
  cyp: 'Cyprus',
  mlt: 'Malta',
  lux: 'Luxembourg',
  usa: 'United States',
  can: 'Canada',
  mex: 'Mexico',
  gua: 'Guatemala',
  bra: 'Brazil',
  per: 'Peru',
  chi: 'Chile',
  arg: 'Argentina',
  aus: 'Australia',
  nzl: 'New Zealand',
  rsa: 'South Africa',
  egy: 'Egypt',
  alg: 'Algeria',
  mri: 'Mauritius',
  ngr: 'Nigeria',
  uga: 'Uganda',
  ken: 'Kenya',
}

// Alternate spellings/short names people actually type, mapped to their code.
const COUNTRY_ALIASES: Record<string, string> = {
  taiwan: 'tpe',
  taipei: 'tpe',
  'south korea': 'kor',
  'north korea': 'prk',
  america: 'usa',
  'united states of america': 'usa',
  uk: 'eng',
  holland: 'ned',
  czechia: 'cze',
  'czech republic': 'cze',
  emirates: 'uae',
}

const MIN_COUNTRY_PREFIX = 3

// Resolve a typed search term to the country code(s) it implies:
//   "tha" → ["tha"]            (exact code)
//   "thai" / "thailand" → ["tha"]  (name prefix, ≥3 chars)
//   "taiwan" → ["tpe"]         (alias)
// A term can legitimately map to several codes (e.g. "ind" → India + Indonesia);
// all are returned so the search highlights every plausible nation. Returns []
// for terms that resolve to no country.
export function countryCodesForTerm(term: string): string[] {
  const t = term.trim().toLowerCase()
  if (!t) return []
  const out = new Set<string>()

  // Exact 3-letter code.
  if (COUNTRY_NAMES[t]) out.add(t)

  // Country-name prefix (guarded by a min length so "in"/"ch" don't fan out).
  if (t.length >= MIN_COUNTRY_PREFIX) {
    for (const [code, name] of Object.entries(COUNTRY_NAMES)) {
      if (name.toLowerCase().startsWith(t)) out.add(code)
    }
    for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) {
      if (alias.startsWith(t)) out.add(code)
    }
  }

  return Array.from(out)
}

// True when any typed search term names the given BWF country code (by exact
// code or by country name/prefix). Used by the match-list search to match a
// player's `country` field without letting a code like "tha" also match names.
export function queryMatchesCountry(queries: string[], country: string | null | undefined): boolean {
  if (!country) return false
  const c = country.toLowerCase()
  return queries.some((q) => countryCodesForTerm(q).includes(c))
}
