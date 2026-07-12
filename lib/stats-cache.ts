import { promises as fs } from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import type { TournamentStats } from './types'

function safeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function statsPath(tournamentId: string): string {
  return path.join(process.cwd(), '.cache', 'stats', `${safeSegment(tournamentId)}.json`)
}

// v1 envelopes were written before the route guarded against an empty
// clubs map, so some on-disk caches have club: '—' baked into every
// medal/multi-gold row. v2 added the empty-clubs guard. v3 adds club to
// every topPlayers row, which v2 caches don't carry. v4 adds the per-medal
// medalist arrays on clubMedals (needed for the hover tooltip). v5 sorts
// each medalist array by event rank (and updates OPEN_ORDER/DISCIPLINES to
// MS-MD-WS-WD-XD / BS-BD-GS-GD-XD plus U7), so v4 envelopes have the wrong
// in-tooltip order. v6 adds clubRosters and countryRosters — without it the
// client crashes on `.length` of undefined when rendering past tournaments.
// v7 adds members[] (player names) to each roster row for the hover tooltip.
// v8 adds players (unique count) on each event row, and reshuffles event
// sort to singles-before-doubles (MS-WS-MD-WD-XD / BS-GS-BD-GD-XD); v7
// envelopes crash the panel when it tries to render undefined.players.
// v9 falls back to country code in topPlayers[].club for BWF tournaments
// (no clubs map); v8 envelopes have '—' there for every BWF row.
// v10 removes the top-10 cap on clubMedals — the UI now caps at 10 with a
// "show more" toggle for the long tail. v9 envelopes are truncated and would
// never expose the toggle until re-aggregated.
// v11 adds results[] (match-by-match) to each topPlayers row, powering the
// W-L hover tooltip. v10 envelopes have no results, so the tooltip would be
// empty until re-aggregated.
// v12 credits walkover finals/semis as titles and medals — a walkover final
// still crowns a champion (event winner + gold/silver) and a walkover semi
// still earns the loser bronze. v11 envelopes show such finals as "pending"
// with no medal credit, so they must be recomputed.
// v13 adds team (sorted playerIds) to each clubMedals medalist so the panel's
// "medals" mode can dedup by team instead of event — badminton awards two
// bronzes per event, so two same-country bronze teams must count separately.
// v12 envelopes lack team and would still collapse those to one bronze.
// v14 adds eventBreakdown (per-country team counts by knockout round). v13
// envelopes lack it, so the Event Breakdown matrix would be empty until
// recomputed.
// v15 adds per-cell teams[] (member names + event) to eventBreakdown for the
// hover tooltip. v14 cells have no names, so the tooltip would be empty.
// Bumping the version invalidates older envelopes so they get recomputed.
export interface StatsCacheEnvelope {
  version: 15
  sourceVersion: string
  // Set to true only when every day in fullData.days had a disk-cache hit at
  // write time. Older envelopes (or those written with partial coverage) are
  // ignored on read so a stale, incomplete aggregate never gets stuck in the
  // cache once shards finally arrive.
  coverageComplete: boolean
  stats: TournamentStats
}

export async function readStatsCache(tournamentId: string): Promise<StatsCacheEnvelope | null> {
  try {
    const buf = await fs.readFile(statsPath(tournamentId), 'utf8')
    const parsed = JSON.parse(buf) as StatsCacheEnvelope
    if (parsed.version !== 15) return null
    if (parsed.coverageComplete !== true) return null
    return parsed
  } catch {
    return null
  }
}

export async function writeStatsCache(
  tournamentId: string,
  envelope: { sourceVersion: string; coverageComplete: boolean; stats: TournamentStats },
): Promise<void> {
  if (!envelope.coverageComplete) return
  const file = statsPath(tournamentId)
  const tmp = `${file}.tmp`
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    const payload: StatsCacheEnvelope = { version: 15, ...envelope }
    await fs.writeFile(tmp, JSON.stringify(payload), 'utf8')
    await fs.rename(tmp, file)
    console.log(`[stats-cache] wrote tournament=${tournamentId}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.log(`[stats-cache] write failed tournament=${tournamentId} err=${msg}`)
  }
}

export function hashFullCacheBytes(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}
