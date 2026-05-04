'use client'

import { toJpeg } from 'html-to-image'

interface CaptureMatchImageOptions {
  matchEl: HTMLElement
  tournamentName: string
  filename: string
}

interface ShareOrDownloadOptions {
  file: File
  filename: string
  tournamentName: string
  eventName: string
}

const HIGHLIGHT_CLASSES = ['ms-match--active', 'ms-match--next-opp', 'ms-match--tracked', 'ms-match--pressing']
const FILENAME_MAX = 80

function buildSlug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-')
}

export function buildFilename(tournamentName: string, eventName: string): string {
  const base = `${buildSlug(tournamentName)}-${buildSlug(eventName)}-${Date.now()}.jpg`
  return base.length > FILENAME_MAX ? base.slice(0, FILENAME_MAX - 4) + '.jpg' : base
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

async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const blob = await (await fetch(dataUrl)).blob()
  return new File([blob], filename, { type: 'image/jpeg' })
}

export async function captureMatchImageFile(opts: CaptureMatchImageOptions): Promise<File> {
  const { matchEl, tournamentName, filename } = opts

  const root = document.documentElement
  const hadDark = root.classList.contains('dark')
  if (hadDark) root.classList.remove('dark')

  const wrapper = document.createElement('div')
  // The wrapper has to be in the DOM at a real on-screen position for iOS
  // Safari to rasterize it (off-screen produces a blank canvas), but we put
  // it behind the page with z-index:-1 so the user never sees it flash.
  wrapper.style.cssText = `
    position: fixed; left: 0; top: 0; width: 380px;
    background: #ffffff; font-family: 'Segoe UI', system-ui, sans-serif;
    z-index: -1; pointer-events: none;
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

  try {
    const dataUrl = await toJpeg(wrapper, {
      quality: 0.95,
      pixelRatio: 2,
      backgroundColor: '#ffffff',
      width: fullWidth,
      height: fullHeight,
    })
    return await dataUrlToFile(dataUrl, filename)
  } finally {
    document.body.removeChild(wrapper)
    if (hadDark) root.classList.add('dark')
  }
}

function downloadFile(file: File, filename: string): void {
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.download = filename
  link.href = url
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Synchronous entry: must be called inside a user-gesture handler chain
// (touchend / click) with no awaits between the gesture and this call.
// iOS Safari otherwise drops transient activation and rejects share().
export function shareOrDownloadFile(opts: ShareOrDownloadOptions): void {
  const { file, filename, tournamentName, eventName } = opts
  const hasShare = typeof navigator.share === 'function'
  const canShareFiles = typeof navigator.canShare === 'function'
    ? navigator.canShare({ files: [file] })
    : hasShare

  if (hasShare && canShareFiles) {
    navigator
      .share({ files: [file], title: tournamentName, text: `${tournamentName} — ${eventName}` })
      .catch((err: Error) => {
        if (err?.name === 'AbortError') return
        downloadFile(file, filename)
      })
    return
  }

  downloadFile(file, filename)
}

// Backward-compatible wrapper: capture then share/download in one call.
// Note: this awaits the capture before share(), which on iOS Safari loses
// transient activation and forces the download path. Use the
// captureMatchImageFile + shareOrDownloadFile pair for the gesture-aware flow.
export async function shareMatchAsImage(opts: { matchEl: HTMLElement; tournamentName: string; eventName: string }): Promise<void> {
  const filename = buildFilename(opts.tournamentName, opts.eventName)
  let file: File
  try {
    file = await captureMatchImageFile({ matchEl: opts.matchEl, tournamentName: opts.tournamentName, filename })
  } catch (err) {
    console.warn('shareMatchAsImage: capture failed', err)
    return
  }
  shareOrDownloadFile({ file, filename, tournamentName: opts.tournamentName, eventName: opts.eventName })
}
