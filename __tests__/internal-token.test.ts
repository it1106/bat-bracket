import fs from 'fs'
import os from 'os'
import path from 'path'
import { internalHeaders, isInternalRequest } from '@/lib/internal-token'

const cwd = process.cwd()
let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itok-'))
  process.chdir(dir)
})
afterAll(() => { process.chdir(cwd) })

const request = (headers: Record<string, string> = {}) => new Request('http://x/', { method: 'POST', headers })

describe('internal token', () => {
  it('accepts a request carrying the headers the server gives its own calls', () => {
    expect(isInternalRequest(request(internalHeaders()))).toBe(true)
  })

  it('refuses a request with no token', () => {
    internalHeaders()
    expect(isInternalRequest(request())).toBe(false)
  })

  it('refuses a request with the wrong token', () => {
    const [name] = Object.keys(internalHeaders())
    expect(isInternalRequest(request({ [name]: 'f'.repeat(64) }))).toBe(false)
  })

  it('refuses everything before a token has ever been made', () => {
    expect(isInternalRequest(request({ 'x-internal-token': '' }))).toBe(false)
    expect(isInternalRequest(request())).toBe(false)
  })

  // The PM2 cluster's workers share one file: a call made by one worker may
  // be answered by another.
  it('keeps one token across calls, so every worker agrees on it', () => {
    const first = internalHeaders()
    expect(internalHeaders()).toEqual(first)
    const [value] = Object.values(first)
    expect(value).toMatch(/^[0-9a-f]{64}$/)
  })

  it('replaces a token file that is not a token', () => {
    fs.mkdirSync(path.join(dir, '.cache'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.cache', 'internal-token'), 'garbage')
    const headers = internalHeaders()
    expect(Object.values(headers)[0]).toMatch(/^[0-9a-f]{64}$/)
    expect(isInternalRequest(request(headers))).toBe(true)
  })

  it('keeps the token readable by its owner only', () => {
    internalHeaders()
    const mode = fs.statSync(path.join(dir, '.cache', 'internal-token')).mode & 0o777
    expect(mode).toBe(0o600)
  })
})
