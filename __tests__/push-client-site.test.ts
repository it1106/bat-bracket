/**
 * @jest-environment jsdom
 */
import { browserPushClient } from '@/lib/push/client'

const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'p', auth: 'a' } }
const calls: Array<{ url: string; body: unknown }> = []

const answers = (status: number, body: unknown) => {
  global.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
    return { ok: status === 200, status, json: async () => body } as unknown as Response
  }) as unknown as typeof fetch
}

beforeEach(() => { calls.length = 0 })

describe('browserPushClient.setSite', () => {
  it('posts the subscription, the language and the switch', async () => {
    answers(200, { follows: [], site: true })
    expect(await browserPushClient.setSite(SUB, 'th', true)).toEqual({ follows: [], site: true })
    expect(calls[0].url).toBe('/api/push/site')
    expect(calls[0].body).toEqual({ subscription: SUB, lang: 'th', on: true })
  })

  it('reports a refusal the caller can act on', async () => {
    answers(429, { error: 'too many', reason: 'device-limit' })
    expect(await browserPushClient.setSite(SUB, 'en', true)).toEqual({ error: 'too many', reason: 'device-limit' })
  })

  it('survives a network failure', async () => {
    global.fetch = (async () => { throw new Error('offline') }) as unknown as typeof fetch
    expect(await browserPushClient.setSite(SUB, 'en', true)).toEqual({ error: 'network' })
  })
})

describe('browserPushClient.state', () => {
  it('gives the follows and the switch together', async () => {
    answers(200, { follows: [{ kind: 'club' }], site: true })
    expect(await browserPushClient.state(SUB.endpoint)).toEqual({ follows: [{ kind: 'club' }], site: true })
  })

  it('defaults the switch to off when the server does not say', async () => {
    answers(200, { follows: [] })
    expect(await browserPushClient.state(SUB.endpoint)).toEqual({ follows: [], site: false })
  })

  it('is null when the server refuses', async () => {
    answers(404, { error: 'nope' })
    expect(await browserPushClient.state(SUB.endpoint)).toBeNull()
  })
})
