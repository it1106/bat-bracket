import { webPushSender } from '@/lib/push/sender'

const config = { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:a@b.c' }
const record = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'p', auth: 'a' } }
const payload = { title: 'Up next', body: 'A vs B', url: '/?tournament=T', tag: 't' }

describe('webPushSender', () => {
  it('sends the payload as JSON, high urgency, ten-minute lifetime, a ten-second limit, signed with the keys', async () => {
    const send = jest.fn().mockResolvedValue({ statusCode: 201 })
    expect(await webPushSender(config, send as never)(record, payload)).toBe('ok')
    const [sub, body, options] = send.mock.calls[0]
    expect(sub).toEqual(record)
    expect(JSON.parse(body)).toEqual(payload)
    expect(options).toEqual({ TTL: 600, urgency: 'high', vapidDetails: config, timeout: 10_000 })
  })

  it.each([404, 410])('reports a device the push service no longer knows (%i)', async (statusCode) => {
    const send = jest.fn().mockRejectedValue(Object.assign(new Error('gone'), { statusCode }))
    expect(await webPushSender(config, send as never)(record, payload)).toBe('gone')
  })

  it.each([400, 413, 429, 500])('reports any other answer as a failure (%i)', async (statusCode) => {
    const send = jest.fn().mockRejectedValue(Object.assign(new Error('no'), { statusCode }))
    expect(await webPushSender(config, send as never)(record, payload)).toBe('failed')
  })

  it('reports a network error as a failure, and never throws', async () => {
    const send = jest.fn().mockRejectedValue(new Error('ECONNRESET'))
    expect(await webPushSender(config, send as never)(record, payload)).toBe('failed')
  })
})
