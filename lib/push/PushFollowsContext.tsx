'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import { browserPushClient, type PushClient, type PushEnvironment } from './client'
import type { FollowTarget, PushFollow } from './types'

export type FollowOutcome = 'ok' | 'denied' | 'dismissed' | 'limit' | 'error'

export interface PushFollowsValue {
  /** 'off' until the server says match alerts are set up. */
  status: 'off' | PushEnvironment
  permission: NotificationPermission
  follows: PushFollow[]
  isFollowingPlayer(tournamentId: string, playerId: string): boolean
  isFollowingClub(tournamentId: string, clubName: string | undefined): boolean
  follow(target: FollowTarget): Promise<FollowOutcome>
  unfollow(target: FollowTarget): Promise<void>
  /** Whether this device asked to be told about new tournaments, draws and schedules. */
  siteNews: boolean
  setSiteNews(on: boolean): Promise<FollowOutcome>
}

// The same rule the server uses for club names (lib/push/alerts.ts), kept
// here so the browser bundle does not pull in the server's hashing.
const clubKey = (name: string | undefined) => (name ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

const OFF: PushFollowsValue = {
  status: 'off',
  permission: 'default',
  follows: [],
  isFollowingPlayer: () => false,
  isFollowingClub: () => false,
  follow: async () => 'error',
  unfollow: async () => {},
  siteNews: false,
  setSiteNews: async () => 'error',
}

const Ctx = createContext<PushFollowsValue>(OFF)

export function usePushFollows(): PushFollowsValue {
  return useContext(Ctx)
}

/** What this device follows, shared by every follow control and the list.
 *  Loading only reads: it never asks for permission or subscribes. */
export function PushFollowsProvider({ children, client = browserPushClient }: { children: ReactNode; client?: PushClient }) {
  const { lang } = useLanguage()
  const [status, setStatus] = useState<PushFollowsValue['status']>('off')
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const [follows, setFollows] = useState<PushFollow[]>([])
  const [siteNews, setSiteNewsState] = useState(false)
  const keyRef = useRef<string | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      const key = await client.publicKey()
      if (!live || !key) return
      keyRef.current = key
      const environment = client.environment()
      setStatus(environment)
      if (environment !== 'ok') return
      setPermission(client.permission())
      const sub = await client.currentSubscription()
      if (!live || !sub?.endpoint) return
      const known = await client.state(sub.endpoint)
      if (!live || !known) return
      setFollows(known.follows)
      setSiteNewsState(known.site)
    })()
    return () => { live = false }
  }, [client])

  const follow = useCallback(async (target: FollowTarget): Promise<FollowOutcome> => {
    const key = keyRef.current
    if (!key || client.environment() !== 'ok') return 'error'
    if (client.permission() === 'denied') { setPermission('denied'); return 'denied' }
    const sub = await client.subscribe(key)
    setPermission(client.permission())
    if (sub === 'denied' || sub === 'dismissed') return sub
    if (!sub) return 'error'
    const result = await client.follow(sub, lang, target)
    if ('follows' in result) { setFollows(result.follows); return 'ok' }
    return result.reason ? 'limit' : 'error'
  }, [client, lang])

  const unfollow = useCallback(async (target: FollowTarget): Promise<void> => {
    const sub = await client.currentSubscription()
    if (!sub?.endpoint) return
    const next = await client.unfollow(sub.endpoint, target)
    if (next) setFollows(next)
  }, [client])

  const setSiteNews = useCallback(async (on: boolean): Promise<FollowOutcome> => {
    const key = keyRef.current
    if (!key || client.environment() !== 'ok') return 'error'
    // Switching off must never put a permission prompt in front of someone:
    // the device is already subscribed, or there is nothing to switch off.
    if (!on) {
      const current = await client.currentSubscription()
      if (!current?.endpoint) { setSiteNewsState(false); return 'ok' }
      const off = await client.setSite(current, lang, false)
      if (!('follows' in off)) return off.reason ? 'limit' : 'error'
      setFollows(off.follows)
      setSiteNewsState(off.site)
      return 'ok'
    }
    if (client.permission() === 'denied') { setPermission('denied'); return 'denied' }
    const sub = await client.subscribe(key)
    setPermission(client.permission())
    if (sub === 'denied' || sub === 'dismissed') return sub
    if (!sub) return 'error'
    const result = await client.setSite(sub, lang, true)
    if ('follows' in result) {
      setFollows(result.follows)
      setSiteNewsState(result.site)
      return 'ok'
    }
    return result.reason ? 'limit' : 'error'
  }, [client, lang])

  const value = useMemo<PushFollowsValue>(() => ({
    status,
    permission,
    follows,
    isFollowingPlayer: (tournamentId, playerId) =>
      follows.some((f) => f.kind === 'player' && f.tournamentId === tournamentId.toUpperCase() && f.playerId === playerId),
    isFollowingClub: (tournamentId, clubName) => {
      const want = clubKey(clubName)
      return !!want && follows.some((f) => f.kind === 'club' && f.tournamentId === tournamentId.toUpperCase() && clubKey(f.clubName) === want)
    },
    follow,
    unfollow,
    siteNews,
    setSiteNews,
  }), [status, permission, follows, follow, unfollow, siteNews, setSiteNews])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
