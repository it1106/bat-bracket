// Pure derived view for the per-discipline tab in the ranking-detail UI.
// Provider-agnostic: the publish-date format is passed in by the caller
// (BAT = 'thai-be', BWF = 'en-gb') and dispatched in
// parsePublishDateString. All downstream math (ISO week, 52-week cutoff)
// operates on the parsed UTC Date and is format-blind.

import type {
  Ranking,
  RankingPlayerDetail,
  RankingPlayerTournament,
  RankingTargetCredit,
} from '@/lib/types'
import type { DateFormat } from './config'

export type Discipline = 'singles' | 'doubles' | 'mixed'

export const TOP_N = 10

/** Classify a row's source event (e.g. "BS U15", "MD U17", "XD U23") into
 *  one of our three tabs. Order matters: check mixed (XD) before doubles
 *  (D) because "XD" contains "D" but is its own bucket. */
export function disciplineOf(sourceEvent: string): Discipline | null {
  const code = sourceEvent.trim().toUpperCase().split(/\s+/)[0]
  if (code.endsWith('XD') || code === 'XD' || code.startsWith('XD')) return 'mixed'
  if (code.endsWith('D') || code.includes('DOUBLE')) return 'doubles'
  if (code.endsWith('S') || code.includes('SINGLE')) return 'singles'
  return null
}

/** Zero-pad week half to two digits so string comparison agrees with
 *  calendar ordering. */
export function weekSortKey(week: string): string {
  const idx = week.indexOf('-')
  if (idx < 0) return week
  const y = week.slice(0, idx)
  const w = week.slice(idx + 1)
  return `${y}-${w.padStart(2, '0')}`
}

/** Numeric rank of an event's age group, higher = older / more senior. */
export function ageGroupRank(sourceEvent: string): number {
  const m = sourceEvent.match(/U(\d+)/i)
  if (!m) return Number.POSITIVE_INFINITY
  return parseInt(m[1], 10)
}

/** Parse a publish-date string into a UTC Date, branching on the provider's
 *  date format. Each branch rejects values that look like the other format
 *  so a typo or upstream locale change can't silently drift dates by 543
 *  years. Returns null on malformed input. */
function parsePublishDateString(s: string, format: DateFormat): Date | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const day = parseInt(m[1], 10)
  const month = parseInt(m[2], 10)
  const year = parseInt(m[3], 10)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  if (format === 'thai-be') {
    if (year < 2400) return null
    return new Date(Date.UTC(year - 543, month - 1, day))
  }
  // en-gb
  if (year >= 2400) return null
  return new Date(Date.UTC(year, month - 1, day))
}

/** ISO 8601 week of a UTC Date as "YYYY-W" (no zero-padding). */
function isoWeekString(d: Date): string {
  const t = new Date(d.getTime())
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((t.getTime() - yearStart) / 86400000 + 1) / 7)
  return `${t.getUTCFullYear()}-${week}`
}

export function weekKeyFromPublishDate(s: string, format: DateFormat): string | null {
  const d = parsePublishDateString(s, format)
  if (!d) return null
  return isoWeekString(d)
}

export function expiringWithinWeeksCutoff(
  publishDate: string,
  weeksOut: number,
  format: DateFormat,
): string | null {
  if (!Number.isInteger(weeksOut) || weeksOut < 1) return null
  const d = parsePublishDateString(publishDate, format)
  if (!d) return null
  const cutoff = new Date(d.getTime() - (53 - weeksOut) * 7 * 86400000)
  return isoWeekString(cutoff)
}

export function expiringNextWeekCutoff(publishDate: string, format: DateFormat): string | null {
  return expiringWithinWeeksCutoff(publishDate, 1, format)
}

export function isExpiringNextWeek(week: string, cutoff: string | null): boolean {
  if (!cutoff) return false
  return weekSortKey(week).localeCompare(weekSortKey(cutoff)) <= 0
}

/** Horizon (in publishing weeks) for the secondary 'soon' tier. */
export const EXPIRY_SOON_HORIZON_WEEKS = 4

