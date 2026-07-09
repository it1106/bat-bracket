'use client'

import { useEffect, useState } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import CountryMatrixTable from '@/components/CountryMatrixTable'
import type { TournamentStats } from '@/lib/types'

interface Props {
  tournamentId: string
  tournamentName?: string
}

// Standalone full-page rendering of the country head-to-head grid. Reuses the
// same /api/stats endpoint the panel does; the matrix gets the full viewport
// width here, which the in-panel grid can't. Directly reachable by URL, so it
// handles the no-matrix case (non-BWF tournament, or stats still warming) with
// an empty state rather than assuming the panel already gated the link.
export default function CountryMatrixFullView({ tournamentId, tournamentName }: Props) {
  const { t } = useLanguage()
  const [stats, setStats] = useState<TournamentStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/stats?tournament=${encodeURIComponent(tournamentId)}`)
        const data = await res.json()
        if (cancelled) return
        if ('error' in data) setError(data.error)
        else setStats(data as TournamentStats)
      } catch {
        if (!cancelled) setError('fetch failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [tournamentId])

  const matrix = stats?.countryMatrix
  const hasMatrix = !!matrix && matrix.countries.length >= 2

  return (
    <main className="country-matrix-page">
      <header className="country-matrix-page__head">
        <h1>{t('statsSectionCountryMatrix')}</h1>
        {tournamentName && <p className="country-matrix-page__sub">{tournamentName}</p>}
        <p className="stats-matrix-hint">{t('statsCountryMatrixHint')}</p>
      </header>

      {loading && <p className="country-matrix-page__msg">{t('loading')}</p>}
      {!loading && error && <p className="country-matrix-page__msg">{error}</p>}
      {!loading && !error && !hasMatrix && (
        <p className="country-matrix-page__msg">{t('statsCountryMatrixEmpty')}</p>
      )}
      {!loading && hasMatrix && <CountryMatrixTable matrix={matrix!} />}
    </main>
  )
}
