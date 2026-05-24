import { promises as fs } from 'fs'
import path from 'path'
import type { PlayerIndex, Leaderboards, ProviderTag } from './types'

let root = path.join(process.cwd(), '.cache', 'players')

export function __setPlayersRootForTesting(dir: string): void { root = dir }

function indexPath(p: ProviderTag): string { return path.join(root, `index-${p}.json`) }
function lbPath(p: ProviderTag): string { return path.join(root, `leaderboards-${p}.json`) }

async function readJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) as T } catch { return null }
}

async function writeJson(file: string, obj: unknown): Promise<void> {
  const tmp = `${file}.tmp`
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(tmp, JSON.stringify(obj), 'utf8')
    await fs.rename(tmp, file)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.log(`[player-index-cache] write failed file=${file} err=${msg}`)
  }
}

export async function readIndexCache(provider: ProviderTag): Promise<PlayerIndex | null> {
  const out = await readJson<PlayerIndex>(indexPath(provider))
  if (!out || out.version !== 1) return null
  return out
}

export async function writeIndexCache(idx: PlayerIndex): Promise<void> {
  await writeJson(indexPath(idx.provider), idx)
}

export async function readLeaderboardsCache(provider: ProviderTag): Promise<Leaderboards | null> {
  const out = await readJson<Leaderboards>(lbPath(provider))
  if (!out || out.version !== 1) return null
  return out
}

export async function writeLeaderboardsCache(lb: Leaderboards): Promise<void> {
  await writeJson(lbPath(lb.provider), lb)
}
