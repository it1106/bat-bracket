'use client'

import { useEffect, useRef, useState } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import { track } from '@/lib/analytics'
import type { AlertItem } from '@/lib/alerts'

interface AlertBellProps {
  alerts: AlertItem[]
  onDismiss: () => void
}

function formatAlertDate(dateIso: string, lang: 'en' | 'th'): string {
  // dateIso is YYYY-MM-DD; build a Date at noon UTC to avoid TZ rollovers.
  const d = new Date(`${dateIso}T12:00:00Z`)
  if (lang === 'th') {
    return d.toLocaleDateString('th-TH', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'Asia/Bangkok',
    })
  }
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Bangkok',
  })
}

export default function AlertBell({ alerts, onDismiss }: AlertBellProps) {
  const { t, lang } = useLanguage()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)

  const hasAlerts = alerts.length > 0
  const showPulse = hasAlerts && !open

  const tournamentItems = alerts.filter(
    (a): a is Extract<AlertItem, { kind: 'tournament' }> => a.kind === 'tournament',
  )
  const scheduleItems = alerts.filter(
    (a): a is Extract<AlertItem, { kind: 'schedule' }> => a.kind === 'schedule',
  )
  const rankingItems = alerts.filter(
    // Require `provider`: ranking alerts persisted by an older build (pre
    // multi-provider) lack it, and would otherwise crash on `.toUpperCase()`
    // / produce a `provider=undefined` link. Such stale items age out of the
    // pending cap on their own.
    (a): a is Extract<AlertItem, { kind: 'ranking' }> =>
      a.kind === 'ranking' && typeof a.provider === 'string',
  )

  const dismissWith = (via: 'item' | 'outside' | 'escape') => {
    const tournaments = alerts.filter((a) => a.kind === 'tournament').length
    const schedules = alerts.filter((a) => a.kind === 'schedule').length
    const rankings = alerts.filter((a) => a.kind === 'ranking').length
    track('alert_dismissed', { count: alerts.length, tournaments, schedules, rankings, via })
    setOpen(false)
    onDismiss()
  }

  // Close + dismiss on Escape
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissWith('escape')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, alerts, onDismiss])

  // Close + dismiss on outside click / tap
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      const node = wrapRef.current
      if (!node) return
      if (node.contains(e.target as Node)) return
      dismissWith('outside')
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, alerts, onDismiss])

  const handleBellClick = () => {
    if (!hasAlerts) return
    if (!open) {
      const tournaments = alerts.filter((a) => a.kind === 'tournament').length
      const schedules = alerts.filter((a) => a.kind === 'schedule').length
      const rankings = alerts.filter((a) => a.kind === 'ranking').length
      track('alert_opened', { count: alerts.length, tournaments, schedules, rankings })
    }
    setOpen((v) => !v)
  }

  const handleItemClick = () => {
    dismissWith('item')
  }

  return (
    <span ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={handleBellClick}
        aria-disabled={hasAlerts ? undefined : true}
        aria-expanded={open}
        aria-label={t('alertsBellAria')}
        title={t('alertsBellAria')}
        className={`relative inline-flex items-center justify-center w-9 h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm transition-colors ${
          hasAlerts ? 'text-[var(--fg)] hover:bg-[var(--bg)] cursor-pointer' : 'text-[var(--muted)] cursor-default'
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {showPulse && <span className="alert-bell-pulse" aria-hidden />}
        {hasAlerts && <span className="alert-bell-dot" aria-hidden />}
      </button>

      {open && (
        <>
          {/* Mobile backdrop */}
          <div
            aria-hidden
            className="fixed inset-0 z-40 bg-black/15 sm:hidden"
            onClick={handleItemClick}
          />
          <div
            role="dialog"
            aria-label={t('alertsTitle')}
            className="fixed sm:absolute z-50 left-2 right-2 sm:left-auto sm:right-0 top-[60px] sm:top-auto sm:mt-1.5 sm:w-[320px] max-h-[70vh] overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--surface)] shadow-xl"
          >
            <div className="px-4 pt-3 pb-2 text-[13px] font-semibold text-[var(--fg)] border-b border-[var(--border)]">
              {t('alertsTitle')}
            </div>

            {tournamentItems.length > 0 && (
              <>
                <div className="px-4 pt-3 pb-1 text-[10px] font-bold text-[var(--muted)] uppercase tracking-wide">
                  {t('alertsNewTournaments')}
                </div>
                {tournamentItems.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={handleItemClick}
                    className="block w-full text-left px-4 py-2.5 text-[13px] text-[var(--fg)] hover:bg-[var(--info-bg)]"
                  >
                    {a.tournamentName}
                  </button>
                ))}
              </>
            )}

            {scheduleItems.length > 0 && (
              <>
                <div className="px-4 pt-3 pb-1 text-[10px] font-bold text-[var(--muted)] uppercase tracking-wide">
                  {t('alertsNewSchedule')}
                </div>
                {scheduleItems.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={handleItemClick}
                    className="block w-full text-left px-4 py-2.5 text-[13px] text-[var(--fg)] hover:bg-[var(--info-bg)]"
                  >
                    <div>{a.tournamentName}</div>
                    <div className="text-[11px] text-[var(--muted)] mt-0.5">
                      {formatAlertDate(a.dateIso, lang)}
                    </div>
                  </button>
                ))}
              </>
            )}

            {rankingItems.length > 0 && (
              <>
                <div className="px-4 pt-3 pb-1 text-[10px] font-bold text-[var(--muted)] uppercase tracking-wide">
                  {t('alertsNewRanking')}
                </div>
                {rankingItems.map((a) => (
                  <a
                    key={a.id}
                    href={`/leaderboards?provider=${a.provider}`}
                    onClick={handleItemClick}
                    className="block w-full text-left px-4 py-2.5 text-[13px] text-[var(--fg)] hover:bg-[var(--info-bg)]"
                  >
                    <div>{t('alertsRankingTitle')}</div>
                    <div className="text-[11px] text-[var(--muted)] mt-0.5">
                      {a.provider.toUpperCase()} · {a.publishDate}
                    </div>
                  </a>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </span>
  )
}
