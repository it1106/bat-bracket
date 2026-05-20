import { extractTokenFromHtml } from './url-resolver'

export interface ChromiumDriver {
  launch(): Promise<DriverContext>
}

export interface DriverContext {
  newPage(): Promise<DriverPage>
  close(): Promise<void>
}

export interface DriverPage {
  goto(url: string): Promise<void>
  content(): Promise<string>
  evaluate<T>(fn: (arg: unknown) => Promise<T>, arg?: unknown): Promise<T>
  close(): Promise<void>
}

const PRIME_TTL_MS = 25 * 60_000
const PRIMER_URL = 'https://bwfbadminton.com/calendar/'
// Per-request timeout for BWF API calls executed inside the Playwright page.
// Without this, a stalled upstream (seen hanging 3+ minutes in prod) lets
// in-flight evaluates pile up and exhaust container memory.
const REQUEST_TIMEOUT_MS = 30_000

let context: DriverContext | null = null
let apiPage: DriverPage | null = null
let token: string | null = null
let lastPrime = 0
let primePromise: Promise<void> | null = null
let driver: ChromiumDriver | null = null

export function _resetForTesting(): void {
  context = null; apiPage = null; token = null; lastPrime = 0; primePromise = null; driver = null
}

export function _setDriverForTesting(d: ChromiumDriver): void { driver = d }

export const _internals = { getToken: () => token, getLastPrime: () => lastPrime }

async function getRealDriver(): Promise<ChromiumDriver> {
  const { chromium } = await import('playwright-core')
  const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME
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
  apiPage = await context.newPage()
  await apiPage.goto(PRIMER_URL)
  const html = await apiPage.content()
  const t = extractTokenFromHtml(html)
  if (!t) throw new Error('cannot extract token from primer page')
  token = t
  lastPrime = Date.now()
  console.log('[bwf-cf] primed: token=' + (token ? 'extracted' : 'missing'))
}

async function refreshToken(): Promise<void> {
  if (!apiPage) throw new Error('no apiPage')
  await apiPage.goto(PRIMER_URL)
  const html = await apiPage.content()
  const t = extractTokenFromHtml(html)
  if (!t) throw new Error('cannot extract token on refresh')
  token = t
}

export async function primeIfNeeded(): Promise<void> {
  if (context && Date.now() - lastPrime < PRIME_TTL_MS) return
  if (primePromise) return primePromise
  primePromise = (async () => {
    try { await prime() } finally { primePromise = null }
  })()
  return primePromise
}

interface FetchArg { url: string; method: string; token: string; body?: unknown; timeoutMs: number }
interface FetchResult { status: number; data?: unknown }

export async function request<T = unknown>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  await primeIfNeeded()
  const url = `https://extranet-lv.bwfbadminton.com${path}`
  const start = Date.now()

  const doFetch = async (): Promise<FetchResult> => apiPage!.evaluate(
    async (arg: unknown) => {
      const { url: u, method: m, token: tok, body: b, timeoutMs } = arg as FetchArg
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const r = await fetch(u, {
          method: m,
          headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
          body: b !== undefined ? JSON.stringify(b) : undefined,
          signal: controller.signal,
        })
        let data: unknown = null
        try { data = await r.json() } catch { /* non-JSON */ }
        return { status: r.status, data }
      } finally {
        clearTimeout(timer)
      }
    },
    { url, method, token: token!, body, timeoutMs: REQUEST_TIMEOUT_MS } as unknown,
  )

  let res = await doFetch()

  if (res.status === 401) {
    console.log('[bwf-cf] 401, refreshing token')
    await refreshToken()
    res = await doFetch()
  }
  if (res.status === 403) {
    console.log('[bwf-cf] 403, re-priming')
    await prime()
    res = await doFetch()
  }
  if (res.status >= 400) {
    const ms = Date.now() - start
    console.log(`[bwf-fetch] path=${path} status=${res.status} ms=${ms} FAIL`)
    throw new Error(`BWF API ${res.status} for ${path}`)
  }
  const ms = Date.now() - start
  console.log(`[bwf-fetch] path=${path} status=${res.status} ms=${ms}`)
  return res.data as T
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
  const g = globalThis as unknown as { __bwfCf?: { context: typeof context; apiPage: typeof apiPage; token: typeof token; lastPrime: typeof lastPrime } }
  if (g.__bwfCf) {
    context = g.__bwfCf.context
    apiPage = g.__bwfCf.apiPage
    token = g.__bwfCf.token
    lastPrime = g.__bwfCf.lastPrime
  } else {
    g.__bwfCf = { context, apiPage, token, lastPrime }
  }
}
