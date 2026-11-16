import fs from 'fs'
import os from 'os'
import path from 'path'
import { ensureInternalToken, internalHeaders, isInternalRequest } from '@/lib/internal-token'

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

  // Made at boot, so the file is there for a manual call before the
  // scheduler has ever needed it.
  it('can be made ahead of need, and is then the token requests carry', () => {
    expect(fs.existsSync(path.join(dir, '.cache', 'internal-token'))).toBe(false)
    expect(ensureInternalToken()).toBe(true)
    const onDisk = fs.readFileSync(path.join(dir, '.cache', 'internal-token'), 'utf8').trim()
    expect(onDisk).toMatch(/^[0-9a-f]{64}$/)
    expect(isInternalRequest(request({ 'x-internal-token': onDisk }))).toBe(true)
    expect(Object.values(internalHeaders())).toEqual([onDisk])
  })

  it('says so when no token can be made', () => {
    // A file where the directory should be: nothing can be written under it.
    fs.writeFileSync(path.join(dir, '.cache'), 'not a directory')
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(ensureInternalToken()).toBe(false)
    warn.mockRestore()
  })
})
