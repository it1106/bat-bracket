'use client'
import React, { useState } from 'react'
import Link from 'next/link'
import type { Leaderboards, LeaderboardCategory } from '@/lib/types'

interface Props { leaderboards: Leaderboards }

const CATEGORIES: Array<{ id: LeaderboardCategory; label: string }> = [
  { id: 'headline', label: 'Headline' },
  { id: 'discipline', label: 'Discipline' },
  { id: 'character', label: 'Character' },
  { id: 'activity', label: 'Activity' },
]

function humanize(titleKey: string): string {
  return titleKey.replace(/^lb/, '').replace(/([A-Z])/g, ' $1').trim()
}

export default function LeaderboardsView({ leaderboards }: Props) {
  const [active, setActive] = useState<LeaderboardCategory>('headline')
  if (leaderboards.boards.length === 0) {
    return (
      <div className="lb-page">
        <div className="lb-hdr"><h1>🏆 Leaderboards</h1></div>
        <div className="lb-empty">No leaderboards yet — add a completed tournament to get started.</div>
      </div>
    )
  }
  const visible = leaderboards.boards.filter(b => b.category === active)
  return (
    <div className="lb-page">
      <div className="lb-hdr">
        <h1>🏆 Leaderboards</h1>
        <div className="lb-sub">Provider: {leaderboards.provider.toUpperCase()} · {leaderboards.boards.length} boards</div>
      </div>
      <div className="lb-tabs">
        {CATEGORIES.map(c => (
          <button key={c.id}
            className={`lb-tab ${active === c.id ? 'lb-active' : ''}`}
            onClick={() => setActive(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="lb-grid">
        {visible.map(b => (
          <div key={b.id} className="lb-card" id={b.id}>
            <h3>
              <span><span className="lb-card-ico">{b.icon}</span>{humanize(b.titleKey)}</span>
              {b.qualifier && <span className="lb-card-qual">{b.qualifier}</span>}
            </h3>
            {b.entries.length === 0 ? (
              <div className="lb-empty" style={{ padding: '12px 0' }}>—</div>
            ) : b.entries.map(e => (
              <Link key={e.slug} href={`/player/${leaderboards.provider}/${e.slug}`}
                className="lb-row">
                <div className={`lb-rk ${e.rank === 1 ? 'lb-r1' : e.rank === 2 ? 'lb-r2' : e.rank === 3 ? 'lb-r3' : ''}`}>{e.rank}</div>
                <div>
                  <div>{e.name}</div>
                  <div className="lb-club">{e.primaryClub}</div>
                </div>
                <div className="lb-val">{e.display}</div>
              </Link>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
