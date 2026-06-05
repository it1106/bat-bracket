import { promises as fs } from 'fs'
import path from 'path'
import type { RankingPlayerDetail, RankingPlayerDetailCache, ProviderTag } from '@/lib/types'

// One file per (provider, globalPlayerId) under
// .cache/players/ranking-detail/{provider}/{id}.json. Atomic write-then-rename.
// Read returns null on missing file, version mismatch, or corrupt JSON —
// caller treats null as "fetch fresh".

let root = path.join(process.cwd(), '.cache', 'players', 'ranking-detail')

export function __setRankingPlayerCacheRootForTesting(dir: string): void { root = dir }

function dirFor(provider: ProviderTag): string { return path.join(root, provider) }

function cacheFile(provider: ProviderTag, globalPlayerId: string): string {
  const safe = globalPlayerId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(dirFor(provider), `${safe}.json`)
}

export async function readRankingPlayerDetail(
  provider: ProviderTag,
  globalPlayerId: string,
): Promise<RankingPlayerDetailCache | null> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(cacheFile(provider, globalPlayerId), 'utf8'),
    ) as RankingPlayerDetailCache
    if (parsed.version !== 1) return null
    return parsed
  } catch {
    return null
  }
}

export async function writeRankingPlayerDetail(
  provider: ProviderTag,
  detail: RankingPlayerDetail,
): Promise<void> {
  const file = cacheFile(provider, detail.globalPlayerId)
  const tmp = `${file}.tmp`
  await fs.mkdir(path.dirname(file), { recursive: true })
  const payload: RankingPlayerDetailCache = { version: 1, detail }
  await fs.writeFile(tmp, JSON.stringify(payload), 'utf8')
  await fs.rename(tmp, file)
}

export async function writeRankingPlayerNotFound(
  provider: ProviderTag,
  globalPlayerId: string,
  publishDate: string,
): Promise<void> {
  const file = cacheFile(provider, globalPlayerId)
  const tmp = `${file}.tmp`
  await fs.mkdir(path.dirname(file), { recursive: true })
  const payload: RankingPlayerDetailCache = {
    version: 1,
    notFound: { publishDate, scrapedAt: new Date().toISOString() },
  }
  await fs.writeFile(tmp, JSON.stringify(payload), 'utf8')
  await fs.rename(tmp, file)
}