export interface ExpiryCutoffs {
  /** Rows at or before this week fall out at the very next publication. */
  next: string | null
  /** Rows at or before this week fall out within EXPIRY_SOON_HORIZON_WEEKS
   *  publications. By construction `next` is a sub-set of `soon`. */
  soon: string | null
}

export type ExpiryTier = 'next' | 'soon' | null

export function computeExpiryCutoffs(
  publishDate: string | undefined | null,
  format: DateFormat,
): ExpiryCutoffs {
  if (!publishDate) return { next: null, soon: null }
  return {
    next: expiringWithinWeeksCutoff(publishDate, 1, format),
    soon: expiringWithinWeeksCutoff(publishDate, EXPIRY_SOON_HORIZON_WEEKS, format),
  }
}

export function classifyExpiry(week: string, cutoffs: ExpiryCutoffs): ExpiryTier {
  const w = weekSortKey(week)
  if (cutoffs.next && w.localeCompare(weekSortKey(cutoffs.next)) <= 0) return 'next'
  if (cutoffs.soon && w.localeCompare(weekSortKey(cutoffs.soon)) <= 0) return 'soon'
  return null
}

/** Dedup per (week, tournamentName) keeping the row that the upstream
 *  credits (marker > unmarked), then higher points, then higher age
 *  group. */
export function dedupePerTournament(
  rows: RankingPlayerTournament[],
): RankingPlayerTournament[] {
  const byKey = new Map<string, RankingPlayerTournament>()
  const isMarked = (r: RankingPlayerTournament) => r.countsTowardRankings.length > 0
  for (const r of rows) {
    const key = `${weekSortKey(r.week)}::${r.tournamentName.trim()}`
    const existing = byKey.get(key)
    if (!existing) { byKey.set(key, r); continue }
    const rM = isMarked(r), eM = isMarked(existing)
    let rWins: boolean
    if (rM !== eM) rWins = rM
    else if (r.points !== existing.points) rWins = r.points > existing.points
    else rWins = ageGroupRank(r.sourceEvent) > ageGroupRank(existing.sourceEvent)
    if (rWins) byKey.set(key, r)
  }
  return Array.from(byKey.values())
}

function disciplineRowsByPointsDesc(
  detail: RankingPlayerDetail,
  discipline: Discipline,
): RankingPlayerTournament[] {
  const inTab = detail.tournaments.filter(
    (r) => disciplineOf(r.sourceEvent) === discipline,
  )
  if (inTab.length === 0) return []
  return dedupePerTournament(inTab)
    .slice()
    .sort((a, b) => b.points - a.points || weekSortKey(b.week).localeCompare(weekSortKey(a.week)))
}

export function topRowsForTab(detail: RankingPlayerDetail, discipline: Discipline): RankingPlayerTournament[] {
  return disciplineRowsByPointsDesc(detail, discipline)
    .slice(0, TOP_N)
    .sort((a, b) => weekSortKey(b.week).localeCompare(weekSortKey(a.week)))
}

export function otherRowsForTab(detail: RankingPlayerDetail, discipline: Discipline): RankingPlayerTournament[] {
  return disciplineRowsByPointsDesc(detail, discipline).slice(TOP_N)
}

/** Like disciplineOf but takes a full ranking event name like
 *  "Boy's singles U15" rather than a token like "BS U15". Order of checks
 *  mirrors disciplineOf: mixed before doubles before singles. */
export function disciplineOfEventName(name: string): Discipline | null {
  const upper = name.toUpperCase()
  if (/MIXED/.test(upper)) return 'mixed'
  if (/DOUBLES?/.test(upper)) return 'doubles'
  if (/SINGLES?/.test(upper)) return 'singles'
  return null
}

export interface RankingSectionRow {
  row: RankingPlayerTournament
  /** Credit this row contributes toward this section's ranking event. */
  creditInThisSection: number
}

export interface RankingSection {
  eventName: string
  top: RankingSectionRow[]
  others: RankingSectionRow[]
  topTotal: number
}

