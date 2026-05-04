'use client'

import { toJpeg } from 'html-to-image'

interface ShareMatchOptions {
  matchEl: HTMLElement
  tournamentName: string
  eventName: string
}

const HIGHLIGHT_CLASSES = ['ms-match--active', 'ms-match--next-opp', 'ms-match--tracked', 'ms-match--pressing']
const FILENAME_MAX = 80

function buildSlug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-')
}

function buildHeader(tournamentName: string): HTMLElement {
  const header = document.createElement('div')
  header.style.cssText = `
    padding: 12px 14px;
    border-bottom: 2px solid #dee2e6;
    font-family: 'Segoe UI', system-ui, sans-serif;
    background: white;
    font-size: 13px;
    font-weight: 600;
    color: #333;
  `
  header.textContent = tournamentName
  return header
}

function cleanClone(matchEl: HTMLElement): HTMLElement {
  const clone = matchEl.cloneNode(true) as HTMLElement
  for (const cls of HIGHLIGHT_CLASSES) clone.classList.remove(cls)
  clone.querySelectorAll('.ms-player-highlight').forEach((el) => el.classList.remove('ms-player-highlight'))
  clone.querySelectorAll('.ms-h2h-inline').forEach((el) => el.remove())
  return clone
}

function buildFilename(tournamentName: string, eventName: string): string {
  const base = `${buildSlug(tournamentName)}-${buildSlug(eventName)}-${Date.now()}.jpg`
  return base.length > FILENAME_MAX ? base.slice(0, FILENAME_MAX - 4) + '.jpg' : base
}

async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const blob = await (await fetch(dataUrl)).blob()
  return new File([blob], filename, { type: 'image/jpeg' })
}

function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement('a')
  link.download = filename
  link.href = dataUrl
  link.click()
}

export async function shareMatchAsImage(opts: ShareMatchOptions): Promise<void> {
  const { matchEl, tournamentName, eventName } = opts
  void eventName // kept in API for filename + share sheet text

  const root = document.documentElement
  const hadDark = root.classList.contains('dark')
  if (hadDark) root.classList.remove('dark')

  const wrapper = document.createElement('div')
  wrapper.style.cssText = `
    position: fixed; left: 0; top: 0; width: 380px;
    background: #ffffff; font-family: 'Segoe UI', system-ui, sans-serif;
    z-index: 2147483647; pointer-events: none;
  `
  wrapper.appendChild(buildHeader(tournamentName))
  wrapper.appendChild(cleanClone(matchEl))
  document.body.appendChild(wrapper)

  if (document.fonts?.ready) {
    try { await document.fonts.ready } catch { /* ignore */ }
  }
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )

  const fullWidth = wrapper.scrollWidth
  const fullHeight = wrapper.scrollHeight

  let dataUrl: string | null = null
  try {
    dataUrl = await toJpeg(wrapper, {
      quality: 0.95,
      pixelRatio: 2,
      backgroundColor: '#ffffff',
      width: fullWidth,
      height: fullHeight,
    })
  } catch (err) {
    console.warn('shareMatchAsImage: capture failed', err)
  } finally {
    document.body.removeChild(wrapper)
    if (hadDark) root.classList.add('dark')
  }

  if (!dataUrl) return

  const filename = buildFilename(tournamentName, eventName)
  const file = await dataUrlToFile(dataUrl, filename)
  const hasShare = typeof navigator.share === 'function'
  const canShareFiles = typeof navigator.canShare === 'function'
    ? navigator.canShare({ files: [file] })
    : hasShare

  if (hasShare && canShareFiles) {
    try {
      await navigator.share({ files: [file], title: tournamentName, text: `${tournamentName} — ${eventName}` })
      return
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
    }
  }

  downloadDataUrl(dataUrl, filename)
}
