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
  const { matchSelector, onFire, holdMs = 500 } = options

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let activeMatch: HTMLElement | null = null

    const onTouchStart = (e: TouchEvent) => {
      const target = e.target as Element | null
      const match = target?.closest(matchSelector) as HTMLElement | null
      if (!match || !container.contains(match)) return
      activeMatch = match
      timer = setTimeout(() => {
        timer = null
        const fired = activeMatch
        activeMatch = null
        if (fired) onFire(fired)
      }, holdMs)
    }

    container.addEventListener('touchstart', onTouchStart, { passive: true })
    return () => {
      container.removeEventListener('touchstart', onTouchStart)
      if (timer) clearTimeout(timer)
    }
  }, [containerRef, matchSelector, onFire, holdMs])
}
