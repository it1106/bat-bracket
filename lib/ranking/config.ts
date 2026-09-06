import type { ProviderTag } from '@/lib/types'

export interface PollSchedule {
  /** Bangkok day-of-week: 0=Sun..6=Sat. BAT=Tue=2, BWF=Wed=3. */
  dayOfWeek: number
  /** Inclusive start hour (Bangkok local). */
  startHour: number
  /** Inclusive end hour. */
  endHour: number
  /** Cache older than this on boot triggers an immediate peek regardless
   *  of day-of-week (6 days = one day of safety margin under weekly
   *  upstream cadence). */
  staleBootKickMs: number
}

export type DateFormat = 'thai-be' | 'en-gb'

/** One ranking series published by a provider. BAT split its single
 *  all-ages list (rid=188, retired after the 28/7/2569 publication) into an
 *  Open list and a Junior list; both publish weekly on the same day. Order
 *  here is display order — Open first, so it takes the slot the old U23
 *  events used to occupy at the top of the board list. */
export interface RankingSeriesConfig {
  /** `rid=` series id. */
  id: string
  /** Short label used in logs and (optionally) UI. */
  label: string
}

export interface RankingProviderConfig {
  provider: 'bat' | 'bwf'
  series: RankingSeriesConfig[]
  overviewUrl: (seriesId: string) => string
  categoryUrl: (rankingId: string, categoryId: string, page?: number) => string
  playerUrl:   (rankingId: string, globalPlayerId: string) => string
  headers: Record<string, string>
  dateFormat: DateFormat
  pollSchedule: PollSchedule
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000

const BAT_BASE = 'https://bat.tournamentsoftware.com/ranking'
const BWF_BASE = 'https://www.tournamentsoftware.com/ranking'

export const PROVIDER_CONFIG: Record<'bat' | 'bwf', RankingProviderConfig> = {
  bat: {
    provider: 'bat',
    series: [
      { id: '289', label: 'Open' },
      { id: '189', label: 'Junior' },
    ],
    overviewUrl: (rid) => `${BAT_BASE}/ranking.aspx?rid=${rid}`,
    categoryUrl: (rid, cat, page) => {
      const base = `${BAT_BASE}/category.aspx?id=${rid}&category=${cat}&ps=100`
      return page && page > 1 ? `${base}&p=${page}` : base
    },
    playerUrl:   (rid, pid) => `${BAT_BASE}/player.aspx?id=${rid}&player=${pid}`,
    headers: { 'User-Agent': UA },
    dateFormat: 'thai-be',
    pollSchedule: { dayOfWeek: 2, startHour: 8, endHour: 23, staleBootKickMs: SIX_DAYS_MS },
  },
  bwf: {
    provider: 'bwf',
    series: [{ id: '186', label: 'Badminton Asia Junior' }],
    overviewUrl: (rid) => `${BWF_BASE}/ranking.aspx?rid=${rid}`,
    categoryUrl: (rid, cat, page) => {
      const base = `${BWF_BASE}/category.aspx?id=${rid}&category=${cat}&ps=100`
      return page && page > 1 ? `${base}&p=${page}` : base
    },
    playerUrl:   (rid, pid) => `${BWF_BASE}/player.aspx?id=${rid}&player=${pid}`,
    // www.tournamentsoftware.com 302s to /cookiewall unless an `st` cookie is
    // present. cp=23 = purposes 1|2|4|16 (full opt-in); l=2057 = en-GB locale
    // so the publish date renders as unambiguous DD/MM/YYYY.
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Cookie': 'st=l=2057&exp=46542&c=1&cp=23',
    },
    dateFormat: 'en-gb',
    pollSchedule: { dayOfWeek: 3, startHour: 8, endHour: 23, staleBootKickMs: SIX_DAYS_MS },
  },
}

export function getRankingConfig(provider: ProviderTag): RankingProviderConfig {
  if (provider !== 'bat' && provider !== 'bwf') {
    throw new Error(`unsupported ranking provider: ${provider}`)
  }
  return PROVIDER_CONFIG[provider]
}
