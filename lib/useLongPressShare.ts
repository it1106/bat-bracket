'use client'

import { useEffect, type RefObject } from 'react'

interface UseLongPressShareOptions {
  matchSelector: string
  onFire: (matchEl: HTMLElement) => void
  holdMs?: number
  moveSlopPx?: number
  pressClass?: string
}

export function useLongPressShare(
  containerRef: RefObject<HTMLElement>,
  options: UseLongPressShareOptions,
): void {
  const { matchSelector, onFire, holdMs = 500, moveSlopPx = 10, pressClass = 'ms-match--pressing' } = options

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let readyTimer: ReturnType<typeof setTimeout> | null = null
    let activeMatch: HTMLElement | null = null
    let startY = 0
    let isReady = false
    let suppressClickFor: HTMLElement | null = null

    const cancel = () => {
      if (readyTimer) { clearTimeout(readyTimer); readyTimer = null }
      if (activeMatch) { activeMatch.classList.remove(pressClass); activeMatch = null }
      isReady = false
    }

    const onTouchStart = (e: TouchEvent) => {
      const target = e.target as Element | null
      const match = target?.closest(matchSelector) as HTMLElement | null
      if (!match || !container.contains(match)) return
      const t = e.touches[0]
      if (!t) return
      activeMatch = match
      startY = t.clientY
      isReady = false
      match.classList.add(pressClass)
      readyTimer = setTimeout(() => {
        readyTimer = null
        isReady = true
        navigator.vibrate?.(15)
      }, holdMs)
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!activeMatch) return
      const t = e.touches[0]
      if (!t) return
      if (Math.abs(t.clientY - startY) > moveSlopPx) cancel()
    }

    const onTouchEnd = () => {
      const fired = activeMatch
      const wasReady = isReady
      cancel()
      // Fire onFire synchronously from the touchend handler so iOS Safari
      // preserves transient activation for navigator.share inside onFire.
      if (wasReady && fired) {
        suppressClickFor = fired
        onFire(fired)
      }
    }

    const onClickCapture = (e: MouseEvent) => {
      if (!suppressClickFor) return
      const target = e.target as Element | null
      const match = target?.closest(matchSelector) as HTMLElement | null
      if (match === suppressClickFor) {
        e.stopPropagation()
        e.preventDefault()
        suppressClickFor = null
      }
    }

    const onContextMenu = (e: Event) => {
      const target = e.target as Element | null
      const match = target?.closest(matchSelector) as HTMLElement | null
      if (match && container.contains(match)) e.preventDefault()
    }

    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchmove', onTouchMove, { passive: true })
    container.addEventListener('touchend', onTouchEnd)
    container.addEventListener('touchcancel', cancel)
    container.addEventListener('click', onClickCapture, true)
    container.addEventListener('contextmenu', onContextMenu)
    return () => {
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('touchend', onTouchEnd)
      container.removeEventListener('touchcancel', cancel)
      container.removeEventListener('click', onClickCapture, true)
      container.removeEventListener('contextmenu', onContextMenu)
      if (readyTimer) clearTimeout(readyTimer)
      if (activeMatch) activeMatch.classList.remove(pressClass)
    }
  }, [containerRef, matchSelector, onFire, holdMs, moveSlopPx, pressClass])
}
