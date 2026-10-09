import { createHash } from 'crypto'
import type { MatchEntry, MatchPlayer, MatchScheduleGroup } from '@/lib/types'
import { computePlayingOrder } from '@/lib/playingOrder'
import { matchTag } from './text'
import type { DueAlert, PushSubscriptionRecord, Stage } from './types'

/** Club names are compared trimmed, with runs of spaces collapsed and case
 *  folded. Two clubs BAT spells differently stay two clubs. */
export function normalizeClub(name: string | undefined | null): string {
  return (name ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** A short stand-in for a push address, so the sent log does not hold it. */
export function endpointHash(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex').slice(0, 16)
}

export function sentKeyFor(endpoint: string, tournamentId: string, dateIso: string, match: MatchEntry, stage: Stage): string {
  return `${endpointHash(endpoint)}|${tournamentId.toUpperCase()}|${dateIso}|${matchTag(match)}|${stage}`
}

// "About three away" is a small range, so a once-a-minute check cannot step over it.
const SOON_FROM = 2
const SOON_TO = 4

// Before any match of the day has been played, how close a slot must be.
const LEAD_BEFORE_FIRST_SLOT = 30

/** "9:00", "09:00" or "9.00" as minutes since midnight; null when unreadable. */
function slotMinutes(time: string): number | null {
  const m = time.match(/(\d{1,2})[:.](\d{2})/)
  if (!m) return null
  const h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  return h < 24 && min < 60 ? h * 60 + min : null
}

/** Whether the day is under way: a match is on court, or one has been played.
 *  A walkover is not play. */
function playHasStarted(groups: MatchScheduleGroup[]): boolean {
  return groups.some((g) => g.matches.some((m) => m.nowPlaying || (m.winner !== null && !m.walkover)))
}

/** The alerts due now: for each device, each match with a player it follows
 *  by name at the front of the queue (`next`) or two to four places from it
 *  (`soon`) that has not been sent yet. A club follow brings none of these --
 *  a club is followed for its results. One match is one alert per stage. */
export function dueAlerts(input: {
  tournamentId: string
  dateIso: string
  groups: MatchScheduleGroup[]
  records: PushSubscriptionRecord[]
  clubOf: (playerId: string) => string | undefined
  alreadySent: (key: string) => boolean
  /** Minutes since midnight, Bangkok time. */
  nowMinutes: number
}): DueAlert[] {
  const { groups, records, clubOf, alreadySent, dateIso, nowMinutes } = input
  const tid = input.tournamentId.toUpperCase()

  const watching = records
    .map((r) => {
      const here = r.follows.filter((f) => f.tournamentId.toUpperCase() === tid)
      const players = new Set(here.flatMap((f) => (f.kind === 'player' ? [f.playerId] : [])))
      const clubs = new Map<string, string>()
      for (const f of here) {
        if (f.kind !== 'club') continue
        const key = normalizeClub(f.clubName)
        if (key) clubs.set(key, f.clubName)
      }
      return { record: r, players, clubs }
    })
    .filter((w) => w.players.size > 0 || w.clubs.size > 0)
  if (watching.length === 0) return []

  const order = computePlayingOrder({ groups, liveByCourt: null })
  // Until a match has been played or is on court, the queue says nothing about
  // the time: the day's first match is "next" from midnight on. Before play
  // starts a match is therefore only alerted when its own time slot is near.
  const started = playHasStarted(groups)
  const out: DueAlert[] = []

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi]
    const matches = group.matches
    if (!started) {
      const slot = group.type === 'time' ? slotMinutes(group.time) : null
      if (slot === null || slot - nowMinutes > LEAD_BEFORE_FIRST_SLOT) continue
    }
    for (let mi = 0; mi < matches.length; mi++) {
      const position = order.get(`${gi}-${mi}`)
      if (position === undefined) continue
      const match = matches[mi]
      if (match.winner !== null || match.walkover || match.nowPlaying) continue
      // An opponent not yet decided: wait. Alerting now would name nobody, and
      // the match would be alerted again as a different one once it is known.
      if (match.team1.length === 0 || match.team2.length === 0) continue
      const stage: Stage | null = position === 1 ? 'next' : position >= SOON_FROM && position <= SOON_TO ? 'soon' : null
      if (!stage) continue

      const inMatch: MatchPlayer[] = [...match.team1, ...match.team2]
      for (const w of watching) {
        const players: MatchPlayer[] = []
        const directPlayers: MatchPlayer[] = []
        const clubs = new Set<string>()
        for (const p of inMatch) {
          const viaClub = w.clubs.get(normalizeClub(clubOf(p.playerId)))
          if (viaClub) clubs.add(viaClub)
          const byName = !!p.playerId && w.players.has(p.playerId)
          if (byName) directPlayers.push(p)
          if (viaClub || byName) players.push(p)
        }
        // A club is followed for its results, not its fixtures: only a follow
        // by name brings an alert before the match.
        if (directPlayers.length === 0) continue

        const endpoint = w.record.endpoint
        const sentKey = sentKeyFor(endpoint, tid, dateIso, match, stage)
        if (alreadySent(sentKey)) continue
        // "next" settles "soon" as well: an early alert must never follow the late one.
        const covers = stage === 'next' ? [sentKey, sentKeyFor(endpoint, tid, dateIso, match, 'soon')] : [sentKey]
        out.push({ endpoint, lang: w.record.lang, stage, position, sentKey, covers, match, players, directPlayers, clubs: Array.from(clubs) })
      }
    }
  }
  return out
}

