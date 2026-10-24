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

describe('FollowButton — where the alerts come from, and how many', () => {
  const chip = (label: string) => screen.getByRole('button', { name: label })
  const pressed = (label: string) => chip(label).getAttribute('aria-pressed') === 'true'

  it('offers this tournament and every tournament, this one to begin with', async () => {
    mount(fakeClient())
    await waitFor(() => expect(button()).not.toBeNull())
    expect(pressed('This tournament')).toBe(true)
    expect(pressed('Every tournament')).toBe(false)
  })

  it('offers every alert and results only, every alert to begin with', async () => {
    mount(fakeClient())
    await waitFor(() => expect(button()).not.toBeNull())
    expect(pressed('All alerts')).toBe(true)
    expect(pressed('Results only')).toBe(false)
  })

  it('follows the player wherever they play once that is chosen', async () => {
    const client = fakeClient()
    mount(client)
    await waitFor(() => expect(button()).not.toBeNull())
    fireEvent.click(chip('Every tournament'))
    fireEvent.click(button()!)
    await waitFor(() => expect(button()!.getAttribute('aria-pressed')).toBe('true'))
    const follows = (await client.state('e'))!.follows
    expect(follows).toEqual([expect.objectContaining({ kind: 'player', tournamentId: '', slug: 'anan_dee', playerName: 'Anan Dee' })])
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

  it('widens a follow to every tournament without ever leaving the player unfollowed', async () => {
    const client = fakeClient()
    mount(client)
    await waitFor(() => expect(button()).not.toBeNull())
    fireEvent.click(button()!)
    await waitFor(() => expect(button()!.getAttribute('aria-pressed')).toBe('true'))
    fireEvent.click(chip('Every tournament'))
    await waitFor(async () => expect((await client.state('e'))!.follows).toEqual([
      expect.objectContaining({ tournamentId: '', slug: 'anan_dee' }),
    ]))
    // The wider follow is made before the narrower one goes, so a failure
    // between the two leaves the player followed, never dropped.
    expect(client.calls.indexOf('follow:en')).toBeLessThan(client.calls.lastIndexOf('unfollow'))
  })

  it('reads "Following" for a player followed everywhere, with no tournament named', async () => {
    const client = fakeClient()
    await client.subscribe('PUB')
    await client.follow(FAKE_SUBSCRIPTION, 'en', { kind: 'player', scope: 'everywhere', slug: 'anan_dee', playerName: 'Anan Dee' })
    mount(client)
    await waitFor(() => expect(button()?.textContent).toContain('Following'))
    expect(pressed('Every tournament')).toBe(true)
  })
})
