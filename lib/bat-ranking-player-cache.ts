import { promises as fs } from 'fs'
import path from 'path'
import type { BatRankingPlayerDetail, BatRankingPlayerDetailCache } from './types'

// One file per player at .cache/players/bat-ranking-detail/<globalPlayerId>.json.
// Atomic write-then-rename. Read returns null on missing file, version
// mismatch, or corrupt JSON — caller treats null as "fetch fresh".

let root = path.join(process.cwd(), '.cache', 'players', 'bat-ranking-detail')

export function __setBatRankingPlayerCacheRootForTesting(dir: string): void { root = dir }

function cacheFile(globalPlayerId: string): string {
  // The globalPlayerId is numeric per BAT, but defensively segment-sanitize
  // in case future BAT IDs ever contain a path separator.
  const safe = globalPlayerId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(root, `${safe}.json`)
}

export async function readBatRankingPlayerDetail(
  globalPlayerId: string,
): Promise<BatRankingPlayerDetailCache | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(cacheFile(globalPlayerId), 'utf8')) as BatRankingPlayerDetailCache
    if (parsed.version !== 1) return null
    return parsed
  } catch {
    return null
  }
}

export async function writeBatRankingPlayerDetail(detail: BatRankingPlayerDetail): Promise<void> {
  const file = cacheFile(detail.globalPlayerId)
  const tmp = `${file}.tmp`
  await fs.mkdir(path.dirname(file), { recursive: true })
  const payload: BatRankingPlayerDetailCache = { version: 1, detail }
  await fs.writeFile(tmp, JSON.stringify(payload), 'utf8')
  await fs.rename(tmp, file)
}

export async function writeBatRankingPlayerNotFound(
  globalPlayerId: string,
  publishDate: string,
): Promise<void> {
  const file = cacheFile(globalPlayerId)
  const tmp = `${file}.tmp`
  await fs.mkdir(path.dirname(file), { recursive: true })
  const payload: BatRankingPlayerDetailCache = {
    version: 1,
    notFound: { publishDate, scrapedAt: new Date().toISOString() },
  }
  await fs.writeFile(tmp, JSON.stringify(payload), 'utf8')
  await fs.rename(tmp, file)
}
