'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import TopBar from '@/components/TopBar'
import BracketCanvas from '@/components/BracketCanvas'
import { exportBracketAsJpg } from '@/components/ExportButton'
import type { Tournament, TournamentEvent, BracketData, ApiError } from '@/lib/types'

function isApiError(data: unknown): data is ApiError {
  return typeof data === 'object' && data !== null && 'error' in data
}

export default function Home() {
  const [tournaments, setTournaments] = useState<Tournament[]>([])
  const [events, setEvents] = useState<TournamentEvent[]>([])
  const [bracketHtml, setBracketHtml] = useState('')
  const [selectedTournament, setSelectedTournament] = useState('')
  const [selectedEvent, setSelectedEvent] = useState('')
  const [playerQuery, setPlayerQuery] = useState('')
  const [loadingTournaments, setLoadingTournaments] = useState(true)
  const [loadingEvents, setLoadingEvents] = useState(false)
  const [loadingBracket, setLoadingBracket] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bracketRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/tournaments')
      .then((r) => r.json())
      .then((data) => {
        if (isApiError(data)) throw new Error(data.error)
        setTournaments(data)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingTournaments(false))
  }, [])

  const handleTournamentChange = useCallback((id: string) => {
    setSelectedTournament(id)
    setSelectedEvent('')
    setBracketHtml('')
    setEvents([])
    setError(null)
    if (!id) return

    setLoadingEvents(true)
    fetch(`/api/events?tournament=${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (isApiError(data)) throw new Error(data.error)
        setEvents(data)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingEvents(false))
  }, [])

  const handleEventChange = useCallback(
    (eventId: string) => {
      setSelectedEvent(eventId)
      setBracketHtml('')
      setError(null)
      if (!eventId) return

      setLoadingBracket(true)
      fetch(`/api/bracket?tournament=${selectedTournament}&event=${eventId}`)
        .then((r) => r.json())
        .then((data: BracketData | ApiError) => {
          if (isApiError(data)) throw new Error(data.error)
          setBracketHtml(data.html)
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoadingBracket(false))
    },
    [selectedTournament]
  )

  const handleExport = useCallback(() => {
    if (!bracketRef.current) return
    const tournament = tournaments.find((t) => t.id === selectedTournament)
    const event = events.find((e) => e.id === selectedEvent)
    exportBracketAsJpg({
      bracketEl: bracketRef.current,
      tournamentName: tournament?.name ?? 'Tournament',
      eventName: event?.name ?? 'Event',
    })
  }, [tournaments, events, selectedTournament, selectedEvent])

  return (
    <>
      <TopBar
        tournaments={tournaments}
        events={events}
        selectedTournament={selectedTournament}
        selectedEvent={selectedEvent}
        playerQuery={playerQuery}
        loadingEvents={loadingEvents}
        loadingBracket={loadingBracket}
        onTournamentChange={handleTournamentChange}
        onEventChange={handleEventChange}
        onPlayerQueryChange={setPlayerQuery}
        onExport={handleExport}
      />

      <div className="flex gap-4 px-5 py-2 bg-white border-b border-gray-100 text-xs text-gray-500">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-green-100 border border-green-300" />
          Winner
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-gray-50 border border-gray-300" />
          Bye / Not played
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-yellow-100 border border-yellow-400" />
          Tracked player
        </div>
      </div>

      {loadingTournaments && (
        <div className="p-10 text-center text-gray-400 text-sm">Loading tournaments…</div>
      )}
      {loadingBracket && (
        <div className="p-10 text-center text-gray-400 text-sm">Loading bracket…</div>
      )}
      {error && (
        <div className="m-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}
      {!selectedTournament && !loadingTournaments && !error && (
        <div className="p-10 text-center text-gray-400 text-sm">
          Select a tournament and event to view the bracket.
        </div>
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
