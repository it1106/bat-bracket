'use client'
import { useEffect } from 'react'
import { expandSearchQuery } from './searchAliases'

export function applyPlayerHighlight(
  root: HTMLElement,
  playerQuery: string,
  playerClubMap?: Record<string, string>,
): void {
  const queries = expandSearchQuery(playerQuery)
  if (queries.length === 0) {
    root.querySelectorAll<HTMLElement>('.bk-row.tracked, .match__row.highlighted, .standings-row.tracked, .group-card-matches .ms-match.tracked')
      .forEach((row) => {
        row.classList.remove('tracked')
        row.classList.remove('highlighted')
      })
    return
  }

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

  // Bracket rendered HTML (single-elim parser output)
  root.querySelectorAll<HTMLElement>('.bk-row').forEach((row) => {
    const spans = row.querySelectorAll<HTMLElement>('.bk-player, span')
    const matches = Array.from(spans).some((s) =>
      textMatches(s.textContent) ||
      clubMatches(s.getAttribute('data-player-id'))
    )
    row.classList.toggle('tracked', matches)
  })

  // Raw BAT bracket HTML (used by some legacy paths and the BWF renderer)
  root.querySelectorAll<HTMLElement>('.match__row').forEach((row) => {
    const links = row.querySelectorAll<HTMLAnchorElement>('.match__row-title-value-content a')
    const matches = Array.from(links).some((link) =>
      textMatches(link.textContent) ||
      clubMatches(link.getAttribute('data-player-id'))
    )
    row.classList.toggle('highlighted', matches)
  })

  // EventBundle standings + group-match rows (new components)
  root.querySelectorAll<HTMLElement>('.standings-row, .group-card-matches .ms-match').forEach((row) => {
    const players = row.querySelectorAll<HTMLElement>('[data-player-id]')
    const matches = Array.from(players).some((p) =>
      textMatches(p.textContent) || clubMatches(p.getAttribute('data-player-id'))
    )
    row.classList.toggle('tracked', matches)
  })
}

export function usePlayerHighlight(
  containerRef: React.RefObject<HTMLElement>,
  playerQuery: string,
  playerClubMap: Record<string, string> | undefined,
  rerunKey: unknown,
): void {
  useEffect(() => {
    if (!containerRef.current) return
    applyPlayerHighlight(containerRef.current, playerQuery, playerClubMap)
  }, [containerRef, playerQuery, playerClubMap, rerunKey])
}
