'use client'

import { useMemo, useRef, useState, useEffect } from 'react'
import type { MatchScheduleGroup, MatchDay, MatchEntry, MatchPlayer } from '@/lib/types'
import { matchLiveCourt, type CourtLive } from '@/lib/live-score'
import { useLanguage } from '@/lib/LanguageContext'
import { useFirstUnplayed } from '@/lib/useFirstUnplayed'
import { computePlayingOrder } from '@/lib/playingOrder'
import { expandSearchQuery, parseSearchQuery } from '@/lib/searchAliases'
import { queryMatchesCountry } from '@/lib/countryCodes'
import { track } from '@/lib/analytics'
import { buildNextOppMap } from '@/lib/nextOpp'
import { useLongPress } from '@/lib/useLongPress'
import { buildFilename, captureMatchImageFile, prewarmFontEmbedCSS, shareFile } from '@/lib/shareMatchAsImage'
import JumpToNextButton from '@/components/JumpToNextButton'
import TournamentStatsPanel from '@/components/TournamentStatsPanel'

interface Props {
  groups: MatchScheduleGroup[]
  days: MatchDay[]
  selectedDay: string
  onDayChange: (date: string) => void
  loading: boolean
  playerQuery: string
  excludeCompleted?: boolean
  highlightMatches?: boolean
  showJumpToNext?: boolean
  onEventClick?: (drawNum: string, round: string) => void
  eventToPlayoffDrawNum?: Record<string, string>
  playerClubMap?: Record<string, string>
  onPlayerClick?: (playerId: string) => void
  onH2HClick?: (h2hUrl: string, m: MatchEntry) => void
  liveByCourt?: Map<string, CourtLive>
  tournamentId?: string
  tournamentName?: string
}

// Extracts the completed sets and the in-progress set from a live record.
// Some tournament feeds put the in-progress set into `setScores` with
// winner=0 instead of surfacing it via `current`; this helper unifies
// both shapes so the in-progress score gets the .set-live cell + flash.
function liveProgress(live: CourtLive | null): {
  completedSets: { t1: number; t2: number }[]
  currentT1: number | null
  currentT2: number | null
} {
  if (!live) return { completedSets: [], currentT1: null, currentT2: null }
  const completedSets = live.setScores.filter((s) => s.winner !== 0)
  const inProgress = live.setScores.find((s) => s.winner === 0)
  const currentT1 = live.current?.t1 ?? inProgress?.t1 ?? null
  const currentT2 = live.current?.t2 ?? inProgress?.t2 ?? null
  return { completedSets, currentT1, currentT2 }
}

function scoreStr(
  entry: MatchEntry,
  tr: { walkover: string; vsMatch: string; retired: string },
  live: CourtLive | null,
): { done: string; liveText: string | null } {
  if (entry.walkover) return { done: tr.walkover, liveText: null }
  const { completedSets, currentT1, currentT2 } = liveProgress(live)
  const baseSets = live?.setScores?.length
    ? completedSets.map((s) => `${s.t1}-${s.t2}`)
    : entry.scores.map((s) => `${s.t1}-${s.t2}`)
  const done = baseSets.length === 0 && !live
    ? tr.vsMatch
    : entry.retired
      ? `${baseSets.join(', ')} ${tr.retired}`
      : baseSets.join(', ')
  const liveText = currentT1 != null && currentT2 != null ? `${currentT1}-${currentT2}` : null
  return { done, liveText }
}

// A single AND-group is satisfied by one side iff the draw name matches the
// group OR a player on that side matches it. Shared by the search filter
// (both sides combined) and the win/loss breakdown (one side at a time) so the
// two can never drift apart.
function sideMatchesGroup(
  team: MatchPlayer[],
  entry: MatchEntry,
  group: string[],
  clubMap?: Record<string, string>,
): boolean {
  if (group.some((q) => entry.draw.toLowerCase().includes(q))) return true
  return team.some((p) => playerMatchesQuery(p, group, clubMap))
}

function entryMatchesGroup(entry: MatchEntry, group: string[], clubMap?: Record<string, string>): boolean {
  return sideMatchesGroup([...entry.team1, ...entry.team2], entry, group, clubMap)
}

