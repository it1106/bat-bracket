'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { expandSearchQuery } from '@/lib/searchAliases'
import { useLanguage } from '@/lib/LanguageContext'
import { longRoundL } from '@/lib/i18n'

interface BracketCanvasProps {
  bracketHtml: string
  playerQuery: string
  bracketRef: React.RefObject<HTMLDivElement>
  onRoundClick?: (roundIndex: number) => void
  onPlayerClick?: (playerId: string) => void
  playerClubMap?: Record<string, string>
}

const MIN_ZOOM = 0.25
const MAX_ZOOM = 3

export default function BracketCanvas({
  bracketHtml,
  playerQuery,
  bracketRef,
  onRoundClick,
  onPlayerClick,
  playerClubMap,
}: BracketCanvasProps) {
  const { lang } = useLanguage()
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const scaleRef = useRef(1)
  const [isPinching, setIsPinching] = useState(false)
  const lastTouchDistance = useRef<number | null>(null)
  const [hintShown] = useState(() => {
    if (typeof window === 'undefined') return true
    try { return localStorage.getItem('batbracket.bracketHintShown') === '1' } catch { return true }
  })

  useEffect(() => { scaleRef.current = scale }, [scale])

  useEffect(() => {
    if (!hintShown && typeof window !== 'undefined') {
      try { localStorage.setItem('batbracket.bracketHintShown', '1') } catch {}
    }
  }, [hintShown])

  // Pre-compute HTML with tracked/highlighted classes embedded so all elements
  // (including off-screen) are styled correctly from initial render.
  const displayHtml = useMemo(() => {
    if (!bracketHtml || typeof document === 'undefined') return bracketHtml
    const queries = expandSearchQuery(playerQuery)
    const wrapper = document.createElement('div')
    wrapper.innerHTML = bracketHtml

    wrapper.querySelectorAll<HTMLElement>('.bk-round-label').forEach((el) => {
      const raw = el.textContent ?? ''
      el.textContent = longRoundL(raw, lang)
    })

    if (!hintShown) {
      wrapper.querySelector<HTMLElement>('.bk-round-label')?.classList.add('bk-round-label--hint')
    }

    if (queries.length > 0) {
      const textMatches = (text: string | null | undefined) => {
        if (!text) return false
        const lc = text.toLowerCase()
        return queries.some((q) => lc.includes(q))
      }
      const clubMatches = (pid: string | null) => {
        if (!pid || !playerClubMap) return false
        const club = (playerClubMap[pid] ?? '').toLowerCase()
        return !!club && queries.some((q) => club.includes(q))
      }

      // bk-row format
      wrapper.querySelectorAll<HTMLElement>('.bk-row').forEach((row) => {
        const spans = row.querySelectorAll<HTMLElement>('.bk-player, span')
        const matches = Array.from(spans).some((s) =>
          textMatches(s.textContent) ||
          clubMatches(s.getAttribute('data-player-id'))
        )
        row.classList.toggle('tracked', matches)
      })

      // match__row format
      wrapper.querySelectorAll<HTMLElement>('.match__row').forEach((row) => {
        const links = row.querySelectorAll<HTMLAnchorElement>('.match__row-title-value-content a')
        const matches = Array.from(links).some((link) =>
          textMatches(link.textContent) ||
          clubMatches(link.getAttribute('data-player-id'))
        )
        row.classList.toggle('highlighted', matches)
      })
    }

    // Gold/silver/bronze medals: final round awards 🥇/🥈,
    // semi-final awards 🥉 to each losing team.
    const addMedal = (row: HTMLElement, emoji: string) => {
      row.querySelectorAll<HTMLElement>('.bk-player').forEach((p) => {
        if (!p.textContent?.trim()) return
        if (p.querySelector('.bk-medal')) return
        const m = document.createElement('span')
        m.className = 'bk-medal'
        m.textContent = `${emoji} `
        p.insertBefore(m, p.firstChild)
      })
    }
    const rounds = wrapper.querySelectorAll<HTMLElement>('.bk-round')
    if (rounds.length >= 1) {
      const finalBox = rounds[rounds.length - 1].querySelector<HTMLElement>('.bk-match-box')
      if (finalBox && finalBox.querySelector('.bk-row.winner')) {
        finalBox.querySelectorAll<HTMLElement>('.bk-row').forEach((row) => {
          addMedal(row, row.classList.contains('winner') ? '🥇' : '🥈')
        })
      }
    }
    if (rounds.length >= 2) {
      rounds[rounds.length - 2].querySelectorAll<HTMLElement>('.bk-match-box').forEach((box) => {
        if (!box.querySelector('.bk-row.winner')) return
        box.querySelectorAll<HTMLElement>('.bk-row').forEach((row) => {
          if (!row.classList.contains('winner')) addMedal(row, '🥉')
        })
      })
    }

    return wrapper.innerHTML
  }, [bracketHtml, playerQuery, playerClubMap, lang, hintShown])

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
          className="w-8 h-8 bg-[var(--surface)] border border-[var(--border)] text-[var(--fg)] rounded-md text-sm font-bold shadow-sm hover:bg-[var(--bg)]"
          title="Zoom in"
        >+</button>
        <button
          onClick={zoomOut}
          className="w-8 h-8 bg-[var(--surface)] border border-[var(--border)] text-[var(--fg)] rounded-md text-sm font-bold shadow-sm hover:bg-[var(--bg)]"
          title="Zoom out"
        >−</button>
        <button
          onClick={resetZoom}
          className="w-8 h-8 bg-[var(--surface)] border border-[var(--border)] text-[var(--fg)] rounded-md text-xs font-bold shadow-sm hover:bg-[var(--bg)]"
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
