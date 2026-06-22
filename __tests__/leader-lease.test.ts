import fs from 'fs'
import os from 'os'
import path from 'path'
import { decideClaim, acquireOrRenewLease, readLease } from '@/lib/leader-lease'

const TTL = 60_000

describe('decideClaim (pure)', () => {
  it('claims an unheld lease', () => {
    expect(decideClaim(null, 'me', 1_000, TTL)).toBe(true)
  })
  it('renews a lease I already hold', () => {
    expect(decideClaim({ holder: 'me', heartbeatAt: 500 }, 'me', 1_000, TTL)).toBe(true)
  })
  it('takes over when the current holder is stale', () => {
    expect(decideClaim({ holder: 'other', heartbeatAt: 0 }, 'me', TTL + 1, TTL)).toBe(true)
  })
  it('defers to a fresh holder that is not me', () => {
    expect(decideClaim({ holder: 'other', heartbeatAt: 1_000 }, 'me', 1_500, TTL)).toBe(false)
  })
})

describe('acquireOrRenewLease (file)', () => {
  let dir: string
  let file: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lease-'))
    file = path.join(dir, 'leader.lock')
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('acquires when the file is missing and records me as holder', async () => {
    const got = await acquireOrRenewLease(file, 'me', 1_000, TTL)
    expect(got).toBe(true)
    expect((await readLease(file))?.holder).toBe('me')
  })

  it('renews when the file already holds me', async () => {
    await acquireOrRenewLease(file, 'me', 1_000, TTL)
    const got = await acquireOrRenewLease(file, 'me', 2_000, TTL)
    expect(got).toBe(true)
    expect((await readLease(file))?.heartbeatAt).toBe(2_000)
  })

  it('does not take a lease held by a fresh other holder', async () => {
    await acquireOrRenewLease(file, 'other', 1_000, TTL)
    const got = await acquireOrRenewLease(file, 'me', 1_500, TTL)
    expect(got).toBe(false)
    expect((await readLease(file))?.holder).toBe('other')
  })

  it('takes over a stale lease', async () => {
    await acquireOrRenewLease(file, 'other', 1_000, TTL)
    const got = await acquireOrRenewLease(file, 'me', 1_000 + TTL + 1, TTL)
    expect(got).toBe(true)
    expect((await readLease(file))?.holder).toBe('me')
  })

  it('treats a corrupt lease file as unheld', async () => {
    fs.writeFileSync(file, '{not json')
    const got = await acquireOrRenewLease(file, 'me', 1_000, TTL)
    expect(got).toBe(true)
    expect((await readLease(file))?.holder).toBe('me')
  })
})
