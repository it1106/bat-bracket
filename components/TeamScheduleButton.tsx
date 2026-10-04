'use client'

// The calendar button on a searched or custom-tab schedule: builds a picture
// of that team's matches for the day and shows it, with Share and Download.
// Showing it first matters on iOS, where sharing only works straight from a
// tap — the picture takes a moment to render, so the share is a second tap.

import { useEffect, useState } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import { track } from '@/lib/analytics'
import type { TeamScheduleRow } from '@/lib/teamSchedule'
import { captureTeamScheduleFile } from '@/lib/teamScheduleImage'

interface Props {
  /** Called on click, so the rows reflect the schedule at that moment. */
  getRows: () => TeamScheduleRow[]
  tournamentName: string
  teamLabel: string
  dateLabel: string
}

export default function TeamScheduleButton({ getRows, tournamentName, teamLabel, dateLabel }: Props) {
  const { t } = useLanguage()
  const [busy, setBusy] = useState(false)
  const [image, setImage] = useState<{ file: File; url: string } | null>(null)

  // Free the picture's memory when it is replaced or the button goes away.
  useEffect(() => () => { if (image) URL.revokeObjectURL(image.url) }, [image])

  const generate = async () => {
    if (busy) return
    const rows = getRows()
    if (rows.length === 0) return
    setBusy(true)
    try {
      const file = await captureTeamScheduleFile({
        tournamentName,
        teamLabel,
        dateLabel,
        rows,
        labels: { nowPlaying: t('nowPlaying'), disclaimer: t('appSubtitle'), playsAgain: t('teamSchedulePlaysAgain'), or: t('tbdOr') },
      })
      setImage({ file, url: URL.createObjectURL(file) })
      track('team_schedule_image', { matches: rows.length })
    } catch (err) {
      console.warn('team schedule image failed', err)
    } finally {
      setBusy(false)
    }
  }

  const canShare = !!image && typeof navigator !== 'undefined' && typeof navigator.share === 'function'
    && (typeof navigator.canShare !== 'function' || navigator.canShare({ files: [image.file] }))

  return (
    <>
      <button
        type="button"
        className="ts-button"
        onClick={generate}
        disabled={busy}
        aria-label={t('teamScheduleSave')}
        title={t('teamScheduleSave')}
      >
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <rect x="2" y="3" width="12" height="11" rx="1.5" />
          <path d="M2 6.5h12M5 1.5v3M11 1.5v3" strokeLinecap="round" />
        </svg>
        {busy && <span className="ts-busy">…</span>}
      </button>
      {image && (
        <div className="pm-overlay" onClick={() => setImage(null)}>
          <div className="pm-modal ts-modal" role="dialog" aria-label={t('teamScheduleSave')} onClick={(e) => e.stopPropagation()}>
            <button className="pm-close" onClick={() => setImage(null)} aria-label={t('close')}>✕</button>
            {/* eslint-disable-next-line @next/next/no-img-element -- a blob URL made in the browser */}
            <img className="ts-preview" src={image.url} alt={`${teamLabel} · ${dateLabel}`} />
            <div className="ts-actions">
              {canShare && (
                <button
                  type="button"
                  className="ts-action ts-action--primary"
                  // Straight from the tap, with nothing awaited first: iOS
                  // refuses to share otherwise.
                  onClick={() => { navigator.share({ files: [image.file] }).catch(() => {}) }}
                >
                  {t('teamScheduleShare')}
                </button>
              )}
              <a className={`ts-action${canShare ? '' : ' ts-action--primary'}`} href={image.url} download={image.file.name}>
                {t('teamScheduleDownload')}
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
