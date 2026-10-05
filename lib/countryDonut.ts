// The slices of the "By country" donut on /bmstats: the busiest few countries
// and everything else as one "Other" slice, so the ring never has more parts
// than can be told apart.

/** Countries drawn as their own slice; the rest fold into "Other". */
export const MAX_COUNTRIES = 5
/** The home country always wears the first colour. */
const HOME = 'TH'

export interface CountrySlice {
  /** Country code, or 'other'. */
  key: string
  name: string
  count: number
  /** 0–100. */
  percent: number
  /** Colour slot 1–5, or 0 for "Other". */
  slot: number
}

const SPECIAL: Record<string, string> = {
  direct: 'Not through Cloudflare',
  XX: 'Unknown',
  T1: 'Tor',
}

let regionNames: Intl.DisplayNames | null | undefined

/** "Thailand" for "TH"; the code itself if it is not a country. */
export function countryName(code: string): string {
  if (SPECIAL[code]) return SPECIAL[code]
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['en'], { type: 'region' })
    } catch {
      regionNames = null
    }
  }
  try {
    return regionNames?.of(code) ?? code
  } catch {
    return code
  }
}

// A colour belongs to a country, not to its rank: Thailand is always the first,
// and each other country starts from a slot of its own, so the ring does not
// repaint when two countries swap places.
function assignSlots(codes: string[]): Map<string, number> {
  const slots = new Map<string, number>()
  const taken = new Set<number>()
  const others = MAX_COUNTRIES - 1
  if (codes.includes(HOME)) {
    slots.set(HOME, 1)
    taken.add(1)
  }
  // In code order, so who shares the ring decides a clash, not who is ahead.
  for (const code of codes.filter((c) => c !== HOME).sort()) {
    let slot = 2 + (Array.from(code).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % others)
    while (taken.has(slot)) slot = slot >= MAX_COUNTRIES ? 1 : slot + 1
    slots.set(code, slot)
    taken.add(slot)
  }
  return slots
}

/** The donut's slices, busiest first with "Other" last. */
export function countrySlices(countries: Array<{ country: string; count: number }>): CountrySlice[] {
  const rows = countries.filter((c) => c.count > 0).sort((a, b) => b.count - a.count || a.country.localeCompare(b.country))
  const total = rows.reduce((sum, c) => sum + c.count, 0)
  if (total === 0) return []
  const top = rows.slice(0, MAX_COUNTRIES)
  const rest = rows.slice(MAX_COUNTRIES)
  const slots = assignSlots(top.map((c) => c.country))
  const slices: CountrySlice[] = top.map((c) => ({
    key: c.country,
    name: countryName(c.country),
    count: c.count,
    percent: (c.count / total) * 100,
    slot: slots.get(c.country) ?? 0,
  }))
  if (rest.length > 0) {
    const count = rest.reduce((sum, c) => sum + c.count, 0)
    slices.push({
      key: 'other',
      name: `Other (${rest.length} ${rest.length === 1 ? 'country' : 'countries'})`,
      count,
      percent: (count / total) * 100,
      slot: 0,
    })
  }
  return slices
}

/** "95.2%", "<0.1%" for a sliver, "100%" for everything. */
export function percentLabel(percent: number): string {
  if (percent >= 99.95) return '100%'
  if (percent > 0 && percent < 0.1) return '<0.1%'
  return `${percent.toFixed(1)}%`
}
