import http from 'http'
import { recordSiteRequest } from './site-requests'
import { clientOf, recordAccess } from './access-log'

// Times every HTTP request the server answers, for the "Site requests" figures
// on /bmstats, and notes who asked, for the access log. Hooks the server's
// 'request' event rather than wrapping each route, so no route can be
// forgotten. It only observes: a failure in here must never affect the request
// itself.

export function installRequestTimer(): void {
  const g = globalThis as typeof globalThis & { __requestTimerInstalled?: boolean }
  if (g.__requestTimerInstalled) return
  g.__requestTimerInstalled = true

  const emit = http.Server.prototype.emit
  http.Server.prototype.emit = function (this: http.Server, event: string | symbol, ...args: unknown[]): boolean {
    if (event === 'request') {
      try {
        const [req, res] = args as [http.IncomingMessage, http.ServerResponse]
        const url = req.url
        const started = process.hrtime.bigint()
        const elapsed = () => Number(process.hrtime.bigint() - started) / 1e6
        // Read now: a route may rewrite the request before it ends.
        const method = req.method ?? ''
        const { headers } = req
        const client = clientOf(headers, req.socket?.remoteAddress)
        let answeredMs: number | null = null
        res.once('finish', () => {
          try {
            answeredMs = elapsed()
            recordSiteRequest(url, res.statusCode, answeredMs)
          } catch { /* observing only */ }
        })
        // 'close' follows 'finish', and also comes alone when the visitor goes
        // away before an answer — which the log records with status 0.
        res.once('close', () => {
          try {
            recordAccess({
              now: Date.now(),
              ...client,
              method,
              url,
              status: answeredMs === null ? 0 : res.statusCode,
              ms: answeredMs ?? elapsed(),
              userAgent: String(headers['user-agent'] ?? ''),
              referer: String(headers.referer ?? ''),
            })
          } catch { /* observing only */ }
        })
      } catch { /* observing only */ }
    }
    return emit.apply(this, [event, ...args] as Parameters<typeof emit>)
  } as typeof emit
}
