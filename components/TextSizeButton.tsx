'use client'

// Text-size toolbar button, labelled A / A+ / A++ for the current step: cycles
// Normal → Large → Larger and remembers the choice per device. See lib/textSize.ts for how the size is applied.

import { useEffect, useState } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import { track } from '@/lib/analytics'
import {
  TEXT_SIZE_KEY, applyTextSize, isTextSize, nextTextSize, type TextSize,
} from '@/lib/textSize'

export default function TextSizeButton() {
  const { t } = useLanguage()
  const [size, setSize] = useState<TextSize>('normal')

  // The pre-paint script already set html[data-text-size]; just sync state.
  useEffect(() => {
    const current = document.documentElement.getAttribute('data-text-size')
    if (isTextSize(current)) setSize(current)
  }, [])

  const label = t('textSize').replace('{size}', t(
    size === 'normal' ? 'textSizeNormal' : size === 'large' ? 'textSizeLarge' : 'textSizeLarger',
  ))

  return (
    <button
      onClick={() => {
        const next = nextTextSize(size)
        track('text_size_changed', { from: size, to: next })
        applyTextSize(next)
        setSize(next)
        try {
          if (next === 'normal') localStorage.removeItem(TEXT_SIZE_KEY)
          else localStorage.setItem(TEXT_SIZE_KEY, next)
        } catch {}
      }}
      aria-label={label}
      title={label}
      className="inline-flex items-center justify-center min-w-[30px] h-[28px] px-1 rounded-md border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--bg)] text-[var(--fg)] font-semibold leading-none"
    >
      {/* Fixed px on purpose: the button stays the same size at every setting. */}
      <span style={{ fontSize: 13 }}>{size === 'normal' ? 'A' : size === 'large' ? 'A+' : 'A++'}</span>
    </button>
  )
}
