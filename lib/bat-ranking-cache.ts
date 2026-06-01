import { promises as fs } from 'fs'
import path from 'path'
import type { BatRanking } from './types'

// v11 adds rankingId so the per-player detail URL can be constructed
// deterministically. v10 envelopes lack the field — rejected on read so the
// boot kick (instrumentation.ts) repopulates immediately after deploy.

let root = path.join(process.cwd(), '.cache', 'players')

export function __setBatRankingRootForTesting(dir: string): void { root = dir }

function cacheFile(): string { return path.join(root, 'bat-ranking.json') }

export async function readBatRankingCache(): Promise<BatRanking | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(cacheFile(), 'utf8')) as BatRanking & { rankingId?: string }
    if (typeof parsed.rankingId !== 'string') return null // v10 envelope
    return parsed as BatRanking
  } catch {
    return null
  }
}

export async function writeBatRankingCache(data: BatRanking): Promise<void> {
  const file = cacheFile()
  const tmp = `${file}.tmp`
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(tmp, JSON.stringify(data), 'utf8')
  await fs.rename(tmp, file)
}
