/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import FollowingList from '@/components/FollowingList'
import { PushFollowsProvider } from '@/lib/push/PushFollowsContext'
import { LanguageProvider } from '@/lib/LanguageContext'
import { fakeClient } from '@/lib/push/fake-client'

const TID = 'AAAAAAAA-0000-0000-0000-000000000001'
const SUB = { endpoint: 'e', keys: { p256dh: 'p', auth: 'a' } }
const names = { [TID]: 'The Open 2026' }

async function seeded() {
  const client = fakeClient()
  await client.subscribe('PUB')
  await client.follow(SUB, 'en', { kind: 'player', tournamentId: TID, playerId: '1', playerName: 'Anan Dee' })
  await client.follow(SUB, 'en', { kind: 'club', tournamentId: TID, clubName: 'Red Club' })
  return client
}

const mount = (client: ReturnType<typeof fakeClient>) =>
  render(<LanguageProvider><PushFollowsProvider client={client}><FollowingList tournamentNames={names} /></PushFollowsProvider></LanguageProvider>)

const rows = () => Array.from(document.querySelectorAll('.following-row')).map((r) => r.textContent!.replace(/\s+/g, ' ').trim())

describe('FollowingList', () => {
  it('renders nothing while the feature is off', async () => {
    mount(fakeClient({ publicKey: async () => null }))
    await Promise.resolve()
    expect(document.querySelector('.following')).toBeNull()
  })

  it('says how to start when nothing is followed', async () => {
    mount(fakeClient())
    await waitFor(() => expect(screen.getByText(/Follow a player to be told when their match is close/)).toBeTruthy())
  })

  it('lists clubs first, then players, each with its tournament', async () => {
    mount(await seeded())
    await waitFor(() => expect(rows()).toHaveLength(2))
    expect(rows()[0]).toContain('Red Club')
    expect(rows()[0]).toContain('The Open 2026')
    expect(rows()[1]).toContain('Anan Dee')
  })

  it('falls back to no tournament name when it is not known', async () => {
    const client = await seeded()
    render(<LanguageProvider><PushFollowsProvider client={client}><FollowingList tournamentNames={{}} /></PushFollowsProvider></LanguageProvider>)
    await waitFor(() => expect(rows()).toHaveLength(2))
    expect(rows()[1]).toContain('Anan Dee')
  })

  it('unfollows one row and keeps the other', async () => {
    mount(await seeded())
    await waitFor(() => expect(rows()).toHaveLength(2))
    fireEvent.click(screen.getAllByRole('button', { name: /Unfollow/ })[1])
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(rows()[0]).toContain('Red Club')
  })
})
