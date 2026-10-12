/** @jest-environment jsdom */
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import PlayerSearchBox from '../components/PlayerSearchBox'
import { LanguageProvider } from '@/lib/LanguageContext'
import type { Suggestion } from '@/lib/searchSuggestions'

const CANDIDATES: Suggestion[] = [
  { value: 'Somchai Suksawat', kind: 'player' },
  { value: 'Somsak Chaiyo', kind: 'player' },
  { value: 'Anan Wongsiri', kind: 'player' },
  { value: 'BS U15', kind: 'event' },
]

/** Mirrors the page: the query lives above the box. */
function Harness({ initial = '' }: { initial?: string }) {
  const [q, setQ] = useState(initial)
  return (
    <LanguageProvider>
      <PlayerSearchBox value={q} onChange={setQ} candidates={CANDIDATES} />
      <output data-testid="query">{q}</output>
    </LanguageProvider>
  )
}

const box = () => screen.getByRole('combobox') as HTMLInputElement

/** Appends to whatever is in the box, the way typing does. */
const type = (text: string) =>
  fireEvent.change(box(), { target: { value: box().value + text } })

const query = () => screen.getByTestId('query').textContent

describe('PlayerSearchBox', () => {
  it('shows no list before anything is typed', () => {
    render(<Harness />)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('lists partial matches as the text is entered', () => {
    render(<Harness />)
    type('som')
    const options = screen.getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['Somchai Suksawat', 'Somsak Chaiyo'])
  })

  it('offers event types too, tagged as such', () => {
    render(<Harness />)
    type('u15')
    expect(screen.getByRole('option')).toHaveTextContent('BS U15')
    expect(screen.getByRole('option')).toHaveTextContent(/event/i)
  })

  it('shows nothing when the term matches no one', () => {
    render(<Harness />)
    type('zzz')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('fills the query when a suggestion is clicked', () => {
    render(<Harness />)
    type('som')
    fireEvent.mouseDown(screen.getByText('Somsak Chaiyo'))
    expect(query()).toBe('Somsak Chaiyo')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('completes only the segment being typed, keeping an & prefix', () => {
    render(<Harness initial="BS U15 & " />)
    type('wong')
    fireEvent.mouseDown(screen.getByText('Anan Wongsiri'))
    expect(query()).toBe('BS U15 & Anan Wongsiri')
  })

  it('moves through the list with the arrow keys and takes Enter', () => {
    render(<Harness />)
    type('som')
    fireEvent.keyDown(box(), { key: 'ArrowDown' })
    fireEvent.keyDown(box(), { key: 'ArrowDown' })
    expect(screen.getByText('Somsak Chaiyo').closest('li')).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(query()).toBe('Somsak Chaiyo')
  })

  it('wraps around when arrowing up from the top', () => {
    render(<Harness />)
    type('som')
    fireEvent.keyDown(box(), { key: 'ArrowUp' })
    expect(screen.getByText('Somsak Chaiyo').closest('li')).toHaveAttribute('aria-selected', 'true')
  })

  it('leaves the query alone on Enter with nothing highlighted', () => {
    render(<Harness />)
    type('som')
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(query()).toBe('som')
  })

  it('closes on Escape without changing the query', () => {
    render(<Harness />)
    type('som')
    fireEvent.keyDown(box(), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(query()).toBe('som')
  })

  it('closes when the reader taps outside', () => {
    render(<Harness />)
    type('som')
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('clears the query and the list with the ✕ button', () => {
    render(<Harness />)
    type('som')
    fireEvent.click(screen.getByLabelText('Clear search'))
    expect(query()).toBe('')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('does not suggest anything once the full value is in the box', () => {
    render(<Harness />)
    type('BS U15')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
