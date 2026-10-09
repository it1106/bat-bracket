import type { Lang } from '@/lib/i18n'
import type { FollowTarget, PushFollow } from './types'

export type PushEnvironment = 'ok' | 'unsupported' | 'needs-install' | 'in-app-browser'

// Browsers built into other apps cannot register for push; the person has to
// open the page in Chrome or Safari.
const IN_APP = /\bLine\/|FBAN|FBAV|FB_IAB|Instagram|MicroMessenger|TikTok/i

/** Whether this browser can get match alerts, and if not, what stands in the way. */
export function pushEnvironment(env: {
  userAgent: string
  standalone: boolean
  hasServiceWorker: boolean
  hasPushManager: boolean
  hasNotification: boolean
}): PushEnvironment {
  if (IN_APP.test(env.userAgent)) return 'in-app-browser'
  const isIos = /iPad|iPhone|iPod/.test(env.userAgent)
  // On iPhone and iPad, push exists only for an app added to the home screen.
  if (isIos && !env.standalone) return 'needs-install'
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return 'unsupported'
  return 'ok'
}

export function readEnvironment(): PushEnvironment {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported'
  const nav = navigator as Navigator & { standalone?: boolean }
  return pushEnvironment({
    userAgent: nav.userAgent,
    standalone: nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true,
    hasServiceWorker: 'serviceWorker' in nav,
    hasPushManager: 'PushManager' in window,
    hasNotification: 'Notification' in window,
  })
}

/** The form `pushManager.subscribe` wants the server's public key in. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  // over a plain ArrayBuffer, which is what `applicationServerKey` is typed to take
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export interface PushClient {
  environment(): PushEnvironment
  permission(): NotificationPermission
  /** The server's public key, or null when match alerts are not set up. */
  publicKey(): Promise<string | null>
  currentSubscription(): Promise<PushSubscriptionJSON | null>
  /** Asks for permission if needed, then subscribes. 'denied' is a refusal;
   *  'dismissed' is the prompt closed without an answer, which can be asked again. */
  subscribe(publicKey: string): Promise<PushSubscriptionJSON | 'denied' | 'dismissed' | null>
  follow(subscription: PushSubscriptionJSON, lang: Lang, target: FollowTarget): Promise<{ follows: PushFollow[] } | { error: string; reason?: string }>
  unfollow(endpoint: string, target: FollowTarget): Promise<PushFollow[] | null>
  state(endpoint: string): Promise<PushFollow[] | null>
}

async function postJson(path: string, body: unknown): Promise<{ status: number; data: unknown }> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, data: await res.json().catch(() => null) }
}

const registration = () => navigator.serviceWorker.register('/sw.js', { scope: '/' })

export const browserPushClient: PushClient = {
  environment: readEnvironment,
  permission: () => (typeof Notification === 'undefined' ? 'denied' : Notification.permission),
  async publicKey() {
    try {
      const res = await fetch('/api/push/key')
      if (!res.ok) return null
      const key = ((await res.json()) as { publicKey?: unknown }).publicKey
      return typeof key === 'string' && key ? key : null
    } catch {
      return null
    }
  },
  async currentSubscription() {
    try {
      const reg = await navigator.serviceWorker.getRegistration('/')
      const sub = await reg?.pushManager.getSubscription()
      return sub ? sub.toJSON() : null
    } catch {
      return null
    }
  },
  async subscribe(publicKey) {
    try {
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
      if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'dismissed'
      const reg = await registration()
      await navigator.serviceWorker.ready
      const existing = await reg.pushManager.getSubscription()
      const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }))
      return sub.toJSON()
    } catch {
      return null
    }
  },
  async follow(subscription, lang, target) {
    try {
      const { status, data } = await postJson('/api/push/follow', { subscription, lang, target })
      const d = (data ?? {}) as { follows?: PushFollow[]; error?: string; reason?: string }
      if (status === 200 && Array.isArray(d.follows)) return { follows: d.follows }
      return { error: d.error ?? `HTTP ${status}`, ...(d.reason && { reason: d.reason }) }
    } catch {
      return { error: 'network' }
    }
  },
  async unfollow(endpoint, target) {
    try {
      const { status, data } = await postJson('/api/push/unfollow', { endpoint, target })
      const follows = (data as { follows?: PushFollow[] } | null)?.follows
      return status === 200 && Array.isArray(follows) ? follows : null
    } catch {
      return null
    }
  },
  async state(endpoint) {
    try {
      const { status, data } = await postJson('/api/push/state', { endpoint })
      const follows = (data as { follows?: PushFollow[] } | null)?.follows
      return status === 200 && Array.isArray(follows) ? follows : null
    } catch {
      return null
    }
  },
}
