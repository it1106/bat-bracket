import http from 'http'
import { recordSiteRequest } from './site-requests'

// Times every HTTP request the server answers, for the "Site requests" figures
// on /bmstats. Hooks the server's 'request' event rather than wrapping each
// route, so no route can be forgotten. It only observes: a failure in here
// must never affect the request itself.

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
        res.once('finish', () => {
          try {
            recordSiteRequest(url, res.statusCode, Number(process.hrtime.bigint() - started) / 1e6)
          } catch { /* observing only */ }
        })
      } catch { /* observing only */ }
    }
    return emit.apply(this, [event, ...args] as Parameters<typeof emit>)
  } as typeof emit
}
