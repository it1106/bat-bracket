'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import BracketCanvas from '@/components/BracketCanvas'
import { exportBracketAsJpg } from '@/components/ExportButton'
import type { BracketData, ApiError, TournamentInfo, DrawInfo } from '@/lib/types'

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
  const [error, setError] = useState<string | null>(null)
  const [tournamentName, setTournamentName] = useState('')
  const [drawName, setDrawName] = useState('')
  const bracketRef = useRef<HTMLDivElement>(null)
  const lastScrollY = useRef(0)
  const [headerVisible, setHeaderVisible] = useState(true)

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

  // Load draws when tournament changes
  const handleTournamentChange = useCallback(async (id: string) => {
    setSelectedTournament(id)
    setSelectedDraw('')
    setDraws([])
    setBracketHtml('')
    setError(null)
    if (!id) return
    setLoadingDraws(true)
    try {
      const res = await fetch(`/api/draws?id=${encodeURIComponent(id)}`)
      const data = await safeJson(res)
      if (isApiError(data)) throw new Error(data.error)
      setDraws(data as DrawInfo[])
      const t = tournaments.find((t) => t.id === id)
      setTournamentName(t?.name ?? id)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load draws')
    } finally {
      setLoadingDraws(false)
    }
  }, [tournaments])

  // Load bracket when draw changes
  const handleDrawChange = useCallback(async (drawNum: string) => {
    setSelectedDraw(drawNum)
    setBracketHtml('')
    setError(null)
    if (!drawNum || !selectedTournament) return
    setLoadingBracket(true)
    const url = `https://bat.tournamentsoftware.com/tournament/${selectedTournament}/draw/${drawNum}`
    try {
      const res = await fetch(`/api/bracket?url=${encodeURIComponent(url)}`)
      const data = await safeJson(res) as BracketData | ApiError
      if (isApiError(data)) throw new Error(data.error)
      setBracketHtml(data.html)
      const d = draws.find((d) => d.drawNum === drawNum)
      setDrawName(d?.name ?? drawNum)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoadingBracket(false)
    }
  }, [selectedTournament, draws])

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
              <span style={{color:'#25316B'}}>BAT</span> <span style={{color:'#BE1D2E'}}>Unofficial</span> Brackets
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

          {/* Draw selector */}
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

          {/* Player search */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
              Track Player
            </label>
            <input
              type="text"
              placeholder="Search player…"
              value={playerQuery}
              onChange={(e) => setPlayerQuery(e.target.value)}
              className="border border-gray-300 rounded-md px-2.5 py-1.5 text-xs min-w-[180px] bg-white focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Export */}
          <button
            onClick={handleExport}
            disabled={!bracketHtml || loading}
            className="ml-auto bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white rounded-md px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors"
          >
            ↓ Export JPG
          </button>
        </div>
      </div>

      {/* Legend */}
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

      {/* States */}
      {error && (
        <div className="m-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

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

      {bracketHtml && !loadingBracket && (
        <BracketCanvas
          bracketHtml={bracketHtml}
          playerQuery={playerQuery}
          bracketRef={bracketRef}
        />
      )}
    </>
  )
}
