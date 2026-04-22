/**
 * @jest-environment jsdom
 */
import { useEffect } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ThemeProvider, useTheme } from '@/lib/ThemeContext'

function HotkeyHarness() {
  const { theme, toggleTheme } = useTheme()
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <input data-testid="search" />
      <HotkeyListener toggleTheme={toggleTheme} />
    </div>
  )
}

// Extracted listener mirrors the effect in app/page.tsx Task 15.
function HotkeyListener({ toggleTheme }: { toggleTheme: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'd' && e.key !== 'D') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      e.preventDefault()
      toggleTheme()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleTheme])
  return null
}

describe('d hotkey', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
  })

  it("'d' without a focused input toggles the theme", () => {
    render(<ThemeProvider><HotkeyHarness /></ThemeProvider>)
    expect(screen.getByTestId('theme').textContent).toBe('light')
    act(() => { fireEvent.keyDown(window, { key: 'd' }) })
    expect(screen.getByTestId('theme').textContent).toBe('dark')
  })

  it("'d' while input is focused does NOT toggle", () => {
    render(<ThemeProvider><HotkeyHarness /></ThemeProvider>)
    const input = screen.getByTestId('search') as HTMLInputElement
    input.focus()
    expect(document.activeElement).toBe(input)
    act(() => { fireEvent.keyDown(window, { key: 'd' }) })
    expect(screen.getByTestId('theme').textContent).toBe('light')
  })

  it("'d' with Cmd/Ctrl held does NOT toggle", () => {
    render(<ThemeProvider><HotkeyHarness /></ThemeProvider>)
    act(() => { fireEvent.keyDown(window, { key: 'd', metaKey: true }) })
    expect(screen.getByTestId('theme').textContent).toBe('light')
    act(() => { fireEvent.keyDown(window, { key: 'd', ctrlKey: true }) })
    expect(screen.getByTestId('theme').textContent).toBe('light')
  })
})
