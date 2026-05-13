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
  parseDrawData,
  parseDayMatches,
} from './bwf/parsers'
import { buildBracketHtml } from './bwf/bracket-html'
import type {
  TournamentInfo, DrawInfo, BracketData, MatchesData,
  MatchScheduleGroup, MatchEntry, PlayerProfile, H2HData,
  TournamentRef,
} from '@/lib/types'
import type { TournamentProvider } from './types'
import { NotImplementedError } from './types'

function resolveOrThrow(ref: TournamentRef) {
  const entry = lookupByGuid(ref.id)
  if (!entry) throw new Error(`[bwf] no sidecar entry for ${ref.id}`)
  return entry
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
      const json = await fetchTournamentDraws({ tmtId })
      return parseDraws(json)
    } catch (err) {
      console.warn('[bwf] getDraws failed:', err)
      return []
    }
  },
  async getBracket(ref, drawNum) {
    try {
      const { tmtId } = resolveOrThrow(ref)
      const drawsJson = await fetchTournamentDraws({ tmtId })
      const drawInfo = parseDraws(drawsJson).find((d) => d.drawNum === drawNum)
      const drawName = drawInfo?.name ?? drawNum
      const data = await fetchTournamentDrawData({ tmtId, drawId: drawNum })
      const html = buildBracketHtml(data, drawName)
      return { html, format: 'single-elimination' as const }
    } catch (err) {
      console.warn('[bwf] getBracket failed:', err)
      return null
    }
  },
  async getMatchesFull(ref): Promise<MatchesData | null> {
    try {
      const entry = resolveOrThrow(ref)
      const days = enumerateDays(entry.startDateIso, entry.endDateIso)
      const allGroups: MatchScheduleGroup[] = []
      for (const dateIso of days) {
        const json = await fetchDayMatches({ tournamentCode: entry.tournamentCode, date: dateIso })
        const groups = parseDayMatches(json)
        allGroups.push(...groups)
      }
      return {
        days: days.map((dateIso) => ({
          date: dateIso, label: dateIso.slice(5), dateIso, hasMatches: true,
        })),
        currentDate: days[0] ?? '',
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
      const json = await fetchDayMatches({ tournamentCode: entry.tournamentCode, date: dateIso })
      return parseDayMatches(json)
    } catch (err) {
      console.warn('[bwf] getDayMatches failed:', err)
      return []
    }
  },
  async getPlayer(): Promise<PlayerProfile | null> { throw new NotImplementedError('getPlayer', 'bwf') },
  async getH2H(): Promise<H2HData | null> { throw new NotImplementedError('getH2H', 'bwf') },
  async getLiveScore(): Promise<MatchEntry | null> { throw new NotImplementedError('getLiveScore', 'bwf') },
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
