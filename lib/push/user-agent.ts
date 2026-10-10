// The device's operating system, for the status page's device table.
//
// One coarse word, never the user-agent itself: the full string is a strong
// fingerprint, and the privacy notice promises only what the alerts need.
//
// An iPad reports itself as a Mac (iPadOS 13 and later send a desktop Safari
// user agent), so it is counted as macOS here. Telling the two apart needs the
// browser's own touch-point count, which this never sees.

export type DeviceOs = 'iOS' | 'Android' | 'macOS' | 'Windows' | 'Linux' | 'ChromeOS' | ''

/** The OS behind a user agent, or '' when it is not one we recognise. */
export function osFromUserAgent(ua: string | undefined | null): DeviceOs {
  const s = ua ?? ''
  // Order matters: an Android or ChromeOS agent also says Linux.
  if (/iPhone|iPad|iPod/.test(s)) return 'iOS'
  if (/Android/.test(s)) return 'Android'
  if (/CrOS/.test(s)) return 'ChromeOS'
  if (/Windows/.test(s)) return 'Windows'
  if (/Macintosh|Mac OS X/.test(s)) return 'macOS'
  if (/Linux|X11/.test(s)) return 'Linux'
  return ''
}
