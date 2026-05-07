import { promises as fs } from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import type { TournamentStats } from './types'

const STATS_ROOT = path.join(process.cwd(), '.cache', 'stats')

function safeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function statsPath(tournamentId: string): string {
  return path.join(STATS_ROOT, `${safeSegment(tournamentId)}.json`)
}

export interface StatsCacheEnvelope {
  version: 1
  sourceVersion: string
  stats: TournamentStats
}

export async function readStatsCache(tournamentId: string): Promise<StatsCacheEnvelope | null> {
  try {
    const buf = await fs.readFile(statsPath(tournamentId), 'utf8')
    const parsed = JSON.parse(buf) as StatsCacheEnvelope
    if (parsed.version !== 1) return null
    return parsed
  } catch {
    return null
  }
}

export async function writeStatsCache(
  tournamentId: string,
  envelope: { sourceVersion: string; stats: TournamentStats },
): Promise<void> {
  const file = statsPath(tournamentId)
  const tmp = `${file}.tmp`
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    const payload: StatsCacheEnvelope = { version: 1, ...envelope }
    await fs.writeFile(tmp, JSON.stringify(payload), 'utf8')
    await fs.rename(tmp, file)
    console.log(`[stats-cache] wrote tournament=${tournamentId}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.log(`[stats-cache] write failed tournament=${tournamentId} err=${msg}`)
  }
}

export function hashFullCacheBytes(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}
