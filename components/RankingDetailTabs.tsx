'use client'
import { useEffect, useState } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import { track } from '@/lib/analytics'
import {
  topRowsForTab,
  otherRowsForTab,
  bwfSectionsForTab,
  computeExpiryCutoffs,
  classifyExpiry,
  type Discipline,
} from '@/lib/ranking/player-view'
import { getRankingConfig } from '@/lib/ranking/config'
import type { Ranking, RankingPlayerDetail, ProviderTag } from '@/lib/types'
import TournamentRow from './TournamentRow'
import BwfRankingSection from './BwfRankingSection'

interface Props {
  provider: ProviderTag
  slug: string
  initialDetail?: RankingPlayerDetail
  /** Upstream publication date string (BE for BAT, Gregorian for BWF).
   *  Used to compute which rows' points will fall out of the 52-week
   *  window at the next publication. */
  rankingPublishDate?: string
  /** Current overview cache for the provider. Used by the BWF section
   *  renderer to look up the player's rank per target event. */
  currentRanking?: Ranking | null
}

const DISCIPLINES: Discipline[] = ['singles', 'doubles', 'mixed']

type FetchState =
  | { state: 'idle'; detail: RankingPlayerDetail }
  | { state: 'loading' }
  | { state: 'error'; message: string }

/**
 * Owns: active tab state + the fetch lifecycle when SSR didn't deliver
 * the detail. Renders three tabs; the body of each tab is a flat top-10
 * list (by points) sorted newest-first.
 */
export default function RankingDetailTabs({ provider, slug, initialDetail, rankingPublishDate, currentRanking }: Props) {
  const { t } = useLanguage()
  const [active, setActive] = useState<Discipline>('singles')
  const [fetchState, setFetchState] = useState<FetchState>(
    initialDetail ? { state: 'idle', detail: initialDetail } : { state: 'loading' },
  )
  const [trackedOnce, setTrackedOnce] = useState(false)

  useEffect(() => {
    if (initialDetail) return // already have it from SSR
    const ctrl = new AbortController()
    fetch(`/api/players/ranking-detail?provider=${provider}&slug=${encodeURIComponent(slug)}`, { signal: ctrl.signal })
      .then(async (r) => {
        // 404 means either discovery failed for this slug or upstream has no
        // detail page at this publishDate. Both render as "empty" from the
        // user's perspective — never as a load-failed error.
        if (r.status === 404) return { kind: 'empty' as const }
        if (!r.ok) throw new Error(`${r.status}`)
        const body = await r.json() as { detail?: RankingPlayerDetail; error?: string }
        return { kind: 'ok' as const, body }
      })
      .then((result) => {
        if (result.kind === 'empty') {
          setFetchState({
            state: 'idle',
            detail: { globalPlayerId: '', publishDate: '', scrapedAt: '', tournaments: [] },
          })
          return
        }
        if (result.body.detail) setFetchState({ state: 'idle', detail: result.body.detail })
        else setFetchState({ state: 'error', message: result.body.error ?? 'unknown' })
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return
        setFetchState({ state: 'error', message: String(err) })
      })
    return () => ctrl.abort()
  }, [provider, slug, initialDetail])

  useEffect(() => {
    if (fetchState.state !== 'idle' || trackedOnce) return
    track('ranking_detail_viewed', { provider, slug, discipline: active })
    setTrackedOnce(true)
  }, [fetchState, trackedOnce, provider, slug, active])

  const switchTab = (next: Discipline) => {
    if (next === active) return
    track('ranking_detail_tab_changed', { from: active, to: next })
    setActive(next)
  }

  const renderBody = () => {
    if (fetchState.state === 'loading') {
      return (
        <>
          <div className="pp-rd-skeleton" />
          <div className="pp-rd-skeleton" />
        </>
      )
    }
    if (fetchState.state === 'error') {
      return (
        <div className="pp-rd-error">
          <span>{t('rankingDetailLoadFailed')}</span>
          <button
            type="button"
            className="pp-rd-error-retry"
            onClick={() => setFetchState({ state: 'loading' })}
          >{t('rankingDetailRetry')}</button>
        </div>
      )
    }
    const cutoffs = computeExpiryCutoffs(rankingPublishDate, getRankingConfig(provider).dateFormat)

    if (provider === 'bwf') {
      const sections = bwfSectionsForTab(fetchState.detail, active)
      if (sections.length === 0) {
        return <div className="pp-rd-empty">{t('rankingDetailEmpty')}</div>
      }
      return (
        <>
          {sections.map((section) => (
            <BwfRankingSection
              key={section.eventName}
              slug={slug}
              section={section}
              cutoffs={cutoffs}
              currentRanking={currentRanking}
            />
          ))}
        </>
      )
    }

    // BAT path — unchanged below.
    const top = topRowsForTab(fetchState.detail, active)
    if (top.length === 0) {
      return <div className="pp-rd-empty">{t('rankingDetailEmpty')}</div>
    }
    const others = otherRowsForTab(fetchState.detail, active)
    const topTotal = top.reduce((sum, r) => sum + r.points, 0)
    return (
      <>
        <h3 className="pp-rd-section-header">
          <span>{t('rankingDetailTopTen')}</span>
          <span className="pp-rd-section-total">{topTotal.toLocaleString()} pts</span>
        </h3>
        {top.map((r, i) => (
          <TournamentRow
            key={`top-${r.week}-${r.tournamentName}-${i}`}
            row={r}
            expiry={classifyExpiry(r.week, cutoffs)}
          />
        ))}
        {others.length > 0 && (
          <>
            <h3 className="pp-rd-section-header pp-rd-section-header--divided">
              {t('rankingDetailOthersTournaments')}
            </h3>
            {others.map((r, i) => (
              <TournamentRow
                key={`oth-${r.week}-${r.tournamentName}-${i}`}
                row={r}
                expiry={classifyExpiry(r.week, cutoffs)}
              />
            ))}
          </>
        )}
      </>
    )
  }

  return (
    <div className="pp-section pp-ranking-detail">
      <h2>{t('rankingDetailTitle')}</h2>
      <div className="pp-rd-tabs" role="tablist">
        {DISCIPLINES.map((d) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={active === d}
            className={`pp-rd-tab${active === d ? ' active' : ''}`}
            onClick={() => switchTab(d)}
          >
            {d === 'singles'
              ? t('rankingDetailTabSingles')
              : d === 'doubles'
                ? t('rankingDetailTabDoubles')
                : t('rankingDetailTabMixed')}
          </button>
        ))}
      </div>
      {renderBody()}
    </div>
  )
}
