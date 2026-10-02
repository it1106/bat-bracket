/** @jest-environment jsdom */
import { nextTextSize, isTextSize, applyTextSize } from '@/lib/textSize'

describe('textSize', () => {
  it('cycles normal → large → larger → normal', () => {
    expect(nextTextSize('normal')).toBe('large')
    expect(nextTextSize('large')).toBe('larger')
    expect(nextTextSize('larger')).toBe('normal')
  })

  it('validates stored values', () => {
    expect(isTextSize('large')).toBe(true)
    expect(isTextSize('huge')).toBe(false)
    expect(isTextSize(null)).toBe(false)
  })

  it('sets the html attribute, and clears it for normal', () => {
    applyTextSize('larger')
    expect(document.documentElement.getAttribute('data-text-size')).toBe('larger')
    applyTextSize('normal')
    expect(document.documentElement.hasAttribute('data-text-size')).toBe(false)
  })
})
