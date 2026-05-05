'use client'

import { useEffect, useRef, type RefObject } from 'react'
import { shareDebug } from '@/lib/shareDebug'

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
  // Keep callbacks in a ref so the useEffect below stays stable across
  // re-renders. Without this, every parent render recreates onPressStart /
  // onFire, the effect tears down listeners and resets activeTarget /
  // readyTimer mid-press, and the long-press silently fails when a sibling
  // re-renders during the hold (e.g. an iOS-synthesized mouseenter setting
  // hovered/active state, which mutates a next-opp sibling's className).
  const optsRef = useRef(options)
  optsRef.current = options

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let readyTimer: ReturnType<typeof setTimeout> | null = null
    let activeTarget: HTMLElement | null = null
    let startX = 0
    let startY = 0
    let isReady = false
    let pendingFireFor: HTMLElement | null = null

    const cancel = () => {
      if (readyTimer) { clearTimeout(readyTimer); readyTimer = null }
      if (activeTarget) {
        activeTarget.classList.remove(optsRef.current.pressClass)
        activeTarget.classList.remove(optsRef.current.readyClass)
        activeTarget = null
      }
      isReady = false
    }

    const onTouchStart = (e: TouchEvent) => {
      const target = e.target as Element | null
      const found = target?.closest(optsRef.current.targetSelector) as HTMLElement | null
      if (!found || !container.contains(found)) return
      const t = e.touches[0]
      if (!t) return
      // Drop any stale pending fire from a prior long-press whose click
      // never arrived — otherwise it would trigger on this tap instead.
      pendingFireFor = null
      activeTarget = found
      startX = t.clientX
      startY = t.clientY
      isReady = false
      found.classList.add(optsRef.current.pressClass)
      shareDebug(`touchstart key=${found.dataset.matchKey?.slice(0, 20) ?? '?'}`)
      optsRef.current.onPressStart?.(found)
      readyTimer = setTimeout(() => {
        readyTimer = null
        isReady = true
        if (activeTarget) {
          activeTarget.classList.remove(optsRef.current.pressClass)
          activeTarget.classList.add(optsRef.current.readyClass)
        }
        shareDebug('ready (timer fired)')
        navigator.vibrate?.(15)
      }, optsRef.current.holdMs ?? 500)
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!activeTarget) return
      const t = e.touches[0]
      if (!t) return
      const dx = t.clientX - startX
      const dy = t.clientY - startY
      if (Math.hypot(dx, dy) > (optsRef.current.moveSlopPx ?? 10)) {
        shareDebug('cancel (move)')
        cancel()
      }
    }

    const onTouchEnd = () => {
      const fired = activeTarget
      const wasReady = isReady
      cancel()
      shareDebug(`touchend wasReady=${wasReady ? 'Y' : 'N'} target=${fired ? 'Y' : 'N'}`)
      // Defer onFire to the synthetic click that follows touchend. iOS
      // Safari does NOT grant transient activation from a long-hold
      // touchend, so calling navigator.share() here yields NotAllowedError.
      // The synthetic click does grant activation, so we fire from there.
      if (wasReady && fired) {
        pendingFireFor = fired
      }
    }

    const fireFromActivation = (e: Event, source: string) => {
      if (!pendingFireFor) return
      const target = e.target as Element | null
      const found = target?.closest(optsRef.current.targetSelector) as HTMLElement | null
      const fired = pendingFireFor
      pendingFireFor = null
      if (found !== fired) return
      e.stopPropagation()
      e.preventDefault()
      shareDebug(`${source} → onFire`)
      optsRef.current.onFire(fired)
    }

    // iOS Safari suppresses synthetic click/mouseup after a long-press, so
    // we can't rely on click for activation. pointerup still fires and per
    // spec grants user activation — share() works from there.
    const onPointerUpCapture = (e: PointerEvent) => fireFromActivation(e, 'pointerup')
    // Click is kept as a fallback for non-iOS browsers that DO fire click
    // after long-press (Android Chrome, desktop).
    const onClickCapture = (e: MouseEvent) => fireFromActivation(e, 'click')

    const onContextMenu = (e: Event) => {
      const target = e.target as Element | null
      const found = target?.closest(optsRef.current.targetSelector) as HTMLElement | null
      if (found && container.contains(found)) e.preventDefault()
    }

    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchmove', onTouchMove, { passive: true })
    container.addEventListener('touchend', onTouchEnd)
    container.addEventListener('touchcancel', cancel)
    container.addEventListener('pointerup', onPointerUpCapture, true)
    container.addEventListener('click', onClickCapture, true)
    container.addEventListener('contextmenu', onContextMenu)
    return () => {
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('touchend', onTouchEnd)
      container.removeEventListener('touchcancel', cancel)
      container.removeEventListener('pointerup', onPointerUpCapture, true)
      container.removeEventListener('click', onClickCapture, true)
      container.removeEventListener('contextmenu', onContextMenu)
      if (readyTimer) clearTimeout(readyTimer)
      if (activeTarget) {
        activeTarget.classList.remove(optsRef.current.pressClass)
        activeTarget.classList.remove(optsRef.current.readyClass)
      }
    }
  }, [containerRef])
}
