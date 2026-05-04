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
    let timer: ReturnType<typeof setTimeout> | null = null
    let activeMatch: HTMLElement | null = null
    let startY = 0

    const cancel = () => {
      if (timer) { clearTimeout(timer); timer = null }
      if (activeMatch) { activeMatch.classList.remove(pressClass); activeMatch = null }
    }

    const onTouchStart = (e: TouchEvent) => {
      const target = e.target as Element | null
      const match = target?.closest(matchSelector) as HTMLElement | null
      if (!match || !container.contains(match)) return
      const t = e.touches[0]
      if (!t) return
      activeMatch = match
      startY = t.clientY
      match.classList.add(pressClass)
      timer = setTimeout(() => {
        timer = null
        const fired = activeMatch
        if (fired) {
          fired.classList.remove(pressClass)
          activeMatch = null
          onFire(fired)
        }
      }, holdMs)
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!activeMatch) return
      const t = e.touches[0]
      if (!t) return
      if (Math.abs(t.clientY - startY) > moveSlopPx) cancel()
    }

    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchmove', onTouchMove, { passive: true })
    container.addEventListener('touchend', cancel)
    container.addEventListener('touchcancel', cancel)
    return () => {
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('touchend', cancel)
      container.removeEventListener('touchcancel', cancel)
      if (timer) clearTimeout(timer)
      if (activeMatch) activeMatch.classList.remove(pressClass)
    }
  }, [containerRef, matchSelector, onFire, holdMs, moveSlopPx, pressClass])
}