// Court-schedule ("Followed by") rows carry a leading order-of-play number in
// their sequenceLabel ("2. Followed by"). Returns that number, or null when the
// row isn't part of a numbered court schedule.
function matchNumberOf(m: MatchEntry): number | null {
  const mm = m.sequenceLabel?.match(/^\s*(\d+)\./)
  return mm ? parseInt(mm[1], 10) : null
}

// Tally the searched player/club's record over a set of already-filtered
// matches: a decided match counts as a win/loss for whichever searched side
// won/lost (a club-derby where both sides match adds one of each), and any
// match without a winner (incl. live/in-progress) counts as unplayed.
export function summarizeSearchResults(
  matches: MatchEntry[],
  query: string,
  clubMap?: Record<string, string>,
): { total: number; won: number; lost: number; unplayed: number } {
  const groups = parseSearchQuery(query)
  const sideSearched = (team: MatchPlayer[], entry: MatchEntry): boolean =>
    groups.length > 0 && groups.every((g) => sideMatchesGroup(team, entry, g, clubMap))
  let won = 0
  let lost = 0
  let unplayed = 0
  for (const m of matches) {
    if (m.winner === null) {
      unplayed++
      continue
    }
    if (sideSearched(m.team1, m)) {
      if (m.winner === 1) won++
      else lost++
    }
    if (sideSearched(m.team2, m)) {
      if (m.winner === 2) won++
      else lost++
    }
  }
  return { total: matches.length, won, lost, unplayed }
}

function matchesQuery(entry: MatchEntry, query: string, clubMap?: Record<string, string>): boolean {
  const groups = parseSearchQuery(query)
  if (groups.length === 0) return true
  return groups.every((g) => entryMatchesGroup(entry, g, clubMap))
}

function isFinalRound(round: string): boolean {
  const t = round.trim().toLowerCase()
  return t === 'final' || t === 'finale'
}

function playerMatchesQuery(
  p: { name: string; playerId: string; country?: string },
  queries: string[],
  clubMap?: Record<string, string>,
): boolean {
  if (queries.length === 0) return false
  const nameOrClub = queries.some((q) => {
    if (p.name.toLowerCase().includes(q)) return true
    if (clubMap && p.playerId && (clubMap[p.playerId] ?? '').toLowerCase().includes(q)) return true
    return false
  })
  // Country match is resolved (name/code → code) and compared to the country
  // field exactly, so "Thailand"/"THA" match Thai players without "tha" also
  // catching a player named "Nattha".
  return nameOrClub || queryMatchesCountry(queries, p.country)
}

