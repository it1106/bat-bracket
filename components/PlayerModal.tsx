'use client'

import { useEffect, useState } from 'react'
import type { PlayerProfile, MatchEntry } from '@/lib/types'
import { useLanguage } from '@/lib/LanguageContext'
import { pct } from '@/lib/playerStats'

interface Props {
  profile: PlayerProfile | null
  loading: boolean
  onClose: () => void
  onH2HClick?: (h2hUrl: string, m: MatchEntry) => void
  onPlayerClick?: (playerId: string) => void
}


function scoreStr(entry: MatchEntry, tr: { walkover: string; vsMatch: string; retired: string }): string {
  if (entry.walkover) return tr.walkover
  if (entry.scores.length === 0) return tr.vsMatch
  const s = entry.scores.map((s) => `${s.t1}–${s.t2}`).join(', ')
  return entry.retired ? `${s} ${tr.retired}` : s
}

export default function PlayerModal({ profile, loading, onClose, onH2HClick, onPlayerClick }: Props) {
  const { t, abbrevRound, lang } = useLanguage()
  const scoreTr = { walkover: t('walkover'), vsMatch: t('vsMatch'), retired: t('retired') }
  const [activeEventIds, setActiveEventIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => { setActiveEventIds(new Set()) }, [profile?.playerId])

  const toggleEvent = (id: string) => {
    setActiveEventIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  if (!loading && !profile) return null

  const eventShortName = (name: string) => name.split(' (')[0].trim().toLowerCase()
  const activeEventShortNames = profile
    ? profile.events.filter((e) => activeEventIds.has(e.eventId)).map((e) => eventShortName(e.name))
    : []
  const matchInActiveEvent = (m: MatchEntry) => {
    if (activeEventIds.size === 0) return true
    if (m.eventId && activeEventIds.has(m.eventId)) return true
    const drawLower = m.draw.toLowerCase()
    return activeEventShortNames.some((n) => drawLower === n || drawLower.includes(n) || n.includes(drawLower))
  }

  return (
    <div className="pm-overlay" onClick={onClose}>
      <div className="pm-modal" onClick={(e) => e.stopPropagation()}>
        <button className="pm-close" onClick={onClose} aria-label={t('close')}>✕</button>

        {loading && (
          <div className="pm-loading">{t('loadingPlayer')}</div>
        )}

        {!loading && profile && (
          <>
            <div className="pm-header">
              <div className="pm-name">{profile.name}</div>
              {(profile.club || profile.yob) && (
                <div className="pm-club">
                  {[profile.club, profile.yob ? `${t('yob')}: ${profile.yob}` : ''].filter(Boolean).join(' · ')}
                </div>
              )}
              {profile.stats && (() => {
                const s = profile.stats
                const fmt = (r: { wins: number; losses: number }) => `${r.wins}–${r.losses}`
                return (
                  <div className="pm-stats">
                    <div className="pm-stats-banner">
                      <div className="pm-stats-banner-label">{t('statsCareer')}</div>
                      <div className="pm-stats-banner-value">
                        <span className="pm-stats-banner-career">{fmt(s.total.career)}</span>
                        <span className="pm-stats-banner-ytd">({fmt(s.total.ytd)})</span>
                      </div>
                      {(() => {
                        const p = pct(s.total.career)
                        if (p === null) return null
                        return (
                          <>
                            <div className="pm-stats-banner-bar">
                              <div className="pm-stats-banner-bar-fill" style={{ width: `${p}%` }} />
                            </div>
                            <div className="pm-stats-banner-bar-caption">
                              <span>{t('winRate')}</span>
                              <span className="pm-stats-banner-bar-pct">{p}%</span>
                            </div>
                          </>
                        )
                      })()}
                    </div>
                    <div className="pm-stats-cells">
                      {(['singles','doubles','mixed'] as const).map((k) => {
                        const p = pct(s[k].career)
                        return (
                          <div key={k} className="pm-stats-cell">
                            <div className="pm-stats-cell-label">{t(`stats${k.charAt(0).toUpperCase()+k.slice(1)}` as 'statsSingles'|'statsDoubles'|'statsMixed')}</div>
                            <div className="pm-stats-cell-value">{fmt(s[k].career)}</div>
                            <div className="pm-stats-cell-ytd">({fmt(s[k].ytd)})</div>
                            {p !== null && (
                              <>
                                <div className="pm-stats-cell-bar">
                                  <div className="pm-stats-cell-bar-fill" style={{ width: `${p}%` }} />
                                </div>
                                <div className="pm-stats-cell-pct">{p}%</div>
                              </>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}
            </div>

            {profile.events.length > 0 && (
              <div className="pm-section">
                <div className="pm-section-title">{t('eventsEntered')}</div>
                <div className="pm-events">
                  {profile.events.map((ev) => (
                    <button
                      key={ev.eventId}
                      type="button"
                      className={`pm-event-pill${activeEventIds.has(ev.eventId) ? ' active' : ''}`}
                      onClick={() => toggleEvent(ev.eventId)}
                    >{lang === 'th' ? ev.name.replace(/\s+with\s+/i, ' คู่กับ ') : ev.name}</button>
                  ))}
                </div>
              </div>
            )}

            {profile.matches.length > 0 && (
              <div className="pm-section">
                <div className="pm-section-title">{t('matchResults')}</div>
                <div className="pm-matches">
                  {profile.matches.filter(m => m.team1.length > 0 && m.team2.length > 0 && matchInActiveEvent(m)).map((m, i) => {
                    const renderName = (p: import('@/lib/types').MatchPlayer, pi: number) => (
                      <div
                        key={pi}
                        className={onPlayerClick && p.playerId ? 'pm-player-link' : ''}
                        onClick={onPlayerClick && p.playerId ? () => onPlayerClick(p.playerId) : undefined}
                      >{p.name}</div>
                    )
                    return (
                    <div key={i} className="pm-match">
                      {/* Meta: draw + round */}
                      <div className="pm-match-meta">
                        <span className="pm-match-draw">{m.draw}</span>
                        <span className="pm-match-round">{abbrevRound(m.round)}</span>
                        {m.nowPlaying && <span className="ms-now-playing" title={t('nowPlaying')} />}
                        {m.h2hUrl && onH2HClick && (
                          <button
                            className="ms-h2h-inline"
                            onClick={() => onH2HClick(m.h2hUrl!, m)}
                            title={t('h2hButton')}
                          >{t('h2hButton')}</button>
                        )}
                      </div>

                      {/* Desktop: team1 | score | team2 */}
                      <div className={`pm-match-team pm-d${m.winner === 1 ? ' winner' : ''}`}>
                        {m.team1.length ? m.team1.map(renderName) : m.winner !== null ? <div className="pm-bye">{t('bye')}</div> : null}
                      </div>
                      <div className="pm-match-score pm-d">
                        {m.scheduledTime && !m.scores.length && !m.walkover ? m.scheduledTime : scoreStr(m, scoreTr)}
                      </div>
                      <div className={`pm-match-team pm-d${m.winner === 2 ? ' winner' : ''}`}>
                        {m.team2.length ? m.team2.map(renderName) : m.winner !== null ? <div className="pm-bye">{t('bye')}</div> : null}
                      </div>

                      {/* Mobile: two-row scoreboard */}
                      <div className="pm-board pm-m">
                        <div className={`pm-board-row${m.winner === 1 ? ' winner' : ''}`}>
                          <div className="pm-board-players">
                            {m.team1.length ? m.team1.map(renderName) : m.winner !== null ? <div className="pm-bye">{t('bye')}</div> : null}
                          </div>
                          {m.walkover
                            ? <span className="pm-board-badge">{m.winner === 1 ? t('walkover') : ''}</span>
                            : <>{m.scores.map((s, si) => <span key={si} className="pm-board-set">{s.t1}</span>)}{m.retired && m.winner === 1 && <span className="pm-board-badge">{t('retired')}</span>}</>
                          }
                        </div>
                        <div className={`pm-board-row${m.winner === 2 ? ' winner' : ''}`}>
                          <div className="pm-board-players">
                            {m.team2.length ? m.team2.map(renderName) : m.winner !== null ? <div className="pm-bye">{t('bye')}</div> : null}
                          </div>
                          {m.walkover
                            ? <span className="pm-board-badge">{m.winner === 2 ? t('walkover') : ''}</span>
                            : <>{m.scores.map((s, si) => <span key={si} className="pm-board-set">{s.t2}</span>)}{m.retired && m.winner === 2 && <span className="pm-board-badge">{t('retired')}</span>}</>
                          }
                        </div>
                      </div>
                      {m.scheduledTime && !m.scores.length && !m.walkover && (
                        <div className="pm-board-scheduled pm-m">{m.scheduledTime}</div>
                      )}
                    </div>
                  )})}
                </div>
              </div>
            )}

            {profile.matches.length === 0 && profile.events.length === 0 && (
              <div className="pm-empty">{t('noPlayerMatches')}</div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
