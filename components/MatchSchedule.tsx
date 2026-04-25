'use client'

import { useEffect, useRef } from 'react'
import type { MatchScheduleGroup, MatchDay, MatchEntry } from '@/lib/types'
import { matchLiveCourt, type CourtLive } from '@/lib/live-score'
import { useLanguage } from '@/lib/LanguageContext'
import { useFirstUnplayed } from '@/lib/useFirstUnplayed'
import JumpToNextButton from '@/components/JumpToNextButton'

// Replays the .is-flashing CSS animation every time `value` changes by
// toggling the class and forcing a reflow. React key-based remounts are
// unreliable here — siblings with stable keys (and browsers that cache
// animation state on the reused DOM node) would otherwise skip replays.
function LiveScore({ value, className }: { value: string | number; className: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.classList.remove('is-flashing')
    void el.offsetWidth
    el.classList.add('is-flashing')
  }, [value])
  return <span ref={ref} className={`${className} is-flashing`}>{value}</span>
}

interface Props {
  groups: MatchScheduleGroup[]
  days: MatchDay[]
  selectedDay: string
  onDayChange: (date: string) => void
  loading: boolean
  playerQuery: string
  onEventClick?: (drawNum: string, round: string) => void
  playerClubMap?: Record<string, string>
  onPlayerClick?: (playerId: string) => void
  onH2HClick?: (h2hUrl: string) => void
  liveByCourt?: Map<string, CourtLive>
}

function scoreStr(
  entry: MatchEntry,
  tr: { walkover: string; vsMatch: string; retired: string },
  live: CourtLive | null,
): { done: string; liveText: string | null } {
  if (entry.walkover) return { done: tr.walkover, liveText: null }
  const baseSets = live?.setScores?.length
    ? live.setScores.map((s) => `${s.t1}-${s.t2}`)
    : entry.scores.map((s) => `${s.t1}-${s.t2}`)
  const done = baseSets.length === 0 && !live
    ? tr.vsMatch
    : entry.retired
      ? `${baseSets.join(', ')} ${tr.retired}`
      : baseSets.join(', ')
  const liveText = live?.current ? `${live.current.t1}-${live.current.t2}` : null
  return { done, liveText }
}

function matchesQuery(entry: MatchEntry, query: string, clubMap?: Record<string, string>): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  if (entry.draw.toLowerCase().includes(q)) return true
  return [...entry.team1, ...entry.team2].some((p) => playerMatchesQuery(p, q, clubMap))
}

function isFinalRound(round: string): boolean {
  const t = round.trim().toLowerCase()
  return t === 'final' || t === 'finale'
}

function playerMatchesQuery(
  p: { name: string; playerId: string },
  qLower: string,
  clubMap?: Record<string, string>,
): boolean {
  if (!qLower) return false
  if (p.name.toLowerCase().includes(qLower)) return true
  if (clubMap && p.playerId && (clubMap[p.playerId] ?? '').toLowerCase().includes(qLower)) return true
  return false
}

