/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react'
import OnlinePill from '../components/OnlinePill'
import { LanguageProvider } from '@/lib/LanguageContext'
import { usePresence } from '../lib/PresenceContext'

jest.mock('../lib/PresenceContext', () => ({ usePresence: jest.fn() }))
const mockPresence = usePresence as jest.Mock

function renderPill() {
  return render(
    <LanguageProvider>
      <OnlinePill />
    </LanguageProvider>,
  )
}

describe('OnlinePill', () => {
  it('renders nothing until the first heartbeat answers', () => {
    mockPresence.mockReturnValue(null)
    const { container } = renderPill()
    expect(container.firstChild).toBeNull()
  })

  it('shows the online count first', () => {
    mockPresence.mockReturnValue({ online: 5, peak: 11, users: 412 })
    renderPill()
    expect(screen.getByRole('button')).toHaveTextContent('5 online')
  })

  it('cycles through peak, users today and back on click', () => {
    mockPresence.mockReturnValue({ online: 5, peak: 11, users: 412 })
    renderPill()
    const pill = screen.getByRole('button')
    fireEvent.click(pill)
    expect(pill).toHaveTextContent('11 peak')
    expect(pill.getAttribute('title')).toMatch(/same time/i)
    fireEvent.click(pill)
    expect(pill).toHaveTextContent('412 today')
    expect(pill.getAttribute('title')).toMatch(/browsers/i)
    fireEvent.click(pill)
    expect(pill).toHaveTextContent('5 online')
  })
})
