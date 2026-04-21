'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { translate, type Lang, type TKey, longRoundL, abbrevRoundL } from './i18n'

interface LanguageContextValue {
  lang: Lang
  setLang: (l: Lang) => void
  toggleLang: () => void
  t: (key: TKey) => string
  longRound: (name: string) => string
  abbrevRound: (name: string) => string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

const STORAGE_KEY = 'batbracket.lang'

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en')

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === 'en' || stored === 'th') setLangState(stored)
    } catch {}
  }, [])

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang
    }
  }, [lang])

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    try { localStorage.setItem(STORAGE_KEY, l) } catch {}
  }, [])

  const toggleLang = useCallback(() => {
    setLang(lang === 'en' ? 'th' : 'en')
  }, [lang, setLang])

  const t = useCallback((key: TKey) => translate(key, lang), [lang])
  const longRound = useCallback((name: string) => longRoundL(name, lang), [lang])
  const abbrevRound = useCallback((name: string) => abbrevRoundL(name, lang), [lang])

  return (
    <LanguageContext.Provider value={{ lang, setLang, toggleLang, t, longRound, abbrevRound }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider')
  return ctx
}
