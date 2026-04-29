'use client'

import { useEffect, useState } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import { useScrollActivity } from '@/lib/useScrollActivity'

export default function ScrollToTopButton() {
  const { t } = useLanguage()
  const [scrolled, setScrolled] = useState(false)
  const active = useScrollActivity()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 300)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (!scrolled) return null
  const label = t('scrollToTop')
  return (
    <button
      type="button"
      className={`ms-scroll-top${active ? '' : ' ms-scroll-top--hidden'}`}
      aria-label={label}
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
    >
      {label}
    </button>
  )
}
