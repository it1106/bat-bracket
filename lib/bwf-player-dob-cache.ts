import { promises as fs } from 'fs'
import path from 'path'
import { fetchPlayerSummary } from './providers/bwf/api-client'
import { parsePlayerDob } from './providers/bwf/parsers'

// Single global cache of BWF playerId → date-of-birth. DOB is immutable and
// player-global (not per-tournament), so one file serves every tournament and a
// found value is kept forever. A miss (BWF has no DOB on file) is cached too but
// re-checked after MISS_TTL_MS, since a player can get a DOB added later.
//
// Shape: { version: 1, players: { [playerId]: { dob: string | null, ts } } }

let root = path.join(process.cwd(), '.cache', 'players')
const FILE = () => path.join(root, 'bwf-player-dob.json')
export function __setDobRootForTesting(dir: string): void { root = dir; loaded = false; mem.clear() }

const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000 // re-check "no DOB" players weekly
// Fetches MUST be serial. The BWF transport (cf-context) routes every request
// through a single shared Chromium page; when any request triggers a
// token-refresh or re-prime it navigates that page, which aborts every other
// in-flight fetch on it ("TypeError: Failed to fetch"). A concurrent burst
// therefore self-sabotages (~half the requests died at concurrency 6). One at a
// time is both correct and polite — a small gap between requests keeps the
// upstream rate gentle so we don't trip Cloudflare / IP blocks.
const FETCH_GAP_MS = 150
const MAX_IDS_PER_REQUEST = 400

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

interface DobEntry { dob: string | null; ts: number }

const mem = new Map<string, DobEntry>()
let loaded = false

async function ensureLoaded(): Promise<void> {
  if (loaded) return
  try {
    const file = JSON.parse(await fs.readFile(FILE(), 'utf8')) as { players?: Record<string, DobEntry> }
    for (const [id, e] of Object.entries(file.players ?? {})) mem.set(id, e)
  } catch { /* no file yet */ }
  loaded = true
}

async function persist(): Promise<void> {
  const players: Record<string, DobEntry> = {}
  for (const [id, e] of Array.from(mem)) players[id] = e
  const dest = FILE()
  const tmp = `${dest}.tmp`
  try {
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.writeFile(tmp, JSON.stringify({ version: 1, players }), 'utf8')
    await fs.rename(tmp, dest)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.log(`[bwf-player-dob-cache] write failed err=${msg}`)
  }
}

function isFresh(e: DobEntry): boolean {
  // A found DOB never expires; a miss is re-checked weekly.
  if (e.dob) return true
  return Date.now() - e.ts < MISS_TTL_MS
}


// Resolve date-of-birth for a set of BWF playerIds. Serves cached values and
// fetches only the misses (bounded concurrency), persisting new results. The
// returned map has an entry for every requested id (dob string or null).
export async function getPlayerDobs(ids: string[]): Promise<Record<string, string | null>> {
  await ensureLoaded()
  const unique = Array.from(new Set(ids.filter(Boolean))).slice(0, MAX_IDS_PER_REQUEST)
  const toFetch = unique.filter((id) => {
    const e = mem.get(id)
    return !e || !isFresh(e)
  })

  let fetched = 0
  for (let i = 0; i < toFetch.length; i++) {
    const id = toFetch[i]
    try {
      const dob = parsePlayerDob(await fetchPlayerSummary({ playerId: id }))
      mem.set(id, { dob, ts: Date.now() })
      fetched++
    } catch (err) {
      // Leave uncached on transient failure so a later request retries.
      console.warn(`[bwf-player-dob-cache] fetch failed player=${id}:`, err instanceof Error ? err.message : err)
    }
    if (i < toFetch.length - 1) await sleep(FETCH_GAP_MS)
  }
  if (fetched > 0) await persist()

  const out: Record<string, string | null> = {}
  for (const id of unique) out[id] = mem.get(id)?.dob ?? null
  return out
}
