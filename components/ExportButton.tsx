'use client'

import { toJpeg } from 'html-to-image'

interface ExportOptions {
  bracketEl: HTMLElement
  tournamentName: string
  eventName: string
}

function buildSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

function formatDate(date: Date): string {
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export async function exportBracketAsJpg({
  bracketEl,
  tournamentName,
  eventName,
}: ExportOptions): Promise<void> {
  const wrapper = document.createElement('div')
  wrapper.style.cssText = `
    position: fixed;
    top: -99999px;
    left: -99999px;
    background: white;
    padding: 24px;
    font-family: 'Segoe UI', system-ui, sans-serif;
  `

  const header = document.createElement('div')
  header.style.cssText = `
    margin-bottom: 20px;
    padding-bottom: 16px;
    border-bottom: 2px solid #dee2e6;
  `
  header.innerHTML = `
    <div style="font-size:20px;font-weight:700;color:#1a1a1a;margin-bottom:4px;">
      BAT <span style="color:#2563eb;">Brackets</span>
    </div>
    <div style="font-size:15px;font-weight:600;color:#333;margin-bottom:2px;">${tournamentName}</div>
    <div style="font-size:13px;color:#555;margin-bottom:6px;">${eventName}</div>
    <div style="font-size:11px;color:#999;">Exported: ${formatDate(new Date())}</div>
  `

  const bracketClone = bracketEl.cloneNode(true) as HTMLElement

  wrapper.appendChild(header)
  wrapper.appendChild(bracketClone)
  document.body.appendChild(wrapper)

  try {
    const dataUrl = await toJpeg(wrapper, { quality: 0.95, pixelRatio: 2 })
    const link = document.createElement('a')
    link.download = `${buildSlug(tournamentName)}-${buildSlug(eventName)}.jpg`
    link.href = dataUrl
    link.click()
  } finally {
    document.body.removeChild(wrapper)
  }
}
