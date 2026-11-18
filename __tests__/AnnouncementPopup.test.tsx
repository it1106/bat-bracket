/**
 * @jest-environment jsdom
 */
import { render as rtlRender, screen, waitFor, fireEvent } from '@testing-library/react'
import type { ReactElement } from 'react'
import AnnouncementPopup from '@/components/AnnouncementPopup'
import { LanguageProvider } from '@/lib/LanguageContext'

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: LanguageProvider })

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

  it('shows nothing when a 200 carries a body that is not JSON', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: async () => { throw new SyntaxError('Unexpected token <') },
    }) as unknown as typeof fetch
    render(<AnnouncementPopup />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('goes away when a client navigation lands on /bmstats while it is open', async () => {
    serve({ id: 'aaa', text: 'hello' })
    const { rerender } = render(<AnnouncementPopup />)
    expect(await screen.findByText('hello')).toBeInTheDocument()
    pathname = '/bmstats'
    rerender(<AnnouncementPopup />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('AnnouncementPopup — new tournaments', () => {
  const A = { id: 'AAAA', name: 'Alpha Open 2026', addedAt: '2026-11-18T01:00:00Z' }
  const B = { id: 'BBBB', name: 'Beta Cup 2026', addedAt: '2026-11-18T00:00:00Z' }

  const serveBoth = (announcement: unknown, tournaments: unknown, updates: unknown = []) => {
    global.fetch = jest.fn().mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () => (url.includes('tournament-news') ? { tournaments, updates } : { announcement }),
      }),
    ) as unknown as typeof fetch
  }

  it('lists every unseen new tournament in one pop-up with a link to open each', async () => {
    serveBoth(null, [A, B])
    render(<AnnouncementPopup />)
    expect(await screen.findByText('Alpha Open 2026')).toBeInTheDocument()
    expect(screen.getByText('Beta Cup 2026')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'ทัวร์นาเมนต์ใหม่' })).toBeInTheDocument()
    const links = screen.getAllByRole('link', { name: 'เปิดดู' })
    expect(links[0]).toHaveAttribute('href', '/?tournament=AAAA&name=Alpha%20Open%202026')
  })

  it('is in Thai even when the site is switched to English', async () => {
    localStorage.setItem('batbracket.lang', 'en')
    serveBoth(null, [A])
    render(<AnnouncementPopup />)
    expect(await screen.findByRole('dialog', { name: 'ทัวร์นาเมนต์ใหม่' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ตกลง' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ปิด' })).toBeInTheDocument()
  })

  it('remembers the tournaments on OK and leaves out ones already seen', async () => {
    localStorage.setItem('batbracket.newTournamentsSeen', JSON.stringify(['BBBB']))
    serveBoth(null, [A, B])
    render(<AnnouncementPopup />)
    await screen.findByText('Alpha Open 2026')
    expect(screen.queryByText('Beta Cup 2026')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ตกลง' }))
    expect(JSON.parse(localStorage.getItem('batbracket.newTournamentsSeen')!)).toEqual(['BBBB', 'AAAA'])
    expect(track).toHaveBeenCalledWith('new_tournament_popup_dismissed', { ids: ['AAAA'] })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows nothing when every new tournament has been seen', async () => {
    localStorage.setItem('batbracket.newTournamentsSeen', JSON.stringify(['AAAA']))
    serveBoth(null, [A])
    render(<AnnouncementPopup />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it("shows the owner's announcement first, then the new tournaments", async () => {
    serveBoth({ id: 'own', text: 'owner says hi' }, [A])
    render(<AnnouncementPopup />)
    expect(await screen.findByText('owner says hi')).toBeInTheDocument()
    expect(screen.queryByText('Alpha Open 2026')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /ok/i }))
    expect(localStorage.getItem('batbracket.announcementSeen')).toBe('own')
    expect(await screen.findByText('Alpha Open 2026')).toBeInTheDocument()
    // Closing the tournament pop-up leaves the owner's announcement remembered as-is.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(localStorage.getItem('batbracket.announcementSeen')).toBe('own')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('marks them seen when one is opened', async () => {
    serveBoth(null, [A, B])
    render(<AnnouncementPopup />)
    const links = await screen.findAllByRole('link', { name: 'เปิดดู' })
    links[1].addEventListener('click', (e) => e.preventDefault())
    fireEvent.click(links[1])
    expect(JSON.parse(localStorage.getItem('batbracket.newTournamentsSeen')!)).toEqual(['AAAA', 'BBBB'])
    expect(track).toHaveBeenCalledWith('new_tournament_popup_opened', { id: 'BBBB' })
  })

  it('ignores malformed entries', async () => {
    serveBoth(null, [null, { id: 1, name: 'x' }, { id: 'CCCC', name: '' }, 'junk'])
    render(<AnnouncementPopup />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  const DRAWS = {
    id: 'b:AAAA:2026-11-18T02:00:00.000Z', kind: 'bracket', tournamentId: 'AAAA', tournamentName: 'Alpha Open 2026',
    items: ['MS U15', 'WS U15', 'MD U15', 'WD U15', 'XD U15', 'MS U17'],
  }
  const SCHEDULE = {
    id: 's:BBBB:2026-11-18T03:00:00.000Z', kind: 'schedule', tournamentId: 'BBBB', tournamentName: 'Beta Cup 2026',
    items: ['2026-11-20', '2026-11-21'],
  }

  it('lists published draws and schedules in Thai, with a link to each tournament', async () => {
    serveBoth(null, [], [DRAWS, SCHEDULE])
    render(<AnnouncementPopup />)
    expect(await screen.findByText('📋 สายการแข่งขันออกแล้ว')).toBeInTheDocument()
    expect(screen.getByText('📅 ตารางแข่งออกแล้ว')).toBeInTheDocument()
    expect(screen.getByText('MS U15, WS U15, MD U15, WD U15 +อีก 2')).toBeInTheDocument()
    expect(screen.getByText('20 พ.ย., 21 พ.ย.')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'ข่าวการแข่งขัน' })).toBeInTheDocument()
    const links = screen.getAllByRole('link', { name: 'เปิดดู' })
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/?tournament=AAAA&name=Alpha%20Open%202026',
      '/?tournament=BBBB&name=Beta%20Cup%202026',
    ])
  })

  it('puts new tournaments, draws and schedules in one card and remembers all of them', async () => {
    serveBoth({ id: 'own', text: 'owner' }, [A], [DRAWS, SCHEDULE])
    render(<AnnouncementPopup />)
    fireEvent.click(await screen.findByRole('button', { name: /ok/i }))
    expect(await screen.findByText('🏸 ทัวร์นาเมนต์ใหม่')).toBeInTheDocument()
    expect(screen.getByText('📋 สายการแข่งขันออกแล้ว')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ตกลง' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('batbracket.newTournamentsSeen')!)).toEqual(['AAAA', DRAWS.id, SCHEDULE.id])
  })

  it('leaves out an update already seen', async () => {
    localStorage.setItem('batbracket.newTournamentsSeen', JSON.stringify([DRAWS.id]))
    serveBoth(null, [], [DRAWS, SCHEDULE])
    render(<AnnouncementPopup />)
    expect(await screen.findByText('📅 ตารางแข่งออกแล้ว')).toBeInTheDocument()
    expect(screen.queryByText('📋 สายการแข่งขันออกแล้ว')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'ตารางแข่งออกแล้ว' })).toBeInTheDocument()
  })

  it('ignores malformed updates', async () => {
    serveBoth(null, [], [{ ...DRAWS, kind: 'other' }, { ...SCHEDULE, items: [] }, { ...DRAWS, items: [1] }, null])
    render(<AnnouncementPopup />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
