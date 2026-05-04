'use client'

import { useEffect, type RefObject } from 'react'

interface UsePointerReorderOptions {
  enabled: boolean
  /** CSS selector identifying which descendant elements participate in reordering. */
  targetSelector: string
  /** Reads a stable id from a target element (e.g. via dataset). */
  getId: (el: HTMLElement) => string | null
  /** Called when the user drops one target onto another. Order arguments: (sourceId, dropTargetId). */
  onReorder: (fromId: string, toId: string) => void
  moveSlopPx?: number
}

// Pointer-event-based drag-to-reorder. Works for mouse, touch, and pen.
// Replaces HTML5 drag-and-drop, which fires unreliably for touch.
export function usePointerReorder(
  containerRef: RefObject<HTMLElement>,
  options: UsePointerReorderOptions,
): void {
  const { enabled, targetSelector, getId, onReorder, moveSlopPx = 8 } = options

  useEffect(() => {
    if (!enabled) return
    const container = containerRef.current
    if (!container) return

    let dragged: HTMLElement | null = null
    let pointerId: number | null = null
    let startX = 0
    let startY = 0
    let isDragging = false
    let suppressClickFor: HTMLElement | null = null

    const reset = () => {
      if (dragged) {
        dragged.style.transform = ''
        dragged.style.zIndex = ''
        dragged.style.opacity = ''
        dragged.style.transition = ''
        dragged.style.pointerEvents = ''
        if (pointerId !== null) {
          try { dragged.releasePointerCapture(pointerId) } catch { /* already released */ }
        }
      }
      dragged = null
      pointerId = null
      isDragging = false
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const target = (e.target as Element | null)?.closest(targetSelector) as HTMLElement | null
      if (!target || !container.contains(target)) return
      dragged = target
      pointerId = e.pointerId
      startX = e.clientX
      startY = e.clientY
      isDragging = false
      try { target.setPointerCapture(e.pointerId) } catch { /* not capturable */ }
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!dragged || e.pointerId !== pointerId) return
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (!isDragging) {
        if (Math.abs(dx) < moveSlopPx) return
        // Mostly-vertical movement is page scroll — abandon reorder.
        if (Math.abs(dy) > Math.abs(dx) * 1.5) {
          reset()
          return
        }
        isDragging = true
        dragged.style.zIndex = '10'
        dragged.style.opacity = '0.85'
        dragged.style.transition = 'none'
      }
      dragged.style.transform = `translateX(${dx}px) scale(1.04)`
    }

    const onPointerUp = (e: PointerEvent) => {
      if (!dragged || e.pointerId !== pointerId) return
      if (!isDragging) {
        reset()
        return
      }
      // Hide the dragged element from elementFromPoint so it sees what's underneath.
      dragged.style.pointerEvents = 'none'
      const under = document.elementFromPoint(e.clientX, e.clientY) as Element | null
      const hover = under?.closest(targetSelector) as HTMLElement | null
      if (hover && hover !== dragged && container.contains(hover)) {
        const fromId = getId(dragged)
        const toId = getId(hover)
        if (fromId && toId) {
          suppressClickFor = dragged
          onReorder(fromId, toId)
        }
      }
      reset()
    }

    const onClickCapture = (e: MouseEvent) => {
      if (!suppressClickFor) return
      const target = (e.target as Element | null)?.closest(targetSelector) as HTMLElement | null
      if (target === suppressClickFor) {
        e.stopPropagation()
        e.preventDefault()
        suppressClickFor = null
      }
    }

    container.addEventListener('pointerdown', onPointerDown)
    container.addEventListener('pointermove', onPointerMove)
    container.addEventListener('pointerup', onPointerUp)
    container.addEventListener('pointercancel', reset)
    container.addEventListener('click', onClickCapture, true)
    return () => {
      container.removeEventListener('pointerdown', onPointerDown)
      container.removeEventListener('pointermove', onPointerMove)
      container.removeEventListener('pointerup', onPointerUp)
      container.removeEventListener('pointercancel', reset)
      container.removeEventListener('click', onClickCapture, true)
      reset()
    }
  }, [enabled, containerRef, targetSelector, getId, onReorder, moveSlopPx])
}
