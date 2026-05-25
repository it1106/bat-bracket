import { promises as fs } from 'fs'
import path from 'path'
import type { BatRanking } from './types'

let root = path.join(process.cwd(), '.cache', 'players')

export function __setBatRankingRootForTesting(dir: string): void { root = dir }

function cacheFile(): string { return path.join(root, 'bat-ranking.json') }

export async function readBatRankingCache(): Promise<BatRanking | null> {
  try {
    return JSON.parse(await fs.readFile(cacheFile(), 'utf8')) as BatRanking
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
