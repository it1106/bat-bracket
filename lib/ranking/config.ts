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

export interface RankingProviderConfig {
  provider: 'bat' | 'bwf'
  overviewUrl: string
  categoryUrl: (rankingId: string, categoryId: string) => string
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
    overviewUrl: `${BAT_BASE}/ranking.aspx?rid=188`,
    categoryUrl: (rid, cat) => `${BAT_BASE}/category.aspx?id=${rid}&category=${cat}&ps=50`,
    playerUrl:   (rid, pid) => `${BAT_BASE}/player.aspx?id=${rid}&player=${pid}`,
    headers: { 'User-Agent': UA },
    dateFormat: 'thai-be',
    pollSchedule: { dayOfWeek: 2, startHour: 8, endHour: 23, staleBootKickMs: SIX_DAYS_MS },
  },
  bwf: {
    provider: 'bwf',
    overviewUrl: `${BWF_BASE}/ranking.aspx?rid=186`,
    categoryUrl: (rid, cat) => `${BWF_BASE}/category.aspx?id=${rid}&category=${cat}&ps=50`,
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
