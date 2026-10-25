/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import AnnouncementPopup from '@/components/AnnouncementPopup'

let pathname = '/'
jest.mock('next/navigation', () => ({ usePathname: () => pathname }))
const track = jest.fn()
jest.mock('../lib/analytics', () => ({ track: (...a: unknown[]) => track(...a) }))

const serve = (announcement: unknown, ok = true) => {
  global.fetch = jest.fn().mockResolvedValue({
    ok, json: async () => ({ announcement }),
  }) as unknown as typeof fetch
}

beforeEach(() => {
  pathname = '/'
  localStorage.clear()
  track.mockClear()
})

describe('AnnouncementPopup', () => {
  it('shows the text and an OK button when nothing has been seen', async () => {
    serve({ id: 'aaa', text: 'ประกาศใหม่' })
    render(<AnnouncementPopup />)
    expect(await screen.findByText('ประกาศใหม่')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ok/i })).toBeInTheDocument()
  })

  it('stores the id and reports the dismissal when OK is clicked', async () => {
    serve({ id: 'aaa', text: 'hello' })
    render(<AnnouncementPopup />)
    fireEvent.click(await screen.findByRole('button', { name: /ok/i }))
    expect(localStorage.getItem('batbracket.announcementSeen')).toBe('aaa')
    expect(track).toHaveBeenCalledWith('announcement_dismissed', { id: 'aaa' })
    expect(screen.queryByText('hello')).not.toBeInTheDocument()
  })

  it('stays away for an id already seen', async () => {
    localStorage.setItem('batbracket.announcementSeen', 'aaa')
    serve({ id: 'aaa', text: 'hello' })
    render(<AnnouncementPopup />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByText('hello')).not.toBeInTheDocument()
  })

  it('shows again once the id changes', async () => {
    localStorage.setItem('batbracket.announcementSeen', 'aaa')
    serve({ id: 'bbb', text: 'new text' })
    render(<AnnouncementPopup />)
    expect(await screen.findByText('new text')).toBeInTheDocument()
  })

  it('shows nothing when the announcement is off', async () => {
    serve(null)
    render(<AnnouncementPopup />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows nothing when the fetch fails or the body is unusable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch
    const { unmount } = render(<AnnouncementPopup />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    unmount()

    serve({ id: 'aaa', text: 'nope' }, false)
    render(<AnnouncementPopup />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders markup in the text as literal characters', async () => {
    serve({ id: 'aaa', text: '<script>alert(1)</script> & <b>bold</b>' })
    render(<AnnouncementPopup />)
    expect(await screen.findByText('<script>alert(1)</script> & <b>bold</b>')).toBeInTheDocument()
    expect(document.querySelector('script')).toBeNull()
    expect(document.querySelector('b')).toBeNull()
  })

  it('keeps line breaks from the textarea', async () => {
    serve({ id: 'aaa', text: 'line one\nline two' })
    render(<AnnouncementPopup />)
    const el = await screen.findByText(/line one/)
    expect(el).toHaveClass('whitespace-pre-wrap')
  })

  it('treats Escape and a backdrop click as OK', async () => {
    serve({ id: 'aaa', text: 'hello' })
    const { unmount } = render(<AnnouncementPopup />)
    await screen.findByText('hello')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(localStorage.getItem('batbracket.announcementSeen')).toBe('aaa')
    unmount()

    localStorage.clear()
    serve({ id: 'bbb', text: 'again' })
    render(<AnnouncementPopup />)
    await screen.findByText('again')
    fireEvent.click(document.querySelector('.pm-overlay')!)
    expect(localStorage.getItem('batbracket.announcementSeen')).toBe('bbb')
  })

  it('still closes when storage refuses the write', async () => {
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    serve({ id: 'aaa', text: 'hello' })
    render(<AnnouncementPopup />)
    fireEvent.click(await screen.findByRole('button', { name: /ok/i }))
    expect(screen.queryByText('hello')).not.toBeInTheDocument()
    spy.mockRestore()
  })

  it('never appears on /bmstats', async () => {
    pathname = '/bmstats'
    serve({ id: 'aaa', text: 'hello' })
    render(<AnnouncementPopup />)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
