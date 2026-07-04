'use client'
import React, { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { PlayerRecord, PlayerRanks, PlayerStats, WLRecord, OpponentTimeWindow } from '@/lib/types'
import { weekKeyFromPublishDate } from '@/lib/ranking/player-view'
import { getRankingConfig } from '@/lib/ranking/config'
import { useLanguage } from '@/lib/LanguageContext'
import RankingDetailTabs from './RankingDetailTabs'
import { pointsFor, ageGroupFromEvent, pointsRoundFromResult, AGE_GROUPS } from '@/lib/points/bat-points'

interface Props {
  record: PlayerRecord
  playerRankings?: import('@/lib/types').RankingPlayerRank[]
  rankingPublishDate?: string
  initialDetail?: import('@/lib/types').RankingPlayerDetail
  /** Current overview cache for the player's provider, forwarded to the
   *  ranking-detail panel so it can resolve the player's per-event rank. */
  currentRanking?: import('@/lib/types').Ranking | null
  /** Optional BWF country-flag URL captured at scrape time. When present,
   *  rendered next to the country name instead of the globe glyph. */
  countryFlagUrl?: string
  /** BAT tournamentId → level (1-6). Present only for BAT profiles; drives the
   *  locked-in points shown per event. Absent for BWF. */
  tournamentLevels?: Record<string, number>
}

function fmtPct(n: number): string { return `${Math.round(n * 100)}%` }
function fmtHM(min: number): string {
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60); const m = min % 60
  return m ? `${h}h ${m}m` : `${h}h`
}
function disciplinePct(s: { wins: number; losses: number }): string {
  const total = s.wins + s.losses
  return total === 0 ? '—' : `${Math.round((s.wins / total) * 100)}%`
}
function wlPct(r: WLRecord): number | null {
  const total = r.wins + r.losses
  return total === 0 ? null : Math.round((r.wins / total) * 100)
}
function wl(r: WLRecord): string { return `${r.wins}–${r.losses}` }

const RANK_LABELS: Array<[keyof PlayerRanks, string, import('@/lib/i18n').TKey]> = [
  ['titles', '🏆', 'ppRankMostTitles'],
  ['wins', '🥇', 'ppRankMostWins'],
  ['winPct', '📊', 'ppRankHighestWinPct'],
  ['courtTime', '⏱', 'ppRankMostCourtTime'],
  ['comebackWins', '🔁', 'ppRankComebackWins'],
  ['threeSetterWins', '🔥', 'ppRankThreeSetterWins'],
]

const OPPONENT_WINDOWS: Array<{ key: OpponentTimeWindow; labelKey:
  'opponentsWin30d' | 'opponentsWin90d' | 'opponentsWin180d' | 'opponentsWin1y' | 'opponentsWinAll' }> = [
  { key: '30d',  labelKey: 'opponentsWin30d'  },
  { key: '90d',  labelKey: 'opponentsWin90d'  },
  { key: '180d', labelKey: 'opponentsWin180d' },
  { key: '1y',   labelKey: 'opponentsWin1y'   },
  { key: 'all',  labelKey: 'opponentsWinAll'  },
]

