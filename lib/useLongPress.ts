'use client'

import { useEffect, type RefObject } from 'react'

interface UseLongPressOptions {
  /** CSS selector identifying which descendant elements respond to the gesture. */
  targetSelector: string
  /** Called on touchstart of a matching element, before the hold timer starts. */
  onPressStart?: (targetEl: HTMLElement) => void
  /** Called on touchend if the user held for at least holdMs without cancelling. */
  onFire: (targetEl: HTMLElement) => void
  holdMs?: number
  moveSlopPx?: number
  /** Class added to the target during the hold (before the threshold). */
  pressClass: string
  /** Class added to the target once the threshold is reached. Replaces pressClass. */
  readyClass: string
}

export function useLongPress(
  containerRef: RefObject<HTMLElement>,
  options: UseLongPressOptions,
): void {
  const {
    targetSelector,
    onPressStart,
    onFire,
    holdMs = 500,
    moveSlopPx = 10,
    pressClass,
    readyClass,
  } = options

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let readyTimer: ReturnType<typeof setTimeout> | null = null
    let activeTarget: HTMLElement | null = null
    let startX = 0
    let startY = 0
    let isReady = false
    let suppressClickFor: HTMLElement | null = null

    const cancel = () => {
      if (readyTimer) { clearTimeout(readyTimer); readyTimer = null }
      if (activeTarget) {
        activeTarget.classList.remove(pressClass)
        activeTarget.classList.remove(readyClass)
        activeTarget = null
      }
      isReady = false
    }

    const onTouchStart = (e: TouchEvent) => {
      const target = e.target as Element | null
      const found = target?.closest(targetSelector) as HTMLElement | null
      if (!found || !container.contains(found)) return
      const t = e.touches[0]
      if (!t) return
      activeTarget = found
      startX = t.clientX
      startY = t.clientY
      isReady = false
      found.classList.add(pressClass)
      onPressStart?.(found)
      readyTimer = setTimeout(() => {
        readyTimer = null
        isReady = true
        if (activeTarget) {
          activeTarget.classList.remove(pressClass)
          activeTarget.classList.add(readyClass)
        }
        navigator.vibrate?.(15)
      }, holdMs)
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!activeTarget) return
      const t = e.touches[0]
      if (!t) return
      const dx = t.clientX - startX
      const dy = t.clientY - startY
      if (Math.hypot(dx, dy) > moveSlopPx) cancel()
    }

    const onTouchEnd = () => {
      const fired = activeTarget
      const wasReady = isReady
      cancel()
      // Fire onFire synchronously from the touchend handler so iOS Safari
      // preserves transient activation for any navigator.share() call inside.
      if (wasReady && fired) {
        suppressClickFor = fired
        onFire(fired)
      }
    }

    const onClickCapture = (e: MouseEvent) => {
      if (!suppressClickFor) return
      const target = e.target as Element | null
      const found = target?.closest(targetSelector) as HTMLElement | null
      if (found === suppressClickFor) {
        e.stopPropagation()
        e.preventDefault()
        suppressClickFor = null
      }
    }

    const onContextMenu = (e: Event) => {
      const target = e.target as Element | null
      const found = target?.closest(targetSelector) as HTMLElement | null
      if (found && container.contains(found)) e.preventDefault()
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
      if (activeTarget) {
        activeTarget.classList.remove(pressClass)
        activeTarget.classList.remove(readyClass)
      }
    }
  }, [containerRef, targetSelector, onPressStart, onFire, holdMs, moveSlopPx, pressClass, readyClass])
}
