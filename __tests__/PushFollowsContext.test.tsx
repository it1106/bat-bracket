/**
 * @jest-environment jsdom
 */
import { render, screen, act, waitFor } from '@testing-library/react'
import { PushFollowsProvider, usePushFollows, type PushFollowsValue } from '@/lib/push/PushFollowsContext'
import { LanguageProvider } from '@/lib/LanguageContext'
import type { PushClient } from '@/lib/push/client'
import { fakeClient, FAKE_SUBSCRIPTION as SUB } from '@/lib/push/fake-client'
import type { FollowTarget } from '@/lib/push/types'

const TID = 'AAAAAAAA-0000-0000-0000-000000000001'
const PLAYER: FollowTarget = { kind: 'player', tournamentId: TID, playerId: '1', playerName: 'Anan Dee' }
let value: PushFollowsValue
function Probe() {
  value = usePushFollows()
  return <span data-testid="status">{value.status}</span>
}
const mount = (client: PushClient) =>
  render(<LanguageProvider><PushFollowsProvider client={client}><Probe /></PushFollowsProvider></LanguageProvider>)

describe('PushFollowsProvider', () => {
  it('is off until the server says the feature is set up, then reports the browser', async () => {
    mount(fakeClient())
    expect(screen.getByTestId('status').textContent).toBe('off')
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ok'))
  })

  it('stays off when the server has no key', async () => {
    const client = fakeClient({ publicKey: async () => null })
    mount(client)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByTestId('status').textContent).toBe('off')
    expect(client.calls).toEqual([])
  })

  it('reports what stands in the way on an iPhone or in an in-app browser', async () => {
    mount(fakeClient({ environment: () => 'needs-install' }))
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('needs-install'))
  })

  it('never subscribes or asks permission on load', async () => {
    const client = fakeClient()
    mount(client)
    await waitFor(() => expect(value.status).toBe('ok'))
    expect(client.calls).not.toContain('subscribe')
  })

  it('reads back the follows of a device already subscribed', async () => {
    const client = fakeClient()
    await client.subscribe('PUB')
    await client.follow(SUB, 'en', PLAYER)
    client.calls.length = 0
    mount(client)
    await waitFor(() => expect(value.follows).toHaveLength(1))
    expect(value.isFollowingPlayer(TID.toLowerCase(), '1')).toBe(true)
    expect(value.isFollowingPlayer(TID, '2')).toBe(false)
  })

  it('follow subscribes first, then follows, in the page language', async () => {
    const client = fakeClient()
    mount(client)
    await waitFor(() => expect(value.status).toBe('ok'))
    let outcome = ''
    await act(async () => { outcome = await value.follow(PLAYER) })
    expect(outcome).toBe('ok')
    expect(client.calls).toEqual(['subscribe', 'follow:en'])
    expect(value.isFollowingPlayer(TID, '1')).toBe(true)
  })

  it('a denied prompt stores nothing and says so', async () => {
    const client = fakeClient({ subscribe: async () => 'denied' })
    mount(client)
    await waitFor(() => expect(value.status).toBe('ok'))
    let outcome = ''
    await act(async () => { outcome = await value.follow(PLAYER) })
    expect(outcome).toBe('denied')
    expect(client.calls).not.toContain('follow:en')
    expect(value.follows).toEqual([])
  })

  it('a prompt closed without an answer is neither a denial nor an error, and stores nothing', async () => {
    const client = fakeClient({ subscribe: async () => 'dismissed' })
    mount(client)
    await waitFor(() => expect(value.status).toBe('ok'))
    let outcome = ''
    await act(async () => { outcome = await value.follow(PLAYER) })
    expect(outcome).toBe('dismissed')
    expect(client.calls).not.toContain('follow:en')
  })

  it('reports the limit, and any other failure, without changing the list', async () => {
    const limited = fakeClient({ follow: async () => ({ error: 'follow limit reached', reason: 'player-limit' }) })
    mount(limited)
    await waitFor(() => expect(value.status).toBe('ok'))
    let outcome = ''
    await act(async () => { outcome = await value.follow(PLAYER) })
    expect(outcome).toBe('limit')
    expect(value.follows).toEqual([])
  })

  it('a failed subscribe is an error, not a denial', async () => {
    mount(fakeClient({ subscribe: async () => null }))
    await waitFor(() => expect(value.status).toBe('ok'))
    let outcome = ''
    await act(async () => { outcome = await value.follow(PLAYER) })
    expect(outcome).toBe('error')
  })

  it('unfollows', async () => {
    const client = fakeClient()
    mount(client)
    await waitFor(() => expect(value.status).toBe('ok'))
    await act(async () => { await value.follow(PLAYER) })
    await act(async () => { await value.unfollow(PLAYER) })
    expect(value.follows).toEqual([])
  })

  it('knows a followed club whatever the case or spacing', async () => {
    const client = fakeClient()
    mount(client)
    await waitFor(() => expect(value.status).toBe('ok'))
    await act(async () => { await value.follow({ kind: 'club', tournamentId: TID, clubName: 'Red Club' }) })
    expect(value.isFollowingClub(TID, '  red   CLUB ')).toBe(true)
    expect(value.isFollowingClub(TID, 'Blue Club')).toBe(false)
    expect(value.isFollowingClub(TID, undefined)).toBe(false)
  })

  it('works without a provider: everything is off', () => {
    render(<Probe />)
    expect(value.status).toBe('off')
    expect(value.isFollowingPlayer(TID, '1')).toBe(false)
  })
})
