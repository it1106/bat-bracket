/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import FollowButton from '@/components/FollowButton'
import { PushFollowsProvider } from '@/lib/push/PushFollowsContext'
import { LanguageProvider } from '@/lib/LanguageContext'
import type { PushClient } from '@/lib/push/client'
import { fakeClient, FAKE_SUBSCRIPTION } from '@/lib/push/fake-client'

jest.mock('../lib/analytics', () => ({ track: jest.fn() }))
import { track } from '@/lib/analytics'

const TID = 'AAAAAAAA-0000-0000-0000-000000000001'

const mount = (client: PushClient, props: Partial<React.ComponentProps<typeof FollowButton>> = {}) =>
  render(
    <LanguageProvider>
      <PushFollowsProvider client={client}>
        <FollowButton tournamentId={TID} playerId="1" playerName="Anan Dee" {...props} />
      </PushFollowsProvider>
    </LanguageProvider>,
  )

const button = () => document.querySelector<HTMLButtonElement>('.follow-btn')
const note = () => document.querySelector('.follow-note')?.textContent ?? ''

beforeEach(() => { (track as jest.Mock).mockReset(); localStorage.clear() })

describe('FollowButton', () => {
  it('marks match alerts as a beta feature beside the button', async () => {
    mount(fakeClient())
    await waitFor(() => expect(document.querySelector('.follow-beta')).toBeTruthy())
    const badge = document.querySelector('.follow-beta')
    expect(badge?.textContent).toBe('beta')
    // Beside the button, not under it: same row.
    expect(badge?.parentElement?.querySelector('.follow-btn')).toBeTruthy()
  })

  it('is not shown while the feature is off or the browser cannot do push', async () => {
    mount(fakeClient({ publicKey: async () => null }))
    await Promise.resolve()
    expect(button()).toBeNull()
    document.body.innerHTML = ''
    mount(fakeClient({ environment: () => 'unsupported' }))
    await waitFor(() => expect(button()).toBeNull())
  })

  it('follows on tap and then reads "Following"', async () => {
    mount(fakeClient())
    await waitFor(() => expect(button()?.textContent).toContain('Follow'))
    expect(button()!.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(button()!)
    await waitFor(() => expect(button()!.textContent).toContain('Following'))
    expect(button()!.getAttribute('aria-pressed')).toBe('true')
    expect(track).toHaveBeenCalledWith('match_alert_followed', { tournament_id: TID, kind: 'player', player_id: '1' })
  })

  it('unfollows on a second tap', async () => {
    mount(fakeClient())
    await waitFor(() => expect(button()).not.toBeNull())
    fireEvent.click(button()!)
    await waitFor(() => expect(button()!.getAttribute('aria-pressed')).toBe('true'))
    fireEvent.click(button()!)
    await waitFor(() => expect(button()!.getAttribute('aria-pressed')).toBe('false'))
    expect(track).toHaveBeenCalledWith('match_alert_unfollowed', { tournament_id: TID, kind: 'player', player_id: '1' })
  })

  it('explains a denied prompt', async () => {
    mount(fakeClient({ subscribe: async () => 'denied' }))
    await waitFor(() => expect(button()).not.toBeNull())
    fireEvent.click(button()!)
    await waitFor(() => expect(note()).toContain('blocked'))
    expect(button()!.getAttribute('aria-pressed')).toBe('false')
    expect(track).toHaveBeenCalledWith('match_alert_blocked', { reason: 'denied' })
  })

  it('explains notifications already blocked, without asking again', async () => {
    const client = fakeClient({ permission: () => 'denied' })
    mount(client)
    await waitFor(() => expect(button()).not.toBeNull())
    fireEvent.click(button()!)
    await waitFor(() => expect(note()).toContain('blocked'))
    expect(client.calls).not.toContain('subscribe')
  })

  it('tells an iPhone user to install first, and does not try to subscribe', async () => {
    const client = fakeClient({ environment: () => 'needs-install' })
    mount(client)
    await waitFor(() => expect(button()).not.toBeNull())
    fireEvent.click(button()!)
    await waitFor(() => expect(note()).toContain('home screen'))
    expect(client.calls).not.toContain('subscribe')
    expect(track).toHaveBeenCalledWith('match_alert_blocked', { reason: 'needs-install' })
  })

  it('tells an in-app browser user to open a real browser, and offers the link', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    mount(fakeClient({ environment: () => 'in-app-browser' }))
    await waitFor(() => expect(button()).not.toBeNull())
    fireEvent.click(button()!)
    await waitFor(() => expect(note()).toContain('Chrome or Safari'))
    fireEvent.click(screen.getByText('Copy link'))
    await waitFor(() => expect(screen.getByText('Link copied')).toBeTruthy())
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`tournament=${TID}`))
  })

  it('says so at the limit and on any other failure', async () => {
    mount(fakeClient({ follow: async () => ({ error: 'x', reason: 'player-limit' }) }))
    await waitFor(() => expect(button()).not.toBeNull())
    fireEvent.click(button()!)
    await waitFor(() => expect(note()).toContain('Unfollow some first'))
    document.body.innerHTML = ''
    mount(fakeClient({ follow: async () => ({ error: 'network' }) }))
    await waitFor(() => expect(button()).not.toBeNull())
    fireEvent.click(button()!)
    await waitFor(() => expect(note()).toContain('try again'))
  })

  it('reads "Following (club)" for a member of a followed club, and does not unfollow on tap', async () => {
    const client = fakeClient()
    await client.subscribe('PUB')
    await client.follow({ endpoint: 'e', keys: { p256dh: 'p', auth: 'a' } }, 'en', { kind: 'club', tournamentId: TID, clubName: 'Red Club' })
    client.calls.length = 0
    mount(client, { clubName: 'red club' })
    await waitFor(() => expect(button()?.textContent).toContain('Following (club)'))
    fireEvent.click(button()!)
    await waitFor(() => expect(note()).toContain('unfollow the club'))
    expect(client.calls).not.toContain('unfollow')
    expect(client.calls).not.toContain('follow:en')
  })

  it('says nothing untrue when the prompt is closed without an answer', async () => {
    const client = fakeClient({ subscribe: async () => 'dismissed' })
    mount(client)
    await waitFor(() => expect(button()).not.toBeNull())
    fireEvent.click(button()!)
    await waitFor(() => expect(button()!.disabled).toBe(false))
    expect(note()).toBe('')
    expect(button()!.getAttribute('aria-pressed')).toBe('false')
    expect(client.calls).not.toContain('follow:en')
    expect(track).not.toHaveBeenCalled()
  })

  it('is written in Thai', async () => {
    localStorage.setItem('batbracket.lang', 'th')
    mount(fakeClient())
    await waitFor(() => expect(button()?.textContent).toContain('ติดตาม'))
  })
})

