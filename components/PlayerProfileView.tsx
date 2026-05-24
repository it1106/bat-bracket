'use client'
import React from 'react'
import Link from 'next/link'
import type { PlayerRecord, PlayerRanks } from '@/lib/types'

interface Props { record: PlayerRecord }

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

const RANK_LABELS: Array<[keyof PlayerRanks, string, string]> = [
  ['titles', '🏆', 'Most Titles'],
  ['wins', '🥇', 'Most Wins'],
  ['winPct', '📊', 'Highest Win %'],
  ['courtTime', '⏱', 'Most Court Time'],
  ['comebackWins', '🔁', 'Comeback Wins'],
  ['threeSetterWins', '🔥', 'Three-setter Wins'],
]

export default function PlayerProfileView({ record }: Props) {
  const winPct = record.totals.matches > 0
    ? Math.round((record.totals.wins / record.totals.matches) * 100)
    : 0
  return (
    <div className="pp-page">
      <Link href="/" className="pp-back">← Home</Link>
      <div className="pp-hdr">
        <h1>{record.displayName}</h1>
        <div className="pp-meta">
          {record.clubs[0] && <span>🏛 <strong>{record.clubs[0]}</strong></span>}
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

      <div className="pp-kpi-row">
        <div className="pp-kpi"><div className="pp-kpi-num">{record.totals.wins}</div><div className="pp-kpi-lbl">Wins</div></div>
        <div className="pp-kpi"><div className="pp-kpi-num">{record.totals.losses}</div><div className="pp-kpi-lbl">Losses</div></div>
        <div className="pp-kpi"><div className="pp-kpi-num">{winPct}%</div><div className="pp-kpi-lbl">Win Rate</div></div>
        <div className="pp-kpi"><div className="pp-kpi-num">{record.titles.length}</div><div className="pp-kpi-lbl">Titles</div></div>
      </div>

      <div className="pp-section">
        <h2>By discipline</h2>
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
        <div className="pp-section">
          <h2>Tournament history</h2>
          {record.tournaments.map(t => (
            <div className="pp-tour" key={t.tournamentId}>
              <div className="pp-tour-name-row">
                <div className="pp-tour-name">{t.tournamentName}</div>
                <div className="pp-tour-date">{t.tournamentDateIso}</div>
              </div>
              <div className="pp-events">
                {t.events.map(e => (
                  <span key={e.eventId + e.eventName} className={`pp-ev-chip ${e.bestFinish === 'Champion' ? 'pp-champ' : ''}`}>
                    {e.bestFinish === 'Champion' ? '🏆 ' : ''}{e.eventName} ·{' '}
                    <span className="pp-ev-chip-finish">{e.bestFinish}</span> ·{' '}
                    <span className="pp-ev-chip-wl">{e.wins}–{e.losses}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {record.recentForm.length > 0 && (
        <div className="pp-section">
          <h2>Recent form</h2>
          <div className="pp-form-strip">
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
              return <div key={i} className={`pp-form-cell ${cls}`} title={tip}>{label}</div>
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
            <div className="pp-char-value">{record.matchCharacter.comebackWins}</div>
            <div className="pp-char-sub">Lost game 1, won the match</div>
          </div>
          <div className="pp-char-card">
            <div className="pp-char-label">Three-setter wins</div>
            <div className="pp-char-value">{record.matchCharacter.threeSetterWins}</div>
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
