import { allowNewDevice, clientAddress, NEW_DEVICES_PER_DAY, __resetRateLimitForTesting } from '@/lib/push/rate-limit'

const T0 = Date.UTC(2026, 9, 9)
const DAY = 86_400_000

beforeEach(() => __resetRateLimitForTesting())

describe('allowNewDevice', () => {
  it('lets one address register a household\'s worth of devices in a day, then stops', () => {
    for (let i = 0; i < NEW_DEVICES_PER_DAY; i++) expect(allowNewDevice('1.2.3.4', T0 + i)).toBe(true)
    expect(allowNewDevice('1.2.3.4', T0 + 100)).toBe(false)
  })

  it('counts each address on its own', () => {
    for (let i = 0; i < NEW_DEVICES_PER_DAY; i++) allowNewDevice('1.2.3.4', T0)
    expect(allowNewDevice('5.6.7.8', T0)).toBe(true)
  })

  it('lets the address in again a day later', () => {
    for (let i = 0; i < NEW_DEVICES_PER_DAY; i++) allowNewDevice('1.2.3.4', T0)
    expect(allowNewDevice('1.2.3.4', T0 + DAY + 1)).toBe(true)
  })

  it('does not keep addresses for ever', () => {
    for (let i = 0; i < 30_000; i++) allowNewDevice(`10.0.${i >> 8}.${i & 255}`, T0)
    // far more addresses than it is willing to hold: the oldest were dropped
    expect(allowNewDevice('10.0.0.0', T0 + 1)).toBe(true)
  })
})

describe('clientAddress', () => {
  const req = (headers: Record<string, string>) => new Request('http://x/', { headers })
  it('prefers the address Cloudflare reports, then the first forwarded one', () => {
    expect(clientAddress(req({ 'cf-connecting-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1' }))).toBe('9.9.9.9')
    expect(clientAddress(req({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }))).toBe('1.1.1.1')
    expect(clientAddress(req({}))).toBe('direct')
  })
})
