'use client'

import { useEffect, useState } from 'react'
import { getShareDebug, subscribeShareDebug } from '@/lib/shareDebug'

export default function ShareDebugOverlay() {
  const [, setTick] = useState(0)
  useEffect(() => subscribeShareDebug(() => setTick((t) => t + 1)), [])
  const lines = getShareDebug()
  if (lines.length === 0) return null
  return (
    <div
      style={{
        position: 'fixed',
        top: 4,
        right: 4,
        zIndex: 99999,
        maxWidth: '70vw',
        background: 'rgba(0,0,0,0.78)',
        color: '#0f0',
        font: '11px/1.3 ui-monospace,Menlo,monospace',
        padding: '6px 8px',
        borderRadius: 6,
        pointerEvents: 'none',
        whiteSpace: 'pre',
      }}
    >
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  )
}
