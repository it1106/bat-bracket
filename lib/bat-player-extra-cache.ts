import { promises as fs } from 'fs'
import path from 'path'
import type { PlayerProfileExtra, PlayerProfileExtraCache } from './types'

let root = path.join(process.cwd(), '.cache', 'players')

export function __setBatPlayerExtraRootForTesting(dir: string): void { root = dir }

function cacheFile(): string { return path.join(root, 'bat-player-extra.json') }

export async function readPlayerExtraCache(): Promise<PlayerProfileExtraCache> {
  try {
    return JSON.parse(await fs.readFile(cacheFile(), 'utf8')) as PlayerProfileExtraCache
  } catch {
    return { version: 1, players: {} }
  }
}

export async function readPlayerExtra(slug: string): Promise<PlayerProfileExtra | null> {
  const cache = await readPlayerExtraCache()
  return cache.players[slug] ?? null
}

export async function writePlayerExtra(slug: string, extra: PlayerProfileExtra): Promise<void> {
  const cache = await readPlayerExtraCache()
  cache.players[slug] = extra
  const file = cacheFile()
  const tmp = `${file}.tmp`
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(tmp, JSON.stringify(cache), 'utf8')
  await fs.rename(tmp, file)
}
