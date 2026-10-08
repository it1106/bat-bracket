'use client'

import { useEffect, useRef, useState } from 'react'
import type { MatchPlayer } from '@/lib/types'
import type { PathCandidate, PathRecord, PathResponse, PathRoundOut } from '@/lib/pathEnrich'
import { useLanguage } from '@/lib/LanguageContext'

interface Props {
  tournamentId: string
  drawNum: string
  drawName: string
  playerId: string
  onClose: () => void
  onPlayerClick?: (playerId: string) => void
}

export default function PathToFinalModal({ tournamentId, drawNum, drawName, playerId, onClose, onPlayerClick }: Props) {
  const { t, longRound } = useLanguage()
  const [data, setData] = useState<PathResponse | null>(null)
  const [failed, setFailed] = useState(false)
  // Which rounds have their full candidate list open, by row index.
  const [open, setOpen] = useState<Set<number>>(new Set())

  useEffect(() => {
    let live = true
    setData(null)
    setFailed(false)
    setOpen(new Set())
    const url = `/api/path?tournament=${encodeURIComponent(tournamentId)}&draw=${encodeURIComponent(drawNum)}&player=${encodeURIComponent(playerId)}`
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: PathResponse) => { if (live) setData(d) })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [tournamentId, drawNum, playerId])

  // This panel opens on top of the player window, which also closes on
  // Escape. Taking the key in the capture phase and stopping it there closes
  // the panel alone, and leaves the window underneath for the next press.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      onCloseRef.current()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [])

  const toggle = (i: number) => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i); else next.add(i)
      return next
    })
  }

  const team = (players: MatchPlayer[]) => (
    <span className="ptf-team">
      {players.map((p, i) => (
        <span key={i}>
          {i > 0 && ' / '}
          {onPlayerClick && p.playerId
            ? <button type="button" className="ptf-name pm-player-link" onClick={() => onPlayerClick(p.playerId)}>{p.name}</button>
            : <span className="ptf-name">{p.name}</span>}
        </span>
      ))}
    </span>
  )

  const seed = (s: string | undefined) =>
    s ? <span className="ptf-tag">{t('pathSeed').replace('{n}', s)}</span> : null

  const record = (r: PathRecord | null | undefined) => {
    if (!r) return null
    const text = r.wins === 0 && r.losses === 0
      ? t('pathFirstMeeting')
      : t('pathRecord').replace('{w}', String(r.wins)).replace('{l}', String(r.losses))
    return <span className="ptf-record">{text}</span>
  }

  const candidate = (c: PathCandidate, key?: number) => (
    <div className="ptf-candidate" key={key}>
      {team(c.team)}
      {seed(c.seed)}
      {c.rank !== undefined && <span className="ptf-tag">{t('pathRank').replace('{n}', String(c.rank))}</span>}
      {record(c.record)}
    </div>
  )

  // BAT prints the date with a Buddhist-era year ("20/6/2569"); the day and
  // month are all a reader needs, and a time alone would not say which day.
  const schedule = (r: PathRoundOut) => {
    const when = [r.date?.replace(/\/\d{4}$/, ''), r.time].filter(Boolean).join(' ')
    const text = [when, r.court].filter(Boolean).join(' · ')
    return text ? <span className="ptf-when">{text}</span> : null
  }

  const body = (r: PathRoundOut, i: number) => {
    if (r.status === 'bye') return <span className="ptf-muted">{t('pathBye')}</span>

    if (r.status === 'won' || r.status === 'lost') {
      const score = (r.scores ?? []).map((s) => `${s.t1}–${s.t2}`).join(', ')
      return (
        <>
          <span className={`ptf-result ptf-result--${r.status}`}>{t(r.status === 'won' ? 'pathWon' : 'pathLost')}</span>
          {team(r.opponent ?? [])}
          {seed(r.opponentSeed)}
          {r.walkover
            ? <span className="bk-walkover-badge">{t('walkover')}</span>
            : score && <span className="ptf-score">{score}</span>}
          {r.retired && <span className="bk-walkover-badge">{t('retired')}</span>}
        </>
      )
    }

    if (r.opponent) {
      return (
        <>
          <span className="ptf-muted">{t('vs')}</span>
          {team(r.opponent)}
          {seed(r.opponentSeed)}
          {schedule(r)}
          {record(r.record)}
        </>
      )
    }

    const list = r.candidates ?? []
    // Only one team can still fill the place: that is the opponent, not a guess.
    if (list.length === 1) {
      return (
        <>
          <span className="ptf-muted">{t('vs')}</span>
          {candidate(list[0])}
          {schedule(r)}
        </>
      )
    }
    const favourite = list.find((c) => c.favourite)
    const rest = favourite ? list.filter((c) => c !== favourite) : list
    const label = !favourite
      ? t('pathPossible').replace('{n}', String(rest.length))
      : rest.length === 1
        ? t('pathOthersOne')
        : t('pathOthers').replace('{n}', String(rest.length))
    return (
      <>
        {favourite && (
          <div className="ptf-favourite">
            <span className="ptf-muted">{t('pathLikely')}</span>
            {candidate(favourite)}
          </div>
        )}
        {schedule(r)}
        {rest.length > 0 && (
          <button type="button" className="ptf-more" aria-expanded={open.has(i)} onClick={() => toggle(i)}>{label}</button>
        )}
        {open.has(i) && <div className="ptf-candidates">{rest.map((c, ci) => candidate(c, ci))}</div>}
      </>
    )
  }

  const last = data?.rounds[data.rounds.length - 1]

  return (
    <div className="pm-overlay" onClick={onClose}>
      <div className="pm-modal ptf-modal" onClick={(e) => e.stopPropagation()}>
        <button className="pm-close" onClick={onClose} aria-label={t('close')}>✕</button>

        {!data && !failed && <div className="pm-loading">{t('loading')}</div>}
        {failed && <div className="ptf-error">{t('pathLoadFailed')}</div>}

        {data && (
          <>
            <div className="pm-header">
              <div className="pm-section-title">{t('pathToFinal')}</div>
              <div className="ptf-title">
                {data.team.map((p) => p.name).join(' / ')}
                {data.seed && <> {seed(data.seed)}</>}
                <span className="ptf-draw"> · {drawName}</span>
              </div>
            </div>

            {data.stale && <div className="ptf-stale" role="status">{t('staleCacheBanner')}</div>}

            <div className="ptf-rows">
              {data.rounds.map((r, i) => (
                <div key={i} className={`ptf-row ptf-row--${r.status}`}>
                  <div className="ptf-round">{longRound(r.round)}</div>
                  <div className="ptf-body">{body(r, i)}</div>
                </div>
              ))}
            </div>

            {data.eliminated && last && (
              <div className="ptf-end">
                {/^final$/i.test(last.round.trim())
                  ? t('pathRunnerUp')
                  : t('pathOut').replace('{round}', longRound(last.round))}
              </div>
            )}
            {data.champion && <div className="ptf-end">{t('pathChampion')}</div>}

            <div className="ptf-note">{t('pathRecordNote')}</div>
          </>
        )}
      </div>
    </div>
  )
}
