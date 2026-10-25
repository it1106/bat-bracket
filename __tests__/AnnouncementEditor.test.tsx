/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { AnnouncementEditor } from '@/components/BmStats'

const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})
const reply = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body })

describe('AnnouncementEditor', () => {
  it('loads the current text into the textarea and reports it on', async () => {
    fetchMock.mockResolvedValue(reply({ announcement: { text: 'current', id: 'aaa', updatedAt: Date.now() } }))
    render(<AnnouncementEditor />)
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('current'))
    expect(screen.getByText(/^On —/)).toBeInTheDocument()
  })

  it('reports off when there is no announcement', async () => {
    fetchMock.mockResolvedValue(reply({ announcement: null }))
    render(<AnnouncementEditor />)
    await waitFor(() => expect(screen.getByText(/^Off —/)).toBeInTheDocument())
    expect(screen.getByRole('textbox')).toHaveValue('')
  })

  it('posts the typed text on Save', async () => {
    fetchMock.mockResolvedValueOnce(reply({ announcement: null }))
    render(<AnnouncementEditor />)
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''))
    fetchMock.mockResolvedValueOnce(reply({ announcement: { text: 'typed', id: 'bbb', updatedAt: Date.now() } }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'typed' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe('/api/bmstats/announcement')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ text: 'typed' })
  })

  it('posts an empty text on Clear and reports off', async () => {
    fetchMock.mockResolvedValueOnce(reply({ announcement: { text: 'on now', id: 'aaa', updatedAt: Date.now() } }))
    render(<AnnouncementEditor />)
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('on now'))
    fetchMock.mockResolvedValueOnce(reply({ announcement: null }))
    fireEvent.click(screen.getByRole('button', { name: /clear/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ text: '' })
    await waitFor(() => expect(screen.getByText(/^Off —/)).toBeInTheDocument())
  })

  it('shows the server error and keeps the typed text', async () => {
    fetchMock.mockResolvedValueOnce(reply({ announcement: null }))
    render(<AnnouncementEditor />)
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''))
    fetchMock.mockResolvedValueOnce(reply({ error: 'The announcement can be at most 500 characters.' }, false, 400))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'too long' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/at most 500/)
    expect(screen.getByRole('textbox')).toHaveValue('too long')
  })

  it('shows a message when the server cannot be reached', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    render(<AnnouncementEditor />)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('disables Save until the text changes', async () => {
    fetchMock.mockResolvedValue(reply({ announcement: { text: 'same', id: 'aaa', updatedAt: Date.now() } }))
    render(<AnnouncementEditor />)
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('same'))
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'same!' } })
    expect(screen.getByRole('button', { name: /save/i })).toBeEnabled()
  })
})
