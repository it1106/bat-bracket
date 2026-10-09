import type { PushClient } from './client'
import type { FollowTarget, PushFollow } from './types'

// A stand-in for the browser side of match alerts, for component tests: a
// server that remembers follows, and a browser that subscribes when asked.
// Lives beside the real client (not under __tests__, where Jest would take it
// for a test file). Nothing in the app imports it.

export const FAKE_SUBSCRIPTION = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'p', auth: 'a' } }

const asFollow = (t: FollowTarget): PushFollow =>
  t.kind === 'player'
    ? { kind: 'player', tournamentId: t.tournamentId, playerId: t.playerId, playerName: t.playerName ?? '', addedAt: '' }
    : { kind: 'club', tournamentId: t.tournamentId, clubName: t.clubName, addedAt: '' }

const same = (f: PushFollow, t: FollowTarget) =>
  f.kind === t.kind && f.tournamentId === t.tournamentId &&
  (f.kind === 'player' && t.kind === 'player' ? f.playerId === t.playerId : f.kind === 'club' && t.kind === 'club' ? f.clubName === t.clubName : false)

export function fakeClient(over: Partial<PushClient> = {}): PushClient & { calls: string[] } {
  const calls: string[] = []
  let server: PushFollow[] = []
  let subscribed = false
  const client: PushClient & { calls: string[] } = {
    calls,
    environment: () => 'ok',
    permission: () => (subscribed ? 'granted' : 'default'),
    publicKey: async () => 'PUB',
    currentSubscription: async () => (subscribed ? FAKE_SUBSCRIPTION : null),
    subscribe: async () => { calls.push('subscribe'); subscribed = true; return FAKE_SUBSCRIPTION },
    follow: async (_s, lang, target) => { calls.push(`follow:${lang}`); server = [...server, asFollow(target)]; return { follows: server } },
    unfollow: async (_e, target) => {
      calls.push('unfollow')
      server = server.filter((f) => !same(f, target))
      return server
    },
    state: async () => { calls.push('state'); return server },
    ...over,
  }
  return client
}
