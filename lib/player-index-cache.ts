import { promises as fs } from 'fs'
import path from 'path'
import type { PlayerIndex, Leaderboards, ProviderTag, PlayerIdentityMap, PlayerLink } from './types'

let root = path.join(process.cwd(), '.cache', 'players')

export function __setPlayersRootForTesting(dir: string): void { root = dir }

function indexPath(p: ProviderTag): string { return path.join(root, `index-${p}.json`) }
function lbPath(p: ProviderTag): string { return path.join(root, `leaderboards-${p}.json`) }
function identityMapPath(): string { return path.join(root, 'player-identity-map.json') }

// Parsed-result memo keyed by file mtime. The index is ~10 MB; re-parsing it on
// every /api/players/exists (one per modal open) and every profile view is
// wasteful. Reuse the parse until the file's mtime changes (i.e. a rebuild).
const parseMemo = new Map<string, { mtimeMs: number; value: unknown }>()

async function readJsonMemo<T>(file: string): Promise<T | null> {
  try {
    const st = await fs.stat(file)
    const hit = parseMemo.get(file)
    if (hit && hit.mtimeMs === st.mtimeMs) return hit.value as T
    const value = JSON.parse(await fs.readFile(file, 'utf8')) as T
    parseMemo.set(file, { mtimeMs: st.mtimeMs, value })
    return value
  } catch {
    return null
  }
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
  const out = await readJsonMemo<PlayerIndex>(indexPath(provider))
  if (!out || out.version !== 1) return null
  return out
}

export async function writeIndexCache(idx: PlayerIndex): Promise<void> {
  await writeJson(indexPath(idx.provider), idx)
}

export async function readLeaderboardsCache(provider: ProviderTag): Promise<Leaderboards | null> {
  const out = await readJsonMemo<Leaderboards>(lbPath(provider))
  if (!out || out.version !== 1) return null
  return out
}

export async function writeLeaderboardsCache(lb: Leaderboards): Promise<void> {
  await writeJson(lbPath(lb.provider), lb)
}

export async function readIdentityMap(): Promise<PlayerIdentityMap | null> {
  return readJsonMemo<PlayerIdentityMap>(identityMapPath())
}

export async function writeIdentityMap(map: PlayerIdentityMap): Promise<void> {
  await writeJson(identityMapPath(), map)
}

export async function readPlayerLinks(): Promise<PlayerLink[]> {
  const file = path.join(process.cwd(), 'data', 'player-links.json')
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as PlayerLink[]
  } catch {
    return []
  }
}
