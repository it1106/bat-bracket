'use client'
import React, { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useLanguage } from '@/lib/LanguageContext'
import type { Leaderboards, LeaderboardCategory, ProviderTag } from '@/lib/types'
import type { TKey } from '@/lib/i18n'

interface Props { leaderboards: Leaderboards[] }

const CATEGORIES: Array<{ id: LeaderboardCategory; key: TKey }> = [
  { id: 'headline', key: 'lbHeadline' },
  { id: 'discipline', key: 'lbDiscipline' },
  { id: 'character', key: 'lbCharacter' },
  { id: 'activity', key: 'lbActivity' },
  { id: 'ranking', key: 'lbRanking' },
]

const PROVIDER_LABELS: Record<ProviderTag, string> = {
  bat: 'BAT',
  bwf: 'BWF',
  combined: 'BAT+BWF',
}

export default function LeaderboardsView({ leaderboards }: Props) {
  const { t } = useLanguage()
  const [activeProvider, setActiveProvider] = useState<ProviderTag>(leaderboards[0]?.provider ?? 'bat')
  const [active, setActive] = useState<LeaderboardCategory>('headline')
  const [openHelp, setOpenHelp] = useState<string | null>(null)
  const helpRef = useRef<HTMLSpanElement | null>(null)
  const didMountRef = useRef(false)

  // Switching tabs (esp. away from Ranking with 34 boards) leaves the viewport
  // scrolled into dead space below the new, shorter grid.
  useEffect(() => {
    if (!didMountRef.current) { didMountRef.current = true; return }
    window.scrollTo(0, 0)
  }, [active])

  // Close a click-opened tooltip when tapping elsewhere (mobile).
  useEffect(() => {
    if (!openHelp) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (helpRef.current && !helpRef.current.contains(e.target as Node)) setOpenHelp(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [openHelp])

  const lb = leaderboards.find(l => l.provider === activeProvider) ?? leaderboards[0]

  if (!lb || lb.boards.length === 0) {
    return (
      <div className="lb-page">
        <Link href="/" className="pp-back">← Home</Link>
        <div className="lb-hdr"><h1>🏆 {t('leaderboards')}</h1></div>
        <div className="lb-empty">No leaderboards yet — add a completed tournament to get started.</div>
      </div>
    )
  }

  const visible = lb.boards.filter(b => b.category === active)
  const multiProvider = leaderboards.length > 1

  return (
    <div className="lb-page">
      <Link href="/" className="pp-back">← Home</Link>
      <div className="lb-hdr">
        <h1>🏆 {t('leaderboards')}</h1>
        {!multiProvider && (
          <div className="lb-sub">{PROVIDER_LABELS[lb.provider]} · {lb.boards.length} boards</div>
        )}
      </div>
      {multiProvider && (
        <div className="lb-provider-tabs">
          {leaderboards.map(l => (
            <button key={l.provider}
              className={`lb-provider-tab ${activeProvider === l.provider ? 'lb-active' : ''}`}
              onClick={() => setActiveProvider(l.provider)}>
              {PROVIDER_LABELS[l.provider]}
            </button>
          ))}
        </div>
      )}
      <div className="lb-tabs">
        {CATEGORIES.map(c => (
          <button key={c.id}
            className={`lb-tab ${active === c.id ? 'lb-active' : ''}`}
            onClick={() => setActive(c.id)}>
            {t(c.key)}
          </button>
        ))}
      </div>
      <div className="lb-grid">
        {visible.map(b => {
          const helpKey = `${b.titleKey}Help` as TKey
          const isOpen = openHelp === b.id
          return (
          <div key={b.id} className="lb-card" id={b.id}>
            <h3>
              <span>
                <span className="lb-card-ico">{b.icon}</span>{t(b.titleKey as TKey)}
                <span
                  ref={isOpen ? helpRef : undefined}
                  className={`lb-help ${isOpen ? 'lb-help-open' : ''}`}
                >
                  <button
                    type="button"
                    className="lb-help-btn"
                    aria-label={t(helpKey)}
                    onClick={(e) => { e.preventDefault(); setOpenHelp(isOpen ? null : b.id) }}
                  >?</button>
                  <span className="lb-help-tip" role="tooltip">{t(helpKey)}</span>
                </span>
              </span>
              {b.qualifier && <span className="lb-card-qual">{t(b.qualifier as TKey)}</span>}
            </h3>
            {b.entries.length === 0 ? (
              <div className="lb-empty" style={{ padding: '12px 0' }}>—</div>
            ) : b.entries.map(e => (
              <Link key={e.slug} href={`/player/${e.provider ?? lb.provider}/${e.slug}`}
                prefetch={false} className="lb-row">
                <div className={`lb-rk ${e.rank === 1 ? 'lb-r1' : e.rank === 2 ? 'lb-r2' : e.rank === 3 ? 'lb-r3' : ''}`}>{e.rank}</div>
                <div>
                  <div>{e.name}</div>
                  <div className="lb-club">{e.primaryClub}</div>
                </div>
                <div className="lb-val">{e.display}</div>
              </Link>
            ))}
          </div>
        )})}
      </div>
    </div>
  )
}
