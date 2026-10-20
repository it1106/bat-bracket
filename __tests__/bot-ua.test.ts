import { isBotUserAgent } from '@/lib/bot-ua'

// Keep the route tests off the real .cache/presence.json.
jest.mock('../lib/presence-persist', () => ({
  ensurePresenceLoaded: jest.fn(),
  schedulePresenceSave: jest.fn(),
}))

const APPLEBOT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)'
const GOOGLEBOT = 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

describe('isBotUserAgent', () => {
  it.each([
    ['Applebot', APPLEBOT],
    ['Googlebot', GOOGLEBOT],
    ['bingbot', 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'],
    ['DuckDuckBot', 'DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)'],
    ['YandexBot', 'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)'],
    ['Baiduspider', 'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)'],
    ['PetalBot', 'Mozilla/5.0 (compatible; PetalBot;+https://webmaster.petalsearch.com/site/petalbot)'],
    ['Bytespider', 'Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)'],
    ['GPTBot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot'],
    ['OAI-SearchBot', 'Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)'],
    ['ChatGPT-User', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot'],
    ['PerplexityBot', 'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)'],
    ['ClaudeBot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ClaudeBot/1.0; +claudebot@anthropic.com'],
    ['facebookexternalhit', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'],
    ['AdsBot-Google', 'AdsBot-Google (+http://www.google.com/adsbot.html)'],
    ['Google-InspectionTool', 'Mozilla/5.0 (compatible; Google-InspectionTool/1.0)'],
    ['SemrushBot', 'Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)'],
    ['AhrefsBot', 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)'],
    ['MJ12bot', 'Mozilla/5.0 (compatible; MJ12bot/v1.4.8; http://mj12bot.com/)'],
    ['DataForSeoBot', 'Mozilla/5.0 (compatible; DataForSeoBot/1.0; +https://dataforseo.com/dataforseo-bot)'],
    ['HeadlessChrome', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36'],
    ['Chrome-Lighthouse', 'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse'],
    ['a bare bot/ marker', 'SomethingNew/2.0 (bot/1.0; +http://example.com)'],
    ['a generic crawler', 'Mozilla/5.0 (compatible; ExampleCrawler/1.0)'],
  ])('flags %s', (_name, ua) => {
    expect(isBotUserAgent(ua)).toBe(true)
  })

  it.each([
    ['iPhone Safari', IPHONE],
    ['Android Chrome', 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36'],
    ['desktop Chrome', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'],
    ['Firefox', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0'],
    // Cubot is a phone brand: a bare `bot` must not be a marker.
    ['a Cubot phone', 'Mozilla/5.0 (Linux; Android 10; CUBOT KINGKONG MINI) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.101 Mobile Safari/537.36'],
    ['an empty agent', ''],
  ])('leaves %s alone', (_name, ua) => {
    expect(isBotUserAgent(ua)).toBe(false)
  })

  it.each([undefined, null])('treats a missing agent (%p) as a person', (ua) => {
    expect(isBotUserAgent(ua)).toBe(false)
  })
})

describe('POST /api/presence from a crawler', () => {
  const post = async (ua: string | undefined) => {
    const { POST } = await import('@/app/api/presence/route')
    return POST(
      new Request('http://localhost/api/presence', {
        method: 'POST',
        body: JSON.stringify({ id: `device-${Math.random().toString(36).slice(2, 10)}` }),
        headers: ua === undefined ? {} : { 'user-agent': ua },
      }),
    )
  }
  const users = async () => {
    const { GET } = await import('@/app/api/presence/route')
    return (await (await GET()).json()).users as number
  }

  let log: jest.SpyInstance
  beforeAll(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterAll(() => log.mockRestore())

  it('answers a crawler without counting it as a user', async () => {
    const before = await users()
    const res = await post(APPLEBOT)
    expect(res.status).toBe(200)
    // The same shape as any other heartbeat, so nothing breaks client-side.
    expect(await res.json()).toEqual({
      online: expect.any(Number),
      peak: expect.any(Number),
      users: expect.any(Number),
    })
    expect(await users()).toBe(before)
    expect(await post(GOOGLEBOT)).toHaveProperty('status', 200)
    expect(await users()).toBe(before)
  })

  it('still counts an ordinary browser', async () => {
    const before = await users()
    expect((await post(IPHONE)).status).toBe(200)
    expect(await users()).toBe(before + 1)
  })

  it('still counts a request that sends no user agent', async () => {
    const before = await users()
    expect((await post(undefined)).status).toBe(200)
    expect(await users()).toBe(before + 1)
  })

  it('still rejects a bad id, crawler or not', async () => {
    const { POST } = await import('@/app/api/presence/route')
    const res = await POST(
      new Request('http://localhost/api/presence', {
        method: 'POST',
        body: JSON.stringify({ id: 'nope' }),
        headers: { 'user-agent': APPLEBOT },
      }),
    )
    expect(res.status).toBe(400)
  })
})

describe('POST /api/pageview from a crawler', () => {
  const post = async (ua: string | undefined) => {
    const { POST } = await import('@/app/api/pageview/route')
    return POST(
      new Request('http://localhost/api/pageview', {
        method: 'POST',
        body: JSON.stringify({ path: '/' }),
        headers: ua === undefined ? {} : { 'user-agent': ua },
      }),
    )
  }
  const loads = async () => (await import('@/lib/pageview-stats')).getPageviewStats().today

  it('answers a crawler without counting a page load', async () => {
    const before = await loads()
    expect((await post(APPLEBOT)).status).toBe(204)
    expect((await post(GOOGLEBOT)).status).toBe(204)
    expect(await loads()).toBe(before)
  })

  it('still counts an ordinary browser', async () => {
    const before = await loads()
    expect((await post(IPHONE)).status).toBe(204)
    expect(await loads()).toBe(before + 1)
  })

  it('still counts a request that sends no user agent', async () => {
    const before = await loads()
    expect((await post(undefined)).status).toBe(204)
    expect(await loads()).toBe(before + 1)
  })
})
