// Thin fetch wrapper that emits one tagged log line per upstream BAT call.
// Used to measure real BAT hit volume — grep `[bat-fetch]` in PM2 logs to
// count requests, broken down by `kind` and `status`.
//
// Note: when called from a route that also uses Next's `next.revalidate`
// data cache, hits served from that cache will still log here (Next exposes
// no cache-hit signal on the Response). Treat very low `ms` values as a
// likely data-cache hit, not a real BAT round-trip.
//
// Every call is capped with a handshake timeout. Without this, a stalled
// BAT upstream (seen in prod hanging 3+ minutes) lets in-flight requests
// pile up until the container OOM-kills pm2. The timer is cleared once
// headers arrive — body reads aren't bounded by it, because BAT's ~1.3 MB
// matches HTML routinely streams for several seconds and a shared signal
// would abort `res.text()` mid-stream, falsely flagging BAT as unreachable.
// Callers can override via `timeoutMs`, or supply their own `signal`
// (their signal wins outright and gates the whole exchange).
const DEFAULT_TIMEOUT_MS = 30_000

export async function batFetch(
  kind: string,
  url: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const start = Date.now()
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: externalSignal, ...rest } = init ?? {}

  // Request compression. BAT serves the matches HTML uncompressed by default
  // (~1.3 MB), and the transfer dominates cold-fetch latency — on prod the
  // body streamed ~15 s without gzip vs ~1.5 s with it (the ~1.3 MB collapses
  // to ~145 KB). Node's fetch (undici) decompresses transparently, so callers
  // still read plain HTML from res.text(). A caller may opt out by setting its
  // own Accept-Encoding. (BAT's TTFB — its server generating the HTML — is
  // unaffected by this and remains the irreducible floor.)
  const headers = new Headers((rest as RequestInit).headers)
  if (!headers.has('accept-encoding')) headers.set('accept-encoding', 'gzip, deflate, br')

  let signal: AbortSignal
  let timer: ReturnType<typeof setTimeout> | null = null
  if (externalSignal) {
    signal = externalSignal
  } else {
    const controller = new AbortController()
    timer = setTimeout(
      () => controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError')),
      timeoutMs,
    )
    signal = controller.signal
  }

  try {
    const res = await fetch(url, { ...rest, headers, signal })
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    const ms = Date.now() - start
    console.log(`[bat-fetch] kind=${kind} status=${res.status} ms=${ms} url=${url}`)
    return res
  } catch (err) {
    if (timer) clearTimeout(timer)
    const ms = Date.now() - start
    const msg = err instanceof Error ? err.message : 'unknown'
    console.log(`[bat-fetch] kind=${kind} status=ERR ms=${ms} err=${msg} url=${url}`)
    throw err
  }
}
