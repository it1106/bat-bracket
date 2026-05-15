import { batFetch } from '@/lib/bat-fetch'
import {
  parseTournamentDraws,
  parseTournamentMeta,
  parseBracket,
  parseMatchesFull,
  parseRoundRobinMatches,
  parseRoundRobinScheduleMatches,
  parseStandings,
  detectGroupedDraws,
  orderScheduleGroups,
} from '@/lib/scraper'
import type {
  TournamentInfo, DrawInfo, BracketData, MatchesData,
  MatchScheduleGroup, MatchEntry, PlayerProfile, H2HData,
  TournamentRef, EventBundle, GroupData,
} from '@/lib/types'
import type { TournamentProvider, GroupRefresh } from './types'
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

// XHR variant: required for endpoints (e.g. GetStandings) that return the
// full page wrapper unless the request is flagged as XHR.
async function fetchHtmlXhr(kind: string, refId: string, drawNum: string, url: string): Promise<string | null> {
  const headers = {
    ...HEADERS,
    'X-Requested-With': 'XMLHttpRequest',
    'Accept': 'text/html, */*; q=0.01',
    'Referer': `https://bat.tournamentsoftware.com/tournament/${refId}/draw/${drawNum}`,
  }
  const res = await batFetch(kind, url, { headers })
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
  async getPlayer(): Promise<PlayerProfile | null> {
    throw new NotImplementedError('getPlayer', 'bat')
  },
  async getH2H(): Promise<H2HData | null> {
    throw new NotImplementedError('getH2H', 'bat')
  },
  async getLiveScore(): Promise<MatchEntry | null> {
    throw new NotImplementedError('getLiveScore', 'bat')
  },
  async getEventBundle(ref: TournamentRef, eventName: string): Promise<EventBundle | null> {
    const allDraws = await this.getDraws(ref)
    const annotated = detectGroupedDraws(allDraws)
    const groupDraws = annotated
      .filter((d) => d.eventName === eventName && d.groupLetter)
      .sort((a, b) => (a.groupLetter ?? '').localeCompare(b.groupLetter ?? ''))
    const playoffDraw = annotated.find((d) => d.eventName === eventName && d.isPlayoff)
    if (!playoffDraw || groupDraws.length === 0) return null

    const drawContentUrl = (n: string) =>
      `https://bat.tournamentsoftware.com/tournament/${ref.id}/Draw/${n}/GetDrawContent?tabindex=1&X-Requested-With=XMLHttpRequest`
    const standingsUrl = (n: string) =>
      `https://bat.tournamentsoftware.com/tournament/${ref.id}/Draw/${n}/GetStandings`

    const playoffPromise = this.getBracket(ref, playoffDraw.drawNum)
    const groupPromises = groupDraws.flatMap((g) => [
      fetchHtmlXhr('group', ref.id, g.drawNum, drawContentUrl(g.drawNum)),
      fetchHtmlXhr('standings', ref.id, g.drawNum, standingsUrl(g.drawNum)),
    ])

    const settled = await Promise.allSettled([playoffPromise, ...groupPromises])
    const playoffResult = settled[0] as PromiseSettledResult<BracketData | null>
    const playoff: BracketData = playoffResult.status === 'fulfilled' && playoffResult.value
      ? playoffResult.value
      : { html: '', format: 'unknown' }

    const groups: GroupData[] = groupDraws.map((g, i) => {
      const drawHtmlRes = settled[1 + i * 2] as PromiseSettledResult<string | null>
      const standingsHtmlRes = settled[2 + i * 2] as PromiseSettledResult<string | null>
      const drawHtml = drawHtmlRes.status === 'fulfilled' ? drawHtmlRes.value : null
      const standingsHtml = standingsHtmlRes.status === 'fulfilled' ? standingsHtmlRes.value : null
      return {
        drawNum: g.drawNum,
        groupLetter: g.groupLetter ?? '',
        standings: standingsHtml ? parseStandings(standingsHtml) : [],
        matches: drawHtml ? parseRoundRobinMatches(drawHtml, g.name) : [],
      }
    })

    return { eventName, playoff, playoffDrawNum: playoffDraw.drawNum, groups }
  },
  async refreshGroup(ref: TournamentRef, drawNum: string): Promise<GroupRefresh | null> {
    const matchesUrl = `https://bat.tournamentsoftware.com/tournament/${ref.id}/Draw/${drawNum}/GetMatchesContent?tabindex=1`
    const standingsUrl = `https://bat.tournamentsoftware.com/tournament/${ref.id}/Draw/${drawNum}/GetStandings`
    const [matchesHtmlRes, standingsHtmlRes] = await Promise.allSettled([
      fetchHtmlXhr('group-matches', ref.id, drawNum, matchesUrl),
      fetchHtmlXhr('standings', ref.id, drawNum, standingsUrl),
    ])
    const matchesHtml = matchesHtmlRes.status === 'fulfilled' ? matchesHtmlRes.value : null
    const standingsHtml = standingsHtmlRes.status === 'fulfilled' ? standingsHtmlRes.value : null
    if (!matchesHtml && !standingsHtml) return null
    return {
      standings: standingsHtml ? parseStandings(standingsHtml) : [],
      matches: matchesHtml ? parseRoundRobinScheduleMatches(matchesHtml, '') : [],
    }
  },
}
