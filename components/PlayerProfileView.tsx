'use client'
import React, { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { PlayerRecord, PlayerRanks, PlayerStats, WLRecord } from '@/lib/types'
import { weekKeyFromPublishDate } from '@/lib/bat-ranking-player-view'
import RankingDetailTabs from './RankingDetailTabs'

interface Props {
  record: PlayerRecord
  batRanking?: import('@/lib/types').BatRankingPlayerRank[]
  rankingPublishDate?: string
  initialDetail?: import('@/lib/types').BatRankingPlayerDetail
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

const RANK_LABELS: Array<[keyof PlayerRanks, string, string]> = [
  ['titles', '🏆', 'Most Titles'],
  ['wins', '🥇', 'Most Wins'],
  ['winPct', '📊', 'Highest Win %'],
  ['courtTime', '⏱', 'Most Court Time'],
  ['comebackWins', '🔁', 'Comeback Wins'],
  ['threeSetterWins', '🔥', 'Three-setter Wins'],
]

export default function PlayerProfileView({ record, batRanking, rankingPublishDate, initialDetail }: Props) {
  const router = useRouter()
  const winPct = record.totals.matches > 0
    ? Math.round((record.totals.wins / record.totals.matches) * 100)
    : 0
  const rankingWeekKey = rankingPublishDate ? weekKeyFromPublishDate(rankingPublishDate) : null

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
      <a href="/leaderboards" className="pp-back" onClick={goBack}>← Back</a>
      <div className="pp-hdr">
        <h1>{record.displayName}</h1>
        <div className="pp-meta">
          {record.clubs[0] && <span>🏛 <strong>{record.clubs[0]}</strong></span>}
          {extra?.yob && <span>🎂 <strong>{extra.yob}</strong></span>}
          {record.country && <span>🌐 <strong>{record.country}</strong></span>}
          <span>🏸 <strong>{record.tournaments.length}</strong> tournaments · {record.totals.matches} matches</span>
        </div>
        <div className="pp-badges">
          {RANK_LABELS.map(([k, icon, label]) => {
            const rank = record.ranks[k]
            if (rank === undefined) return null
            return (
              <Link key={String(k)} href={`/leaderboards#${String(k)}`} className="pp-rank-badge">
                <span className="pp-rk">#{rank}</span>{icon} {label}
              </Link>
            )
          })}
        </div>
      </div>

      {extra?.stats && (
        <div className="pp-section">
          <h2>BAT record <span className="pp-stats-note">career (this year)</span></h2>
          <div className="pp-stats-banner">
            <div className="pp-stats-banner-label">Total</div>
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
                  <div className="pp-stats-cell-label">{k}</div>
                  <div className="pp-stats-cell-value">{wl(extra.stats[k].career)}</div>
                  <div className="pp-stats-cell-ytd">({wl(extra.stats[k].ytd)})</div>
                  {p !== null && <div className="pp-stats-cell-pct">{p}%</div>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {batRanking && batRanking.length > 0 && (
        <div className="pp-section pp-ranking-section">
          <h2>Current Ranking{rankingPublishDate && (
            <span className="pp-stats-note">as of {rankingPublishDate}{rankingWeekKey && ` (${rankingWeekKey})`}</span>
          )}</h2>
          <div className="pp-ranking-list">
            {batRanking.map(r => (
              <div key={r.eventName} className="pp-ranking-row">
                <span className="pp-ranking-event">{r.eventName}</span>
                <span className="pp-ranking-pos">#{r.rank}</span>
                <span className="pp-ranking-tn">{r.tournaments} tn</span>
                <span className="pp-ranking-pts">{r.points.toLocaleString()} pts</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {batRanking && batRanking.length > 0 && record.key.provider === 'bat' && (
        <RankingDetailTabs
          slug={record.key.slug}
          initialDetail={initialDetail}
          rankingPublishDate={rankingPublishDate}
        />
      )}
      <div className="pp-kpi-row">
        <div className="pp-kpi"><div className="pp-kpi-num">{record.totals.wins}</div><div className="pp-kpi-lbl">Wins</div></div>
        <div className="pp-kpi"><div className="pp-kpi-num">{record.totals.losses}</div><div className="pp-kpi-lbl">Losses</div></div>
        <div className="pp-kpi"><div className="pp-kpi-num">{winPct}%</div><div className="pp-kpi-lbl">Win Rate</div></div>
        <div className="pp-kpi"><div className="pp-kpi-num">{record.titles.length}</div><div className="pp-kpi-lbl">Titles</div></div>
      </div>

      <div className="pp-section">
        <h2>By Event Type</h2>
        <div className="pp-disc-grid">
          {(['singles', 'doubles', 'mixed'] as const).map(d => {
            const s = record.byDiscipline[d]
            return (
              <div key={d} className="pp-disc">
                <div className="pp-disc-name">{d}</div>
                <div className="pp-disc-wl">{s.wins}–{s.losses}</div>
                <div className="pp-disc-pct">{disciplinePct(s)} win rate</div>
                <div className="pp-disc-ttl">{s.titles} title{s.titles === 1 ? '' : 's'} · {s.semis} SF</div>
              </div>
            )
          })}
        </div>
      </div>

      {record.tournaments.length > 0 && (
        <div className="pp-section" ref={tourSectionRef}>
          <h2>Tournament history</h2>
          {[...record.tournaments]
            .sort((a, b) => (b.tournamentDateIso ?? '').localeCompare(a.tournamentDateIso ?? ''))
            .map(t => (
            <div className="pp-tour" key={t.tournamentId}>
              <div className="pp-tour-name-row">
                <div className="pp-tour-name">{t.tournamentName}</div>
                <div className="pp-tour-date">{t.tournamentDateIso}</div>
              </div>
              <div className="pp-events">
                {t.events.map(e => {
                  // Podium tint: Champion (won the Final) → gold, F (reached
                  // the Final, lost) → silver, SF (reached the SF, lost) →
                  // bronze. Badminton awards both losing semifinalists 3rd.
                  // Everyone who didn't podium gets green so a 'participated'
                  // chip can't be mistaken for the silver runner-up.
                  const medalClass = e.bestFinish === 'Champion' ? 'pp-champ'
                    : e.bestFinish === 'F' ? 'pp-runnerup'
                    : e.bestFinish === 'SF' ? 'pp-third'
                    : 'pp-noplace'
                  const tipKey = `${t.tournamentId}:${e.eventId}`
                  const matches = record.tournamentMatches?.[tipKey] ?? []
                  // Mirror the recentForm tip format: one line per match with
                  // round, verb prefix, opponents, optional partner suffix,
                  // and the comma-joined scores (or walkover/retired tag).
                  const tip = matches.length === 0 ? '' : matches.map(m => {
                    const won = m.outcome === 'W' || m.outcome === 'WO-W' || m.outcome === 'RET-W'
                    const verb = won ? 'def.' : 'lost to'
                    const opp = m.opponents.length > 0 ? m.opponents.join(' / ') : '—'
                    const partnerLine = m.partners.length > 0 ? ` (w/ ${m.partners.join(' / ')})` : ''
                    const scoreLine = m.scores.length > 0
                      ? m.scores.map(s => `${s.t1}-${s.t2}`).join(', ')
                      : (m.outcome.startsWith('WO') ? 'walkover' : m.outcome.startsWith('RET') ? 'retired' : '')
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
                      {hasTip && <span className="pp-ev-tip" role="tooltip">{tip}</span>}
                    </span>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {record.recentForm.length > 0 && (
        <div className="pp-section">
          <h2>Recent form</h2>
          <div className="pp-form-strip" ref={formStripRef}>
            {record.recentForm.map((r, i) => {
              const won = r.outcome === 'W' || r.outcome === 'WO-W' || r.outcome === 'RET-W'
              const label = won ? 'W'
                : r.outcome === 'WO-L' ? 'WO'
                : r.outcome === 'RET-L' ? 'RT'
                : 'L'
              const cls = won ? 'pp-w' : (label === 'WO' || label === 'RT' ? 'pp-wo' : 'pp-l')
              const verbPrefix = won ? 'def.' : 'lost to'
              const opp = r.opponents.length > 0 ? r.opponents.join(' / ') : '—'
              const scoreLine = r.scores.length > 0
                ? r.scores.map(s => `${s.t1}-${s.t2}`).join(', ')
                : (r.outcome.startsWith('WO') ? 'walkover' : r.outcome.startsWith('RET') ? 'retired' : '')
              const partnerLine = r.partners.length > 0 ? ` (w/ ${r.partners.join(' / ')})` : ''
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
        <h2>Match character</h2>
        <div className="pp-char-grid">
          <div className="pp-char-card">
            <div className="pp-char-label">Court time</div>
            <div className="pp-char-value">{fmtHM(record.matchCharacter.courtMinutes)}</div>
            <div className="pp-char-sub">avg {record.matchCharacter.avgMatchMinutes}m · longest {fmtHM(record.matchCharacter.longestMatchMinutes)}</div>
          </div>
          <div className="pp-char-card">
            <div className="pp-char-label">Three-setter rate</div>
            <div className="pp-char-value">{fmtPct(record.matchCharacter.threeSetterRate)}</div>
            <div className="pp-char-sub">{record.matchCharacter.threeSetterCount} of {record.totals.matches} matches</div>
          </div>
          <div className="pp-char-card">
            <div className="pp-char-label">Comeback wins</div>
            <div className="pp-char-value">
              {record.matchCharacter.comebackWins}
              {record.matchCharacter.firstGameLost > 0 && (
                <span className="pp-char-pct"> · {Math.round((record.matchCharacter.comebackWins / record.matchCharacter.firstGameLost) * 100)}%</span>
              )}
            </div>
            <div className="pp-char-sub">won {record.matchCharacter.comebackWins} of {record.matchCharacter.firstGameLost} after dropping game 1</div>
          </div>
          <div className="pp-char-card">
            <div className="pp-char-label">Three-setter wins</div>
            <div className="pp-char-value">
              {record.matchCharacter.threeSetterWins}
              {record.matchCharacter.threeSetterCount > 0 && (
                <span className="pp-char-pct"> · {Math.round((record.matchCharacter.threeSetterWins / record.matchCharacter.threeSetterCount) * 100)}%</span>
              )}
            </div>
            <div className="pp-char-sub">of {record.matchCharacter.threeSetterCount} three-setters played</div>
          </div>
        </div>
      </div>

      {record.opponents.length > 0 && (
        <div className="pp-section">
          <h2>Frequent opponents</h2>
          <div className="pp-ppl-list">
            {record.opponents.map(o => (
              <Link key={o.slug} href={`/player/${record.key.provider}/${o.slug}`} className="pp-ppl-row">
                <div>
                  <div className="pp-ppl-name">{o.name}</div>
                  <div className="pp-ppl-met">{o.meetings} meetings</div>
                </div>
                <div className="pp-ppl-wl"><span className="pp-w">{o.wins}W</span> · <span className="pp-l">{o.losses}L</span></div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>last: {o.lastRound} · {o.lastEvent}</div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {record.partners.length > 0 && (
        <div className="pp-section">
          <h2>Frequent partners (doubles)</h2>
          <div className="pp-ppl-list">
            {record.partners.map(p => (
              <Link key={p.slug} href={`/player/${record.key.provider}/${p.slug}`} className="pp-ppl-row">
                <div>
                  <div className="pp-ppl-name">{p.name}</div>
                  <div className="pp-ppl-met">{p.matchesTogether} matches · {p.primaryEvent}</div>
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
