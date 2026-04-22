/**
 * @jest-environment jsdom
 */
import { render, screen, act } from '@testing-library/react'
import { ThemeProvider, useTheme } from '@/lib/ThemeContext'

function Consumer() {
  const { theme, toggleTheme } = useTheme()
  return (
    <>
      <span data-testid="theme">{theme}</span>
      <button onClick={toggleTheme}>toggle</button>
    </>
  )
}

describe('ThemeContext', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
  })

  it('defaults to light when localStorage is empty', () => {
    render(<ThemeProvider><Consumer /></ThemeProvider>)
    expect(screen.getByTestId('theme').textContent).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('restores dark from localStorage', () => {
    localStorage.setItem('bat-theme', 'dark')
    document.documentElement.classList.add('dark')
    render(<ThemeProvider><Consumer /></ThemeProvider>)
    expect(screen.getByTestId('theme').textContent).toBe('dark')
  })

  it('toggleTheme flips theme, updates DOM, and persists to localStorage', () => {
    render(<ThemeProvider><Consumer /></ThemeProvider>)
    act(() => { screen.getByRole('button', { name: 'toggle' }).click() })
    expect(screen.getByTestId('theme').textContent).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('bat-theme')).toBe('dark')
    act(() => { screen.getByRole('button', { name: 'toggle' }).click() })
    expect(screen.getByTestId('theme').textContent).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('bat-theme')).toBe('light')
  })
})
