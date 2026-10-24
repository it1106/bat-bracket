import { osFromUserAgent, osWithTouch } from '@/lib/push/user-agent'

describe('osFromUserAgent', () => {
  it.each([
    ['iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 'iOS'],
    ['iPod', 'Mozilla/5.0 (iPod touch; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15', 'iOS'],
    ['iPad that says so', 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 'iPadOS'],
    ['Android phone', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36', 'Android'],
    ['Mac', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36', 'macOS'],
    ['Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 Edg/126', 'Windows'],
    ['ChromeOS', 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36', 'ChromeOS'],
    ['Linux desktop', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36', 'Linux'],
  ])('reads %s', (_name, ua, expected) => {
    expect(osFromUserAgent(ua)).toBe(expected)
  })

  it('says nothing rather than guessing', () => {
    expect(osFromUserAgent('')).toBe('')
    expect(osFromUserAgent('curl/8.4.0')).toBe('')
    expect(osFromUserAgent(undefined)).toBe('')
  })

  it('reads iPad before the Mac its user agent also claims to be', () => {
    expect(osFromUserAgent('Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X)')).toBe('iPadOS')
  })

  it('reads Android before Linux, which its user agent also claims', () => {
    expect(osFromUserAgent('Mozilla/5.0 (Linux; Android 14; SM-S918B)')).toBe('Android')
  })

  it('reads ChromeOS before Linux, which its user agent also resembles', () => {
    expect(osFromUserAgent('Mozilla/5.0 (X11; CrOS aarch64 15917.0.0)')).toBe('ChromeOS')
  })

  it('keeps what it stores short, so the record holds no fingerprint', () => {
    const long = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.6478.127 Safari/537.36'
    expect(osFromUserAgent(long)).toBe('macOS')
    expect(osFromUserAgent(long).length).toBeLessThan(12)
  })

  describe('osWithTouch', () => {
    const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'

    it('takes a Mac that reports touch points for the iPad it is', () => {
      expect(osWithTouch(osFromUserAgent(MAC), true)).toBe('iPadOS')
    })

    it('leaves a real Mac alone', () => {
      expect(osWithTouch(osFromUserAgent(MAC), false)).toBe('macOS')
    })

    it('leaves every other platform alone, touch screen or not', () => {
      for (const os of ['iOS', 'iPadOS', 'Android', 'Windows', 'Linux', 'ChromeOS', ''] as const) {
        expect(osWithTouch(os, true)).toBe(os)
        expect(osWithTouch(os, false)).toBe(os)
      }
    })
  })
})
