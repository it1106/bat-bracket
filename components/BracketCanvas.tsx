'use client'

import { useEffect, useRef } from 'react'

interface BracketCanvasProps {
  bracketHtml: string
  playerQuery: string
  bracketRef: React.RefObject<HTMLDivElement>
}

export default function BracketCanvas({
  bracketHtml,
  playerQuery,
  bracketRef,
}: BracketCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const query = playerQuery.trim().toLowerCase()

    // New format: .match__row with player links
    const playerLinks = containerRef.current.querySelectorAll<HTMLAnchorElement>(
      '.match__row-title-value-content a'
    )
    if (playerLinks.length > 0) {
      playerLinks.forEach((link) => {
        const row = link.closest('.match__row') as HTMLElement | null
        if (!row) return
        const name = link.textContent?.toLowerCase() ?? ''
        if (query && name.includes(query)) {
          row.classList.add('highlighted')
        } else {
          row.classList.remove('highlighted')
        }
      })
      return
    }

    // Legacy format: .bk-row span
    const rows = containerRef.current.querySelectorAll<HTMLElement>('.bk-row span')
    rows.forEach((span) => {
      const row = span.closest('.bk-row') as HTMLElement | null
      if (!row) return
      if (query && span.textContent?.toLowerCase().includes(query)) {
        row.classList.add('tracked')
      } else {
        row.classList.remove('tracked')
      }
    })
  }, [bracketHtml, playerQuery])

  if (!bracketHtml) return null

  return (
    <div className="bracket-canvas">
      <div
        ref={(el) => {
          ;(containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el
          if (bracketRef) (bracketRef as React.MutableRefObject<HTMLDivElement | null>).current = el
        }}
        dangerouslySetInnerHTML={{ __html: bracketHtml }}
      />
    </div>
  )
}
