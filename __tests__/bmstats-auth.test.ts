import { mkdtempSync, rmSync, readFileSync } from 'fs'
import os from 'os'
import path from 'path'
import {
  passwordMatches, createSessionToken, verifySessionToken, LoginThrottle,
  SESSION_TTL_MS, loadOrCreateSecret,
} from '@/lib/bmstats-auth'

const NOW = Date.UTC(2026, 9, 3, 5, 0, 0)
const SECRET = 'test-secret'
const PW = 'correct horse'

describe('bmstats password', () => {
  it('accepts only the exact password', () => {
    expect(passwordMatches(PW, PW)).toBe(true)
    expect(passwordMatches('correct horsE', PW)).toBe(false)
    expect(passwordMatches('', PW)).toBe(false)
    expect(passwordMatches(undefined, PW)).toBe(false)
  })

  it('accepts nothing when no password is configured', () => {
    expect(passwordMatches('', null)).toBe(false)
    expect(passwordMatches('anything', null)).toBe(false)
  })
})

describe('bmstats session token', () => {
  it('is valid until it expires', () => {
    const token = createSessionToken(SECRET, PW, NOW)
    expect(verifySessionToken(token, SECRET, PW, NOW + 1000)).toBe(true)
    expect(verifySessionToken(token, SECRET, PW, NOW + SESSION_TTL_MS - 1)).toBe(true)
    expect(verifySessionToken(token, SECRET, PW, NOW + SESSION_TTL_MS + 1)).toBe(false)
  })

  it('cannot be extended by editing the expiry', () => {
    const token = createSessionToken(SECRET, PW, NOW)
    const [exp, sig] = token.split('.')
    const forged = `${Number(exp) + 1_000_000}.${sig}`
    expect(verifySessionToken(forged, SECRET, PW, NOW)).toBe(false)
  })

  it('stops working when the password or the server secret changes', () => {
    const token = createSessionToken(SECRET, PW, NOW)
    expect(verifySessionToken(token, SECRET, 'new password', NOW)).toBe(false)
    expect(verifySessionToken(token, 'other-secret', PW, NOW)).toBe(false)
  })

  it('rejects junk', () => {
    for (const junk of [undefined, '', 'abc', '123.', '.abc', 'x.y.z']) {
      expect(verifySessionToken(junk, SECRET, PW, NOW)).toBe(false)
    }
  })
})

describe('bmstats login throttle', () => {
  it('locks out after five wrong passwords in a minute, then lets go', () => {
    const t = new LoginThrottle()
    for (let i = 0; i < 5; i++) {
      expect(t.allowed(NOW + i)).toBe(true)
      t.fail(NOW + i)
    }
    expect(t.allowed(NOW + 10)).toBe(false)
    expect(t.allowed(NOW + 59_000)).toBe(false)
    expect(t.allowed(NOW + 61_000)).toBe(true)
  })

  it('does not lock out on a few mistakes spread over time', () => {
    const t = new LoginThrottle()
    for (let i = 0; i < 12; i++) {
      expect(t.allowed(NOW + i * 20_000)).toBe(true)
      t.fail(NOW + i * 20_000)
    }
  })
})

describe('bmstats server secret', () => {
  it('is created once and reused, so sessions survive a restart', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'bmstats-secret-'))
    const file = path.join(dir, 'nested', 'bmstats-secret')
    const first = loadOrCreateSecret(file)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(loadOrCreateSecret(file)).toBe(first)
    expect(readFileSync(file, 'utf8').trim()).toBe(first)
    rmSync(dir, { recursive: true, force: true })
  })
})
