import { promises as fs } from 'fs'
import path from 'path'
import type { Ranking, ProviderTag } from '@/lib/types'

// v12 adds `provider`. v11 envelopes lack it — rejected on read so the
// boot kick (instrumentation.ts) repopulates immediately.

let root = path.join(process.cwd(), '.cache', 'players')

export function __setRankingCacheRootForTesting(dir: string): void { root = dir }

function cacheFile(provider: ProviderTag): string {
  return path.join(root, `ranking-${provider}.json`)
}
function legacyBatFile(): string { return path.join(root, 'bat-ranking.json') }

async function bestEffortDelete(file: string): Promise<void> {
  try { await fs.unlink(file) } catch { /* missing or no perms — ignore */ }
}

export async function readRankingCache(provider: ProviderTag): Promise<Ranking | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(cacheFile(provider), 'utf8')) as Ranking
    if (parsed.provider !== provider) return null
    return parsed
  } catch {
    // First miss on BAT also tries to sweep the legacy file so it doesn't
    // sit forever as a stale orphan after the rename. Best-effort: ignore
    // errors.
    if (provider === 'bat') await bestEffortDelete(legacyBatFile())
    return null
  }
}

export async function writeRankingCache(data: Ranking): Promise<void> {
  const file = cacheFile(data.provider)
  const tmp = `${file}.tmp`
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(tmp, JSON.stringify(data), 'utf8')
  await fs.rename(tmp, file)
}
