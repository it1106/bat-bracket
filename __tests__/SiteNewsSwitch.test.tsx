/**
 * @jest-environment jsdom
 */
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'
import SiteNewsSwitch from '@/components/SiteNewsSwitch'
import { PushFollowsProvider } from '@/lib/push/PushFollowsContext'
import { LanguageProvider } from '@/lib/LanguageContext'
import { fakeClient } from '@/lib/push/fake-client'
import type { PushClient } from '@/lib/push/client'

const mount = (client: PushClient) =>
  render(<LanguageProvider><PushFollowsProvider client={client}><SiteNewsSwitch /></PushFollowsProvider></LanguageProvider>)

describe('SiteNewsSwitch', () => {
  it('renders nothing where push cannot work', () => {
    const { container } = mount(fakeClient({ environment: () => 'unsupported' }))
    expect(container).toBeEmptyDOMElement()
  })

  it('switches on when clicked', async () => {
    const client = fakeClient()
    mount(client)
    const box = await waitFor(() => screen.getByRole('checkbox'))
    expect(box).not.toBeChecked()
    await act(async () => { fireEvent.click(box) })
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeChecked())
    expect(client.calls.some((c) => c.startsWith('setSite:'))).toBe(true)
  })

  it('shows the blocked note and stays off when notifications are denied', async () => {
    mount(fakeClient({ permission: () => 'denied' }))
    const box = await waitFor(() => screen.getByRole('checkbox'))
    await act(async () => { fireEvent.click(box) })
    // The copy is i18n's `followBlocked`: "Notifications are blocked for this
    // site…" / "เว็บไซต์นี้ถูกปิดการแจ้งเตือน…".
    await waitFor(() => expect(screen.getByText(/Notifications are blocked|ถูกปิดการแจ้งเตือน/)).toBeInTheDocument())
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })
})
