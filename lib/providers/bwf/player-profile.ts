import { countryDisplayName } from '@/lib/countryCodes'
import type { MatchEntry, MatchesData, MatchPlayer, PlayerEvent, PlayerProfile } from '@/lib/types'

// BWF publishes no per-player page of its own, but the tournament schedule we
// already hold carries every match with its players' ids — so a player's
// profile is a filter over it rather than an upstream fetch. BAT, which does
// have such a page, keeps its own scraping path (lib/bat-player-fetch).
function playerIn(team: MatchPlayer[], playerId: string): MatchPlayer | undefined {
  return team.find((p) => p.playerId === playerId)
}

/** The player's matches and the draws they entered, read out of one
 *  tournament's schedule. Null when the id plays no match in it. */
export function buildBwfPlayerProfile(schedule: MatchesData, playerId: string): PlayerProfile | null {
  const matches: MatchEntry[] = []
  const events: PlayerEvent[] = []
  const seenEvents = new Set<string>()
  let self: MatchPlayer | undefined

  for (const group of schedule.groups) {
    for (const m of group.matches) {
      const me = playerIn(m.team1, playerId) ?? playerIn(m.team2, playerId)
      if (!me) continue
      self ??= me
      // The modal's event pills filter by eventId and only fall back to
      // matching draw names when it's missing; BWF entries carry the draw
      // number instead, so stamp it as the id.
      matches.push({ ...m, eventId: m.eventId ?? m.drawNum })
      const eventId = m.eventId ?? m.drawNum
      if (eventId && !seenEvents.has(eventId)) {
        seenEvents.add(eventId)
        events.push({ eventId, name: m.draw })
      }
    }
  }

  if (!self) return null

  return {
    playerId,
    name: self.name,
    // BWF has no clubs. The country takes the same line, spelled out.
    club: countryDisplayName(self.country),
    yob: '',
    events,
    matches,
  }
}
