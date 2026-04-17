'use client'

import { useState, useRef, useCallback } from 'react'
import BracketCanvas from '@/components/BracketCanvas'
import { exportBracketAsJpg } from '@/components/ExportButton'
import type { BracketData, ApiError } from '@/lib/types'

function isApiError(data: unknown): data is ApiError {
  return typeof data === 'object' && data !== null && 'error' in data
}

function extractLabel(url: string): { tournament: string; event: string } {
  // Try to extract readable names from the URL; fall back to the URL segments
  const parts = url.split('/')
  const tIdx = parts.indexOf('tournament')
  const dIdx = parts.indexOf('draw')
  return {
    tournament: tIdx !== -1 ? parts[tIdx + 1] : 'Tournament',
    event: dIdx !== -1 ? parts[dIdx + 1] : 'Event',
  }
}

export default function Home() {
  const [inputUrl, setInputUrl] = useState('')
  const [bracketHtml, setBracketHtml] = useState('')
  const [label, setLabel] = useState({ tournament: '', event: '' })
  const [playerQuery, setPlayerQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bracketRef = useRef<HTMLDivElement>(null)

  const loadBracket = useCallback(async (url: string) => {
    const trimmed = url.trim()
    if (!trimmed) return
    setError(null)
    setBracketHtml('')
    setLoading(true)
    try {
      const res = await fetch(`/api/bracket?url=${encodeURIComponent(trimmed)}`)
      const data: BracketData | ApiError = await res.json()
      if (isApiError(data)) throw new Error(data.error)
      setBracketHtml(data.html)
      setLabel(extractLabel(trimmed))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') loadBracket(inputUrl)
  }

  const handleExport = useCallback(() => {
    if (!bracketRef.current) return
    exportBracketAsJpg({
      bracketEl: bracketRef.current,
      tournamentName: label.tournament,
      eventName: label.event,
    })
  }, [label])

  return (
    <>
      {/* Top bar */}
      <div className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
        <div className="flex items-end gap-3 px-5 py-2.5 flex-wrap">
          <span className="font-bold text-base text-gray-900 whitespace-nowrap mr-2">
            BAT <span className="text-blue-600">Brackets</span>
          </span>

          <div className="flex flex-col gap-1 flex-1 min-w-[320px]">
            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
              Draw URL
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                placeholder="https://bat.tournamentsoftware.com/tournament/…/draw/…"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                onKeyDown={handleKeyDown}
                className="border border-gray-300 rounded-md px-2.5 py-1.5 text-xs flex-1 bg-white focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={() => loadBracket(inputUrl)}
                disabled={loading || !inputUrl.trim()}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-md px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors"
              >
                {loading ? 'Loading…' : 'Load →'}
              </button>
            </div>
          </div>

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
          Bye / Not played
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
        <div className="p-10 text-center text-gray-400 text-sm max-w-lg mx-auto">
          <p className="mb-2 font-medium text-gray-500">How to load a bracket:</p>
          <ol className="text-left list-decimal list-inside space-y-1">
            <li>Go to <a href="https://bat.tournamentsoftware.com" target="_blank" rel="noreferrer" className="text-blue-500 underline">bat.tournamentsoftware.com</a></li>

            <li>Open a tournament and click on a draw (e.g. Men&apos;s Singles)</li>
            <li>Copy the URL from your browser</li>
            <li>Paste it above and press <strong>Load →</strong></li>
          </ol>
          <p className="mt-3 text-xs text-gray-400">
            URL looks like: .../tournament/XXXX/draw/YYYY
          </p>
        </div>
      )}

      {loading && (
        <div className="p-10 text-center text-gray-400 text-sm">Loading bracket…</div>
      )}

      {bracketHtml && !loading && (
        <BracketCanvas
          bracketHtml={bracketHtml}
          playerQuery={playerQuery}
          bracketRef={bracketRef}
        />
      )}
    </>
  )
}
