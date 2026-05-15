'use client'
import { useState, useRef, useEffect } from 'react'
import GroupCard from './GroupCard'
import BracketCanvas from './BracketCanvas'
import { usePlayerHighlight } from '@/lib/usePlayerHighlight'
import type { EventBundle } from '@/lib/types'

export function computeQualifierCount(playoffSize: number, groupCount: number): number {
  if (groupCount === 0) return 1
  return Math.max(1, Math.ceil(playoffSize / groupCount))
}

interface Props {
  bundle: EventBundle
  playerQuery: string
  playerClubMap?: Record<string, string>
  initialTab?: 'groups' | 'playoff'
  tournamentId?: string
  onPlayerClick?: (playerId: string) => void
  onTabChange?: (tab: 'groups' | 'playoff') => void
  onGroupExpand?: (groupLetter: string) => void
  onRoundClick?: (roundIndex: number) => void
  bracketRef?: React.RefObject<HTMLDivElement>
}

export default function EventBundleView({
  bundle, playerQuery, playerClubMap,
  initialTab = 'groups', tournamentId, onPlayerClick, onTabChange, onGroupExpand,
  onRoundClick, bracketRef,
}: Props) {
  const [tab, setTab] = useState<'groups' | 'playoff'>(initialTab)
  const groupsRef = useRef<HTMLDivElement>(null)
  const fallbackBracketRef = useRef<HTMLDivElement>(null)

  // Approximate playoff size as the number of groups (one qualifier each).
  // computeQualifierCount stays generic so larger playoffs (top-2 advance
  // formats) get the right indicator if/when they appear.
  const playoffSize = bundle.groups.length
  const qualifierCount = computeQualifierCount(playoffSize, bundle.groups.length)

  usePlayerHighlight(groupsRef, playerQuery, playerClubMap, bundle.eventName + ':' + tab)

  useEffect(() => {
    onTabChange?.(tab)
  }, [tab, onTabChange])

  return (
    <div>
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 mb-4">
        <button
          type="button"
          className={`px-4 py-2 -mb-px border-b-2 ${tab === 'groups' ? 'border-blue-500 text-blue-600 dark:text-blue-400 font-semibold' : 'border-transparent text-gray-500'}`}
          onClick={() => setTab('groups')}
        >Groups</button>
        <button
          type="button"
          className={`px-4 py-2 -mb-px border-b-2 ${tab === 'playoff' ? 'border-blue-500 text-blue-600 dark:text-blue-400 font-semibold' : 'border-transparent text-gray-500'}`}
          onClick={() => setTab('playoff')}
        >Playoff</button>
      </div>

      {tab === 'groups' && (
        <div ref={groupsRef} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {bundle.groups.map((g) => (
            <GroupCard
              key={g.drawNum}
              group={g}
              qualifierCount={qualifierCount}
              tournamentId={tournamentId}
              onPlayerClick={onPlayerClick}
              onExpand={onGroupExpand}
            />
          ))}
        </div>
      )}
      {tab === 'playoff' && (
        <BracketCanvas
          bracketHtml={bundle.playoff.html}
          playerQuery={playerQuery}
          playerClubMap={playerClubMap}
          bracketRef={bracketRef ?? fallbackBracketRef}
          onRoundClick={onRoundClick}
          onPlayerClick={onPlayerClick}
        />
      )}
    </div>
  )
}
