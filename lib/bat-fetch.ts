// Thin fetch wrapper that emits one tagged log line per upstream BAT call.
// Used to measure real BAT hit volume — grep `[bat-fetch]` in PM2 logs to
// count requests, broken down by `kind` and `status`.
//
// Note: when called from a route that also uses Next's `next.revalidate`
// data cache, hits served from that cache will still log here (Next exposes
// no cache-hit signal on the Response). Treat very low `ms` values as a
// likely data-cache hit, not a real BAT round-trip.
export async function batFetch(
  kind: string,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const start = Date.now()
  try {
    const res = await fetch(url, init)
    const ms = Date.now() - start
    console.log(`[bat-fetch] kind=${kind} status=${res.status} ms=${ms} url=${url}`)
    return res
  } catch (err) {
    const ms = Date.now() - start
    const msg = err instanceof Error ? err.message : 'unknown'
    console.log(`[bat-fetch] kind=${kind} status=ERR ms=${ms} err=${msg} url=${url}`)
    throw err
  }
}
