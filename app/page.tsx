'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import BracketCanvas from '@/components/BracketCanvas'
import MatchSchedule from '@/components/MatchSchedule'
import PlayerModal from '@/components/PlayerModal'
import { exportBracketAsJpg } from '@/components/ExportButton'
import H2HModal from '@/components/H2HModal'
import { useLanguage } from '@/lib/LanguageContext'
import { useTheme } from '@/lib/ThemeContext'
import { useLiveScore } from '@/lib/useLiveScore'
import { matchLiveCourt } from '@/lib/live-score'
import type { BracketData, ApiError, TournamentInfo, DrawInfo, MatchDay, MatchScheduleGroup, MatchesData, PlayerProfile, H2HData } from '@/lib/types'

function isApiError(data: unknown): data is ApiError {
  return typeof data === 'object' && data !== null && 'error' in data
}

async function safeJson(res: Response): Promise<unknown> {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(res.ok ? 'Unexpected server response' : `Server error (${res.status}) — please try again`)
  }
}

type ViewMode = 'bracket' | 'matches' | 'live'

export default function Home() {
  const { lang, toggleLang, t } = useLanguage()
  const { theme, toggleTheme } = useTheme()
  const [tournaments, setTournaments] = useState<TournamentInfo[]>([])
  const [draws, setDraws] = useState<DrawInfo[]>([])
  const [selectedTournament, setSelectedTournament] = useState('')
  const [selectedDraw, setSelectedDraw] = useState('')
  const [bracketHtml, setBracketHtml] = useState('')
  const [playerQuery, setPlayerQuery] = useState('')
  const [highlightResults, setHighlightResults] = useState(true)
  const [loadingTournaments, setLoadingTournaments] = useState(true)
  const [loadingDraws, setLoadingDraws] = useState(false)
  const [loadingBracket, setLoadingBracket] = useState(false)
  const [loadingMatches, setLoadingMatches] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tournamentName, setTournamentName] = useState('')
  const [drawName, setDrawName] = useState('')
  const [fromRound, setFromRound] = useState(0)
  const [fromRoundName, setFromRoundName] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('matches')
  const [matchDays, setMatchDays] = useState<MatchDay[]>([])
  const [selectedDay, setSelectedDay] = useState('')
  const [matchGroups, setMatchGroups] = useState<MatchScheduleGroup[]>([])
  const [playerClubMap, setPlayerClubMap] = useState<Record<string, string>>({})
  const [modalProfile, setModalProfile] = useState<PlayerProfile | null>(null)
  const [modalLoading, setModalLoading] = useState(false)
  const [h2hData, setH2hData] = useState<H2HData | null>(null)
  const [h2hLoading, setH2hLoading] = useState(false)
  const bracketRef = useRef<HTMLDivElement>(null)
  const playerSearchRef = useRef<HTMLInputElement>(null)
  const lastScrollY = useRef(0)
  const pendingJumpRef = useRef<{ tournamentId: string; drawNum: string; roundName: string } | null>(null)
  const autoSelectedTournamentRef = useRef(false)
  const [headerVisible, setHeaderVisible] = useState(true)

  const liveGate = matchGroups.some((g) => g.matches.some((m) => m.nowPlaying))
  const liveByCourt = useLiveScore(selectedTournament || null, liveGate)

  const liveGroups: MatchScheduleGroup[] = matchGroups
    .map((g) => {
      const matches = g.matches.filter((m) => matchLiveCourt(m, liveByCourt) !== null)
      if (g.type === 'time') return { type: 'time' as const, time: g.time, matches }
      return { type: 'court' as const, court: g.court, matches }
    })
    .filter((g) => g.matches.length > 0)
  const liveMatchCount = liveGroups.reduce((n, g) => n + g.matches.length, 0)
  const hasLiveData = liveMatchCount > 0

  useEffect(() => {
    if (viewMode === 'live' && !hasLiveData) setViewMode('matches')
  }, [viewMode, hasLiveData])

  useEffect(() => {
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
    if (!selectedTournament || !isMobile) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [selectedTournament])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      e.preventDefault()
      playerSearchRef.current?.focus()
      playerSearchRef.current?.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'd' && e.key !== 'D') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      e.preventDefault()
      toggleTheme()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleTheme])

  useEffect(() => {
    document.body.classList.toggle('no-highlight', !highlightResults)
    return () => { document.body.classList.remove('no-highlight') }
  }, [highlightResults])

  useEffect(() => {
    const handleScroll = () => {
      const y = window.scrollY
      if (y <= 10) {
        setHeaderVisible(true)
      } else {
        setHeaderVisible(false)
      }
      lastScrollY.current = y
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Load tournament list on mount
  useEffect(() => {
    fetch('/api/tournaments')
      .then((r) => safeJson(r))
      .then((data) => {
        if (!isApiError(data)) setTournaments(data as TournamentInfo[])
      })
      .catch(() => {})
      .finally(() => setLoadingTournaments(false))
  }, [])

  // Load draws + matches when tournament changes
  const handleTournamentChange = useCallback(async (id: string) => {
    setSelectedTournament(id)
    if (typeof window !== 'undefined') {
      if (id) localStorage.setItem('selectedTournament', id)
      else localStorage.removeItem('selectedTournament')
    }
    setSelectedDraw('')
    setDraws([])
    setBracketHtml('')
    setError(null)
    setMatchDays([])
    setMatchGroups([])
    setSelectedDay('')
    setViewMode('matches')
    if (!id) return

    setLoadingDraws(true)
    setLoadingMatches(true)
    setPlayerClubMap({})
    const t = tournaments.find((t) => t.id === id)
    setTournamentName(t?.name ?? id)

    // Background: build player→club map from all brackets (non-blocking)
    fetch(`/api/clubs?tournament=${encodeURIComponent(id)}`)
      .then(r => r.json())
      .then((data: Record<string, string>) => { if (data && !('error' in data)) setPlayerClubMap(data) })
      .catch(() => {})

    const [drawsResult, matchesResult] = await Promise.allSettled([
      fetch(`/api/draws?id=${encodeURIComponent(id)}`).then(safeJson),
      fetch(`/api/matches?tournament=${encodeURIComponent(id)}`).then(safeJson),
    ])

    setLoadingDraws(false)
    setLoadingMatches(false)

    if (drawsResult.status === 'fulfilled') {
      const data = drawsResult.value
      if (isApiError(data)) setError(data.error)
      else setDraws(data as DrawInfo[])
    } else {
      setError('Failed to load draws')
    }

    if (matchesResult.status === 'fulfilled' && !isApiError(matchesResult.value)) {
      const md = matchesResult.value as MatchesData
      setMatchDays(md.days)
      setMatchGroups(md.groups)
      setSelectedDay(md.currentDate || md.days[0]?.date || '')
    }
  }, [tournaments])

  // Restore previously selected tournament from localStorage once the list is known
  useEffect(() => {
    if (autoSelectedTournamentRef.current) return
    if (loadingTournaments || tournaments.length === 0) return
    autoSelectedTournamentRef.current = true
    if (typeof window === 'undefined') return
    const saved = localStorage.getItem('selectedTournament')
    if (saved && tournaments.some((t) => t.id === saved)) {
      handleTournamentChange(saved)
    }
  }, [loadingTournaments, tournaments, handleTournamentChange])

  const fetchBracketFrom = useCallback(async (tournamentId: string, drawNum: string, round: number) => {
    setLoadingBracket(true)
    setError(null)
    const params = new URLSearchParams({ tournament: tournamentId, event: drawNum })
    if (round > 0) params.set('fromRound', String(round))
    try {
      const res = await fetch(`/api/bracket?${params}`)
      const data = await safeJson(res) as BracketData | ApiError
      if (isApiError(data)) throw new Error(data.error)
      setBracketHtml(data.html)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoadingBracket(false)
    }
  }, [])

  // Load bracket when draw changes
  const handleDrawChange = useCallback(async (drawNum: string) => {
    setSelectedDraw(drawNum)
    setBracketHtml('')
    setFromRound(0)
    setFromRoundName('')
    setError(null)
    if (!drawNum || !selectedTournament) return
    const d = draws.find((d) => d.drawNum === drawNum)
    setDrawName(d?.name ?? drawNum)
    await fetchBracketFrom(selectedTournament, drawNum, 0)
  }, [selectedTournament, draws, fetchBracketFrom])

  const handleRoundClick = useCallback(async (roundIndex: number) => {
    if (!selectedTournament || !selectedDraw) return
    const newFrom = roundIndex === fromRound && fromRound > 0 ? 0 : roundIndex
    const label = bracketRef.current?.querySelector(`[data-round-index="${roundIndex}"]`)
    const roundName = label?.textContent ?? ''
    setFromRound(newFrom)
    setFromRoundName(newFrom > 0 ? roundName : '')
    await fetchBracketFrom(selectedTournament, selectedDraw, newFrom)
  }, [selectedTournament, selectedDraw, fromRound, fetchBracketFrom])

  // After bracketHtml updates, jump to the pending round if one was requested
  useEffect(() => {
    const jump = pendingJumpRef.current
    if (!jump || !bracketHtml) return
    pendingJumpRef.current = null
    const labels = bracketRef.current?.querySelectorAll<HTMLElement>('.bk-round-label')
    if (!labels) return
    for (const label of Array.from(labels)) {
      if (label.textContent?.trim() === jump.roundName) {
        const idx = parseInt(label.getAttribute('data-round-index') ?? '-1', 10)
        if (idx > 0) {
          setFromRound(idx)
          setFromRoundName(jump.roundName)
          fetchBracketFrom(jump.tournamentId, jump.drawNum, idx)
        }
        return
      }
    }
  }, [bracketHtml, fetchBracketFrom])

  const handleOpenBracketAtRound = useCallback(async (drawNum: string, roundName: string) => {
    setViewMode('bracket')
    pendingJumpRef.current = { tournamentId: selectedTournament, drawNum, roundName }
    setSelectedDraw(drawNum)
    const d = draws.find((d) => d.drawNum === drawNum)
    setDrawName(d?.name ?? drawNum)
    setBracketHtml('')
    setFromRound(0)
    setFromRoundName('')
    setError(null)
    await fetchBracketFrom(selectedTournament, drawNum, 0)
  }, [selectedTournament, draws, fetchBracketFrom])

  const handlePlayerClick = useCallback(async (playerId: string) => {
    if (!selectedTournament) return
    setModalProfile(null)
    setModalLoading(true)
    try {
      const res = await fetch(`/api/player?tournament=${encodeURIComponent(selectedTournament)}&player=${encodeURIComponent(playerId)}`)
      const data = await safeJson(res) as PlayerProfile | ApiError
      if (!isApiError(data)) setModalProfile(data)
    } catch {}
    finally { setModalLoading(false) }
  }, [selectedTournament])

  const handleModalClose = useCallback(() => {
    setModalProfile(null)
    setModalLoading(false)
  }, [])

  const handleH2HClick = useCallback(async (h2hUrl: string) => {
    setH2hData(null)
    setH2hLoading(true)
    try {
      const res = await fetch(`/api/h2h?path=${encodeURIComponent(h2hUrl)}`)
      const data = await safeJson(res) as H2HData | ApiError
      if (!isApiError(data)) setH2hData(data)
    } catch {}
    finally { setH2hLoading(false) }
  }, [])

  const handleH2HClose = useCallback(() => {
    setH2hData(null)
    setH2hLoading(false)
  }, [])

  const handleDayChange = useCallback(async (date: string) => {
    if (!selectedTournament) return
    setSelectedDay(date)
    setLoadingMatches(true)
    try {
      const res = await fetch(`/api/matches?tournament=${encodeURIComponent(selectedTournament)}&date=${date}`)
      const data = await safeJson(res)
      if (!isApiError(data)) {
        const md = data as Pick<MatchesData, 'groups'>
        setMatchGroups(md.groups)
        setMatchDays(prev => prev.map(d =>
          d.date === date ? { ...d, hasMatches: md.groups.length > 0 } : d
        ))
      }
    } catch {}
    finally { setLoadingMatches(false) }
  }, [selectedTournament])

  const handleExport = useCallback(() => {
    if (!bracketRef.current) return
    exportBracketAsJpg({
      bracketEl: bracketRef.current,
      tournamentName,
      eventName: drawName,
    })
  }, [tournamentName, drawName])

  const loading = loadingBracket || loadingDraws

  return (
    <>
      {/* Top bar */}
      <div
        className="sticky top-0 z-50 bg-[var(--surface)] border-b border-[var(--border)] shadow-sm transition-transform duration-300"
        style={{ transform: headerVisible ? 'translateY(0)' : 'translateY(-100%)' }}
      >
        <div className="flex items-end gap-3 px-5 py-2.5 flex-wrap">
          <div className="flex flex-col whitespace-nowrap mr-2">
            <span className="font-bold text-[var(--fg)]" style={{fontSize:'1.2rem',lineHeight:'2rem'}}>
              <span style={{color:'var(--brand-fg)'}}>{t('appTitle1')}</span> <span style={{color:'var(--red)'}}>{t('appTitle2')}</span> {t('appTitle3')}
            </span>
            <span className="text-[12px] text-[var(--muted)]">{t('appSubtitle')}</span>
          </div>

          {/* Tournament selector */}
          <div className="flex flex-col gap-1">
            <label className={`${lang === 'th' ? 'text-[12px]' : 'text-[10px]'} font-semibold text-[var(--muted)] uppercase tracking-wide`}>
              {t('tournament')}
            </label>
            <select
              value={selectedTournament}
              onChange={(e) => handleTournamentChange(e.target.value)}
              disabled={loadingTournaments}
              className="border border-[var(--border)] rounded-md px-2.5 py-1.5 text-xs min-w-[220px] bg-[var(--surface)] text-[var(--fg)] focus:outline-none focus:border-[var(--brand)] disabled:opacity-50"
            >
              <option value="">
                {loadingTournaments ? t('loading') : t('selectTournament')}
              </option>
              {tournaments.filter((tn) => !tn.done).map((tn) => (
                <option key={tn.id} value={tn.id}>{tn.name}</option>
              ))}
              {tournaments.some((tn) => tn.done) && tournaments.some((tn) => !tn.done) && (
                <option disabled>───────── Past Events ─────────</option>
              )}
              {tournaments.filter((tn) => tn.done).map((tn) => (
                <option key={tn.id} value={tn.id}>{tn.name}</option>
              ))}
            </select>
          </div>

          {/* Draw selector — only relevant in bracket view */}
          {viewMode === 'bracket' && (
            <div className="flex flex-col gap-1">
              <label className={`${lang === 'th' ? 'text-[12px]' : 'text-[10px]'} font-semibold text-[var(--muted)] uppercase tracking-wide`}>
                {t('draw')}
              </label>
              <select
                value={selectedDraw}
                onChange={(e) => handleDrawChange(e.target.value)}
                disabled={!selectedTournament || loadingDraws || draws.length === 0}
                className="border border-[var(--border)] rounded-md px-2.5 py-1.5 text-xs min-w-[160px] bg-[var(--surface)] text-[var(--fg)] focus:outline-none focus:border-[var(--brand)] disabled:opacity-50"
              >
                <option value="">
                  {loadingDraws ? t('loading') : draws.length === 0 && selectedTournament ? t('noDraws') : t('selectDraw')}
                </option>
                {draws.map((d) => (
                  <option key={d.drawNum} value={d.drawNum}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Player search */}
          <div className="flex flex-col gap-1">
            <label className={`${lang === 'th' ? 'text-[12px]' : 'text-[10px]'} font-semibold text-[var(--muted)] uppercase tracking-wide`}>
              {t('trackLabel')}
            </label>
            <div className="flex items-center gap-2">
              <div className="relative min-w-[240px]">
                <input
                  ref={playerSearchRef}
                  type="text"
                  placeholder={t('searchPlaceholder')}
                  value={playerQuery}
                  onChange={(e) => setPlayerQuery(e.target.value)}
                  className="w-full border border-[var(--border)] rounded-md pl-2.5 pr-7 py-1.5 text-xs bg-[var(--surface)] text-[var(--fg)] focus:outline-none focus:border-[var(--brand)]"
                />
                {playerQuery && (
                  <button
                    type="button"
                    onClick={() => setPlayerQuery('')}
                    aria-label={t('clearSearch')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-full text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--border)] text-[11px] leading-none"
                  >✕</button>
                )}
              </div>
              <label className="flex items-center gap-1 text-xs text-[var(--fg)] whitespace-nowrap cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={highlightResults}
                  onChange={(e) => setHighlightResults(e.target.checked)}
                  className="accent-yellow-400"
                />
                {t('highlight')}
              </label>
            </div>
          </div>

          {/* Right-side controls: export (bracket only) + language toggle */}
          <div className="ml-auto flex items-center gap-2">
            {viewMode === 'bracket' && (
              <button
                onClick={handleExport}
                disabled={!bracketHtml || loading}
                className="bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white rounded-md px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors"
              >
                {t('exportJpg')}
              </button>
            )}
            <button
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? t('lightMode') : t('darkMode')}
              title={theme === 'dark' ? t('lightMode') : t('darkMode')}
              className="inline-flex items-center justify-center w-[30px] h-[28px] rounded-md border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--bg)] text-[var(--fg)] text-sm"
              suppressHydrationWarning
            >
              {theme === 'dark' ? '☀' : '🌙'}
            </button>
            <button
              onClick={toggleLang}
              aria-label="Toggle language"
              title={lang === 'en' ? 'เปลี่ยนเป็นภาษาไทย' : 'Switch to English'}
              className="inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--bg)] text-[var(--fg)] text-xs font-semibold overflow-hidden"
            >
              <span className={`px-2 py-1 ${lang === 'en' ? 'bg-[var(--brand)] text-white' : ''}`}>EN</span>
              <span className={`px-2 py-1 ${lang === 'th' ? 'bg-[var(--brand)] text-white' : ''}`}>TH</span>
            </button>
          </div>
        </div>
      </div>

      {/* View mode tabs */}
      {selectedTournament && (
        <div className="flex items-center gap-0 px-5 py-0 bg-[var(--surface)] border-b border-[var(--border)]">
          <button
            onClick={() => setViewMode('bracket')}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
              viewMode === 'bracket'
                ? 'border-[var(--brand)] text-[var(--brand-fg)]'
                : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
            }`}
          >
            {t('bracket')}
          </button>
          <button
            onClick={() => setViewMode('matches')}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
              viewMode === 'matches'
                ? 'border-[var(--brand)] text-[var(--brand-fg)]'
                : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
            }`}
          >
            {t('matchSchedule')}
            {loadingMatches && <span className="ml-1 opacity-50">…</span>}
          </button>
          {hasLiveData && (
            <button
              onClick={() => setViewMode('live')}
              className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors inline-flex items-center gap-1.5 ${
                viewMode === 'live'
                  ? 'border-[var(--brand)] text-[var(--brand-fg)]'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
              }`}
            >
              <span className="ms-live-badge">{t('live')}</span>
              {t('liveMatches')}
              <span className="opacity-70">({liveMatchCount})</span>
            </button>
          )}
        </div>
      )}

      {/* Legend (bracket view only) */}
      {viewMode === 'bracket' && (
        <div className="flex gap-4 px-5 py-2 bg-[var(--surface)] border-b border-[var(--row-sep)] text-xs text-[var(--muted)]">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-green-100 border border-green-300" />
            {t('winner')}
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-gray-50 border border-gray-300" />
            {t('notPlayed')}
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-yellow-100 border border-yellow-400" />
            {t('trackedPlayer')}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="m-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Bracket view */}
      {viewMode === 'bracket' && (
        <>
          {!bracketHtml && !loading && !error && (
            <div className="p-10 text-center text-[var(--muted)] text-sm">
              {!selectedTournament
                ? t('startPrompt')
                : !selectedDraw
                ? t('selectDrawPrompt')
                : t('loading')}
            </div>
          )}

          {loadingBracket && (
            <div className="p-10 text-center text-[var(--muted)] text-sm">{t('loadingBracket')}</div>
          )}

          {fromRound > 0 && bracketHtml && (
            <div className="flex items-center gap-2 px-5 py-1.5 bg-[var(--info-bg)] border-b border-[var(--border)] text-xs text-[var(--info-fg)]">
              <span>{t('viewingFrom')} <strong>{fromRoundName}</strong></span>
              <button
                onClick={() => handleRoundClick(0)}
                className="ml-1 underline hover:no-underline"
              >
                {t('showAllRounds')}
              </button>
            </div>
          )}

          {bracketHtml && !loadingBracket && (
            <BracketCanvas
              bracketHtml={bracketHtml}
              playerQuery={playerQuery}
              bracketRef={bracketRef}
              onRoundClick={handleRoundClick}
              onPlayerClick={handlePlayerClick}
              playerClubMap={playerClubMap}
            />
          )}
        </>
      )}

      {/* Matches view */}
      {viewMode === 'matches' && (
        <MatchSchedule
          groups={matchGroups}
          days={matchDays}
          selectedDay={selectedDay}
          onDayChange={handleDayChange}
          loading={loadingMatches}
          playerQuery={playerQuery}
          onEventClick={handleOpenBracketAtRound}
          playerClubMap={playerClubMap}
          onPlayerClick={handlePlayerClick}
          onH2HClick={handleH2HClick}
          liveByCourt={liveByCourt}
        />
      )}

      {/* Live matches view */}
      {viewMode === 'live' && (
        <MatchSchedule
          groups={liveGroups}
          days={[]}
          selectedDay={selectedDay}
          onDayChange={handleDayChange}
          loading={loadingMatches}
          playerQuery={playerQuery}
          onEventClick={handleOpenBracketAtRound}
          playerClubMap={playerClubMap}
          onPlayerClick={handlePlayerClick}
          onH2HClick={handleH2HClick}
          liveByCourt={liveByCourt}
        />
      )}

      {/* Player profile modal */}
      {(modalLoading || modalProfile) && (
        <PlayerModal
          profile={modalProfile}
          loading={modalLoading}
          onClose={handleModalClose}
          onH2HClick={handleH2HClick}
          onPlayerClick={handlePlayerClick}
        />
      )}

      {/* H2H modal */}
      {(h2hLoading || h2hData) && (
        <H2HModal
          data={h2hData}
          loading={h2hLoading}
          onClose={handleH2HClose}
        />
      )}
    </>
  )
}
