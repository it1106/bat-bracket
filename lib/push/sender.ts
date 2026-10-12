import webpush from 'web-push'
import type { PushConfig } from './config'
import type { PushPayload, PushSubscriptionRecord } from './types'

export type SendResult = 'ok' | 'gone' | 'failed'

/** Delivers one notification to one device. A second channel would be
 *  another function of this shape. */
export type Sender = (record: Pick<PushSubscriptionRecord, 'endpoint' | 'keys'>, payload: PushPayload) => Promise<SendResult>

// A match alert that cannot be delivered within ten minutes is no longer
// useful. A publication is not like that — the publication pass asks for a
// day — so these are only the defaults.
const TTL_SECONDS = 600
// A push service that never answers must not hold the watcher up.
const SEND_TIMEOUT_MS = 10_000

export interface SendOptions {
  /** How long the push service may hold the notification for. */
  ttlSeconds?: number
  urgency?: 'very-low' | 'low' | 'normal' | 'high'
}

export function webPushSender(
  config: PushConfig,
  send: typeof webpush.sendNotification = webpush.sendNotification,
  options: SendOptions = {},
): Sender {
  return async (record, payload) => {
    try {
      await send(
        { endpoint: record.endpoint, keys: record.keys },
        JSON.stringify(payload),
        {
          TTL: options.ttlSeconds ?? TTL_SECONDS,
          urgency: options.urgency ?? 'high',
          vapidDetails: config,
          timeout: SEND_TIMEOUT_MS,
        },
      )
      return 'ok'
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode
      // The push service no longer knows this device: it unsubscribed or was reset.
      if (status === 404 || status === 410) return 'gone'
      console.warn(`[push] send failed status=${status ?? 'none'}:`, err instanceof Error ? err.message : err)
      return 'failed'
    }
  }
}