/** Derive structured targets from the raw string list for older cached
 *  details that pre-date countsTowardRankingsParsed. Same parsing rule as
 *  parseMarkerCredits in player-scraper.ts. */
function deriveTargetsFromStrings(rowPoints: number, raw: string[]): RankingTargetCredit[] {
  return raw.map((s) => {
    const m = s.match(/^(.+?)\s*\(([\d.]+)\)\s*$/)
    if (m) return { eventName: m[1].trim(), credit: parseFloat(m[2]) }
    return { eventName: s, credit: rowPoints }
  })
}

function targetsOf(row: RankingPlayerTournament): RankingTargetCredit[] {
  if (row.countsTowardRankingsParsed && row.countsTowardRankingsParsed.length > 0) {
    return row.countsTowardRankingsParsed
  }
  return deriveTargetsFromStrings(row.points, row.countsTowardRankings)
}

/** Player's rank in a given event from the current overview cache, or null
 *  if unranked / no cache. */
function lookupRankIn(current: Ranking | null | undefined, eventName: string, slug: string): number | null {
  if (!current) return null
  const ev = current.events.find((e) => e.eventName === eventName)
  return ev?.entries.find((e) => e.slug === slug)?.rank ?? null
}

/** Numeric age tier from an event name; Infinity for open events. */
function ageTierOfEventName(name: string): number {
  const m = name.match(/U(\d+)/i)
  return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY
}

/** BWF-only: one section per target ranking event the player has credit
 *  toward, filtered to the active discipline tab. */
export function bwfSectionsForTab(
  detail: RankingPlayerDetail,
  discipline: Discipline,
  rankCtx?: { slug: string; current: Ranking | null },
): RankingSection[] {
  // 1. Build per-event row map, filtered to the active discipline.
  const byEvent = new Map<string, RankingSectionRow[]>()
  for (const row of detail.tournaments) {
    for (const target of targetsOf(row)) {
      if (disciplineOfEventName(target.eventName) !== discipline) continue
      const bucket = byEvent.get(target.eventName) ?? []
      bucket.push({ row, creditInThisSection: target.credit })
      byEvent.set(target.eventName, bucket)
    }
  }

  // 2. Per-section dedup + sort + top/others split.
  const sections: RankingSection[] = []
  for (const [eventName, rows] of Array.from(byEvent.entries())) {
    const dedupKey = (sr: RankingSectionRow) =>
      `${weekSortKey(sr.row.week)}::${sr.row.tournamentName.trim()}`
    const dedupMap = new Map<string, RankingSectionRow>()
    for (const sr of rows) {
      const key = dedupKey(sr)
      const ex = dedupMap.get(key)
      if (!ex || sr.creditInThisSection > ex.creditInThisSection) dedupMap.set(key, sr)
    }
    const sorted = Array.from(dedupMap.values()).sort(
      (a, b) =>
        b.creditInThisSection - a.creditInThisSection ||
        weekSortKey(b.row.week).localeCompare(weekSortKey(a.row.week)),
    )
    const top = sorted.slice(0, TOP_N).sort(
      (a, b) => weekSortKey(b.row.week).localeCompare(weekSortKey(a.row.week)),
    )
    const others = sorted.slice(TOP_N)
    const topTotal = top.reduce((sum, sr) => sum + sr.creditInThisSection, 0)
    sections.push({ eventName, top, others, topTotal })
  }

  // 3. Section ordering: ranked first (rank asc), then unranked (age desc).
  sections.sort((a, b) => {
    const ra = rankCtx ? lookupRankIn(rankCtx.current, a.eventName, rankCtx.slug) : null
    const rb = rankCtx ? lookupRankIn(rankCtx.current, b.eventName, rankCtx.slug) : null
    if (ra !== null && rb !== null) return ra - rb
    if (ra !== null) return -1
    if (rb !== null) return 1
    return ageTierOfEventName(b.eventName) - ageTierOfEventName(a.eventName)
  })

  return sections
}