export default function PlayerProfileView({ record, playerRankings, rankingPublishDate, initialDetail, currentRanking, countryFlagUrl, tournamentLevels }: Props) {
  const router = useRouter()
  const { t } = useLanguage()
  const discLabel = (d: 'singles' | 'doubles' | 'mixed') =>
    t(d === 'singles' ? 'ppSingles' : d === 'doubles' ? 'ppDoubles' : 'ppMixed')
  const [oppTab, setOppTab] = useState<OpponentTimeWindow>('all')
  const [oppExpanded, setOppExpanded] = useState(false)
  const OPP_COLLAPSED_LIMIT = 10
  const winPct = record.totals.matches > 0
    ? Math.round((record.totals.wins / record.totals.matches) * 100)
    : 0
  const rankingWeekKey = rankingPublishDate
    ? weekKeyFromPublishDate(rankingPublishDate, getRankingConfig(record.key.provider).dateFormat)
    : null

  const goBack = (e: React.MouseEvent) => {
    e.preventDefault()
    if (window.history.length > 1) router.back()
    else router.push('/leaderboards')
  }

  // Live extras (career/YTD stats + YOB) scraped from the BAT global profile.
  const [extra, setExtra] = useState<{ yob: string; stats: PlayerStats } | null>(null)
  useEffect(() => {
    if (record.key.provider !== 'bat') return
    const ctrl = new AbortController()
    fetch(`/api/players/profile-extra?provider=bat&slug=${encodeURIComponent(record.key.slug)}`, { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.stats) setExtra({ yob: d.yob ?? '', stats: d.stats }) })
      .catch(() => { /* non-fatal */ })
    return () => ctrl.abort()
  }, [record.key.provider, record.key.slug])

  // Recent-form tooltips: hover (desktop) or tap-toggle (mobile).
  const [openForm, setOpenForm] = useState<number | null>(null)
  const [openTour, setOpenTour] = useState<string | null>(null)
  const formStripRef = useRef<HTMLDivElement | null>(null)
  const tourSectionRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (openForm === null) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (formStripRef.current && !formStripRef.current.contains(e.target as Node)) setOpenForm(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [openForm])
  // Same outside-tap dismissal for the Tournament history chip tooltips.
  // Without this, opening a chip tip on a touch device leaves the tooltip
  // visible until the user re-taps the same chip — there's no hover to
  // implicitly close it.
  useEffect(() => {
    if (openTour === null) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (tourSectionRef.current && !tourSectionRef.current.contains(e.target as Node)) setOpenTour(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [openTour])

  return (
    <div className="pp-page">
      <a href="/leaderboards" className="pp-back" onClick={goBack}>← {t('ppBack')}</a>
      <div className="pp-hdr">
        <h1>{record.displayName}</h1>
        <div className="pp-meta">
          {record.clubs[0] && <span>🏛 <strong>{record.clubs[0]}</strong></span>}
          {extra?.yob && <span>🎂 <strong>{extra.yob}</strong></span>}
          {record.country && (
            <span>
              {countryFlagUrl
                ? <img className="pp-meta-flag" src={countryFlagUrl} alt="" />
                : '🌐 '}
              <strong>{record.country}</strong>
            </span>
          )}
          <span>🏸 <strong>{record.tournaments.length}</strong> {t('ppStatTournaments')} · {record.totals.matches} {t('ppMatchesWord')}</span>
        </div>
        <div className="pp-badges">
          {RANK_LABELS.map(([k, icon, label]) => {
            const rank = record.ranks[k]
            if (rank === undefined) return null
            return (
              <Link key={String(k)} href={`/leaderboards#${String(k)}`} className="pp-rank-badge">
                <span className="pp-rk">#{rank}</span>{icon} {t(label)}
              </Link>
            )
          })}
        </div>
      </div>

      {extra?.stats && (
        <div className="pp-section">
          <h2>{t('ppBatRecord')} <span className="pp-stats-note">{t('ppCareerThisYear')}</span></h2>
          <div className="pp-stats-banner">
            <div className="pp-stats-banner-label">{t('ppTotal')}</div>
            <div className="pp-stats-banner-value">
              <span className="pp-stats-career">{wl(extra.stats.total.career)}</span>
              <span className="pp-stats-ytd">({wl(extra.stats.total.ytd)})</span>
            </div>
            {(() => {
              const p = wlPct(extra.stats.total.career)
              return p === null ? null : (
                <div className="pp-stats-bar"><div className="pp-stats-bar-fill" style={{ width: `${p}%` }} /></div>
              )
            })()}
          </div>
          <div className="pp-stats-cells">
            {(['singles', 'doubles', 'mixed'] as const).map(k => {
              const p = wlPct(extra.stats[k].career)
              return (
                <div key={k} className="pp-stats-cell">
                  <div className="pp-stats-cell-label">{discLabel(k)}</div>
                  <div className="pp-stats-cell-value">{wl(extra.stats[k].career)}</div>
                  <div className="pp-stats-cell-ytd">({wl(extra.stats[k].ytd)})</div>
                  {p !== null && <div className="pp-stats-cell-pct">{p}%</div>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {playerRankings && playerRankings.length > 0 && (
        <div className="pp-section pp-ranking-section">
          <h2>{record.key.provider === 'bwf' ? t('ppRankingBwf') : t('ppRankingCurrent')}{rankingPublishDate && (
            <span className="pp-stats-note">{t('ppAsOf')} {rankingPublishDate}{rankingWeekKey && ` (${rankingWeekKey})`}</span>
          )}</h2>
          <div className="pp-ranking-list">
            {playerRankings.map(r => (
              <div key={r.eventName} className="pp-ranking-row">
                <span className="pp-ranking-event">{r.eventName}</span>
                <span className="pp-ranking-pos">#{r.rank}</span>
                {r.tournaments > 0 && <span className="pp-ranking-tn">{r.tournaments} {t('ppTnAbbr')}</span>}
                <span className="pp-ranking-pts">{r.points.toLocaleString()} {t('ppPts')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {playerRankings && playerRankings.length > 0 && (
        <RankingDetailTabs
          provider={record.key.provider}
          slug={record.key.slug}
          initialDetail={initialDetail}
          rankingPublishDate={rankingPublishDate}
          currentRanking={currentRanking}
        />
      )}
      <div className="pp-kpi-row">
        <div className="pp-kpi"><div className="pp-kpi-num">{record.totals.wins}</div><div className="pp-kpi-lbl">{t('ppKpiWins')}</div></div>
        <div className="pp-kpi"><div className="pp-kpi-num">{record.totals.losses}</div><div className="pp-kpi-lbl">{t('ppKpiLosses')}</div></div>
        <div className="pp-kpi"><div className="pp-kpi-num">{winPct}%</div><div className="pp-kpi-lbl">{t('ppKpiWinRate')}</div></div>
        <div className="pp-kpi"><div className="pp-kpi-num">{record.titles.length}</div><div className="pp-kpi-lbl">{t('ppKpiTitles')}</div></div>
      </div>

      <div className="pp-section">
        <h2>{t('ppByEventType')}</h2>
        <div className="pp-disc-grid">
          {(['singles', 'doubles', 'mixed'] as const).map(d => {
            const s = record.byDiscipline[d]
            return (
              <div key={d} className="pp-disc">
                <div className="pp-disc-name">{discLabel(d)}</div>
                <div className="pp-disc-wl">{s.wins}–{s.losses}</div>
                <div className="pp-disc-pct">{disciplinePct(s)} {t('ppWinRateSuffix')}</div>
                <div className="pp-disc-ttl">{s.titles} {s.titles === 1 ? t('ppTitleWord') : t('ppTitlesWord')} · {s.semis} SF</div>
              </div>
            )
          })}
        </div>
      </div>

      {record.tournaments.length > 0 && (
        <div className="pp-section" ref={tourSectionRef}>
          <h2>{t('ppTournamentHistory')}</h2>
          {[...record.tournaments]
            .sort((a, b) => (b.tournamentDateIso ?? '').localeCompare(a.tournamentDateIso ?? ''))
            .map(tour => {
            // Points per event, then per discipline the max-points event is the
            // one that counts toward ranking (others are superseded). Ties break
            // to the older age group (lower AGE_GROUPS index).
            const lvl = tournamentLevels?.[tour.tournamentId]
            const evPts = new Map<string, number | null>()
            const bestByDisc = new Map<string, { key: string; pts: number; ageRank: number }>()
            for (const e of tour.events) {
              const key = e.eventId + e.eventName
              const ageG = ageGroupFromEvent(e.eventName)
              const round = pointsRoundFromResult(e.bestFinish, e.wins, e.drawSize, e.lostByWalkover, e.active)
              const pts = lvl && ageG && round ? pointsFor(lvl, ageG, round) : null
              evPts.set(key, pts)
              if (pts != null) {
                const ageRank = ageG ? AGE_GROUPS.indexOf(ageG) : 99
                const cur = bestByDisc.get(e.discipline)
                if (!cur || pts > cur.pts || (pts === cur.pts && ageRank < cur.ageRank)) {
                  bestByDisc.set(e.discipline, { key, pts, ageRank })
                }
              }
            }
            return (
            <div className="pp-tour" key={tour.tournamentId}>
              <div className="pp-tour-name-row">
                <div className="pp-tour-name">{tour.tournamentName}</div>
                <div className="pp-tour-date">{tour.tournamentDateIso}</div>
              </div>
              <div className="pp-events">
                {tour.events.map(e => {
                  // Podium tint: Champion (won the Final) → gold, F (reached
                  // the Final, lost) → silver, SF (reached the SF, lost) →
                  // bronze. Badminton awards both losing semifinalists 3rd.
                  // Everyone who didn't podium gets green so a 'participated'
                  // chip can't be mistaken for the silver runner-up.
                  // Active (still alive in the draw) takes precedence over the
                  // placement tint — a yellow pill flags "not eliminated yet".
                  const medalClass = e.active ? 'pp-active'
                    : e.bestFinish === 'Champion' ? 'pp-champ'
                    : e.bestFinish === 'F' ? 'pp-runnerup'
                    : e.bestFinish === 'SF' ? 'pp-third'
                    : 'pp-noplace'
                  const evKey = e.eventId + e.eventName
                  const evPoints = evPts.get(evKey) ?? null
                  const counts = bestByDisc.get(e.discipline)?.key === evKey
                  const tipKey = `${tour.tournamentId}:${e.eventId}`
                  const matches = record.tournamentMatches?.[tipKey] ?? []
                  // Mirror the recentForm tip format: one line per match with
                  // round, verb prefix, opponents, optional partner suffix,
                  // and the comma-joined scores (or walkover/retired tag).
                  const tip = matches.length === 0 ? '' : matches.map(m => {
                    const won = m.outcome === 'W' || m.outcome === 'WO-W' || m.outcome === 'RET-W'
                    const verb = won ? t('ppDef') : t('ppLostTo')
                    const opp = m.opponents.length > 0 ? m.opponents.join(' / ') : '—'
                    const partnerLine = m.partners.length > 0 ? ` (${t('ppWith')} ${m.partners.join(' / ')})` : ''
                    const scoreLine = m.scores.length > 0
                      ? m.scores.map(s => `${s.t1}-${s.t2}`).join(', ')
                      : (m.outcome.startsWith('WO') ? t('walkover') : m.outcome.startsWith('RET') ? t('retired') : '')
                    return `${m.round}: ${verb} ${opp}${partnerLine}\n  ${scoreLine}`
                  }).join('\n')
                  const isOpen = openTour === tipKey
                  const hasTip = tip.length > 0
                  return (
                    <span
                      key={e.eventId + e.eventName}
                      className={`pp-ev-chip ${medalClass} ${hasTip ? 'pp-ev-chip-has-tip' : ''} ${isOpen ? 'pp-ev-open' : ''}`}
                      onClick={hasTip ? () => setOpenTour(isOpen ? null : tipKey) : undefined}
                    >
                      {e.bestFinish === 'Champion' ? '🏆 ' : ''}{e.eventName} ·{' '}
                      <span className="pp-ev-chip-finish">{e.bestFinish}</span> ·{' '}
                      <span className="pp-ev-chip-wl">{e.wins}–{e.losses}</span>
                      {evPoints != null && (
                        <> · <span
                          className={`pp-ev-chip-pts ${counts ? '' : 'pp-ev-chip-pts-superseded'}`}
                          title={!counts
                            ? t('ppTipSuperseded')
                            : e.active
                              ? t('ppTipGuaranteed')
                              : t('ppTipProjected')}
                        >≈{evPoints.toLocaleString('en-US')} {t('ppPts')}</span></>
                      )}
                      {hasTip && <span className="pp-ev-tip" role="tooltip">{tip}</span>}
                    </span>
                  )
                })}
              </div>
            </div>
          )})}
        </div>
      )}

      {record.recentForm.length > 0 && (
        <div className="pp-section">
          <h2>{t('ppRecentForm')}</h2>
          <div className="pp-form-strip" ref={formStripRef}>
            {record.recentForm.map((r, i) => {
              const won = r.outcome === 'W' || r.outcome === 'WO-W' || r.outcome === 'RET-W'
              const label = won ? 'W'
                : r.outcome === 'WO-L' ? 'WO'
                : r.outcome === 'RET-L' ? 'RT'
                : 'L'
              const cls = won ? 'pp-w' : (label === 'WO' || label === 'RT' ? 'pp-wo' : 'pp-l')
              const verbPrefix = won ? t('ppDef') : t('ppLostTo')
              const opp = r.opponents.length > 0 ? r.opponents.join(' / ') : '—'
              const scoreLine = r.scores.length > 0
                ? r.scores.map(s => `${s.t1}-${s.t2}`).join(', ')
                : (r.outcome.startsWith('WO') ? t('walkover') : r.outcome.startsWith('RET') ? t('retired') : '')
              const partnerLine = r.partners.length > 0 ? ` (${t('ppWith')} ${r.partners.join(' / ')})` : ''
              const dateLine = r.scheduledDateIso
                ? `${r.tournamentName} · ${r.scheduledDateIso.slice(0, 10)}`
                : r.tournamentName
              const tip = `${verbPrefix} ${opp}${partnerLine}\n${scoreLine}\n${r.eventName} · ${r.round}\n${dateLine}`
              const isOpen = openForm === i
              return (
                <span
                  key={i}
                  className={`pp-form-cell ${cls} ${isOpen ? 'pp-form-open' : ''}`}
                  onClick={() => setOpenForm(isOpen ? null : i)}
                >
                  {label}
                  <span className="pp-form-tip" role="tooltip">{tip}</span>
                </span>
              )
            })}
          </div>
        </div>
      )}

      <div className="pp-section">
        <h2>{t('ppMatchCharacter')}</h2>
        <div className="pp-char-grid">
          <div className="pp-char-card">
            <div className="pp-char-label">{t('ppCourtTime')}</div>
            <div className="pp-char-value">{fmtHM(record.matchCharacter.courtMinutes)}</div>
            <div className="pp-char-sub">{t('ppAvg')} {record.matchCharacter.avgMatchMinutes}m · {t('ppLongest')} {fmtHM(record.matchCharacter.longestMatchMinutes)}</div>
          </div>
          <div className="pp-char-card">
            <div className="pp-char-label">{t('ppThreeSetterRate')}</div>
            <div className="pp-char-value">{fmtPct(record.matchCharacter.threeSetterRate)}</div>
            <div className="pp-char-sub">{record.matchCharacter.threeSetterCount} {t('ppOf')} {record.totals.matches} {t('ppMatchesWord')}</div>
          </div>
          <div className="pp-char-card">
            <div className="pp-char-label">{t('ppComebackWinsLabel')}</div>
            <div className="pp-char-value">
              {record.matchCharacter.comebackWins}
              {record.matchCharacter.firstGameLost > 0 && (
                <span className="pp-char-pct"> · {Math.round((record.matchCharacter.comebackWins / record.matchCharacter.firstGameLost) * 100)}%</span>
              )}
            </div>
            <div className="pp-char-sub">{t('ppComebackSub').replace('{n}', String(record.matchCharacter.comebackWins)).replace('{m}', String(record.matchCharacter.firstGameLost))}</div>
          </div>
          <div className="pp-char-card">
            <div className="pp-char-label">{t('ppThreeSetterWinsLabel')}</div>
            <div className="pp-char-value">
              {record.matchCharacter.threeSetterWins}
              {record.matchCharacter.threeSetterCount > 0 && (
                <span className="pp-char-pct"> · {Math.round((record.matchCharacter.threeSetterWins / record.matchCharacter.threeSetterCount) * 100)}%</span>
              )}
            </div>
            <div className="pp-char-sub">{t('ppThreeSetterSub').replace('{n}', String(record.matchCharacter.threeSetterCount))}</div>
          </div>
        </div>
      </div>

      {(() => {
        const hasAny =
          (record.opponentsByWindow?.all.length ?? record.opponents.length) > 0
        if (!hasAny) return null
        const list =
          record.opponentsByWindow?.[oppTab] ??
          (oppTab === 'all' ? record.opponents : [])
        const visibleList = oppExpanded ? list : list.slice(0, OPP_COLLAPSED_LIMIT)
        const hasMore = list.length > OPP_COLLAPSED_LIMIT
        return (
          <div className="pp-section">
            <div className="pp-section-head">
              <h2>{t('frequentOpponents')}</h2>
              <div className="pp-time-tabs" role="tablist" aria-label={t('frequentOpponents')}>
                {OPPONENT_WINDOWS.map(w => (
                  <button
                    key={w.key}
                    type="button"
                    role="tab"
                    aria-selected={oppTab === w.key}
                    className={`pp-time-tab${oppTab === w.key ? ' active' : ''}`}
                    onClick={() => { setOppTab(w.key); setOppExpanded(false) }}
                  >{t(w.labelKey)}</button>
                ))}
              </div>
            </div>
            {list.length > 0 ? (
              <>
                <div className="pp-ppl-list">
                  {visibleList.map(o => (
                    <Link key={o.slug} href={`/player/${record.key.provider}/${o.slug}`} className="pp-ppl-row">
                      <div>
                        <div className="pp-ppl-name">{o.name}</div>
                        <div className="pp-ppl-met">{o.meetings} {t('ppMeetings')}</div>
                      </div>
                      <div className="pp-ppl-wl"><span className="pp-w">{o.wins}W</span> · <span className="pp-l">{o.losses}L</span></div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('ppLast')} {o.lastRound} · {o.lastEvent}</div>
                    </Link>
                  ))}
                </div>
                {hasMore && (
                  <button
                    type="button"
                    className="pp-show-more"
                    onClick={() => setOppExpanded(v => !v)}
                  >{oppExpanded ? t('leaderboardsShowLess') : t('leaderboardsShowMore')}</button>
                )}
              </>
            ) : (
              <div className="pp-empty">{t('opponentsEmptyWindow')}</div>
            )}
          </div>
        )
      })()}

      {record.partners.length > 0 && (
        <div className="pp-section">
          <h2>{t('ppFrequentPartners')}</h2>
          <div className="pp-ppl-list">
            {record.partners.map(p => (
              <Link key={p.slug} href={`/player/${record.key.provider}/${p.slug}`} className="pp-ppl-row">
                <div>
                  <div className="pp-ppl-name">{p.name}</div>
                  <div className="pp-ppl-met">{p.matchesTogether} {t('ppMatchesWord')} · {p.primaryEvent}</div>
                </div>
                <div className="pp-ppl-wl"><span className="pp-w">{p.wins}W</span> · <span className="pp-l">{p.losses}L</span></div>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>{disciplinePct({ wins: p.wins, losses: p.losses })}</div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
