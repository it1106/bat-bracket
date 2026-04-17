'use client'

import type { Tournament, TournamentEvent } from '@/lib/types'

interface TopBarProps {
  tournaments: Tournament[]
  events: TournamentEvent[]
  selectedTournament: string
  selectedEvent: string
  playerQuery: string
  loadingEvents: boolean
  loadingBracket: boolean
  onTournamentChange: (id: string) => void
  onEventChange: (id: string) => void
  onPlayerQueryChange: (q: string) => void
  onExport: () => void
}

export default function TopBar({
  tournaments,
  events,
  selectedTournament,
  selectedEvent,
  playerQuery,
  loadingEvents,
  loadingBracket,
  onTournamentChange,
  onEventChange,
  onPlayerQueryChange,
  onExport,
}: TopBarProps) {
  return (
    <div className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
      <div className="flex items-end gap-3 px-5 py-2.5 flex-wrap">
        <span className="font-bold text-base text-gray-900 whitespace-nowrap mr-2">
          BAT <span className="text-blue-600">Brackets</span>
        </span>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
            Tournament
          </label>
          <select
            value={selectedTournament}
            onChange={(e) => onTournamentChange(e.target.value)}
            className="border border-gray-300 rounded-md px-2.5 py-1.5 text-xs min-w-[200px] bg-white focus:outline-none focus:border-blue-500"
          >
            <option value="">Select tournament…</option>
            {tournaments.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
            Event
          </label>
          <select
            value={selectedEvent}
            onChange={(e) => onEventChange(e.target.value)}
            disabled={!selectedTournament || loadingEvents}
            className="border border-gray-300 rounded-md px-2.5 py-1.5 text-xs min-w-[180px] bg-white focus:outline-none focus:border-blue-500 disabled:opacity-40"
          >
            <option value="">
              {loadingEvents ? 'Loading…' : 'Select event…'}
            </option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
            Track Player
          </label>
          <input
            type="text"
            placeholder="Search player…"
            value={playerQuery}
            onChange={(e) => onPlayerQueryChange(e.target.value)}
            className="border border-gray-300 rounded-md px-2.5 py-1.5 text-xs min-w-[180px] bg-white focus:outline-none focus:border-blue-500"
          />
        </div>

        <button
          onClick={onExport}
          disabled={!selectedEvent || loadingBracket}
          className="ml-auto bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white rounded-md px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors"
        >
          ↓ Export JPG
        </button>
      </div>
    </div>
  )
}