export default function MatchSchedule({ groups, days, selectedDay, onDayChange, loading, playerQuery, excludeCompleted = false, highlightMatches = true, showJumpToNext = true, onEventClick, eventToPlayoffDrawNum, playerClubMap, onPlayerClick, onH2HClick, liveByCourt, tournamentId, tournamentName }: Props) {
  const { t, longRound } = useLanguage()

  // Court-based "Followed by" schedules can be re-sorted by match number: the
  // toggle only appears when the day is court-grouped and rows carry a match
  // number (time-grid days are already time-ordered and have neither).
  const [sortMode, setSortMode] = useState<'court' | 'matchNum'>('court')
  const hasCourtSchedule = useMemo(
    () =>
      groups.some((g) => g.type === 'court') &&
      groups.some((g) => g.matches.some((m) => matchNumberOf(m) !== null)),
    [groups],
  )
  // In "by match #" mode, flatten every court group and re-group by the match
  // number so "Match 1" lists the first match on each court, "Match 2" the
  // second, etc. Rows without a number sink to a trailing group. Any other case
  // (default, or non-court days) renders the groups untouched.
  const displayGroups = useMemo<MatchScheduleGroup[]>(() => {
    if (sortMode !== 'matchNum' || !hasCourtSchedule) return groups
    const byNum = new Map<number, MatchEntry[]>()
    const noNum: MatchEntry[] = []
    for (const g of groups) {
      for (const m of g.matches) {
        const n = matchNumberOf(m)
        if (n === null) { noNum.push(m); continue }
        const arr = byNum.get(n)
        if (arr) arr.push(m)
        else byNum.set(n, [m])
      }
    }
    const out: MatchScheduleGroup[] = Array.from(byNum.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([n, ms]) => ({ type: 'time', time: `Match ${n}`, matches: ms }))
    if (noNum.length) out.push({ type: 'time', time: '—', matches: noNum })
    return out
  }, [groups, sortMode, hasCourtSchedule])

  const { targetKey, registerTargetRef, isTargetInView, scrollToTarget } =
    useFirstUnplayed(displayGroups, playerQuery, playerClubMap)
  const playingOrder = useMemo(
    () => computePlayingOrder({ groups, liveByCourt: liveByCourt ?? null }),
    [groups, liveByCourt],
  )
  const scoreTr = { walkover: t('walkover'), vsMatch: t('vsMatch'), retired: t('retired') }
  const seenMatchIds = useRef<Set<string>>(new Set())
  const nextOppMap = useMemo(() => buildNextOppMap(displayGroups), [displayGroups])
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const [lockedKey, setLockedKey] = useState<string | null>(null)

  const matchKeyFor = (m: MatchEntry): string => {
    const a = m.team1[0]?.playerId ?? ''
    const b = m.team2[0]?.playerId ?? ''
    return `${m.drawNum}|${m.round}|${a}|${b}`
  }

  const matchByKey = useMemo(() => {
    const map = new Map<string, MatchEntry>()
    for (const g of groups) for (const m of g.matches) map.set(matchKeyFor(m), m)
    return map
  }, [groups])

  // Time-grouped matches don't carry m.scheduledTime — only the parent
  // group.time has it. We index per-match here so the share capture can
  // inject the scheduled time even for time-grouped matches. BWF's
  // scheduledTime is the raw "YYYY-MM-DD HH:MM:SS"; the share stamp already
  // renders the date separately, so collapse to HH:MM here.
  const matchTimeByKey = useMemo(() => {
    const map = new Map<string, string>()
    for (const g of groups) {
      for (const m of g.matches) {
        const raw = m.scheduledTime || (g.type === 'time' ? g.time : '')
        if (!raw) continue
        const hhmm = raw.match(/(\d{2}):(\d{2})/)
        map.set(matchKeyFor(m), hhmm ? `${hhmm[1]}:${hhmm[2]}` : raw)
      }
    }
    return map
  }, [groups])

  const containerRef = useRef<HTMLDivElement>(null)
  const preparedFileRef = useRef<File | null>(null)

  // Resolve the page's font embed CSS once on mount. This is the slow part
  // of html-to-image (~1s on iOS Safari first time), so doing it ahead of
  // time means the first long-press capture finishes inside the 1s hold
  // window — without this, the first share on a cold page silently fails.
  useEffect(() => {
    prewarmFontEmbedCSS()
  }, [])

  useLongPress(containerRef, {
    targetSelector: '.ms-match',
    holdMs: 1000,
    pressClass: 'ms-match--pressing',
    readyClass: 'ms-match--ready',
    onPressStart: (el) => {
      preparedFileRef.current = null
      if (!tournamentName) return
      const key = el.dataset.matchKey
      if (!key) return
      const m = matchByKey.get(key)
      if (!m) return
      const filename = buildFilename(tournamentName, m.draw)
      const scheduledTime = matchTimeByKey.get(key)
      const scheduledDateLabel = days.find((d) => d.date === selectedDay)?.label
      captureMatchImageFile({ matchEl: el, tournamentName, filename, scheduledTime, scheduledDateLabel })
        .then((file) => { preparedFileRef.current = file })
        .catch((err) => { console.warn('captureMatchImageFile failed', err) })
    },
    onFire: (el) => {
      const key = el.dataset.matchKey
      if (!key || !tournamentName) return
      const m = matchByKey.get(key)
      if (!m) return
      track('match_shared_as_image', {
        tournament_id: tournamentId,
        match_id: key,
        round_name: m.round,
        draw_id: m.drawNum,
      })
      const file = preparedFileRef.current
      if (!file) return
      // Synchronous: preserve iOS Safari transient activation for navigator.share().
      shareFile({ file })
    },
  })

  const recordMatchView = (m: MatchEntry): void => {
    const id = matchKeyFor(m)
    if (seenMatchIds.current.has(id)) return
    seenMatchIds.current.add(id)
    track('match_viewed', {
      tournament_id: tournamentId,
      match_id: id,
      round_name: m.round,
      draw_id: m.drawNum,
      is_live: !!m.nowPlaying,
      is_completed: m.winner !== null,
    })
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLockedKey(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const queries = expandSearchQuery(playerQuery)
  const nameCls = (p: { name: string; playerId: string }) => {
    const cls: string[] = []
    if (onPlayerClick && p.playerId) cls.push('pm-player-link')
    if (highlightMatches && queries.length > 0 && playerMatchesQuery(p, queries, playerClubMap)) cls.push('ms-player-highlight')
    return cls.join(' ')
  }
  const flag = (p: { countryFlagUrl?: string }) =>
    p.countryFlagUrl ? <img className="ms-flag" src={p.countryFlagUrl} alt="" /> : null
  // Native title tooltip on desktop name spans: club for BAT (via
  // playerClubMap), country for BWF (which has no club concept).
  const teamTooltip = (p: { playerId: string; country?: string }): string | undefined => {
    const club = playerClubMap && p.playerId ? playerClubMap[p.playerId] : undefined
    return club || p.country || undefined
  }

  const renderTbdOpp = (candidates: MatchPlayer[][]) => (
    <div className="ms-tbd-opp">
      {candidates.map((team, i) => (
        <span key={i}>
          {i > 0 && <span className="ms-tbd-or"> {t('tbdOr')} </span>}
          {team.map((p, j) => (
            <span key={j}>
              {j > 0 && '/'}
              <span>{p.name}</span>
            </span>
          ))}
        </span>
      ))}
    </div>
  )

  const renderMatch = (m: MatchEntry, gi: number, mi: number, showCourt: boolean) => {
    const matchKey = `${gi}-${mi}`
    const isTarget = matchKey === targetKey
    const position = playingOrder.get(matchKey) ?? null
    const finalMedal = isFinalRound(m.round)
    const live = liveByCourt ? matchLiveCourt(m, liveByCourt) : null
    const isLive = live !== null
    const { liveText } = scoreStr(m, scoreTr, live)
    const medal = (team: 1 | 2) => {
      if (m.winner !== team || !finalMedal) return null
      return <span className="ms-medal" aria-label="winner">🥇</span>
    }
    const winnerDot = (team: 1 | 2) =>
      m.winner === team ? <span className="ms-board-dot" aria-label="winner" /> : null
    const { completedSets: liveCompleted, currentT1, currentT2 } = liveProgress(live)
    const boardSets1 = live?.setScores?.length
      ? liveCompleted.map((s) => s.t1)
      : m.scores.map((s) => s.t1)
    const boardSets2 = live?.setScores?.length
      ? liveCompleted.map((s) => s.t2)
      : m.scores.map((s) => s.t2)
    const activeKey = lockedKey ?? hoveredKey
    const isActive = matchKey === activeKey
    const isNextOpp = activeKey !== null && nextOppMap.get(activeKey) === matchKey
    const matchCls = [
      'ms-match',
      isActive ? 'ms-match--active' : '',
      isNextOpp ? 'ms-match--next-opp' : '',
    ].filter(Boolean).join(' ')
    // Prefer the scrape's friendly label ("Court - 5") over SignalR's bare
    // "5", but the scrape sometimes ships the literal "Now playing" stub
    // instead of a court — fall back to live.courtName in that case.
    const courtLabel = showCourt
      ? ((m.court && !/^now\s*playing$/i.test(m.court) ? m.court : '') || live?.courtName || '')
      : ''
    const durationLabel = m.winner !== null && m.duration ? m.duration : ''
    return (
    <div
      key={matchKey}
      ref={isTarget ? registerTargetRef : undefined}
      className={matchCls}
      data-match-key={matchKeyFor(m)}
      onMouseEnter={() => setHoveredKey(matchKey)}
      onMouseLeave={() => setHoveredKey(null)}
      onClick={() => setLockedKey((prev: string | null) => prev === matchKey ? null : matchKey)}
    >
      <div className="ms-meta">
        {isLive && <span className="ms-live-badge">{t('live')}</span>}
        {(() => {
          // Round-robin matches deep-link to the parent event's playoff drawNum
          // (which the page handler treats as a bundle and switches to the
          // EventBundleView). Falls back to the literal drawNum otherwise.
          const targetDrawNum = m.eventName && eventToPlayoffDrawNum?.[m.eventName]
            ? eventToPlayoffDrawNum[m.eventName]
            : m.drawNum
          const canClick = !!onEventClick && !!targetDrawNum
          return (
            <span
              className={`ms-event${canClick ? ' ms-event--link' : ''}`}
              onClick={canClick ? () => { recordMatchView(m); onEventClick!(targetDrawNum, m.round) } : undefined}
            >{m.draw}</span>
          )
        })()}
        <span className="ms-round">{longRound(m.round)}</span>
        {courtLabel && <span className={`ms-court ms-d${sortMode === 'matchNum' ? ' ms-court--accent' : ''}`}>{courtLabel}</span>}
        {durationLabel && <span className="ms-duration ms-d">{durationLabel}</span>}
        {sortMode === 'matchNum'
          ? (() => {
              // "By match #" mode: the group header already reads "Match N", so
              // drop the redundant "Match N. Followed by" label and surface just
              // the estimated start time as "Est. HH:MM".
              const hhmm = m.scheduledTime?.match(/(\d{1,2}:\d{2})/)
              return hhmm ? <span className="ms-seq ms-seq--est">Est. {hhmm[1]}</span> : null
            })()
          : m.sequenceLabel && (() => {
              // BAT court-schedule rows start with a match number ("N. ..."):
              // prefix "Match ". For "Followed by" rows, also append the source's
              // estimated start time as "(~HH:MM)" when present.
              let label = m.sequenceLabel
              if (/^\d+\.\s/.test(label)) {
                const hhmm = /\bfollowed by\b/i.test(label)
                  ? m.scheduledTime?.match(/(\d{1,2}:\d{2})/)
                  : null
                label = `Match ${label}${hhmm ? ` (~${hhmm[1]})` : ''}`
              }
              return <span className="ms-seq">{label}</span>
            })()}
        {m.nowPlaying && !isLive && <span className="ms-now-playing" title={t('nowPlaying')} />}
        {m.h2hUrl && onH2HClick && m.team1.length > 0 && m.team2.length > 0 && (
          <button
            className="ms-h2h-inline"
            onClick={() => { recordMatchView(m); onH2HClick(m.h2hUrl!, m) }}
            title={t('h2hButton')}
          >{t('h2hButton')}</button>
        )}
        {position !== null && (
          <span
            className={`ms-order-pill${position === 1 ? ' ms-order-pill--next' : ''}`}
          >
            {position === 1
              ? t('playingOrderNext')
              : t('playingOrderAway').replace('{n}', String(position))}
          </span>
        )}
      </div>

      <div className={`ms-team ms-team--1 ms-d${m.winner === 1 ? ' winner' : ''}`}>
        {m.team1.length === 0 && m.team2.length > 0 && m.tbdOpponents && m.tbdOpponents.length > 0
          ? renderTbdOpp(m.tbdOpponents)
          : m.team1.map((p, i) => (
              <div key={i}>{flag(p)}<span className={nameCls(p)} title={teamTooltip(p)} onClick={onPlayerClick && p.playerId ? (e) => { e.stopPropagation(); recordMatchView(m); onPlayerClick(p.playerId) } : undefined}>{medal(1)}{p.name}</span>{i === 0 && m.winner === 1 && <span className="ms-team-dot" aria-label="winner" />}</div>
            ))}
      </div>
      <div className="ms-score ms-d">
        {(() => {
          if (m.walkover) return <span>{t('walkover')}</span>
          const sets = live?.setScores?.length ? liveCompleted : m.scores
          if (sets.length === 0 && !liveText) return <span>{t('vsMatch')}</span>
          return (
            <>
              {sets.map((s, i) => {
                const t1Lost = m.winner !== null && s.t1 < s.t2
                const t2Lost = m.winner !== null && s.t2 < s.t1
                return (
                  <span key={i}>
                    {i > 0 && ', '}
                    <span className={t1Lost ? 'ms-score-lost' : ''}>{s.t1}</span>
                    -
                    <span className={t2Lost ? 'ms-score-lost' : ''}>{s.t2}</span>
                  </span>
                )
              })}
              {m.retired && sets.length > 0 && <span> {t('retired')}</span>}
              {liveText && sets.length > 0 && <span>, </span>}
              {/* key={liveText} forces a fresh DOM node on every value change so
                  the CSS animation replays from scratch. */}
              {liveText && <span key={liveText} className="set-live">{liveText}</span>}
            </>
          )
        })()}
      </div>
      <div className={`ms-team ms-team--2 ms-d${m.winner === 2 ? ' winner' : ''}`}>
        {m.team2.length === 0 && m.team1.length > 0 && m.tbdOpponents && m.tbdOpponents.length > 0
          ? renderTbdOpp(m.tbdOpponents)
          : m.team2.map((p, i) => (
              <div key={i}>{flag(p)}<span className={nameCls(p)} title={teamTooltip(p)} onClick={onPlayerClick && p.playerId ? (e) => { e.stopPropagation(); recordMatchView(m); onPlayerClick(p.playerId) } : undefined}>{medal(2)}{p.name}</span>{i === 0 && m.winner === 2 && <span className="ms-team-dot" aria-label="winner" />}</div>
            ))}
      </div>

      <div className="ms-board ms-m">
        <div className={`ms-board-row${m.winner === 1 ? ' winner' : ''}`}>
          <div className="ms-board-players">
            {m.team1.length === 0 && m.team2.length > 0 && m.tbdOpponents && m.tbdOpponents.length > 0
              ? renderTbdOpp(m.tbdOpponents)
              : m.team1.map((p, i) => <div key={i}>{flag(p)}<span className={nameCls(p)} onClick={onPlayerClick && p.playerId ? (e) => { e.stopPropagation(); recordMatchView(m); onPlayerClick(p.playerId) } : undefined}>{medal(1)}{p.name}</span></div>)}
          </div>
          {winnerDot(1)}
          {m.walkover
            ? <span className="ms-board-badge">{m.winner === 2 ? t('walkover') : ''}</span>
            : (
              <>
                {boardSets1.map((v, i) => {
                  const opp = boardSets2[i]
                  const lost = m.winner !== null && opp != null && v < opp
                  return <span key={i} className={`ms-board-set${lost ? ' ms-board-set--lost' : ''}`}>{v}</span>
                })}
                {currentT1 != null && <span key={currentT1} className="ms-board-set live">{currentT1}</span>}
                {m.retired && m.winner === 2 && <span className="ms-board-badge">{t('retired')}</span>}
              </>
            )
          }
        </div>
        <div className={`ms-board-row${m.winner === 2 ? ' winner' : ''}`}>
          <div className="ms-board-players">
            {m.team2.length === 0 && m.team1.length > 0 && m.tbdOpponents && m.tbdOpponents.length > 0
              ? renderTbdOpp(m.tbdOpponents)
              : m.team2.map((p, i) => <div key={i}>{flag(p)}<span className={nameCls(p)} onClick={onPlayerClick && p.playerId ? (e) => { e.stopPropagation(); recordMatchView(m); onPlayerClick(p.playerId) } : undefined}>{medal(2)}{p.name}</span></div>)}
          </div>
          {winnerDot(2)}
          {m.walkover
            ? <span className="ms-board-badge">{m.winner === 1 ? t('walkover') : ''}</span>
            : (
              <>
                {boardSets2.map((v, i) => {
                  const opp = boardSets1[i]
                  const lost = m.winner !== null && opp != null && v < opp
                  return <span key={i} className={`ms-board-set${lost ? ' ms-board-set--lost' : ''}`}>{v}</span>
                })}
                {currentT2 != null && <span key={currentT2} className="ms-board-set live">{currentT2}</span>}
                {m.retired && m.winner === 1 && <span className="ms-board-badge">{t('retired')}</span>}
              </>
            )
          }
        </div>
      </div>

      {(courtLabel || durationLabel) && (
        <div className="ms-footer ms-m">
          {courtLabel && <span className="ms-court">{courtLabel}</span>}
          {durationLabel && <span className="ms-duration">{durationLabel}</span>}
        </div>
      )}
    </div>
    )
  }

  return (
    <div className="match-schedule" ref={containerRef}>
      {(days.length > 0 || selectedDay === 'stats') && (
        <div className="match-schedule__day-tabs">
          <button
            key="__stats__"
            onClick={() => onDayChange('stats')}
            className={[
              'match-schedule__day-tab',
              'match-schedule__day-tab--stats',
              selectedDay === 'stats' ? 'active' : '',
            ].filter(Boolean).join(' ')}
            title={t('tournamentStats')}
            aria-label={t('tournamentStats')}
          >
            📊
          </button>
          {days.map((d) => (
            <button
              key={d.date}
              onClick={() => onDayChange(d.date)}
              className={[
                'match-schedule__day-tab',
                d.date === selectedDay ? 'active' : '',
                d.hasMatches === false ? 'empty' : '',
              ].filter(Boolean).join(' ')}
            >
              {d.label}
            </button>
          ))}
        </div>
      )}

      {selectedDay === 'stats' && tournamentId && (
        <TournamentStatsPanel tournamentId={tournamentId} tournamentName={tournamentName} />
      )}

      {selectedDay !== 'stats' && loading && (
        <div className="p-8 text-center text-gray-400 text-sm">
          <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin mr-2 align-[-2px]" />
          {t('loadingMatches')}
        </div>
      )}

      {selectedDay !== 'stats' && !loading && groups.length === 0 && (
        <div className="p-8 text-center text-gray-400 text-sm">{t('noMatchesScheduled')}</div>
      )}

      {selectedDay !== 'stats' && !loading && groups.length > 0 && hasCourtSchedule && (
        <div className="ms-sort-toggle" role="group" aria-label={t('sortByCourt')}>
          <button
            className={`match-schedule__day-tab${sortMode === 'court' ? ' active' : ''}`}
            aria-pressed={sortMode === 'court'}
            onClick={() => setSortMode('court')}
          >
            {t('sortByCourt')}
          </button>
          <button
            className={`match-schedule__day-tab${sortMode === 'matchNum' ? ' active' : ''}`}
            aria-pressed={sortMode === 'matchNum'}
            onClick={() => setSortMode('matchNum')}
          >
            {t('sortByMatchNum')}
          </button>
        </div>
      )}

      {selectedDay !== 'stats' && !loading && (() => {
        const filterActive = playerQuery.trim() !== '' || excludeCompleted
        let total = 0
        const allFiltered: MatchEntry[] = []
        const rendered = displayGroups.map((group, gi) => {
          const queryFiltered = playerQuery
            ? group.matches.filter((m) => matchesQuery(m, playerQuery, playerClubMap))
            : group.matches
          const filtered = excludeCompleted
            ? queryFiltered.filter((m) => m.winner === null)
            : queryFiltered
          if (filtered.length === 0) return null
          total += filtered.length
          allFiltered.push(...filtered)

          const headerText = group.type === 'court' ? group.court : group.time

          return (
            <div key={gi} className="match-schedule__time-group">
              <div className="match-schedule__time-header">{headerText}</div>
              <div className="ms-list">
                {filtered.map((m) => {
                  const absMi = group.matches.indexOf(m)
                  return renderMatch(m, gi, absMi, group.type === 'time')
                })}
              </div>
            </div>
          )
        })

        const hasVisible = rendered.some((r) => r !== null)
        if (!hasVisible && groups.length > 0 && playerQuery.trim() !== '') {
          return (
            <div className="p-8 text-center text-gray-400 text-sm">{t('searchNotFound')}</div>
          )
        }
        if (filterActive && hasVisible) {
          const countLabel = t('filterMatchCount').replace('{n}', String(total)).replace('{s}', total === 1 ? '' : 'es')
          // Win/loss only makes sense for an actual search, and only when
          // completed matches aren't hidden (otherwise "won 0, loss 0" misleads).
          const summary =
            playerQuery.trim() !== '' && !excludeCompleted
              ? summarizeSearchResults(allFiltered, playerQuery, playerClubMap)
              : null
          return (
            <>
              <div className="match-schedule__filter-count">
                {countLabel}
                {summary && (
                  <>
                    {', '}
                    <span className="ms-fc-won">{t('filterWonCount').replace('{n}', String(summary.won))}</span>
                    {', '}
                    <span className="ms-fc-lost">{t('filterLossCount').replace('{n}', String(summary.lost))}</span>
                    {', '}
                    <span className="ms-fc-undecided">{t('filterUndecidedCount').replace('{n}', String(summary.unplayed))}</span>
                  </>
                )}
              </div>
              {rendered}
            </>
          )
        }
        return rendered
      })()}
      <JumpToNextButton
        visible={showJumpToNext && targetKey !== null && !isTargetInView}
        onClick={scrollToTarget}
      />
    </div>
  )
}
