/**
 * @jest-environment jsdom
 */
import { shareMatchAsImage } from '@/lib/shareMatchAsImage'

jest.mock('html-to-image', () => ({
  toJpeg: jest.fn(async () => 'data:image/jpeg;base64,AAAA'),
}))

import { toJpeg } from 'html-to-image'

function makeRow(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'ms-match ms-match--active ms-match--next-opp'
  el.innerHTML = `
    <div class="ms-meta"><span class="ms-event">WS</span></div>
    <div class="ms-team ms-team--1"><span class="ms-player-highlight">Alpha</span></div>
    <div class="ms-score">21-15</div>
    <div class="ms-team ms-team--2"><span>Beta</span></div>
  `
  return el
}

beforeEach(() => {
  ;(toJpeg as jest.Mock).mockClear()
  ;(toJpeg as jest.Mock).mockResolvedValue('data:image/jpeg;base64,AAAA')
  document.body.innerHTML = ''
  document.documentElement.classList.remove('dark')
  ;(global as { fetch: unknown }).fetch = jest.fn(async () => ({ blob: async () => new Blob(['x'], { type: 'image/jpeg' }) }))
  Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true })
  Object.defineProperty(navigator, 'share', { value: jest.fn(), configurable: true })
  if (typeof global.requestAnimationFrame !== 'function') {
    global.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0)) as typeof requestAnimationFrame
  }
})

describe('shareMatchAsImage', () => {
  it('renders to JPEG via toJpeg with the wrapper element', async () => {
    const row = makeRow()
    document.body.appendChild(row)
    await shareMatchAsImage({ matchEl: row, tournamentName: 'BAT Open', eventName: 'WS U19' })
    expect(toJpeg).toHaveBeenCalledTimes(1)
    const arg = (toJpeg as jest.Mock).mock.calls[0][0] as HTMLElement
    expect(arg).toBeInstanceOf(HTMLElement)
    expect(arg.querySelector('.ms-match')).not.toBeNull()
  })
})
