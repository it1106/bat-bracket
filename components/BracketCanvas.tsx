'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'

interface BracketCanvasProps {
  bracketHtml: string
  playerQuery: string
  bracketRef: React.RefObject<HTMLDivElement>
  onRoundClick?: (roundIndex: number) => void
  onPlayerClick?: (playerId: string) => void
}

const MIN_ZOOM = 0.25
const MAX_ZOOM = 3

export default function BracketCanvas({
  bracketHtml,
  playerQuery,
  bracketRef,
  onRoundClick,
  onPlayerClick,
}: BracketCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const scaleRef = useRef(1)
  const [isPinching, setIsPinching] = useState(false)
  const lastTouchDistance = useRef<number | null>(null)

  useEffect(() => { scaleRef.current = scale }, [scale])

  // Pre-compute HTML with tracked/highlighted classes embedded so all elements
  // (including off-screen) are styled correctly from initial render.
  const displayHtml = useMemo(() => {
    const query = playerQuery.trim().toLowerCase()
    if (!query || !bracketHtml || typeof document === 'undefined') return bracketHtml
    const wrapper = document.createElement('div')
    wrapper.innerHTML = bracketHtml

    // bk-row format
    wrapper.querySelectorAll<HTMLElement>('.bk-row').forEach((row) => {
      const spans = row.querySelectorAll<HTMLElement>('.bk-player, span')
      const matches = Array.from(spans).some(s => s.textContent?.toLowerCase().includes(query))
      row.classList.toggle('tracked', matches)
    })

    // match__row format
    wrapper.querySelectorAll<HTMLAnchorElement>('.match__row-title-value-content a').forEach((link) => {
      const row = link.closest<HTMLElement>('.match__row')
      if (!row) return
      row.classList.toggle('highlighted', !!(link.textContent?.toLowerCase().includes(query)))
    })

    return wrapper.innerHTML
  }, [bracketHtml, playerQuery])

  // Scroll to first match after DOM updates with new displayHtml
  useEffect(() => {
    if (!containerRef.current || !playerQuery.trim()) return
    const firstMatch = containerRef.current.querySelector<HTMLElement>('.bk-row.tracked, .match__row.highlighted')
    if (!firstMatch) return
    const scrollEl = containerRef.current.parentElement
    if (!scrollEl) return
    const elemRect = firstMatch.getBoundingClientRect()
    const scrollRect = scrollEl.getBoundingClientRect()
    const s = scaleRef.current
    scrollEl.scrollTo({
      top: Math.max(0, scrollEl.scrollTop + (elemRect.top - scrollRect.top - 80) / s),
      left: Math.max(0, scrollEl.scrollLeft + (elemRect.left - scrollRect.left - 50) / s),
      behavior: 'smooth',
    })
  }, [displayHtml, playerQuery])

  // Pinch-zoom handling
  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      setIsPinching(true)
      const dx = e.touches[1].clientX - e.touches[0].clientX
      const dy = e.touches[1].clientY - e.touches[0].clientY
      lastTouchDistance.current = Math.sqrt(dx * dx + dy * dy)
    }
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (!isPinching || e.touches.length !== 2 || lastTouchDistance.current === null) return
    const dx = e.touches[1].clientX - e.touches[0].clientX
    const dy = e.touches[1].clientY - e.touches[0].clientY
    const dist = Math.sqrt(dx * dx + dy * dy)
    const delta = dist / lastTouchDistance.current
    lastTouchDistance.current = dist
    setScale((s) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, s * delta)))
  }, [isPinching])

  const handleTouchEnd = useCallback(() => {
    setIsPinching(false)
    lastTouchDistance.current = null
  }, [])

  // Wheel zoom (ctrl+wheel or pinch on trackpad)
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      setScale((s) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, s * delta)))
    }
  }, [])

  const zoomIn = useCallback(() => setScale((s) => Math.min(MAX_ZOOM, s * 1.2)), [])
  const zoomOut = useCallback(() => setScale((s) => Math.max(MIN_ZOOM, s / 1.2)), [])
  const resetZoom = useCallback(() => setScale(1), [])

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const label = (e.target as Element).closest('.bk-round-label')
    if (label) {
      const idx = parseInt(label.getAttribute('data-round-index') ?? '', 10)
      if (!isNaN(idx)) onRoundClick?.(idx)
      return
    }
    const playerEl = (e.target as Element).closest('.bk-player[data-player-id]')
    if (playerEl) {
      const playerId = playerEl.getAttribute('data-player-id')
      if (playerId) onPlayerClick?.(playerId)
    }
  }, [onRoundClick, onPlayerClick])

  if (!bracketHtml) return null

  return (
    <div className="relative w-full h-full">
      {/* Zoom controls */}
      <div className="absolute top-4 right-4 z-50 flex flex-col gap-1">
        <button
          onClick={zoomIn}
          className="w-8 h-8 bg-white border border-gray-300 rounded-md text-sm font-bold shadow-sm hover:bg-gray-50"
          title="Zoom in"
        >+</button>
        <button
          onClick={zoomOut}
          className="w-8 h-8 bg-white border border-gray-300 rounded-md text-sm font-bold shadow-sm hover:bg-gray-50"
          title="Zoom out"
        >−</button>
        <button
          onClick={resetZoom}
          className="w-8 h-8 bg-white border border-gray-300 rounded-md text-xs font-bold shadow-sm hover:bg-gray-50"
          title="Reset zoom"
        >{Math.round(scale * 100)}%</button>
      </div>

      {/* Zoomable container */}
      <div
        className="bracket-canvas w-full h-full overflow-auto"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onWheel={handleWheel}
        onClick={handleClick}
        style={{ cursor: isPinching ? 'grabbing' : 'grab' }}
      >
        <div
          ref={(el) => {
            ;(containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el
            if (bracketRef) (bracketRef as React.MutableRefObject<HTMLDivElement | null>).current = el
          }}
          dangerouslySetInnerHTML={{ __html: displayHtml }}
          style={{
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            transition: isPinching ? 'none' : 'transform 0.1s ease-out',
          }}
        />
      </div>
    </div>
  )
}
