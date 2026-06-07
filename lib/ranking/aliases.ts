import fs from 'fs'
import path from 'path'
import type { ProviderTag } from '@/lib/types'

interface Aliases {
  bat?: Record<string, string>
  bwf?: Record<string, string>
}

let cache: Aliases | null = null

function load(): Aliases {
  if (cache) return cache
  try {
    const file = path.join(process.cwd(), 'data', 'ranking-aliases.json')
    cache = JSON.parse(fs.readFileSync(file, 'utf8')) as Aliases
  } catch {
    cache = {}
  }
  return cache
}

/** Returns the slug to look up in the provider's ranking cache for the given
 *  match-data slug. Falls back to the original slug when no alias is set. */
export function rankingSlugAlias(provider: ProviderTag, slug: string): string {
  if (provider !== 'bat' && provider !== 'bwf') return slug
  return load()[provider]?.[slug] ?? slug
}

export function __resetRankingAliasCacheForTesting(): void { cache = null }
