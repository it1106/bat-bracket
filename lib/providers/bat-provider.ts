import { batFetch } from '@/lib/bat-fetch'
import {
  parseTournamentDraws,
  parseTournamentMeta,
  parseBracket,
  parseMatchesFull,
  orderScheduleGroups,
} from '@/lib/scraper'
import type {
  TournamentInfo, DrawInfo, BracketData, MatchesData,
  MatchScheduleGroup, MatchEntry, PlayerProfile, H2HData,
  TournamentRef,
} from '@/lib/types'
import type { TournamentProvider } from './types'
import { NotImplementedError } from './types'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
}

async function fetchHtml(kind: string, url: string): Promise<string | null> {
  const res = await batFetch(kind, url, { headers: HEADERS })
  if (!res.ok) return null
  return res.text()
}

export const batProvider: TournamentProvider = {
  tag: 'bat',
  async getMeta(ref: TournamentRef): Promise<TournamentInfo | null> {
    const html = await fetchHtml('meta', `https://bat.tournamentsoftware.com/sport/draws.aspx?id=${ref.id}`)
    if (!html) return null
    const info = parseTournamentMeta(html)
    if (!info) return null
    return { id: ref.id, name: info.name, provider: 'bat' }
  },
  async getDraws(ref: TournamentRef): Promise<DrawInfo[]> {
    const html = await fetchHtml('draws', `https://bat.tournamentsoftware.com/sport/draws.aspx?id=${ref.id}`)
    if (!html) return []
    return parseTournamentDraws(html)
  },
  async getBracket(ref: TournamentRef, drawNum: string): Promise<BracketData | null> {
    const url = `https://bat.tournamentsoftware.com/tournament/${ref.id}/Draw/${drawNum}/GetDrawContent?tabindex=1&X-Requested-With=XMLHttpRequest`
    const headers = {
      ...HEADERS,
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'text/html, */*; q=0.01',
      'Referer': `https://bat.tournamentsoftware.com/tournament/${ref.id}/draw/${drawNum}`,
    }
    const res = await batFetch('bracket', url, { headers })
    if (!res.ok) return null
    const html = await res.text()
    return parseBracket(html)
  },
  async getMatchesFull(ref: TournamentRef): Promise<MatchesData | null> {
    const headers = {
      ...HEADERS,
      'Accept': 'text/html, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
    }
    const res = await batFetch('matches-full', `https://bat.tournamentsoftware.com/tournament/${ref.id}/matches`, { headers, cache: 'no-store' })
    if (!res.ok) return null
    const html = await res.text()
    const data = parseMatchesFull(html)
    return { ...data, groups: orderScheduleGroups(data.groups) }
  },
  async getDayMatches(ref: TournamentRef, dateIso: string): Promise<MatchScheduleGroup[]> {
    const full = await this.getMatchesFull(ref)
    if (!full) return []
    const day = full.days.find((d) => d.dateIso === dateIso)
    if (!day) return []
    return full.groups
  },
  async getPlayer(_ref: TournamentRef, _playerId: string): Promise<PlayerProfile | null> {
    throw new NotImplementedError('getPlayer', 'bat')
  },
  async getH2H(): Promise<H2HData | null> {
    throw new NotImplementedError('getH2H', 'bat')
  },
  async getLiveScore(): Promise<MatchEntry | null> {
    throw new NotImplementedError('getLiveScore', 'bat')
  },
}
