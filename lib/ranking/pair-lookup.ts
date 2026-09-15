import type { Ranking, RankingEntry, RankingEvent, RankingPlayer } from '@/lib/types'
import { samePartner } from '@/lib/ranking/partner-name'

/** How a player is identified against ranking rows. `globalPlayerId` is the
 *  strongest signal; the slugs cover rows scraped before ids were captured,
 *  and `aliasSlug` the curated spelling fixes in data/ranking-aliases.json. */
export interface PlayerIdentity {
  slug: string
  aliasSlug?: string
  globalPlayerId?: string
}

/** The row's players. Falls back to a one-member list built from the entry's
 *  own identity fields, which is what a singles row (or any pre-pairing cache)
 *  amounts to. */
function membersOf(e: RankingEntry): RankingPlayer[] {
  if (e.players && e.players.length > 0) return e.players
  return [{ name: e.name, slug: e.slug, ...(e.globalPlayerId ? { globalPlayerId: e.globalPlayerId } : {}) }]
}

/** True when the player is on this row — as EITHER half of a pairing.
 *
 *  The entry's own `slug`/`globalPlayerId` describe only the first player, so
 *  matching on those alone silently drops every pairing where the player is
 *  listed second. That is how สุวิจักขณ์ มีชัย's BD U15 #26 (with รวิณ ชูชัยศรี)
 *  went missing from his profile while his weaker #48 showed. */
export function entryIncludesPlayer(e: RankingEntry, who: PlayerIdentity): boolean {
  return membersOf(e).some(m =>
    (!!who.globalPlayerId && !!m.globalPlayerId && m.globalPlayerId === who.globalPlayerId) ||
    m.slug === who.slug ||
    (!!who.aliasSlug && m.slug === who.aliasSlug))
}

/** The names on this row other than the player's own — the pairing's other
 *  half. Empty for a singles row. */
export function partnersIn(e: RankingEntry, who: PlayerIdentity): string[] {
  const members = membersOf(e)
  if (members.length < 2) return []
  return members
    .filter(m =>
      !((!!who.globalPlayerId && !!m.globalPlayerId && m.globalPlayerId === who.globalPlayerId) ||
        m.slug === who.slug ||
        (!!who.aliasSlug && m.slug === who.aliasSlug)))
    .map(m => m.name)
}

/** Every entry of this event the player appears in, best (lowest) rank first.
 *  A doubles player holds one entry per pairing. */
export function entriesForPlayer(ev: RankingEvent, who: PlayerIdentity): RankingEntry[] {
  return ev.entries.filter(e => entryIncludesPlayer(e, who)).sort((a, b) => a.rank - b.rank)
}

/** The entry for ONE pairing: this player alongside `partnerName`. Null when
 *  no row matches — a pairing outside the cached depth, or a name the two
 *  sources spell differently. Partner names go through `samePartner`, which
 *  strips the seed marker and collapses whitespace. */
export function entryForPairing(
  ev: RankingEvent,
  who: PlayerIdentity,
  partnerName: string | null | undefined,
): RankingEntry | null {
  const mine = ev.entries.filter(e => entryIncludesPlayer(e, who))
  if (!partnerName) {
    // Singles: the only row that names nobody else.
    return mine.find(e => partnersIn(e, who).length === 0) ?? null
  }
  return mine.find(e => partnersIn(e, who).some(n => samePartner(n, partnerName))) ?? null
}

/** The player's best entry in a named event, across all their pairings. */
export function bestEntryForPlayer(
  ranking: Ranking | null | undefined,
  eventName: string,
  who: PlayerIdentity,
): RankingEntry | null {
  const ev = ranking?.events.find(e => e.eventName === eventName)
  return ev ? entriesForPlayer(ev, who)[0] ?? null : null
}
