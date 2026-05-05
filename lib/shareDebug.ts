'use client'

// Lightweight on-screen log for diagnosing the iOS long-press share flow.
// Entries auto-clear ~10s after the last write. Toggle off by deleting the
// shareDebug() calls and removing <ShareDebugOverlay /> from the page.

const MAX = 12
const CLEAR_AFTER_MS = 10_000

let buffer: string[] = []
const listeners = new Set<() => void>()
let clearHandle: ReturnType<typeof setTimeout> | null = null

function emit(): void {
  listeners.forEach((l) => l())
}

export function shareDebug(msg: string): void {
  const time = new Date().toTimeString().slice(0, 8)
  buffer = [`${time} ${msg}`, ...buffer].slice(0, MAX)
  if (clearHandle) clearTimeout(clearHandle)
  clearHandle = setTimeout(() => { buffer = []; emit() }, CLEAR_AFTER_MS)
  emit()
}

export function getShareDebug(): readonly string[] {
  return buffer
}

export function subscribeShareDebug(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}
