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

const PRIMER_URL = 'https://bwfbadminton.com/calendar/'
// Chromium's own heap grows under repeated apiPage.evaluate() calls (the
// page-context fetch we use for the CF bypass) — observed ~5 MB / 20 s in
// prod under tournament load. Cap the browser's lifetime and let the next
// request relaunch a fresh one. close() now actually tears down the browser
// process (see getRealDriver below), so this no longer leaks like it used to.
// Bumped from 30 min to 15 min: at sustained tournament load (~15 MB/min),
// the half-hour ceiling let RSS drift past 2 GiB before recycle, which
// triggered PM2's max_memory_restart and the resulting reload-overlap caused
// the late-evening container-memory peaks. Pairs with a 15-min recycle
// heartbeat in instrumentation.ts so idle periods can't dodge the cap.
const PRIME_TTL_MS = 15 * 60_000
// Per-request timeout for BWF API calls executed inside the Playwright page.
// Without this, a stalled upstream (seen hanging 3+ minutes in prod) lets
// in-flight evaluates pile up and exhaust container memory.
const REQUEST_TIMEOUT_MS = 30_000

interface BwfCfState {
  context: DriverContext | null
  apiPage: DriverPage | null
  token: string | null
  lastPrime: number
  primePromise: Promise<void> | null
  driver: ChromiumDriver | null
}

// Shared singleton on globalThis. Without this, Next.js bundles instrumentation
// (dynamic-import) and API routes (static-import) into separate chunks, each
// with its own `context` variable — instrumentation primes Browser A, the
// first API request sees its own null context and primes Browser B, and both
// chromiums stay alive (each module only knows about its own). Same pattern
// as bracket-cache.ts.
const globalState = globalThis as typeof globalThis & { __bwfCf?: BwfCfState }
const state: BwfCfState = globalState.__bwfCf ??= {
  context: null,
  apiPage: null,
  token: null,
  lastPrime: 0,
  primePromise: null,
  driver: null,
}

export function _resetForTesting(): void {
  state.context = null
  state.apiPage = null
  state.token = null
  state.lastPrime = 0
  state.primePromise = null
  state.driver = null
}

export function _setDriverForTesting(d: ChromiumDriver): void { state.driver = d }

export const _internals = { getToken: () => state.token, getLastPrime: () => state.lastPrime }

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
      // browser.process() is documented public API but not on the static type
      // in this playwright-core version. Cast narrowly to access it.
      const pid = (browser as unknown as { process?: () => { pid?: number } | null }).process?.()?.pid
      // Wrap close() so it tears down the Browser AND force-kills the
      // process group. Observed in prod: after `browser.close()` returns,
      // renderer children stay alive (still parented to Node) and pile up
      // across recycle cycles — one such orphan ballooned past 2 GB. Playwright
      // launches chromium in its own process group, so killing -pid reaps the
      // whole tree.
      return {
        async newPage() { return (await ctx.newPage()) as unknown as DriverPage },
        async close() {
          try { await ctx.close() } catch {}
          try {
            await Promise.race([
              browser.close(),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('browser.close timeout')), 5000),
              ),
            ])
          } catch {}
          if (pid && pid > 1) {
            try { process.kill(-pid, 'SIGKILL') } catch {}
            try { process.kill(pid, 'SIGKILL') } catch {}
          }
        },
      }
    },
  }
}

async function prime(): Promise<void> {
  if (!state.driver) state.driver = await getRealDriver()
  if (state.context) { try { await state.context.close() } catch {} }
  state.context = await state.driver.launch()
  try {
    state.apiPage = await state.context.newPage()
    await state.apiPage.goto(PRIMER_URL)
    const html = await state.apiPage.content()
    const t = extractTokenFromHtml(html)
    if (!t) throw new Error('cannot extract token from primer page')
    state.token = t
    state.lastPrime = Date.now()
    console.log('[bwf-cf] primed: token=' + (state.token ? 'extracted' : 'missing'))
  } catch (err) {
    // A failed prime (e.g. a changed/broken primer page) must not leave the
    // browser sitting on bwfbadminton.com's ad/analytics JS, which leaks ~1 GB /
    // ~30 min while held open. Tear it down and clear state so the next call
    // re-primes cold instead of accumulating leaked contexts.
    try { await state.context.close() } catch {}
    state.context = null
    state.apiPage = null
    state.token = null
    state.lastPrime = 0
    throw err
  }
}

// Tear the browser down and clear state so its memory is reclaimed. The open
// primer page (bwfbadminton.com runs its own ad/analytics JS) leaks ~1 GB per
// ~30 min while held open; under active load the TTL recycle in prime() keeps
// each browser short-lived, but when BWF goes idle the heartbeat must close it
// outright rather than leave it leaking overnight. Next request re-primes cold.
export async function closeContext(): Promise<void> {
  if (!state.context) return
  try { await state.context.close() } catch {}
  state.context = null
  state.apiPage = null
  state.token = null
  state.lastPrime = 0
  console.log('[bwf-cf] context closed (idle teardown)')
}

async function refreshToken(): Promise<void> {
  if (!state.apiPage) throw new Error('no apiPage')
  await state.apiPage.goto(PRIMER_URL)
  const html = await state.apiPage.content()
  const t = extractTokenFromHtml(html)
  if (!t) throw new Error('cannot extract token on refresh')
  state.token = t
}

// Re-prime when the context is missing OR the current browser has aged out
// (PRIME_TTL_MS). Auth failures (401) refresh just the token; CF challenges
// (403) trigger a full re-prime in request(). Browser close is now correct
// (see getRealDriver) so age-based recycling no longer leaks processes.
export async function primeIfNeeded(): Promise<void> {
  if (state.context && Date.now() - state.lastPrime < PRIME_TTL_MS) return
  if (state.primePromise) return state.primePromise
  state.primePromise = (async () => {
    try { await prime() } finally { state.primePromise = null }
  })()
  return state.primePromise
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

  const doFetch = async (): Promise<FetchResult> => state.apiPage!.evaluate(
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
    { url, method, token: state.token!, body, timeoutMs: REQUEST_TIMEOUT_MS } as unknown,
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
  const page = await state.context!.newPage()
  try {
    await page.goto(url)
    return await page.content()
  } finally {
    await page.close()
  }
}
