/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react'
import AlertBell from '@/components/AlertBell'
import { LanguageProvider } from '@/lib/LanguageContext'

jest.mock('../lib/analytics', () => ({ track: jest.fn() }))

const bell = () => screen.getByRole('button', { name: 'Notifications' })
const mount = (props: Partial<React.ComponentProps<typeof AlertBell>>) =>
  render(<LanguageProvider><AlertBell alerts={[]} onDismiss={() => {}} {...props} /></LanguageProvider>)

describe('AlertBell with a following list', () => {
  it('stays inert with no alerts and no following list', () => {
    mount({})
    fireEvent.click(bell())
    expect(bell().getAttribute('aria-expanded')).toBe('false')
  })

  it('opens to show the following list even with no alerts', () => {
    mount({ hasFollowing: true, following: <div data-testid="following">mine</div> })
    expect(bell().getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(bell())
    expect(screen.getByTestId('following')).toBeTruthy()
  })

  it('does not show the unread dot for the following list alone', () => {
    mount({ hasFollowing: true, following: <div>mine</div> })
    expect(document.querySelector('.alert-bell-dot')).toBeNull()
  })

  it('does not clear alerts when closed with only the following list open', () => {
    const onDismiss = jest.fn()
    mount({ hasFollowing: true, following: <div>mine</div>, onDismiss })
    fireEvent.click(bell())
    fireEvent.mouseDown(document.body)
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
