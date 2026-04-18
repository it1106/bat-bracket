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
  // Build header to temporarily inject before the bracket content
  const header = document.createElement('div')
  header.style.cssText = `
    margin-bottom: 20px;
    padding-bottom: 16px;
    border-bottom: 2px solid #dee2e6;
    font-family: 'Segoe UI', system-ui, sans-serif;
    background: white;
  `
  header.innerHTML = `
    <div style="font-size:20px;font-weight:700;color:#1a1a1a;margin-bottom:4px;">
      BAT <span style="color:#2563eb;">Brackets</span>
    </div>
    <div style="font-size:15px;font-weight:600;color:#333;margin-bottom:2px;">${tournamentName}</div>
    <div style="font-size:13px;color:#555;margin-bottom:6px;">${eventName}</div>
    <div style="font-size:11px;color:#999;">Exported: ${formatDate(new Date())}</div>
  `

  // Save current transform, reset to 1:1 for capture
  const origTransform = bracketEl.style.transform
  const origTransition = bracketEl.style.transition
  bracketEl.style.transform = 'none'
  bracketEl.style.transition = 'none'

  // Temporarily remove overflow clipping from parent so html-to-image captures full content
  const parent = bracketEl.parentElement
  const origOverflow = parent?.style.overflow ?? ''
  if (parent) parent.style.overflow = 'visible'

  // Prepend header into the live element (already in DOM, styles fully computed)
  bracketEl.insertBefore(header, bracketEl.firstChild)

  // Wait two frames so the browser paints the reset state before capture
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  )

  // Use scrollWidth/scrollHeight to capture full content, not just visible viewport
  const fullWidth = bracketEl.scrollWidth
  const fullHeight = bracketEl.scrollHeight

  try {
    const dataUrl = await toJpeg(bracketEl, {
      quality: 0.95,
      pixelRatio: 2,
      backgroundColor: '#ffffff',
      width: fullWidth,
      height: fullHeight,
    })
    const link = document.createElement('a')
    link.download = `${buildSlug(tournamentName)}-${buildSlug(eventName)}.jpg`
    link.href = dataUrl
    link.click()
  } finally {
    bracketEl.removeChild(header)
    bracketEl.style.transform = origTransform
    bracketEl.style.transition = origTransition
    if (parent) parent.style.overflow = origOverflow
  }
}
