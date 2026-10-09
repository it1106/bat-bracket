/**
 * @jest-environment jsdom
 */
import { render, fireEvent, waitFor } from '@testing-library/react'
import FollowClubButton from '@/components/FollowClubButton'
import { PushFollowsProvider } from '@/lib/push/PushFollowsContext'
import { LanguageProvider } from '@/lib/LanguageContext'
import type { PushClient } from '@/lib/push/client'
import { fakeClient } from '@/lib/push/fake-client'

jest.mock('../lib/analytics', () => ({ track: jest.fn() }))
import { track } from '@/lib/analytics'

const TID = 'AAAAAAAA-0000-0000-0000-000000000001'
const mount = (client: PushClient) =>
  render(
    <LanguageProvider>
      <PushFollowsProvider client={client}>
        <FollowClubButton tournamentId={TID} clubName="Red Club" />
      </PushFollowsProvider>
    </LanguageProvider>,
  )
const button = () => document.querySelector<HTMLButtonElement>('.follow-btn')
const note = () => document.querySelector('.follow-note')?.textContent ?? ''

beforeEach(() => { (track as jest.Mock).mockReset(); localStorage.clear() })

describe('FollowClubButton', () => {
  it('is hidden while the feature is off', async () => {
    mount(fakeClient({ publicKey: async () => null }))
    await Promise.resolve()
    expect(button()).toBeNull()
  })

  it('warns about the number of alerts on the first tap, and follows on the second', async () => {
    const client = fakeClient()
    mount(client)
    await waitFor(() => expect(button()?.textContent).toContain('Follow club'))
    fireEvent.click(button()!)
    await waitFor(() => expect(note()).toContain('many in a day'))
    expect(client.calls).not.toContain('follow:en')
    fireEvent.click(button()!)
    await waitFor(() => expect(button()!.textContent).toContain('Following club'))
    expect(track).toHaveBeenCalledWith('match_alert_followed', { tournament_id: TID, kind: 'club', club: 'Red Club' })
  })

  it('does not warn again on a device that has seen the warning', async () => {
    localStorage.setItem('batbracket.followClubWarned', '1')
    mount(fakeClient())
    await waitFor(() => expect(button()).not.toBeNull())
    fireEvent.click(button()!)
    await waitFor(() => expect(button()!.textContent).toContain('Following club'))
  })

  it('unfollows on a tap when following', async () => {
    localStorage.setItem('batbracket.followClubWarned', '1')
    mount(fakeClient())
    await waitFor(() => expect(button()).not.toBeNull())
    fireEvent.click(button()!)
    await waitFor(() => expect(button()!.getAttribute('aria-pressed')).toBe('true'))
    fireEvent.click(button()!)
    await waitFor(() => expect(button()!.getAttribute('aria-pressed')).toBe('false'))
    expect(track).toHaveBeenCalledWith('match_alert_unfollowed', { tournament_id: TID, kind: 'club', club: 'Red Club' })
  })

  it('explains an iPhone that needs installing, with no warning step first', async () => {
    mount(fakeClient({ environment: () => 'needs-install' }))
    await waitFor(() => expect(button()).not.toBeNull())
    fireEvent.click(button()!)
    await waitFor(() => expect(note()).toContain('home screen'))
  })

  it('explains a denied prompt', async () => {
    localStorage.setItem('batbracket.followClubWarned', '1')
    mount(fakeClient({ subscribe: async () => 'denied' }))
    await waitFor(() => expect(button()).not.toBeNull())
    fireEvent.click(button()!)
    await waitFor(() => expect(note()).toContain('blocked'))
  })
})
