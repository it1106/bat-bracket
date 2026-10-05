/** @jest-environment node */
import http from 'http'
import type { AddressInfo } from 'net'

jest.mock('../lib/access-log', () => ({
  ...jest.requireActual('../lib/access-log'),
  recordAccess: jest.fn(),
}))

import { installRequestTimer } from '@/lib/request-timer'
import { recordAccess } from '@/lib/access-log'

const recorded = recordAccess as jest.MockedFunction<typeof recordAccess>

let server: http.Server
let port = 0

beforeAll(async () => {
  installRequestTimer()
  server = http.createServer((req, res) => {
    if (req.url === '/hang') return // never answered
    res.statusCode = req.url?.startsWith('/api/boom') ? 500 : 200
    res.end('ok')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})
afterAll(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) }))
beforeEach(() => recorded.mockClear())

const get = (path: string, headers: Record<string, string> = {}) =>
  new Promise<number>((resolve, reject) => {
    http.get({ port, host: '127.0.0.1', path, headers, agent: false }, (res) => {
      res.resume()
      res.on('end', () => resolve(res.statusCode ?? 0))
    }).on('error', reject)
  })

const nextRecord = async () => {
  for (let i = 0; i < 100 && recorded.mock.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 10))
  return recorded.mock.calls[0]?.[0]
}

describe('the request hook', () => {
  it('reports who asked for what, and how it was answered', async () => {
    await get('/api/boom?x=1', {
      'cf-connecting-ip': '203.0.113.7',
      'cf-ipcountry': 'TH',
      'user-agent': 'TestAgent/1.0',
      referer: 'https://batmatch.app/',
    })
    expect(await nextRecord()).toMatchObject({
      ip: '203.0.113.7',
      country: 'TH',
      method: 'GET',
      url: '/api/boom?x=1',
      status: 500,
      userAgent: 'TestAgent/1.0',
      referer: 'https://batmatch.app/',
    })
    expect(recorded).toHaveBeenCalledTimes(1)
  })

  it('reports a request that came around Cloudflare as direct', async () => {
    await get('/')
    expect(await nextRecord()).toMatchObject({ ip: '127.0.0.1', country: 'direct', status: 200 })
  })

  it('reports a visitor who left before the answer, with status 0', async () => {
    const req = http.get({ port, host: '127.0.0.1', path: '/hang', agent: false })
    req.on('error', () => { /* we hang up on purpose */ })
    await new Promise((r) => setTimeout(r, 50))
    req.destroy()
    expect(await nextRecord()).toMatchObject({ url: '/hang', status: 0 })
  })

  it('never lets a failure in the log reach the request', async () => {
    recorded.mockImplementationOnce(() => { throw new Error('disk full') })
    expect(await get('/api/ok')).toBe(200)
  })
})
