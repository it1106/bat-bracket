// Age helpers shared by the country-roster modal. Kept provider-agnostic: they
// operate on an ISO date-of-birth string ("YYYY-MM-DD").

// Whole years between a date of birth and a reference date (default: now).
// Returns null for a missing/unparseable DOB, or for a DOB in the future.
export function ageFromDob(dobIso: string | null | undefined, asOf: Date = new Date()): number | null {
  if (!dobIso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dobIso)
  if (!m) return null
  const [, y, mo, d] = m
  const birth = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)))
  if (Number.isNaN(birth.getTime())) return null
  let age = asOf.getUTCFullYear() - birth.getUTCFullYear()
  const beforeBirthday =
    asOf.getUTCMonth() < birth.getUTCMonth() ||
    (asOf.getUTCMonth() === birth.getUTCMonth() && asOf.getUTCDate() < birth.getUTCDate())
  if (beforeBirthday) age--
  return age < 0 ? null : age
}

const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  th: ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'],
}

// Human-readable DOB for the hover tooltip: "2013-06-06" → "6 Jun 2013"
// (en) / "6 มิ.ย. 2013" (th). Year stays Gregorian (BWF supplies it that way).
export function formatDob(dobIso: string | null | undefined, lang: 'en' | 'th' = 'en'): string {
  if (!dobIso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dobIso)
  if (!m) return ''
  const [, y, mo, d] = m
  const mon = (MONTHS[lang] ?? MONTHS.en)[Number(mo) - 1]
  if (!mon) return ''
  return `${Number(d)} ${mon} ${y}`
}
