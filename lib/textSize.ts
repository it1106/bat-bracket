// Reader-chosen text size, cycled by the aA toolbar button. Stored per
// device and applied as html[data-text-size]; globals.css maps each size to a
// --text-user multiplier on top of the device default (1 desktop, 1.125 phone).

export const TEXT_SIZES = ['normal', 'large', 'larger'] as const
export type TextSize = (typeof TEXT_SIZES)[number]

export const TEXT_SIZE_KEY = 'bat-text-size'

export function isTextSize(v: unknown): v is TextSize {
  return typeof v === 'string' && (TEXT_SIZES as readonly string[]).includes(v)
}

export function nextTextSize(size: TextSize): TextSize {
  return TEXT_SIZES[(TEXT_SIZES.indexOf(size) + 1) % TEXT_SIZES.length]
}

/** Reflect a size on <html>. 'normal' removes the attribute. */
export function applyTextSize(size: TextSize): void {
  const el = document.documentElement
  if (size === 'normal') el.removeAttribute('data-text-size')
  else el.setAttribute('data-text-size', size)
}

/** Inline pre-paint script for layout.tsx, so a saved size never flashes. */
export const TEXT_SIZE_NO_FLASH =
  `(function(){try{var s=localStorage.getItem('${TEXT_SIZE_KEY}');` +
  `if(s==='large'||s==='larger'){document.documentElement.setAttribute('data-text-size',s);}}catch(e){}})();`
