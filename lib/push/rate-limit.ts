// A cap on how many NEW devices one address may register for match alerts in
// a day. Without it one script could fill the device limit and lock everyone
// else out. A device the server already knows is never counted, so following
// more players is not held back. In memory, bounded, per worker.

export const NEW_DEVICES_PER_DAY = 20
const WINDOW_MS = 86_400_000
const MAX_ADDRESSES = 20_000

let seen = new Map<string, number[]>()

export function __resetRateLimitForTesting(): void {
  seen = new Map()
}

/** Whether this address may register one more new device now; counts it if so. */
export function allowNewDevice(address: string, now: number): boolean {
  const recent = (seen.get(address) ?? []).filter((t) => now - t < WINDOW_MS)
  if (recent.length >= NEW_DEVICES_PER_DAY) {
    seen.set(address, recent)
    return false
  }
  recent.push(now)
  // re-insert so the map stays in order of last use, oldest first
  seen.delete(address)
  seen.set(address, recent)
  while (seen.size > MAX_ADDRESSES) {
    const oldest = seen.keys().next().value
    if (oldest === undefined) break
    seen.delete(oldest)
  }
  return true
}

/** The visitor's address as Cloudflare reports it, as lib/access-log.ts reads it. */
export function clientAddress(request: Request): string {
  const cf = (request.headers.get('cf-connecting-ip') ?? '').trim()
  if (cf) return cf
  const forwarded = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
  return forwarded || 'direct'
}
