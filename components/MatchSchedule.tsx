'use client'

import { useMemo, useRef } from 'react'
import type { MatchScheduleGroup, MatchDay, MatchEntry } from '@/lib/types'
import { matchLiveCourt, type CourtLive } from '@/lib/live-score'
import { useLanguage } from '@/lib/LanguageContext'
import { useFirstUnplayed } from '@/lib/useFirstUnplayed'
import { computePlayingOrder } from '@/lib/playingOrder'
import { expandSearchQuery } from '@/lib/searchAliases'
import { track } from '@/lib/analytics'
import JumpToNextButton from '@/components/JumpToNextButton'

interface Props {
  groups: MatchScheduleGroup[]
  days: MatchDay[]
  selectedDay: string
  onDayChange: (date: string) => void
  loading: boolean
  playerQuery: string
  excludeCompleted?: boolean
  onEventClick?: (drawNum: string, round: string) => void
  playerClubMap?: Record<string, string>
  onPlayerClick?: (playerId: string) => void
  onH2HClick?: (h2hUrl: string) => void
  liveByCourt?: Map<string, CourtLive>
  tournamentId?: string
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

function matchesQuery(entry: MatchEntry, query: string, clubMap?: Record<string, string>): boolean {
  const qs = expandSearchQuery(query)
  if (qs.length === 0) return true
  if (qs.some((q) => entry.draw.toLowerCase().includes(q))) return true
  return [...entry.team1, ...entry.team2].some((p) => playerMatchesQuery(p, qs, clubMap))
}

function isFinalRound(round: string): boolean {
  const t = round.trim().toLowerCase()
  return t === 'final' || t === 'finale'
}

function playerMatchesQuery(
  p: { name: string; playerId: string },
  queries: string[],
  clubMap?: Record<string, string>,
): boolean {
  if (queries.length === 0) return false
  return queries.some((q) => {
    if (p.name.toLowerCase().includes(q)) return true
    if (clubMap && p.playerId && (clubMap[p.playerId] ?? '').toLowerCase().includes(q)) return true
    return false
  })
}

export default function MatchSchedule({ groups, days, selectedDay, onDayChange, loading, playerQuery, excludeCompleted = false, onEventClick, playerClubMap, onPlayerClick, onH2HClick, liveByCourt, tournamentId }: Props) {
  const { t, longRound } = useLanguage()
  const { targetKey, registerTargetRef, isTargetInView, scrollToTarget } =
    useFirstUnplayed(groups, playerQuery, playerClubMap)
  const playingOrder = useMemo(
    () => computePlayingOrder({ groups, liveByCourt: liveByCourt ?? null }),
    [groups, liveByCourt],
  )
  const scoreTr = { walkover: t('walkover'), vsMatch: t('vsMatch'), retired: t('retired') }
  const seenMatchIds = useRef<Set<string>>(new Set())

  const matchKey = (m: MatchEntry): string => {
    const a = m.team1[0]?.playerId ?? ''
    const b = m.team2[0]?.playerId ?? ''
    return `${m.drawNum}|${m.round}|${a}|${b}`
  }

  const recordMatchView = (m: MatchEntry): void => {
    const id = matchKey(m)
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
  const queries = expandSearchQuery(playerQuery)
  const nameCls = (p: { name: string; playerId: string }) => {
    const cls: string[] = []
    if (onPlayerClick && p.playerId) cls.push('pm-player-link')
    if (queries.length > 0 && playerMatchesQuery(p, queries, playerClubMap)) cls.push('ms-player-highlight')
    return cls.join(' ')
  }

  const renderMatch = (m: MatchEntry, gi: number, mi: number, showCourt: boolean) => {
    const matchKey = `${gi}-${mi}`
    const isTarget = matchKey === targetKey
    const position = playingOrder.get(matchKey) ?? null
    const finalMedal = isFinalRound(m.round)
    const live = liveByCourt ? matchLiveCourt(m, liveByCourt) : null
    const isLive = live !== null
    const { done: doneScore, liveText } = scoreStr(m, scoreTr, live)
    const medal = (team: 1 | 2) => {
      if (m.winner !== team) return null
      const icon = finalMedal ? '🥇' : '🏸'
      return <span className="ms-medal" aria-label="winner">{icon}</span>
    }
    const { completedSets: liveCompleted, currentT1, currentT2 } = liveProgress(live)
    const boardSets1 = live?.setScores?.length
      ? liveCompleted.map((s) => s.t1)
      : m.scores.map((s) => s.t1)
    const boardSets2 = live?.setScores?.length
      ? liveCompleted.map((s) => s.t2)
      : m.scores.map((s) => s.t2)
    return (
    <div
      key={matchKey}
      ref={isTarget ? registerTargetRef : undefined}
      className="ms-match"
    >
      <div className="ms-meta">
        {isLive && <span className="ms-live-badge">{t('live')}</span>}
        <span
          className={`ms-event${onEventClick && m.drawNum ? ' ms-event--link' : ''}`}
          onClick={onEventClick && m.drawNum ? () => { recordMatchView(m); onEventClick(m.drawNum, m.round) } : undefined}
        >{m.draw}</span>
        <span className="ms-round">{longRound(m.round)}</span>
        {showCourt && (() => {
          // Prefer the scrape's friendly label ("Court - 5") over SignalR's bare
          // "5", but the scrape sometimes ships the literal "Now playing" stub
          // instead of a court — fall back to live.courtName in that case.
          const scraped = m.court && !/^now\s*playing$/i.test(m.court) ? m.court : ''
          const label = scraped || live?.courtName || ''
          return label ? <span className="ms-court">{label}</span> : null
        })()}
        {m.sequenceLabel && <span className="ms-seq">{m.sequenceLabel}</span>}
        {m.nowPlaying && !isLive && <span className="ms-now-playing" title={t('nowPlaying')} />}
        {m.h2hUrl && onH2HClick && (
          <button
            className="ms-h2h-inline"
            onClick={() => { recordMatchView(m); onH2HClick(m.h2hUrl!) }}
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
        {m.team1.map((p, i) => (
          <div key={i} className={nameCls(p)} onClick={onPlayerClick && p.playerId ? () => { recordMatchView(m); onPlayerClick(p.playerId) } : undefined}>{medal(1)}{p.name}</div>
        ))}
      </div>
      <div className="ms-score ms-d">
        {doneScore && <span>{doneScore}</span>}
        {liveText && doneScore && <span>, </span>}
        {/* key={liveText} forces a fresh DOM node on every value change so
            the CSS animation replays from scratch. */}
        {liveText && <span key={liveText} className="set-live">{liveText}</span>}
      </div>
      <div className={`ms-team ms-team--2 ms-d${m.winner === 2 ? ' winner' : ''}`}>
        {m.team2.map((p, i) => (
          <div key={i} className={nameCls(p)} onClick={onPlayerClick && p.playerId ? () => { recordMatchView(m); onPlayerClick(p.playerId) } : undefined}>{medal(2)}{p.name}</div>
        ))}
      </div>

      <div className="ms-board ms-m">
        <div className={`ms-board-row${m.winner === 1 ? ' winner' : ''}`}>
          <div className="ms-board-players">
            {m.team1.map((p, i) => <div key={i} className={nameCls(p)} onClick={onPlayerClick && p.playerId ? () => { recordMatchView(m); onPlayerClick(p.playerId) } : undefined}>{medal(1)}{p.name}</div>)}
          </div>
          {m.walkover
            ? <span className="ms-board-badge">{m.winner === 2 ? t('walkover') : ''}</span>
            : (
              <>
                {boardSets1.map((v, i) => <span key={i} className="ms-board-set">{v}</span>)}
                {currentT1 != null && <span key={currentT1} className="ms-board-set live">{currentT1}</span>}
                {m.retired && m.winner === 2 && <span className="ms-board-badge">{t('retired')}</span>}
              </>
            )
          }
        </div>
        <div className={`ms-board-row${m.winner === 2 ? ' winner' : ''}`}>
          <div className="ms-board-players">
            {m.team2.map((p, i) => <div key={i} className={nameCls(p)} onClick={onPlayerClick && p.playerId ? () => { recordMatchView(m); onPlayerClick(p.playerId) } : undefined}>{medal(2)}{p.name}</div>)}
          </div>
          {m.walkover
            ? <span className="ms-board-badge">{m.winner === 1 ? t('walkover') : ''}</span>
            : (
              <>
                {boardSets2.map((v, i) => <span key={i} className="ms-board-set">{v}</span>)}
                {currentT2 != null && <span key={currentT2} className="ms-board-set live">{currentT2}</span>}
                {m.retired && m.winner === 1 && <span className="ms-board-badge">{t('retired')}</span>}
              </>
            )
          }
        </div>
      </div>
    </div>
    )
  }

  return (
    <div className="match-schedule">
      {days.length > 0 && (
        <div className="match-schedule__day-tabs">
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

      {loading && (
        <div className="p-8 text-center text-gray-400 text-sm">{t('loadingMatches')}</div>
      )}

      {!loading && groups.length === 0 && (
        <div className="p-8 text-center text-gray-400 text-sm">{t('noMatchesScheduled')}</div>
      )}

      {!loading && groups.map((group, gi) => {
        const queryFiltered = playerQuery
          ? group.matches.filter((m) => matchesQuery(m, playerQuery, playerClubMap))
          : group.matches
        const filtered = playerQuery && excludeCompleted
          ? queryFiltered.filter((m) => m.winner === null)
          : queryFiltered
        if (filtered.length === 0) return null

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
      })}
      <JumpToNextButton
        visible={targetKey !== null && !isTargetInView}
        onClick={scrollToTarget}
      />
    </div>
  )
}