describe('FollowButton — how much the alerts say', () => {
  const chip = (label: string) => screen.getByRole('button', { name: label })
  const pressed = (label: string) => chip(label).getAttribute('aria-pressed') === 'true'

  it('asks only how much, never where: a player is followed wherever they play', async () => {
    mount(fakeClient())
    await waitFor(() => expect(button()).not.toBeNull())
    expect(screen.queryByRole('button', { name: 'This tournament' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Every tournament' })).toBeNull()
    expect(pressed('All alerts')).toBe(true)
    expect(pressed('Results only')).toBe(false)
  })

  it('follows the player in every tournament, not the one the bell was opened in', async () => {
    const client = fakeClient()
    mount(client)
    await waitFor(() => expect(button()).not.toBeNull())
    fireEvent.click(button()!)
    await waitFor(() => expect(button()!.getAttribute('aria-pressed')).toBe('true'))
    expect((await client.state('e'))!.follows).toEqual([
      expect.objectContaining({ kind: 'player', tournamentId: '', slug: 'anan_dee', playerName: 'Anan Dee' }),
    ])
  })

  it('follows for the results alone once that is chosen', async () => {
    const client = fakeClient()
    mount(client)
    await waitFor(() => expect(button()).not.toBeNull())
    fireEvent.click(chip('Results only'))
    fireEvent.click(button()!)
    await waitFor(() => expect(button()!.getAttribute('aria-pressed')).toBe('true'))
    expect((await client.state('e'))!.follows[0]).toMatchObject({ tier: 'result' })
  })

  it('changes a follow already made instead of leaving it as it was', async () => {
    const client = fakeClient()
    mount(client)
    await waitFor(() => expect(button()).not.toBeNull())
    fireEvent.click(button()!)
    await waitFor(() => expect(button()!.getAttribute('aria-pressed')).toBe('true'))
    fireEvent.click(chip('Results only'))
    await waitFor(async () => expect((await client.state('e'))!.follows[0]).toMatchObject({ tier: 'result' }))
    expect((await client.state('e'))!.follows).toHaveLength(1)
  })

  it('reads "Following" for a player already followed everywhere', async () => {
    const client = fakeClient()
    await client.subscribe('PUB')
    await client.follow(FAKE_SUBSCRIPTION, 'en', { kind: 'player', scope: 'everywhere', slug: 'anan_dee', playerName: 'Anan Dee' })
    mount(client)
    await waitFor(() => expect(button()?.textContent).toContain('Following'))
  })
})

describe('FollowButton — a follow made before the choice went away', () => {
  it('still reads as following, and unfollows the one it actually is', async () => {
    const client = fakeClient()
    await client.subscribe('PUB')
    await client.follow(FAKE_SUBSCRIPTION, 'en', { kind: 'player', tournamentId: TID, playerId: '1', playerName: 'Anan Dee' })
    mount(client)
    await waitFor(() => expect(button()?.textContent).toContain('Following'))
    fireEvent.click(button()!)
    await waitFor(async () => expect((await client.state('e'))!.follows).toEqual([]))
  })

  it('changes its tier where it is, without moving it', async () => {
    const client = fakeClient()
    await client.subscribe('PUB')
    await client.follow(FAKE_SUBSCRIPTION, 'en', { kind: 'player', tournamentId: TID, playerId: '1', playerName: 'Anan Dee' })
    mount(client)
    await waitFor(() => expect(button()?.textContent).toContain('Following'))
    fireEvent.click(screen.getByRole('button', { name: 'Results only' }))
    await waitFor(async () => expect((await client.state('e'))!.follows).toEqual([
      expect.objectContaining({ tournamentId: TID, playerId: '1', tier: 'result' }),
    ]))
  })
})
