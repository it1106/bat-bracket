'use client'
import React, { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLanguage } from '@/lib/LanguageContext'
import { weekKeyFromPublishDate } from '@/lib/ranking/player-view'
import { getRankingConfig } from '@/lib/ranking/config'
import type { Leaderboards, LeaderboardCategory, ProviderTag } from '@/lib/types'
import type { TKey } from '@/lib/i18n'

interface SearchHit { slug: string; name: string; club: string; provider: ProviderTag }

interface Props { leaderboards: Leaderboards[]; rankingPublishDates?: Partial<Record<ProviderTag, string>> }

// Tab order matters: first entry is the default active tab when none is
// explicitly selected (also the fallback when the requested category has
// no boards on the current provider — see effectiveActive below).
const CATEGORIES: Array<{ id: LeaderboardCategory; key: TKey }> = [
  { id: 'ranking', key: 'lbRanking' },
  { id: 'headline', key: 'lbHeadline' },
  { id: 'discipline', key: 'lbDiscipline' },
  { id: 'character', key: 'lbCharacter' },
  { id: 'activity', key: 'lbActivity' },
]

const PROVIDER_LABELS: Record<ProviderTag, string> = {
  bat: 'BAT',
  bwf: 'BWF',
  combined: 'BAT+BWF',
}

export default function LeaderboardsView({ leaderboards, rankingPublishDates }: Props) {
  const { t } = useLanguage()
  const router = useRouter()
  const [activeProvider, setActiveProvider] = useState<ProviderTag>(leaderboards[0]?.provider ?? 'bat')
  const [active, setActive] = useState<LeaderboardCategory>('ranking')
  const activeRankingPublishDate = rankingPublishDates?.[activeProvider]
  const rankingWeekKey = activeRankingPublishDate && (activeProvider === 'bat' || activeProvider === 'bwf')
    ? weekKeyFromPublishDate(activeRankingPublishDate, getRankingConfig(activeProvider).dateFormat)
    : null
  const [openHelp, setOpenHelp] = useState<string | null>(null)
  // Set of board IDs the user has expanded to see beyond the top 10.
  // Per-board state (not global) so expanding "U23 Men's singles" doesn't
  // also blow open every other board.
  const [expandedBoards, setExpandedBoards] = useState<Set<string>>(new Set())
  const helpRef = useRef<HTMLSpanElement | null>(null)
  const didMountRef = useRef(false)

  const BOARD_COLLAPSED_LIMIT = 10
  const toggleBoardExpansion = (id: string) => {
    setExpandedBoards((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // Player search
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 1) { setHits([]); return }
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      fetch(`/api/players/search?provider=${activeProvider}&q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then(r => r.json())
        .then(d => { setHits(d.hits ?? []); setSearchOpen(true) })
        .catch(() => { /* aborted or failed */ })
    }, 200)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [query, activeProvider])

  // Reset search when switching provider tab.
  useEffect(() => { setQuery(''); setHits([]); setSearchOpen(false) }, [activeProvider])

  // Close results dropdown when tapping elsewhere.
  useEffect(() => {
    if (!searchOpen) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [searchOpen])

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

  const availableCategories = CATEGORIES.filter(c => lb.boards.some(b => b.category === c.id))
  const effectiveActive = availableCategories.some(c => c.id === active) ? active : availableCategories[0]?.id ?? active
  const visible = lb.boards.filter(b => b.category === effectiveActive)
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
      <div className="lb-search" ref={searchRef}>
        <input
          type="text"
          className="lb-search-input"
          placeholder={t('lbSearchPlaceholder')}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => { if (hits.length) setSearchOpen(true) }}
        />
        {query && (
          <button type="button" className="lb-search-clear" aria-label={t('clearSearch')}
            onClick={() => { setQuery(''); setHits([]); setSearchOpen(false) }}>✕</button>
        )}
        {searchOpen && hits.length > 0 && (
          <div className="lb-search-results">
            {hits.map(h => (
              <button key={h.slug} type="button" className="lb-search-row"
                onClick={() => { setSearchOpen(false); router.push(`/player/${h.provider}/${h.slug}`) }}>
                <span className="lb-search-name">{h.name}</span>
                {h.club && <span className="lb-search-club">{h.club}</span>}
              </button>
            ))}
          </div>
        )}
        {searchOpen && query.trim().length > 0 && hits.length === 0 && (
          <div className="lb-search-results"><div className="lb-search-empty">{t('lbSearchEmpty')}</div></div>
        )}
      </div>
      <div className="lb-tabs">
        {availableCategories.map(c => (
          <button key={c.id}
            className={`lb-tab ${effectiveActive === c.id ? 'lb-active' : ''}`}
            onClick={() => setActive(c.id)}>
            {t(c.key)}
          </button>
        ))}
      </div>
      {effectiveActive === 'ranking' && activeRankingPublishDate && (
        <div className="lb-sub lb-ranking-asof">{t('lbRankingAsOf')} {activeRankingPublishDate}{rankingWeekKey && ` (${rankingWeekKey})`}</div>
      )}
      <div className="lb-grid">
        {visible.map(b => {
          const helpKey = `${b.titleKey}Help` as TKey
          const isOpen = openHelp === b.id
          return (
          <div key={b.id} className="lb-card" id={b.id}>
            <h3>
              <span>
                <span className="lb-card-ico">{b.icon}</span>{t(b.titleKey as TKey)}
                {b.category !== 'ranking' && (
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
                )}
              </span>
              {b.qualifier && <span className="lb-card-qual">{t(b.qualifier as TKey)}</span>}
            </h3>
            {(() => {
              if (b.entries.length === 0) {
                return <div className="lb-empty" style={{ padding: '12px 0' }}>—</div>
              }
              const isExpanded = expandedBoards.has(b.id)
              // Every board (ranking + headline/discipline/character/activity)
              // collapses to the top 10 with a Show more / Show less toggle.
              // Ranking caps at 30 entries (set by leaderboards/page.tsx);
              // other categories cap at 25 (set by playerIndex.ts) — both
              // share the same UI affordance here.
              const visibleEntries = isExpanded
                ? b.entries
                : b.entries.slice(0, BOARD_COLLAPSED_LIMIT)
              const hasMore = b.entries.length > BOARD_COLLAPSED_LIMIT
              return (
                <>
                  {visibleEntries.map(e => (
                    <Link key={e.slug} href={`/player/${e.provider ?? lb.provider}/${e.slug}`}
                      prefetch={false} className={`lb-row${e.extra ? ' lb-row-extra' : ''}`}>
                      <div className={`lb-rk ${e.rank === 1 ? 'lb-r1' : e.rank === 2 ? 'lb-r2' : e.rank === 3 ? 'lb-r3' : ''}`}>{e.rank}</div>
                      <div>
                        <div>{e.name}</div>
                        <div className="lb-club">{e.primaryClub}</div>
                      </div>
                      {e.extra && <div className="lb-extra">{e.extra}</div>}
                      <div className="lb-val">{e.display}</div>
                    </Link>
                  ))}
                  {hasMore && (
                    <button
                      type="button"
                      className="lb-show-more"
                      onClick={() => toggleBoardExpansion(b.id)}
                    >
                      {isExpanded
                        ? t('leaderboardsShowLess')
                        : t('leaderboardsShowMore')}
                    </button>
                  )}
                </>
              )
            })()}
          </div>
        )})}
      </div>
    </div>
  )
}
