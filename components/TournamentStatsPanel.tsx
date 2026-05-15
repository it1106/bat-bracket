'use client'

import { useEffect, useRef, useState } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import { track } from '@/lib/analytics'
import { useLongPress } from '@/lib/useLongPress'
import { buildFilename, captureStatsImageFile, prewarmFontEmbedCSS, shareFile } from '@/lib/shareMatchAsImage'
import type { TournamentStats } from '@/lib/types'

interface Props {
  tournamentId: string
  tournamentName?: string
}

const fmt = (n: number) => n.toLocaleString('en-US')
const pct = (r: number) => `${Math.round(r * 100)}%`

function formatHours(minutes: number, lang: 'en' | 'th'): string {
  const h = Math.round(minutes / 60)
  return lang === 'th' ? `${h} ชม.` : `${h}h`
}
function formatMinutes(minutes: number, lang: 'en' | 'th'): string {
  return lang === 'th' ? `${Math.round(minutes)} นาที` : `${Math.round(minutes)} min`
}
function formatDuration(minutes: number, lang: 'en' | 'th'): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (lang === 'th') {
    if (h > 0) return `${h} ชม. ${m} นาที`
    return `${m} นาที`
  }
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export default function TournamentStatsPanel({ tournamentId, tournamentName }: Props) {
  const { t, lang } = useLanguage()
  const [stats, setStats] = useState<TournamentStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)
  const preparedFileRef = useRef<File | null>(null)

  useEffect(() => {
    prewarmFontEmbedCSS()
  }, [])

  useLongPress(containerRef, {
    targetSelector: '[data-stats-share]',
    holdMs: 1000,
    pressClass: 'stats-share-pressing',
    readyClass: 'stats-share-ready',
    onPressStart: (el) => {
      preparedFileRef.current = null
      if (!tournamentName) return
      const key = el.dataset.statsShare
      if (!key) return
      const filename = buildFilename(tournamentName, `stats-${key}`)
      captureStatsImageFile({ sectionEl: el, tournamentName, filename })
        .then((file) => { preparedFileRef.current = file })
        .catch((err) => { console.warn('captureStatsImageFile failed', err) })
    },
    onFire: (el) => {
      const key = el.dataset.statsShare
      if (!key || !tournamentName) return
      track('stats_section_shared_as_image', {
        tournament_id: tournamentId,
        section: key,
      })
      const file = preparedFileRef.current
      if (!file) return
      shareFile({ file })
    },
  })

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null

    const load = async (showSpinner: boolean) => {
      if (showSpinner) {
        setLoading(true)
        setError(null)
      }
      try {
        const res = await fetch(`/api/stats?tournament=${encodeURIComponent(tournamentId)}`)
        const data = await res.json()
        if (cancelled) return
        if ('error' in data) {
          if (showSpinner) setError(data.error)
          // Silent on background refresh — keep showing the previous stats.
        } else {
          setStats(data as TournamentStats)
          setError(null)
        }
      } catch {
        if (showSpinner && !cancelled) setError('fetch failed')
      } finally {
        if (showSpinner && !cancelled) setLoading(false)
      }
    }

    // Fire once per (tournamentId, mount). Background polls don't re-track.
    track('tournament_stats_viewed', { tournament_id: tournamentId })

    load(true)
    // Refresh every 30 s so live tournaments tick up as matches finalize.
    // Past tournaments still poll but the server returns a memo-cached
    // result, so the cost is negligible.
    timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      load(false)
    }, 30_000)

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [tournamentId])

  if (loading) return <div className="stats-loading">…</div>
  if (error) return <div className="stats-error">{t('statsLoadFailed')}</div>
  if (!stats) return null
  if (stats.kpis.matches === 0) return <div className="stats-empty">{t('statsEmptyState')}</div>

  const dayMax = Math.max(1, ...stats.dailyVolume.map((d) => d.total))
  const courtMax = Math.max(1, ...stats.courtUtilization.map((c) => c.minutes))
  const playersPct = stats.kpis.players > 0
    ? Math.round((stats.kpis.multiEventPlayers / stats.kpis.players) * 100)
    : 0
  const threeSetterCount = Math.round(stats.kpis.threeSetterRate * stats.kpis.decided)
  const comebackCount = stats.drama.comebackCount
  const comebackRate = stats.kpis.decided > 0 ? comebackCount / stats.kpis.decided : 0
  const defLabel = lang === 'th' ? 'ชนะ' : 'def.'

  return (
    <div className="stats-panel" ref={containerRef}>
      {/* Hero KPIs */}
      <section className="stats-section" data-stats-share="by-numbers">
        <h2>{t('statsSectionByNumbers')}</h2>
        <div className="stats-kpis">
          <div className="stats-kpi"><div className="stats-kpi-num">{fmt(stats.kpis.events)}</div><div className="stats-kpi-lbl">{t('statsKpiEvents')}</div></div>
          <div className="stats-kpi"><div className="stats-kpi-num">{fmt(stats.kpis.matches)}</div><div className="stats-kpi-lbl">{t('statsKpiMatches')}</div></div>
          <div className="stats-kpi"><div className="stats-kpi-num">{fmt(stats.kpis.players)}</div><div className="stats-kpi-lbl">{t('statsKpiPlayers')}</div></div>
          <div className="stats-kpi">
            <div className="stats-kpi-num">
              {fmt(stats.kpis.multiEventPlayers)}
              {stats.kpis.players > 0 && <span className="stats-kpi-sub"> ({playersPct}%)</span>}
            </div>
            <div className="stats-kpi-lbl">{t('statsKpiMultiEvent')}</div>
          </div>
          <div className="stats-kpi"><div className="stats-kpi-num">{formatHours(stats.kpis.courtMinutes, lang)}</div><div className="stats-kpi-lbl">{t('statsKpiCourtTime')}</div></div>
          <div className="stats-kpi"><div className="stats-kpi-num">{formatMinutes(stats.kpis.avgMatchMinutes, lang)}</div><div className="stats-kpi-lbl">{t('statsKpiAvgMatch')}</div></div>
          <div className="stats-kpi">
            <div className="stats-kpi-num">
              {fmt(threeSetterCount)}
              <span className="stats-kpi-sub"> ({pct(stats.kpis.threeSetterRate)})</span>
            </div>
            <div className="stats-kpi-lbl">{t('statsKpiThreeSetters')}</div>
          </div>
          <div className="stats-kpi">
            <div className="stats-kpi-num">
              {fmt(comebackCount)}
              <span className="stats-kpi-sub"> ({pct(comebackRate)})</span>
            </div>
            <div className="stats-kpi-lbl">{t('statsKpiComebacks')}</div>
          </div>
        </div>
      </section>

      {/* Drama */}
      <section className="stats-section" data-stats-share="drama">
        <h2>{t('statsSectionDrama')}</h2>

        {stats.drama.marathon && stats.drama.marathon.durationMinutes !== undefined && (
          <DramaCard
            badge={`★ ${t('statsMarathonBadge')} — ${formatDuration(stats.drama.marathon.durationMinutes, lang)}`}
            where={`${stats.drama.marathon.draw} · ${stats.drama.marathon.round}`}
            ref_={stats.drama.marathon}
            defLabel={defLabel}
          />
        )}

        {stats.drama.highestSet && (() => {
          const s = stats.drama.highestSet.scores[stats.drama.highestSet.setIndex]
          return (
            <DramaCard
              badge={`★ ${t('statsHighestSetBadge')} — ${s.t1}–${s.t2}`}
              where={`${stats.drama.highestSet.draw} · ${stats.drama.highestSet.round}`}
              ref_={stats.drama.highestSet}
              defLabel={defLabel}
            />
          )
        })()}

        {stats.drama.highestScoringMatch && (() => {
          const total = stats.drama.highestScoringMatch.scores.reduce((acc, s) => acc + s.t1 + s.t2, 0)
          return (
            <DramaCard
              badge={`★ ${t('statsHighestScoringBadge')} — ${total}`}
              where={`${stats.drama.highestScoringMatch.draw} · ${stats.drama.highestScoringMatch.round}`}
              ref_={stats.drama.highestScoringMatch}
              defLabel={defLabel}
            />
          )
        })()}

        {stats.drama.mostCourtTime && (
          <div className="stats-drama">
            <div className="stats-drama-head">
              <span className="stats-drama-badge">★ {t('statsMostCourtTimeBadge')} — {formatDuration(stats.drama.mostCourtTime.minutes, lang)}</span>
              <span className="stats-drama-where">{stats.drama.mostCourtTime.events.join(' + ')} · {stats.drama.mostCourtTime.matches}</span>
            </div>
            <div className="stats-drama-teams">
              {stats.drama.mostCourtTime.name}
              {stats.drama.mostCourtTime.seed && <span className="stats-seed"> {stats.drama.mostCourtTime.seed}</span>}
            </div>
          </div>
        )}
      </section>

      {/* Club Medals */}
      {stats.clubMedals.length > 0 && (
        <section className="stats-section" data-stats-share="club-medals">
          <h2>{t('statsSectionClubMedals')}</h2>
          <table className="stats-table">
            <thead><tr><th></th><th>{t('statsColClub')}</th><th className="stats-num">🥇</th><th className="stats-num">🥈</th><th className="stats-num">🥉</th></tr></thead>
            <tbody>
              {stats.clubMedals.map((c, i) => (
                <tr key={c.club}>
                  <td className="stats-rank">{i + 1}</td>
                  <td>{c.club}</td>
                  <td className="stats-num"><b>{c.gold}</b></td>
                  <td className="stats-num">{c.silver}</td>
                  <td className="stats-num">{c.bronze}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Top players */}
      <section className="stats-section" data-stats-share="top-players">
        <h2>{t('statsSectionTopPlayers')}</h2>
        <table className="stats-table">
          <thead><tr><th></th><th>{t('statsColPlayer')}</th><th className="stats-club-d">{t('statsColClub')}</th><th className="stats-num">{t('statsColWL')}</th></tr></thead>
          <tbody>
            {stats.topPlayers.map((p, i) => (
              <tr key={p.playerId}>
                <td className="stats-rank">{i + 1}</td>
                <td>
                  {p.name}{p.seed && <span className="stats-seed"> {p.seed}</span>}
                  {p.club && <div className="stats-club-m">{p.club}</div>}
                </td>
                <td className="stats-club-d">{p.club}</td>
                <td className="stats-num stats-wl"><b>{p.wins}</b>–<i>{p.losses}</i></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Multi-Gold */}
      {stats.multiGoldPlayers.length > 0 && (
        <section className="stats-section" data-stats-share="multi-gold">
          <h2>{t('statsSectionMultiGold')}</h2>
          <table className="stats-table">
            <thead><tr><th className="stats-num">🥇</th><th>{t('statsColPlayer')}</th><th className="stats-club-d">{t('statsColClub')}</th><th>{t('statsColEvents')}</th></tr></thead>
            <tbody>
              {stats.multiGoldPlayers.map((p) => (
                <tr key={p.playerId}>
                  <td className="stats-num"><b>{p.events.length}</b></td>
                  <td>
                    {p.name}
                    {p.club && <div className="stats-club-m">{p.club}</div>}
                  </td>
                  <td className="stats-club-d">{p.club}</td>
                  <td>{p.events.join(' + ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Events */}
      <section className="stats-section">
        <h2>{t('statsSectionEvents')}</h2>
        <table className="stats-table stats-event-list">
          <thead><tr>
            <th>{t('statsSectionEvents')}</th>
            <th className="stats-num">{t('statsColMatches')}</th>
            <th className="stats-num">{t('statsCol3Set')}</th>
            <th className="stats-num">{t('statsColAvg')}</th>
            <th>{t('statsColWinner')}</th>
          </tr></thead>
          <tbody>
            {stats.events.map((e) => (
              <tr key={e.name}>
                <td className="stats-evname">{e.name}</td>
                <td className="stats-num">{e.matches}</td>
                <td className="stats-num">{e.decided === 0 ? '0%' : pct(e.threeSetters / e.decided)}</td>
                <td className="stats-num">{formatMinutes(e.avgMinutes, lang)}</td>
                <td className="stats-winner-cell">
                  {e.winner.join(' / ')}
                  {e.winnerSeed && <span className="stats-seed"> {e.winnerSeed}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Matches per day */}
      <section className="stats-section">
        <h2>{t('statsSectionMatchesPerDay')}</h2>
        {stats.dailyVolume.map((d) => (
          <div className="stats-bar-row" key={d.date}>
            <span className="stats-bar-label">{d.label}</span>
            <div className="stats-bar-track"><div className="stats-bar-fill" style={{ width: `${(d.total / dayMax) * 100}%` }} /></div>
            <span className="stats-bar-val">
              {fmt(d.total)}
              <span className="stats-bar-secondary">{formatHours(d.minutes, lang)}</span>
            </span>
          </div>
        ))}
      </section>

      {/* Court utilization */}
      <section className="stats-section">
        <h2>{t('statsSectionCourtUtilization')}</h2>
        {stats.courtUtilization.map((c) => {
          const tail = c.name.split(' - ').pop() ?? c.name
          return (
            <div className="stats-court-row" key={c.name}>
              <span className="stats-court-nm">{tail}</span>
              <div className="stats-bar-track"><div className="stats-bar-fill" style={{ width: `${(c.minutes / courtMax) * 100}%` }} /></div>
              <span className="stats-court-v">
                {(c.minutes / 60).toFixed(1)}{lang === 'th' ? ' ชม.' : ' h'}
                <span className="stats-bar-secondary">{fmt(c.matches)} {lang === 'th' ? 'แมตช์' : c.matches === 1 ? 'match' : 'matches'}</span>
              </span>
            </div>
          )
        })}
      </section>

      {/* Integrity */}
      <section className="stats-section">
        <h2>{t('statsSectionIntegrity')}</h2>
        <div className="stats-grid-2">
          <div className="stats-integrity-col">
            <div>W.O.: <b>{stats.kpis.walkovers}</b> · {lang === 'th' ? 'ถอนตัว' : 'Retired'}: <b>{stats.kpis.retired}</b></div>
            {stats.integrity.walkoverByEvent.slice(0, 4).map((w) => (
              <div key={w.event}>{w.event}: {w.walkovers} · {pct(w.rate)}</div>
            ))}
          </div>
          <div className="stats-integrity-col">
            <div>{t('statsCol3Set')}:</div>
            {stats.integrity.threeSetterByEvent.slice(0, 4).map((s) => (
              <div key={s.event}>{s.event}: {pct(s.rate)} ({s.sample})</div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

interface DramaCardProps {
  badge: string
  where: string
  ref_: { team1: string[]; team2: string[]; winnerSide: 1 | 2; scores: Array<{ t1: number; t2: number }> }
  defLabel: string
}

function DramaCard({ badge, where, ref_, defLabel }: DramaCardProps) {
  const winner = ref_.winnerSide === 1 ? ref_.team1 : ref_.team2
  const loser = ref_.winnerSide === 1 ? ref_.team2 : ref_.team1
  return (
    <div className="stats-drama">
      <div className="stats-drama-head">
        <span className="stats-drama-badge">{badge}</span>
        <span className="stats-drama-where">{where}</span>
      </div>
      <div className="stats-drama-teams">
        {winner.join(' / ')} {defLabel} {loser.join(' / ')}
      </div>
      <div className="stats-drama-score">
        {ref_.scores.map((s) => `${s.t1}–${s.t2}`).join(', ')}
      </div>
    </div>
  )
}
