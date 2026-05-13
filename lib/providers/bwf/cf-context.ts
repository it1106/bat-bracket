import { extractMetaFromPageHtml } from './url-resolver'

export interface ChromiumDriver {
  launch(): Promise<DriverContext>
}

export interface DriverContext {
  newPage(): Promise<DriverPage>
  request: {
    fetch(url: string, opts: { method: string; headers?: Record<string, string>; data?: unknown }): Promise<DriverResponse>
  }
  close(): Promise<void>
}

export interface DriverPage {
  goto(url: string): Promise<void>
  content(): Promise<string>
  close(): Promise<void>
}

export interface DriverResponse {
  status(): number
  json<T = unknown>(): Promise<T>
}

const PRIME_TTL_MS = 25 * 60_000
const PROBE_URL = 'https://bwfbadminton.com/tournament/5726/mith-yonex-pathumthanee-u13-u15-u17-international-junior-2026/'
const PRIMER_URL = 'https://bwfbadminton.com/calendar/'

let context: DriverContext | null = null
let token: string | null = null
let lastPrime = 0
let primePromise: Promise<void> | null = null
let driver: ChromiumDriver | null = null

export function _resetForTesting(): void {
  context = null; token = null; lastPrime = 0; primePromise = null; driver = null
}

export function _setDriverForTesting(d: ChromiumDriver): void { driver = d }

export const _internals = { getToken: () => token, getLastPrime: () => lastPrime }

async function getRealDriver(): Promise<ChromiumDriver> {
  const { chromium } = await import('playwright-core')
  const isLambda = process.platform === 'linux'
  const launchArgs = isLambda
    ? await (async () => { const s = await import('@sparticuz/chromium'); return s.default.args })()
    : []
  const executablePath = isLambda
    ? await (async () => { const s = await import('@sparticuz/chromium'); return s.default.executablePath() })()
    : undefined
  const ctxOpts = {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-US',
  }
  return {
    async launch() {
      const browser = await chromium.launch({ args: launchArgs, executablePath, headless: true })
      const ctx = await browser.newContext(ctxOpts)
      return ctx as unknown as DriverContext
    },
  }
}

async function prime(): Promise<void> {
  if (!driver) driver = await getRealDriver()
  if (context) { try { await context.close() } catch {} }
  context = await driver.launch()
  const primerPage = await context.newPage()
  await primerPage.goto(PRIMER_URL)
  await primerPage.close()
  await refreshToken()
  lastPrime = Date.now()
  console.log('[bwf-cf] primed: token=' + (token ? 'extracted' : 'missing'))
}

async function refreshToken(): Promise<void> {
  if (!context) throw new Error('no context')
  const page = await context.newPage()
  await page.goto(PROBE_URL)
  const html = await page.content()
  await page.close()
  const meta = extractMetaFromPageHtml(html)
  if (!meta) throw new Error('cannot extract token from probe page')
  token = meta.token
}

export async function primeIfNeeded(): Promise<void> {
  if (context && Date.now() - lastPrime < PRIME_TTL_MS) return
  if (primePromise) return primePromise
  primePromise = (async () => {
    try { await prime() } finally { primePromise = null }
  })()
  return primePromise
}

export async function request<T = unknown>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  await primeIfNeeded()
  const url = `https://extranet-lv.bwfbadminton.com${path}`
  const start = Date.now()

  const doFetch = async () => context!.request.fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Origin: 'https://bwfbadminton.com',
      Referer: 'https://bwfbadminton.com/',
    },
    data: body,
  })

  let res = await doFetch()

  if (res.status() === 401) {
    console.log('[bwf-cf] 401, refreshing token')
    await refreshToken()
    res = await doFetch()
  }
  if (res.status() === 403) {
    console.log('[bwf-cf] 403, re-priming')
    await prime()
    res = await doFetch()
  }
  if (res.status() >= 400) {
    const ms = Date.now() - start
    console.log(`[bwf-fetch] path=${path} status=${res.status()} ms=${ms} FAIL`)
    throw new Error(`BWF API ${res.status()} for ${path}`)
  }
  const ms = Date.now() - start
  console.log(`[bwf-fetch] path=${path} status=${res.status()} ms=${ms}`)
  return res.json<T>()
}

export async function fetchPageHtml(url: string): Promise<string> {
  await primeIfNeeded()
  const page = await context!.newPage()
  try {
    await page.goto(url)
    return await page.content()
  } finally {
    await page.close()
  }
}

if (process.env.NODE_ENV !== 'test' && typeof globalThis !== 'undefined') {
  const g = globalThis as unknown as { __bwfCf?: { context: typeof context; token: typeof token; lastPrime: typeof lastPrime } }
  if (g.__bwfCf) {
    context = g.__bwfCf.context
    token = g.__bwfCf.token
    lastPrime = g.__bwfCf.lastPrime
  } else {
    g.__bwfCf = { context, token, lastPrime }
  }
}
