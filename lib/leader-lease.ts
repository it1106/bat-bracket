import { promises as fs } from 'fs'
import path from 'path'

// Heartbeat-lease leader election for the once-per-cluster background jobs
// (ranking poll + discovery cycle). PM2 cluster mode reassigns
// NODE_APP_INSTANCE across reloads, so gating on "index === 0" silently
// drops the leader after an odd number of reloads. A lease keyed on a stable
// per-process id is index-independent: whoever holds a non-stale lease is the
// leader, a single worker always holds it, and on a leader's death another
// worker takes over once the lease ages past its TTL.

export interface Lease {
  holder: string
  heartbeatAt: number
}

/** Pure decision: may `myId` hold the lease given the current state?
 *  Claim an unheld lease, renew one already mine, take over a stale one,
 *  otherwise defer to the live holder. */
export function decideClaim(
  current: Lease | null,
  myId: string,
  now: number,
  ttlMs: number,
): boolean {
  if (!current) return true
  if (current.holder === myId) return true
  return now - current.heartbeatAt > ttlMs
}

export async function readLease(file: string): Promise<Lease | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as Lease
    if (typeof parsed?.holder !== 'string' || typeof parsed?.heartbeatAt !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

async function writeLease(file: string, lease: Lease): Promise<void> {
  const tmp = `${file}.tmp.${process.pid}`
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(tmp, JSON.stringify(lease), 'utf8')
  await fs.rename(tmp, file)
}

/** Acquire or renew the lease at `file` for `myId`. Returns whether `myId`
 *  holds it afterwards. The post-write re-read resolves a two-writer race
 *  deterministically (last rename wins; the loser sees another holder and
 *  reports false), so at most one worker ever acts as leader. */
export async function acquireOrRenewLease(
  file: string,
  myId: string,
  now: number,
  ttlMs: number,
): Promise<boolean> {
  const current = await readLease(file)
  if (!decideClaim(current, myId, now, ttlMs)) return false
  await writeLease(file, { holder: myId, heartbeatAt: now })
  const confirmed = await readLease(file)
  return confirmed?.holder === myId
}
