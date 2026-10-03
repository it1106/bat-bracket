'use client'

import { useEffect } from 'react'
import { setSearchAliases } from '@/lib/searchAliases'

/** Fetches the alias list managed on /bmstats once per page load and swaps it
 *  into the search. Renders nothing. If the fetch fails the built-in aliases
 *  stay in place. */
export default function SearchAliasesLoader() {
  useEffect(() => {
    let cancelled = false
    fetch('/api/search-aliases', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { aliases?: Record<string, string> } | null) => {
        if (!cancelled && data?.aliases && typeof data.aliases === 'object') setSearchAliases(data.aliases)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  return null
}
