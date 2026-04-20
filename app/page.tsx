'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import BracketCanvas from '@/components/BracketCanvas'
import MatchSchedule from '@/components/MatchSchedule'
import PlayerModal from '@/components/PlayerModal'
import { exportBracketAsJpg } from '@/components/ExportButton'
import type { BracketData, ApiError, TournamentInfo, DrawInfo, MatchDay, MatchTimeGroup, MatchesData, PlayerProfile } from '@/lib/types'

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

type ViewMode = 'bracket' | 'matches'

export default function Home() {
  const [tournaments, setTournaments] = useState<TournamentInfo[]>([])
  const [draws, setDraws] = useState<DrawInfo[]>([])
  const [selectedTournament, setSelectedTournament] = useState('')
  const [selectedDraw, setSelectedDraw] = useState('')
  const [bracketHtml, setBracketHtml] = useState('')
  const [playerQuery, setPlayerQuery] = useState('')
  const [loadingTournaments, setLoadingTournaments] = useState(true)
  const [loadingDraws, setLoadingDraws] = useState(false)
  const [loadingBracket, setLoadingBracket] = useState(false)
  const [loadingMatches, setLoadingMatches] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tournamentName, setTournamentName] = useState('')
  const [drawName, setDrawName] = useState('')
  const [fromRound, setFromRound] = useState(0)
  const [fromRoundName, setFromRoundName] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('bracket')
  const [matchDays, setMatchDays] = useState<MatchDay[]>([])
  const [selectedDay, setSelectedDay] = useState('')
  const [matchTimeGroups, setMatchTimeGroups] = useState<MatchTimeGroup[]>([])
  const [playerClubMap, setPlayerClubMap] = useState<Record<string, string>>({})
  const [modalProfile, setModalProfile] = useState<PlayerProfile | null>(null)
  const [modalLoading, setModalLoading] = useState(false)
  const bracketRef = useRef<HTMLDivElement>(null)
  const lastScrollY = useRef(0)
  const pendingJumpRef = useRef<{ tournamentId: string; drawNum: string; roundName: string } | null>(null)
  const [headerVisible, setHeaderVisible] = useState(true)

  useEffect(() => {
    if (!selectedTournament) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [selectedTournament])

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
    setSelectedDraw('')
    setDraws([])
    setBracketHtml('')
    setError(null)
    setMatchDays([])
    setMatchTimeGroups([])
    setSelectedDay('')
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
      setMatchTimeGroups(md.timeGroups)
      setSelectedDay(md.currentDate || md.days[0]?.date || '')
    }
  }, [tournaments])

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

  const handleDayChange = useCallback(async (date: string) => {
    if (!selectedTournament) return
    setSelectedDay(date)
    setLoadingMatches(true)
    try {
      const res = await fetch(`/api/matches?tournament=${encodeURIComponent(selectedTournament)}&date=${date}`)
      const data = await safeJson(res)
      if (!isApiError(data)) {
        const md = data as Pick<MatchesData, 'timeGroups'>
        setMatchTimeGroups(md.timeGroups)
        // Update hasMatches for this day based on actual result
        setMatchDays(prev => prev.map(d =>
          d.date === date ? { ...d, hasMatches: md.timeGroups.length > 0 } : d
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
        className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm transition-transform duration-300"
        style={{ transform: headerVisible ? 'translateY(0)' : 'translateY(-100%)' }}
      >
        <div className="flex items-end gap-3 px-5 py-2.5 flex-wrap">
          <div className="flex flex-col whitespace-nowrap mr-2">
            <span className="font-bold text-gray-900" style={{fontSize:'1.2rem',lineHeight:'2rem'}}>
              <span style={{color:'#25316B'}}>BAT</span> <span style={{color:'#BE1D2E'}}>Unofficial</span> Scores
            </span>
            <span className="text-[12px] text-gray-400">Check BAT official website for accuracy</span>
          </div>

          {/* Tournament selector */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
              Tournament
            </label>
            <select
              value={selectedTournament}
              onChange={(e) => handleTournamentChange(e.target.value)}
              disabled={loadingTournaments}
              className="border border-gray-300 rounded-md px-2.5 py-1.5 text-xs min-w-[220px] bg-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
            >
              <option value="">
                {loadingTournaments ? 'Loading…' : '— Select tournament —'}
              </option>
              {tournaments.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* Draw selector — only relevant in bracket view */}
          {viewMode === 'bracket' && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                Draw
              </label>
              <select
                value={selectedDraw}
                onChange={(e) => handleDrawChange(e.target.value)}
                disabled={!selectedTournament || loadingDraws || draws.length === 0}
                className="border border-gray-300 rounded-md px-2.5 py-1.5 text-xs min-w-[160px] bg-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
              >
                <option value="">
                  {loadingDraws ? 'Loading…' : draws.length === 0 && selectedTournament ? 'No draws' : '— Select draw —'}
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
            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
              Track Player / Club / Event
            </label>
            <input
              type="text"
              placeholder="Search player or event…"
              value={playerQuery}
              onChange={(e) => setPlayerQuery(e.target.value)}
              className="border border-gray-300 rounded-md px-2.5 py-1.5 text-xs min-w-[180px] bg-white focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Export — bracket view only */}
          {viewMode === 'bracket' && (
            <button
              onClick={handleExport}
              disabled={!bracketHtml || loading}
              className="ml-auto bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white rounded-md px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors"
            >
              ↓ Export JPG
            </button>
          )}
        </div>
      </div>

      {/* View mode tabs */}
      {selectedTournament && (
        <div className="flex items-center gap-0 px-5 py-0 bg-white border-b border-gray-200">
          <button
            onClick={() => setViewMode('bracket')}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
              viewMode === 'bracket'
                ? 'border-[#25316B] text-[#25316B]'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Bracket
          </button>
          <button
            onClick={() => setViewMode('matches')}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
              viewMode === 'matches'
                ? 'border-[#25316B] text-[#25316B]'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Match Schedule
            {loadingMatches && <span className="ml-1 opacity-50">…</span>}
          </button>
        </div>
      )}

      {/* Legend (bracket view only) */}
      {viewMode === 'bracket' && (
        <div className="flex gap-4 px-5 py-2 bg-white border-b border-gray-100 text-xs text-gray-500">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-green-100 border border-green-300" />
            Winner
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-gray-50 border border-gray-300" />
            Not played
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-yellow-100 border border-yellow-400" />
            Tracked player
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
            <div className="p-10 text-center text-gray-400 text-sm">
              {!selectedTournament
                ? 'Select a tournament above to get started.'
                : !selectedDraw
                ? 'Select a draw to view the bracket.'
                : 'Loading…'}
            </div>
          )}

          {loadingBracket && (
            <div className="p-10 text-center text-gray-400 text-sm">Loading bracket…</div>
          )}

          {fromRound > 0 && bracketHtml && (
            <div className="flex items-center gap-2 px-5 py-1.5 bg-blue-50 border-b border-blue-200 text-xs text-blue-700">
              <span>Viewing from <strong>{fromRoundName}</strong></span>
              <button
                onClick={() => handleRoundClick(0)}
                className="ml-1 underline hover:no-underline"
              >
                ↩ Show all rounds
              </button>
            </div>
          )}

          {bracketHtml && !loadingBracket && (
            <BracketCanvas
              bracketHtml={bracketHtml}
              playerQuery={playerQuery}
              bracketRef={bracketRef}
              onRoundClick={handleRoundClick}
            />
          )}
        </>
      )}

      {/* Matches view */}
      {viewMode === 'matches' && (
        <MatchSchedule
          timeGroups={matchTimeGroups}
          days={matchDays}
          selectedDay={selectedDay}
          onDayChange={handleDayChange}
          loading={loadingMatches}
          playerQuery={playerQuery}
          onEventClick={handleOpenBracketAtRound}
          playerClubMap={playerClubMap}
          onPlayerClick={handlePlayerClick}
        />
      )}

      {/* Player profile modal (fixed, rendered outside view blocks) */}
      {(modalLoading || modalProfile) && (
        <PlayerModal
          profile={modalProfile}
          loading={modalLoading}
          onClose={handleModalClose}
        />
      )}
    </>
  )
}
