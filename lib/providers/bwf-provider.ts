import { lookupByGuid } from './bwf/sidecar'
import {
  fetchTournamentDetail,
  fetchTournamentDraws,
  fetchTournamentDrawData,
  fetchDayMatches,
} from './bwf/api-client'
import {
  parseTournamentDetail,
  parseDraws,
  parseDayMatches,
  parseDrawData,
} from './bwf/parsers'
import { buildBracketHtml } from './bwf/bracket-html'
import { getTodayIso } from '@/lib/today'
import type {
  MatchesData,
  MatchScheduleGroup, MatchEntry, PlayerProfile, H2HData,
  TournamentRef, EventBundle,
} from '@/lib/types'
import type { TournamentProvider, GroupRefresh } from './types'
import { NotImplementedError } from './types'

function resolveOrThrow(ref: TournamentRef) {
  const entry = lookupByGuid(ref.id)
  if (!entry) throw new Error(`[bwf] no sidecar entry for ${ref.id}`)
  return entry
}

// Short-window memo for the tournament-draws payload. getBracket and
// getDayMatches both need the draw list on every call, but it barely changes
// during play — second-by-second polling was the largest avoidable share of
// vue-tournament-draws hits. Keyed by (tmtId, tmtType, tmtTab); 5 min is well
// inside how often draws actually change (rarely) and well below how often
// schedule polls fire (every few seconds during active play).
const DRAWS_MEMO_TTL_MS = 5 * 60 * 1000
const drawsMemo = new Map<string, { json: unknown; ts: number }>()

async function getDrawsJson(tmtId: number, tmtType = 0, tmtTab = 'draw'): Promise<unknown> {
  const key = `${tmtId}:${tmtType}:${tmtTab}`
  const hit = drawsMemo.get(key)
  if (hit && Date.now() - hit.ts < DRAWS_MEMO_TTL_MS) return hit.json
  const json = await fetchTournamentDraws({ tmtId, tmtType, tmtTab })
  drawsMemo.set(key, { json, ts: Date.now() })
  return json
}

export const bwfProvider: TournamentProvider = {
  tag: 'bwf',
  async getMeta(ref) {
    try {
      const { tmtId } = resolveOrThrow(ref)
      const json = await fetchTournamentDetail({ tmtId })
      return parseTournamentDetail(json)
    } catch (err) {
      console.warn('[bwf] getMeta failed:', err)
      return null
    }
  },
  async getDraws(ref) {
    try {
      const { tmtId } = resolveOrThrow(ref)
      const json = await getDrawsJson(tmtId)
      return parseDraws(json)
    } catch (err) {
      console.warn('[bwf] getDraws failed:', err)
      return []
    }
  },
  async getBracket(ref, drawNum, fromRound = 0) {
    try {
      const { tmtId } = resolveOrThrow(ref)
      const drawsJson = await getDrawsJson(tmtId)
      const drawInfo = parseDraws(drawsJson).find((d) => d.drawNum === drawNum)
      const drawName = drawInfo?.name ?? drawNum
      const data = await fetchTournamentDrawData({ tmtId, drawId: drawNum })
      const html = buildBracketHtml(data, drawName, fromRound)
      return { html, format: 'single-elimination' as const }
    } catch (err) {
      console.warn('[bwf] getBracket failed:', err)
      return null
    }
  },
  async getDrawMatches(ref, drawNum, drawName) {
    try {
      const { tmtId } = resolveOrThrow(ref)
      const data = await fetchTournamentDrawData({ tmtId, drawId: drawNum })
      return parseDrawData(data, { drawNum, drawName })
    } catch (err) {
      console.warn('[bwf] getDrawMatches failed:', err)
      return []
    }
  },
  async getMatchesFull(ref): Promise<MatchesData | null> {
    try {
      const entry = resolveOrThrow(ref)
      const days = enumerateDays(entry.startDateIso, entry.endDateIso)
      const drawsJson = await getDrawsJson(entry.tmtId)
      const draws = parseDraws(drawsJson)
      const allGroups: MatchScheduleGroup[] = []
      for (const dateIso of days) {
        const json = await fetchDayMatches({ tournamentCode: entry.tournamentCode, date: dateIso })
        const groups = parseDayMatches(json, draws)
        allGroups.push(...groups)
      }
      return {
        days: days.map((dateIso) => ({
          date: dateIso, label: `${dateIso.slice(8)}/${dateIso.slice(5, 7)}`, dateIso, hasMatches: true,
        })),
        currentDate: pickCurrentDate(days),
        groups: allGroups,
      }
    } catch (err) {
      console.warn('[bwf] getMatchesFull failed:', err)
      return null
    }
  },
  async getDayMatches(ref, dateIso) {
    try {
      const entry = resolveOrThrow(ref)
      const [json, drawsJson] = await Promise.all([
        fetchDayMatches({ tournamentCode: entry.tournamentCode, date: dateIso }),
        getDrawsJson(entry.tmtId),
      ])
      return parseDayMatches(json, parseDraws(drawsJson))
    } catch (err) {
      console.warn('[bwf] getDayMatches failed:', err)
      return []
    }
  },
  async getPlayer(): Promise<PlayerProfile | null> { throw new NotImplementedError('getPlayer', 'bwf') },
  async getH2H(): Promise<H2HData | null> { throw new NotImplementedError('getH2H', 'bwf') },
  async getLiveScore(): Promise<MatchEntry | null> { throw new NotImplementedError('getLiveScore', 'bwf') },
  async getEventBundle(): Promise<EventBundle | null> { throw new NotImplementedError('getEventBundle', 'bwf') },
  async refreshGroup(): Promise<GroupRefresh | null> { throw new NotImplementedError('refreshGroup', 'bwf') },
}

// Default the schedule's selected tab to today when the tournament is live;
// otherwise clamp to the nearest end (first day for upcoming, last for past).
function pickCurrentDate(days: string[]): string {
  if (days.length === 0) return ''
  const today = getTodayIso()
  if (days.includes(today)) return today
  if (today < days[0]) return days[0]
  return days[days.length - 1]
}

function enumerateDays(startIso: string, endIso: string): string[] {
  const out: string[] = []
  if (!startIso || !endIso) return out
  const start = new Date(startIso + 'T00:00:00Z')
  const end = new Date(endIso + 'T00:00:00Z')
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}
