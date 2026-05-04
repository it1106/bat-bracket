'use client'

import { toJpeg } from 'html-to-image'

interface ShareMatchOptions {
  matchEl: HTMLElement
  tournamentName: string
  eventName: string
}

const HIGHLIGHT_CLASSES = ['ms-match--active', 'ms-match--next-opp', 'ms-match--tracked', 'ms-match--pressing']

function formatDate(date: Date): string {
  return date.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function buildHeader(tournamentName: string, eventName: string): HTMLElement {
  const header = document.createElement('div')
  header.style.cssText = `
    padding: 14px 14px 10px 14px;
    border-bottom: 2px solid #dee2e6;
    font-family: 'Segoe UI', system-ui, sans-serif;
    background: white;
  `
  header.innerHTML = `
    <div style="font-size:16px;font-weight:700;margin-bottom:2px;">
      <span style="color:#25316B;">BAT</span> <span style="color:#BE1D2E;">Unofficial</span> Scores
    </div>
    <div style="font-size:10px;color:#888;margin-bottom:6px;">Check BAT official website for accuracy</div>
    <div style="font-size:13px;font-weight:600;color:#333;margin-bottom:2px;">${tournamentName}</div>
    <div style="font-size:12px;color:#555;margin-bottom:4px;">${eventName}</div>
    <div style="font-size:10px;color:#999;">Exported: ${formatDate(new Date())}</div>
  `
  return header
}

function cleanClone(matchEl: HTMLElement): HTMLElement {
  const clone = matchEl.cloneNode(true) as HTMLElement
  for (const cls of HIGHLIGHT_CLASSES) clone.classList.remove(cls)
  clone.querySelectorAll('.ms-player-highlight').forEach((el) => el.classList.remove('ms-player-highlight'))
  return clone
}

export async function shareMatchAsImage(opts: ShareMatchOptions): Promise<void> {
  const { matchEl, tournamentName, eventName } = opts

  const root = document.documentElement
  const hadDark = root.classList.contains('dark')
  if (hadDark) root.classList.remove('dark')

  const wrapper = document.createElement('div')
  wrapper.style.cssText = `
    position: fixed; left: -9999px; top: 0; width: 380px;
    background: #ffffff; font-family: 'Segoe UI', system-ui, sans-serif;
  `
  wrapper.appendChild(buildHeader(tournamentName, eventName))
  wrapper.appendChild(cleanClone(matchEl))
  document.body.appendChild(wrapper)

  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )

  try {
    await toJpeg(wrapper, { quality: 0.95, pixelRatio: 2, backgroundColor: '#ffffff' })
  } catch (err) {
    console.warn('shareMatchAsImage: capture failed', err)
  } finally {
    document.body.removeChild(wrapper)
    if (hadDark) root.classList.add('dark')
  }
}
