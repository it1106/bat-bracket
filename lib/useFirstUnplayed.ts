import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MatchScheduleGroup, MatchEntry, MatchPlayer } from './types'

function playerMatches(p: MatchPlayer, qLower: string, clubMap?: Record<string, string>): boolean {
  if (p.name.toLowerCase().includes(qLower)) return true
  if (clubMap && p.playerId && (clubMap[p.playerId] ?? '').toLowerCase().includes(qLower)) return true
  return false
}

function matchesQuery(entry: MatchEntry, query: string, clubMap?: Record<string, string>): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  if (entry.draw.toLowerCase().includes(q)) return true
  return [...entry.team1, ...entry.team2].some((p) => playerMatches(p, q, clubMap))
}

export function findFirstUnplayed(
  groups: MatchScheduleGroup[],
  playerQuery: string,
  clubMap?: Record<string, string>,
): { gi: number; mi: number } | null {
  for (let gi = 0; gi < groups.length; gi++) {
    const matches = groups[gi].matches
    for (let mi = 0; mi < matches.length; mi++) {
      const m = matches[mi]
      if (m.winner !== null) continue
      if (m.walkover) continue
      if (!matchesQuery(m, playerQuery, clubMap)) continue
      return { gi, mi }
    }
  }
  return null
}

export interface UseFirstUnplayedResult {
  targetKey: string | null
  registerTargetRef: (el: HTMLElement | null) => void
  isTargetInView: boolean
  scrollToTarget: () => void
}

export function useFirstUnplayed(
  groups: MatchScheduleGroup[],
  playerQuery: string,
  clubMap?: Record<string, string>,
): UseFirstUnplayedResult {
  const target = useMemo(
    () => findFirstUnplayed(groups, playerQuery, clubMap),
    [groups, playerQuery, clubMap],
  )
  const targetKey = target ? `${target.gi}-${target.mi}` : null

  const [targetNode, setTargetNode] = useState<HTMLElement | null>(null)
  const [isTargetInView, setIsTargetInView] = useState(true)

  const registerTargetRef = useCallback((el: HTMLElement | null) => {
    setTargetNode(el)
  }, [])

  useEffect(() => {
    if (!targetNode || !targetKey) {
      setIsTargetInView(true)
      return
    }
    if (typeof IntersectionObserver === 'undefined') {
      setIsTargetInView(true)
      return
    }
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) setIsTargetInView(e.isIntersecting)
    })
    obs.observe(targetNode)
    return () => obs.disconnect()
  }, [targetNode, targetKey])

  const scrollToTarget = useCallback(() => {
    const el = targetNode
    if (!el) return
    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' })
    if (reduceMotion) return
    el.classList.remove('ms-jump-flash')
    void el.offsetWidth
    el.classList.add('ms-jump-flash')
  }, [targetNode])

  return { targetKey, registerTargetRef, isTargetInView, scrollToTarget }
}
