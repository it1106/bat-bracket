'use client'
import { useEffect, useState } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import { track } from '@/lib/analytics'
import { groupForTab, type Discipline } from '@/lib/bat-ranking-player-view'
import type { BatRanking, BatRankingPlayerDetail } from '@/lib/types'
import RankingDetailBlock from './RankingDetailBlock'

interface Props {
  slug: string
  initialDetail?: BatRankingPlayerDetail
  currentRanking: BatRanking
}

const DISCIPLINES: Discipline[] = ['singles', 'doubles', 'mixed']

type FetchState =
  | { state: 'idle'; detail: BatRankingPlayerDetail }
  | { state: 'loading' }
  | { state: 'error'; message: string }

/**
 * Owns: active tab state + the fetch lifecycle when SSR didn't deliver
 * the detail. Renders three tabs and the blocks for the active one.
 */
export default function RankingDetailTabs({ slug, initialDetail, currentRanking }: Props) {
  const { t } = useLanguage()
  const [active, setActive] = useState<Discipline>('singles')
  const [fetchState, setFetchState] = useState<FetchState>(
    initialDetail ? { state: 'idle', detail: initialDetail } : { state: 'loading' },
  )
  const [trackedOnce, setTrackedOnce] = useState(false)

  useEffect(() => {
    if (initialDetail) return // already have it from SSR
    const ctrl = new AbortController()
    fetch(`/api/players/ranking-detail?slug=${encodeURIComponent(slug)}`, { signal: ctrl.signal })
      .then(async (r) => {
        // 404 means either discovery failed for this slug or BAT has no detail
        // page for this player at this publishDate. Both render as "empty" from
        // the user's perspective — never as a load-failed error.
        if (r.status === 404) return { kind: 'empty' as const }
        if (!r.ok) throw new Error(`${r.status}`)
        const body = await r.json() as { detail?: BatRankingPlayerDetail; error?: string }
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
  }, [slug, initialDetail])

  useEffect(() => {
    if (fetchState.state !== 'idle' || trackedOnce) return
    track('ranking_detail_viewed', { provider: 'bat', slug, discipline: active })
    setTrackedOnce(true)
  }, [fetchState, trackedOnce, slug, active])

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
    const blocks = groupForTab(fetchState.detail, currentRanking, active)
    if (blocks.length === 0) {
      return <div className="pp-rd-empty">{t('rankingDetailEmpty')}</div>
    }
    return blocks.map((b) => <RankingDetailBlock key={b.rankingEventCode} block={b} />)
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
