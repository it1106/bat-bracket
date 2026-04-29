'use client'

import { useEffect, useState } from 'react'

/**
 * True for `timeoutMs` after every scroll/touch, false once the user is idle.
 * Starts true on mount so a button gated by this hook is visible at first
 * paint and hides itself if the user never moves.
 */
export function useScrollActivity(timeoutMs = 3000): boolean {
  const [active, setActive] = useState(true)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const arm = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setActive(false), timeoutMs)
    }
    const bump = () => {
      setActive(true)
      arm()
    }
    arm()
    window.addEventListener('scroll', bump, { passive: true })
    window.addEventListener('touchstart', bump, { passive: true })
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('scroll', bump)
      window.removeEventListener('touchstart', bump)
    }
  }, [timeoutMs])
  return active
}
