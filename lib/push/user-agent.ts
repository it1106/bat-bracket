// The device's operating system, one coarse word.
//
// Used for the status page's device table (push alerts) and for today's
// visitors by device on /bmstats. They read a user agent the same way, with
// one difference: only the /bmstats heartbeat passes the touch hint below, so
// an iPad asking for the desktop site is an iPad there and a Mac in the device
// table. Sending the hint from the push routes too would close that gap.
//
// Never the user-agent itself: the full string is a strong fingerprint, and
// the privacy notice promises only what each feature needs.
//
// An iPad is the awkward one. iPadOS 13 and later send a desktop Safari user
// agent, so an iPad asking for the desktop site is indistinguishable from a
// Mac here — the user agent alone cannot tell them apart. What can is the
// browser's own touch-point count, which only the page knows: see osWithTouch
// and the heartbeat in lib/PresenceContext. An iPad that identifies itself
// (mobile mode, and older iPadOS) is read straight from the agent.

/** Every OS recognised, each its own word. '' is an agent we do not know. */
export const DEVICE_OSES = ['iOS', 'iPadOS', 'Android', 'macOS', 'Windows', 'Linux', 'ChromeOS'] as const

export type DeviceOs = (typeof DEVICE_OSES)[number] | ''

/** Whether a value is one of our OS words (or '' for unknown). Saved files and
 *  request bodies are untrusted, so anything from them goes through this. */
export function isDeviceOs(value: unknown): value is DeviceOs {
  return value === '' || (DEVICE_OSES as readonly unknown[]).includes(value)
}

/** The OS behind a user agent, or '' when it is not one we recognise. */
export function osFromUserAgent(ua: string | undefined | null): DeviceOs {
  const s = ua ?? ''
  // Order matters: an iPad's agent also says it is like a Mac, and an Android
  // or ChromeOS agent also says Linux.
  if (/iPad/.test(s)) return 'iPadOS'
  if (/iPhone|iPod/.test(s)) return 'iOS'
  if (/Android/.test(s)) return 'Android'
  if (/CrOS/.test(s)) return 'ChromeOS'
  if (/Windows/.test(s)) return 'Windows'
  if (/Macintosh|Mac OS X/.test(s)) return 'macOS'
  if (/Linux|X11/.test(s)) return 'Linux'
  return ''
}

/** The OS again, with what only the browser knows: whether it is a touch
 *  device. A Mac has no touch screen, so a Macintosh agent that reports touch
 *  points is an iPad asking for the desktop site. Everything else is left
 *  alone — a touch Windows laptop is still Windows. */
export function osWithTouch(os: DeviceOs, touch: boolean): DeviceOs {
  return touch && os === 'macOS' ? 'iPadOS' : os
}
