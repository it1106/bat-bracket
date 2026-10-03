// The built-in search aliases: the starting list before anything is changed on
// /bmstats. In its own file, free of React, so the server-side alias store can
// import it as well as the client-side search.
export const DEFAULT_ALIASES: Readonly<Record<string, string>> = {
  kba: 'เกษมศักดิ์ Badminton Academy',
  bty: 'บ้านทองหยอด',
  ren: 'รวิณ',
  aston: 'นริศ',
  trilert: 'ตรีเลิศ',
  pharmacy: 'เภสัชพลัส',
  rlc: 'รีแลกซ์คอร์ทหนองคาย'
}
