'use client'

import { toJpeg } from 'html-to-image'

interface CaptureMatchImageOptions {
  matchEl: HTMLElement
  tournamentName: string
  filename: string
}

interface ShareFileOptions {
  file: File
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

  const wrapper = document.createElement('div')
  // The wrapper has to be in the DOM at a real on-screen position for iOS
  // Safari to rasterize it (off-screen produces a blank canvas), but we put
  // it behind the page with z-index:-1 so the user never sees it flash.
  // The .ms-share-capture class redefines CSS variables to light-mode
  // values in its subtree so we don't have to toggle html.dark globally.
  wrapper.className = 'ms-share-capture'
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
  }
}

// Synchronous entry: must be called inside a user-gesture handler chain
// (touchend / click) with no awaits between the gesture and this call.
// iOS Safari otherwise drops transient activation and rejects share().
// Files-only payload: title/text get prefilled as a message in iOS LINE,
// which we don't want — image-only matches Android behavior.
export function shareFile(opts: ShareFileOptions): void {
  const { file } = opts
  const hasShare = typeof navigator.share === 'function'
  const canShareFiles = typeof navigator.canShare === 'function'
    ? navigator.canShare({ files: [file] })
    : hasShare
  if (!hasShare || !canShareFiles) return
  navigator
    .share({ files: [file] })
    .catch(() => { /* swallow — no fallback */ })
}

export async function shareMatchAsImage(opts: { matchEl: HTMLElement; tournamentName: string; eventName: string }): Promise<void> {
  const filename = buildFilename(opts.tournamentName, opts.eventName)
  let file: File
  try {
    file = await captureMatchImageFile({ matchEl: opts.matchEl, tournamentName: opts.tournamentName, filename })
  } catch (err) {
    console.warn('shareMatchAsImage: capture failed', err)
    return
  }
  shareFile({ file })
}
