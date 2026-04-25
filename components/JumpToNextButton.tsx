'use client'

import { useLanguage } from '@/lib/LanguageContext'

interface Props {
  visible: boolean
  onClick: () => void
}

export default function JumpToNextButton({ visible, onClick }: Props) {
  const { t } = useLanguage()
  if (!visible) return null
  const label = t('jumpToNext')
  return (
    <button
      type="button"
      className="ms-jump-next"
      aria-label={label}
      onClick={onClick}
    >
      {label}
    </button>
  )
}
