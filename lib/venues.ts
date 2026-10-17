import type { MatchScheduleGroup } from './types'

/** Sentinel for "don't filter" — never a real venue name. */
export const ALL_VENUES = '__all__'

/** The venue a court string names: everything before the first " - ".
 *
 *  Multi-venue BAT events print the venue in front of the court
 *  ("ยิมฯ 6 สนาม - A1"), and a row whose court isn't assigned yet prints the
 *  venue alone ("ยิมฯ 6 สนาม"). The separator is matched with the spaces
 *  around it so a hyphenated court number ("Gym6 - A-02") keeps its number.
 *
 *  Returns null when the row names no venue at all: an empty court, or BAT's
 *  "Now playing" stub, which replaces the court while a match is on court. */
export function venueOfCourt(court: string | undefined): string | null {
  const raw = (court ?? '').trim()
  if (!raw) return null
  if (/^now\s*playing$/i.test(raw)) return null
  const sep = raw.indexOf(' - ')
  const venue = (sep === -1 ? raw : raw.slice(0, sep)).trim()
  return venue || null
}

/** Every venue the day's matches name, in the order they first appear — which
 *  is the order the source page lists them in, so the dropdown reads like the
 *  schedule. */
export function collectVenues(groups: MatchScheduleGroup[]): string[] {
  const seen: string[] = []
  for (const g of groups) {
    for (const m of g.matches) {
      const venue = venueOfCourt(m.court)
      if (venue && !seen.includes(venue)) seen.push(venue)
    }
  }
  return seen
}

/** The schedule as one venue sees it. Rows whose venue is unknown (the "Now
 *  playing" stub, or no court at all) stay in every view: hiding a match in
 *  progress would also move the playing-order anchor, so the "up next" count
 *  would start from the wrong place. Groups left empty are dropped. */
export function filterGroupsByVenue(
  groups: MatchScheduleGroup[],
  venue: string,
): MatchScheduleGroup[] {
  if (venue === ALL_VENUES) return groups
  const out: MatchScheduleGroup[] = []
  for (const g of groups) {
    const matches = g.matches.filter((m) => {
      const v = venueOfCourt(m.court)
      return v === null || v === venue
    })
    if (matches.length === 0) continue
    out.push({ ...g, matches })
  }
  return out
}
