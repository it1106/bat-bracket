import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

// A secret the server gives its own requests, for the routes that only its
// background jobs may call (the ranking refresh, which the scheduler in
// instrumentation.ts starts through the app's own address). Server-only.
//
// It lives in .cache/internal-token and is read from there every time rather
// than kept in memory: the PM2 cluster's workers share the file, and a call
// made by one worker may be answered by another. Nothing has to be set up —
// the first call that needs a token makes one.

export const INTERNAL_TOKEN_HEADER = 'x-internal-token'

const TOKEN = /^[0-9a-f]{64}$/

// process.cwd() is evaluated at call time, as in lib/day-cache.
const tokenFile = () => path.join(process.cwd(), '.cache', 'internal-token')

function readToken(file: string): string | null {
  try {
    const token = fs.readFileSync(file, 'utf8').trim()
    return TOKEN.test(token) ? token : null
  } catch {
    return null
  }
}

/** The token on disk, made first if there is none. Null when the directory
 *  cannot be written, in which case nothing can call the guarded routes. */
function loadOrCreateToken(): string | null {
  const file = tokenFile()
  const existing = readToken(file)
  if (existing) return existing
  const tmp = `${file}.${process.pid}.tmp`
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(tmp, `${crypto.randomBytes(32).toString('hex')}\n`, { encoding: 'utf8', mode: 0o600 })
    // Whatever is there is not a token (readToken said so), so it goes. Then
    // link rather than rename: a link never replaces a file, so of two
    // workers starting at once only the first puts its token in place and the
    // other reads that one below.
    fs.rmSync(file, { force: true })
    try {
      fs.linkSync(tmp, file)
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'EEXIST') throw err
    }
  } catch (err) {
    console.warn('[internal-token] could not create:', err instanceof Error ? err.message : err)
  } finally {
    // Tidying up must not be what fails: `force` forgives a missing file but
    // not a path that cannot exist (a file where the directory should be).
    try { fs.rmSync(tmp, { force: true }) } catch { /* nothing to remove */ }
  }
  return readToken(file)
}

/** Makes the token now if there is none. Called at boot, so the file is there
 *  for a manual call before any background job has needed it. False when no
 *  token could be made. */
export function ensureInternalToken(): boolean {
  return loadOrCreateToken() !== null
}

/** Headers for a request the server makes to itself. Empty when there is no
 *  token to send, and the guarded route then answers 401. */
export function internalHeaders(): Record<string, string> {
  const token = loadOrCreateToken()
  return token ? { [INTERNAL_TOKEN_HEADER]: token } : {}
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest()

/** Whether the request carries the server's own token. Never makes one: a
 *  request arriving before any token exists cannot be the server's. */
export function isInternalRequest(request: Request): boolean {
  const given = request.headers.get(INTERNAL_TOKEN_HEADER)
  // Nearly every request has no such header: answer those without the read.
  if (!given) return false
  const token = readToken(tokenFile())
  if (!token) return false
  return crypto.timingSafeEqual(sha256(given), sha256(token))
}
