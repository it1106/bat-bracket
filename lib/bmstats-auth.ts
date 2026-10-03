import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

// Login for the /bmstats status page. Server-only.
//
// The password comes from the BMSTATS_PASSWORD environment variable and is
// never stored in the repository. With none set, nobody can log in.
//
// A successful login gets a signed cookie: "<expiry>.<signature>". The
// signature is keyed by a random secret kept in .cache/bmstats-secret (so
// sessions survive a restart) together with the password (so changing the
// password signs everyone out).

export const SESSION_COOKIE = 'bmstats_session'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

const sha256 = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest()

/** Constant-time comparison, so response timing doesn't leak the password. */
export function passwordMatches(input: unknown, password: string | null): boolean {
  if (!password || typeof input !== 'string') return false
  return crypto.timingSafeEqual(sha256(input), sha256(password))
}

function sign(expiresAt: number, secret: string, password: string): string {
  return crypto.createHmac('sha256', `${secret}:${password}`).update(String(expiresAt)).digest('hex')
}

export function createSessionToken(secret: string, password: string, now: number): string {
  const expiresAt = now + SESSION_TTL_MS
  return `${expiresAt}.${sign(expiresAt, secret, password)}`
}

export function verifySessionToken(
  token: string | undefined | null,
  secret: string,
  password: string | null,
  now: number,
): boolean {
  if (!token || !password) return false
  const parts = token.split('.')
  if (parts.length !== 2 || !/^\d+$/.test(parts[0]) || !/^[0-9a-f]{64}$/.test(parts[1])) return false
  const expiresAt = Number(parts[0])
  if (expiresAt < now) return false
  const expected = Buffer.from(sign(expiresAt, secret, password), 'hex')
  return crypto.timingSafeEqual(Buffer.from(parts[1], 'hex'), expected)
}

/** Slows password guessing: five wrong tries inside a minute locks the login
 *  for everyone until the oldest of them is a minute old. */
export class LoginThrottle {
  private static readonly MAX_FAILURES = 5
  private static readonly WINDOW_MS = 60_000
  private failures: number[] = []

  allowed(now: number): boolean {
    this.failures = this.failures.filter((t) => now - t < LoginThrottle.WINDOW_MS)
    return this.failures.length < LoginThrottle.MAX_FAILURES
  }

  fail(now: number): void {
    this.failures.push(now)
  }
}

export function loadOrCreateSecret(file: string): string {
  try {
    const existing = fs.readFileSync(file, 'utf8').trim()
    if (/^[0-9a-f]{64}$/.test(existing)) return existing
  } catch { /* not created yet */ }
  const secret = crypto.randomBytes(32).toString('hex')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${secret}\n`, { encoding: 'utf8', mode: 0o600 })
  return secret
}

// ── Process-wide helpers used by the routes ─────────────────────────────────

let secret: string | null = null
function serverSecret(): string {
  return (secret ??= loadOrCreateSecret(path.join(process.cwd(), '.cache', 'bmstats-secret')))
}

export const loginThrottle = new LoginThrottle()

export function configuredPassword(): string | null {
  return process.env.BMSTATS_PASSWORD || null
}

export function newSessionToken(): string | null {
  const password = configuredPassword()
  return password ? createSessionToken(serverSecret(), password, Date.now()) : null
}

function cookieValue(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return undefined
}

export function isLoggedIn(request: Request): boolean {
  const password = configuredPassword()
  if (!password) return false
  return verifySessionToken(cookieValue(request, SESSION_COOKIE), serverSecret(), password, Date.now())
}

/** Set-Cookie value. `Secure` is added when the visitor arrived over HTTPS
 *  (Cloudflare forwards the original scheme), so the LAN address still works. */
export function sessionCookie(request: Request, token: string | null): string {
  const secure = request.headers.get('x-forwarded-proto') === 'https' ? '; Secure' : ''
  const base = `Path=/; HttpOnly; SameSite=Lax${secure}`
  return token
    ? `${SESSION_COOKIE}=${token}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; ${base}`
    : `${SESSION_COOKIE}=; Max-Age=0; ${base}`
}
