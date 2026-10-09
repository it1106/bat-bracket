import { pushEnvironment, urlBase64ToUint8Array } from '@/lib/push/client'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const LINE = `${ANDROID} Line/14.5.1`
const FACEBOOK = `${IPHONE} [FBAN/FBIOS;FBAV/450.0.0;FBBV/1]`
const INSTAGRAM = `${ANDROID} Instagram 320.0.0.0 Android`

const all = { standalone: false, hasServiceWorker: true, hasPushManager: true, hasNotification: true }

describe('pushEnvironment', () => {
  it('is ok on Android Chrome and on a desktop browser', () => {
    expect(pushEnvironment({ ...all, userAgent: ANDROID })).toBe('ok')
    expect(pushEnvironment({ ...all, userAgent: MAC })).toBe('ok')
  })

  it('asks an iPhone to install first, and is ok once installed', () => {
    expect(pushEnvironment({ ...all, userAgent: IPHONE, hasPushManager: false })).toBe('needs-install')
    expect(pushEnvironment({ ...all, userAgent: IPHONE })).toBe('needs-install')
    expect(pushEnvironment({ ...all, userAgent: IPHONE, standalone: true })).toBe('ok')
  })

  it('knows an installed iPhone too old for push', () => {
    expect(pushEnvironment({ ...all, userAgent: IPHONE, standalone: true, hasPushManager: false })).toBe('unsupported')
  })

  it.each([['LINE', LINE], ['Facebook', FACEBOOK], ['Instagram', INSTAGRAM]])('sends the %s in-app browser to a real browser', (_n, userAgent) => {
    expect(pushEnvironment({ ...all, userAgent })).toBe('in-app-browser')
    expect(pushEnvironment({ ...all, userAgent, hasPushManager: false, hasServiceWorker: false })).toBe('in-app-browser')
  })

  it('is unsupported without a service worker, push or notifications', () => {
    expect(pushEnvironment({ ...all, userAgent: MAC, hasServiceWorker: false })).toBe('unsupported')
    expect(pushEnvironment({ ...all, userAgent: MAC, hasPushManager: false })).toBe('unsupported')
    expect(pushEnvironment({ ...all, userAgent: MAC, hasNotification: false })).toBe('unsupported')
  })
})

describe('urlBase64ToUint8Array', () => {
  it('decodes URL-safe base64 with its padding left off', () => {
    expect(Array.from(urlBase64ToUint8Array('AQID'))).toEqual([1, 2, 3])
    expect(Array.from(urlBase64ToUint8Array('-_8'))).toEqual([251, 255])
    expect(Array.from(urlBase64ToUint8Array('AQ'))).toEqual([1])
  })
})
