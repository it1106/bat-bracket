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
    const rows = containerRef.current.querySelectorAll<HTMLElement>('.bk-row span')
    const query = playerQuery.trim().toLowerCase()

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
