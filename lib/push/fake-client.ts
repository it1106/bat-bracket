import type { PushClient } from './client'
import type { FollowTarget, PushFollow } from './types'

// A stand-in for the browser side of match alerts, for component tests: a
// server that remembers follows, and a browser that subscribes when asked.
// Lives beside the real client (not under __tests__, where Jest would take it
// for a test file). Nothing in the app imports it.

export const FAKE_SUBSCRIPTION = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'p', auth: 'a' } }

const asFollow = (t: FollowTarget): PushFollow => {
  if (t.kind === 'club') return { kind: 'club', tournamentId: t.tournamentId, clubName: t.clubName, addedAt: '' }
  const tier = t.tier === 'result' ? { tier: 'result' as const } : {}
  return t.scope === 'everywhere'
    ? { kind: 'player', tournamentId: '', playerId: '', slug: t.slug, playerName: t.playerName, addedAt: '', ...tier }
    : { kind: 'player', tournamentId: t.tournamentId, playerId: t.playerId, playerName: t.playerName ?? '', addedAt: '', ...tier }
}

const same = (f: PushFollow, t: FollowTarget) => {
  if (f.kind !== t.kind) return false
  if (t.kind === 'player' && t.scope === 'everywhere') return f.kind === 'player' && !f.tournamentId && f.slug === t.slug
  if (f.kind === 'player' && !f.tournamentId) return false
  if (f.tournamentId !== t.tournamentId) return false
  return f.kind === 'player' && t.kind === 'player' ? f.playerId === t.playerId : f.kind === 'club' && t.kind === 'club' ? f.clubName === t.clubName : false
}

export function fakeClient(over: Partial<PushClient> = {}): PushClient & { calls: string[] } {
  const calls: string[] = []
  let server: PushFollow[] = []
  let subscribed = false
  let site = false
  const client: PushClient & { calls: string[] } = {
    calls,
    environment: () => 'ok',
    permission: () => (subscribed ? 'granted' : 'default'),
    publicKey: async () => 'PUB',
    currentSubscription: async () => (subscribed ? FAKE_SUBSCRIPTION : null),
    subscribe: async () => { calls.push('subscribe'); subscribed = true; return FAKE_SUBSCRIPTION },
    follow: async (_s, lang, target) => {
      calls.push(`follow:${lang}`)
      // Following again changes the follow that is there, as the store does.
      server = server.some((f) => same(f, target))
        ? server.map((f) => (same(f, target) ? asFollow(target) : f))
        : [...server, asFollow(target)]
      return { follows: server }
    },
    unfollow: async (_e, target) => {
      calls.push('unfollow')
      server = server.filter((f) => !same(f, target))
      return server
    },
    setSite: async (_s, lang, on) => { calls.push(`setSite:${lang}:${on}`); site = on; return { follows: server, site } },
    state: async () => { calls.push('state'); return { follows: server, site } },
    ...over,
  }
  return client
}
