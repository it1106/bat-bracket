/**
 * @jest-environment jsdom
 */
import { shareMatchAsImage } from '@/lib/shareMatchAsImage'

jest.mock('html-to-image', () => ({
  toJpeg: jest.fn(async () => 'data:image/jpeg;base64,AAAA'),
  getFontEmbedCSS: jest.fn(async () => ''),
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
    global.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number) as typeof requestAnimationFrame
  }
  if (typeof URL.createObjectURL !== 'function') {
    Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:mock', configurable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, configurable: true })
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

  it('strips highlight classes from the cloned row but not the original', async () => {
    const row = makeRow()
    document.body.appendChild(row)
    await shareMatchAsImage({ matchEl: row, tournamentName: 'T', eventName: 'E' })
    expect(row.classList.contains('ms-match--active')).toBe(true)
    expect(row.classList.contains('ms-match--next-opp')).toBe(true)
    expect(row.querySelector('.ms-player-highlight')).not.toBeNull()
    const captured = (toJpeg as jest.Mock).mock.calls[0][0] as HTMLElement
    const cloned = captured.querySelector('.ms-match') as HTMLElement
    expect(cloned.classList.contains('ms-match--active')).toBe(false)
    expect(cloned.classList.contains('ms-match--next-opp')).toBe(false)
    expect(cloned.querySelector('.ms-player-highlight')).toBeNull()
  })

  it('does not toggle html.dark, applies ms-share-capture class on the wrapper', async () => {
    document.documentElement.classList.add('dark')
    const row = makeRow()
    document.body.appendChild(row)
    let darkDuringCapture: boolean | null = null
    let wrapperHadShareCaptureClass: boolean | null = null
    ;(toJpeg as jest.Mock).mockImplementation(async (el: HTMLElement) => {
      darkDuringCapture = document.documentElement.classList.contains('dark')
      wrapperHadShareCaptureClass = el.classList.contains('ms-share-capture')
      return 'data:image/jpeg;base64,AAAA'
    })
    await shareMatchAsImage({ matchEl: row, tournamentName: 'T', eventName: 'E' })
    expect(darkDuringCapture).toBe(true)
    expect(wrapperHadShareCaptureClass).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('removes the wrapper from document.body after capture', async () => {
    const row = makeRow()
    document.body.appendChild(row)
    const before = document.body.children.length
    await shareMatchAsImage({ matchEl: row, tournamentName: 'T', eventName: 'E' })
    expect(document.body.children.length).toBe(before)
  })

  it('removes the wrapper even when toJpeg throws', async () => {
    ;(toJpeg as jest.Mock).mockRejectedValueOnce(new Error('boom'))
    const row = makeRow()
    document.body.appendChild(row)
    const before = document.body.children.length
    await shareMatchAsImage({ matchEl: row, tournamentName: 'T', eventName: 'E' })
    expect(document.body.children.length).toBe(before)
  })

  it('calls navigator.share when canShare returns true', async () => {
    const share = jest.fn(async (_data?: unknown) => {})
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    const row = makeRow()
    document.body.appendChild(row)
    await shareMatchAsImage({ matchEl: row, tournamentName: 'T', eventName: 'E' })
    expect(share).toHaveBeenCalledTimes(1)
    const arg = share.mock.calls[0][0] as unknown as { files: File[] }
    expect(arg.files[0]).toBeInstanceOf(File)
    expect(arg.files[0].type).toBe('image/jpeg')
  })

  it('does nothing when canShare returns false (no download fallback)', async () => {
    Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true })
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const row = makeRow()
    document.body.appendChild(row)
    await shareMatchAsImage({ matchEl: row, tournamentName: 'BAT Open', eventName: 'WS U19' })
    expect(click).not.toHaveBeenCalled()
    click.mockRestore()
  })

  it('swallows AbortError from navigator.share', async () => {
    const abort = new Error('cancelled') as Error & { name: string }
    abort.name = 'AbortError'
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })
    Object.defineProperty(navigator, 'share', { value: jest.fn(async () => { throw abort }), configurable: true })
    const row = makeRow()
    document.body.appendChild(row)
    await expect(
      shareMatchAsImage({ matchEl: row, tournamentName: 'T', eventName: 'E' }),
    ).resolves.toBeUndefined()
  })

  it('injects scheduledTime into the cloned ms-meta when provided', async () => {
    const row = makeRow()
    document.body.appendChild(row)
    await shareMatchAsImage({ matchEl: row, tournamentName: 'T', eventName: 'E', scheduledTime: '10:00' })
    const captured = (toJpeg as jest.Mock).mock.calls[0][0] as HTMLElement
    const time = captured.querySelector('.ms-meta .ms-time') as HTMLElement | null
    expect(time).not.toBeNull()
    expect(time?.textContent).toBe('10:00')
    // Original row must remain untouched.
    expect(row.querySelector('.ms-time')).toBeNull()
  })

  it('does not add ms-time when scheduledTime is omitted', async () => {
    const row = makeRow()
    document.body.appendChild(row)
    await shareMatchAsImage({ matchEl: row, tournamentName: 'T', eventName: 'E' })
    const captured = (toJpeg as jest.Mock).mock.calls[0][0] as HTMLElement
    expect(captured.querySelector('.ms-time')).toBeNull()
  })

  it('swallows non-Abort rejection from navigator.share without downloading', async () => {
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })
    Object.defineProperty(navigator, 'share', { value: jest.fn(async () => { throw new Error('nope') }), configurable: true })
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const row = makeRow()
    document.body.appendChild(row)
    await expect(
      shareMatchAsImage({ matchEl: row, tournamentName: 'T', eventName: 'E' }),
    ).resolves.toBeUndefined()
    expect(click).not.toHaveBeenCalled()
    click.mockRestore()
  })
})