/** The results due now: for each device, each finished match with a player it
 *  follows, by name or through a followed club.
 *
 *  Only a result the watcher saw come in counts (`resultSeenAt`), and only for
 *  a follow made before it did: following a player at three must not report
 *  the match they won at nine. */
export function dueResults(input: {
  tournamentId: string
  dateIso: string
  groups: MatchScheduleGroup[]
  records: PushSubscriptionRecord[]
  alreadySent: (key: string) => boolean
  /** When the watcher first saw this match's result arrive; undefined if it never did. */
  resultSeenAt: (match: MatchEntry) => number | undefined
  clubOf: (playerId: string) => string | undefined
}): DueAlert[] {
  const { groups, records, alreadySent, dateIso, resultSeenAt, clubOf } = input
  const tid = input.tournamentId.toUpperCase()
  const out: DueAlert[] = []

  for (const group of groups) {
    for (const match of group.matches) {
      if (match.winner === null) continue
      const seenAt = resultSeenAt(match)
      if (seenAt === undefined) continue
      for (const record of records) {
        // Only follows already in place when the result arrived count, by name
        // or by club.
        const here = record.follows.filter((f) =>
          f.tournamentId.toUpperCase() === tid && !(Date.parse(f.addedAt) > seenAt))
        const followed = new Set(here.flatMap((f) => (f.kind === 'player' ? [f.playerId] : [])))
        const clubsWatched = new Map(here.flatMap((f) => (f.kind === 'club' ? [[normalizeClub(f.clubName), f.clubName] as const] : [])))
        if (followed.size === 0 && clubsWatched.size === 0) continue

        const players: MatchPlayer[] = []
        const directPlayers: MatchPlayer[] = []
        const clubs = new Set<string>()
        for (const p of [...match.team1, ...match.team2]) {
          const viaClub = clubsWatched.get(normalizeClub(clubOf(p.playerId)))
          if (viaClub) clubs.add(viaClub)
          const byName = !!p.playerId && followed.has(p.playerId)
          if (byName) directPlayers.push(p)
          if (viaClub || byName) players.push(p)
        }
        if (players.length === 0) continue

        const sentKey = sentKeyFor(record.endpoint, tid, dateIso, match, 'result')
        if (alreadySent(sentKey)) continue
        out.push({ endpoint: record.endpoint, lang: record.lang, stage: 'result', position: 0, sentKey, covers: [sentKey], match, players, directPlayers, clubs: Array.from(clubs) })
      }
    }
  }
  return out
}