export default function MatchSchedule({ groups, days, selectedDay, onDayChange, loading, playerQuery, onEventClick, playerClubMap, onPlayerClick, onH2HClick, liveByCourt }: Props) {
  const { t, longRound } = useLanguage()
  const { targetKey, registerTargetRef, isTargetInView, scrollToTarget } =
    useFirstUnplayed(groups, playerQuery, playerClubMap)
  const scoreTr = { walkover: t('walkover'), vsMatch: t('vsMatch'), retired: t('retired') }
  const qLower = playerQuery.trim().toLowerCase()
  const nameCls = (p: { name: string; playerId: string }) => {
    const cls: string[] = []
    if (onPlayerClick && p.playerId) cls.push('pm-player-link')
    if (qLower && playerMatchesQuery(p, qLower, playerClubMap)) cls.push('ms-player-highlight')
    return cls.join(' ')
  }

  const renderMatch = (m: MatchEntry, gi: number, mi: number, showCourt: boolean) => {
    const matchKey = `${gi}-${mi}`
    const isTarget = matchKey === targetKey
    const finalMedal = isFinalRound(m.round)
    const live = liveByCourt ? matchLiveCourt(m, liveByCourt) : null
    const isLive = live !== null
    const { done: doneScore, liveText } = scoreStr(m, scoreTr, live)
    const medal = (team: 1 | 2) => {
      if (m.winner !== team) return null
      const icon = finalMedal ? '🥇' : '🏸'
      return <span className="ms-medal" aria-label="winner">{icon}</span>
    }
    const boardSets1 = (live?.setScores?.length
      ? live.setScores.map((s) => s.t1)
      : m.scores.map((s) => s.t1))
    const boardSets2 = (live?.setScores?.length
      ? live.setScores.map((s) => s.t2)
      : m.scores.map((s) => s.t2))
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
          onClick={onEventClick && m.drawNum ? () => onEventClick(m.drawNum, m.round) : undefined}
        >{m.draw}</span>
        <span className="ms-round">{longRound(m.round)}</span>
        {showCourt && (live?.courtName || m.court) && (
          <span className="ms-court">{live?.courtName || m.court}</span>
        )}
        {m.sequenceLabel && <span className="ms-seq">{m.sequenceLabel}</span>}
        {m.nowPlaying && !isLive && <span className="ms-now-playing" title={t('nowPlaying')} />}
        {m.h2hUrl && onH2HClick && (
          <button
            className="ms-h2h-inline"
            onClick={() => onH2HClick(m.h2hUrl!)}
            title={t('h2hButton')}
          >{t('h2hButton')}</button>
        )}
      </div>

      <div className={`ms-team ms-team--1 ms-d${m.winner === 1 ? ' winner' : ''}`}>
        {m.team1.map((p, i) => (
          <div key={i} className={nameCls(p)} onClick={onPlayerClick && p.playerId ? () => onPlayerClick(p.playerId) : undefined}>{medal(1)}{p.name}</div>
        ))}
      </div>
      <div className="ms-score ms-d">
        {doneScore && <span>{doneScore}</span>}
        {liveText && doneScore && <span>, </span>}
        {liveText && <LiveScore value={liveText} className="set-live" />}
      </div>
      <div className={`ms-team ms-team--2 ms-d${m.winner === 2 ? ' winner' : ''}`}>
        {m.team2.map((p, i) => (
          <div key={i} className={nameCls(p)} onClick={onPlayerClick && p.playerId ? () => onPlayerClick(p.playerId) : undefined}>{medal(2)}{p.name}</div>
        ))}
      </div>

      <div className="ms-board ms-m">
        <div className={`ms-board-row${m.winner === 1 ? ' winner' : ''}`}>
          <div className="ms-board-players">
            {m.team1.map((p, i) => <div key={i} className={nameCls(p)} onClick={onPlayerClick && p.playerId ? () => onPlayerClick(p.playerId) : undefined}>{medal(1)}{p.name}</div>)}
          </div>
          {m.walkover
            ? <span className="ms-board-badge">{m.winner === 1 ? t('walkover') : ''}</span>
            : (
              <>
                {boardSets1.map((v, i) => <span key={i} className="ms-board-set">{v}</span>)}
                {live?.current && <LiveScore value={live.current.t1} className="ms-board-set live" />}
                {m.retired && m.winner === 1 && <span className="ms-board-badge">{t('retired')}</span>}
              </>
            )
          }
        </div>
        <div className={`ms-board-row${m.winner === 2 ? ' winner' : ''}`}>
          <div className="ms-board-players">
            {m.team2.map((p, i) => <div key={i} className={nameCls(p)} onClick={onPlayerClick && p.playerId ? () => onPlayerClick(p.playerId) : undefined}>{medal(2)}{p.name}</div>)}
          </div>
          {m.walkover
            ? <span className="ms-board-badge">{m.winner === 2 ? t('walkover') : ''}</span>
            : (
              <>
                {boardSets2.map((v, i) => <span key={i} className="ms-board-set">{v}</span>)}
                {live?.current && <LiveScore value={live.current.t2} className="ms-board-set live" />}
                {m.retired && m.winner === 2 && <span className="ms-board-badge">{t('retired')}</span>}
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
        const filtered = playerQuery
          ? group.matches.filter((m) => matchesQuery(m, playerQuery, playerClubMap))
          : group.matches
        if (filtered.length === 0) return null

        const headerText = group.type === 'court' ? group.court : group.time

        return (
          <div key={gi} className="match-schedule__time-group">
            <div className="match-schedule__time-header">{headerText}</div>
            <div className="ms-list">
              {filtered.map((m, mi) => renderMatch(m, gi, mi, group.type === 'time'))}
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
