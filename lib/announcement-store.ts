import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { MAX_ANNOUNCEMENT } from './announcements'

// Server-side home of the announcement managed on /bmstats. Lives in
// .cache/announcement.json (not in Git, so a deploy doesn't touch it) and is
// shared by the PM2 cluster's workers — the mtime memo below picks up another
// worker's write on the next read.
//
// The id is derived from the text, which is what makes "change the text and
// everyone sees it again" work: visitors remember the last id they clicked OK
// on, so a new text is a new id and shows, while re-saving the same text
// changes nothing. Empty text means no announcement at all.

export { MAX_ANNOUNCEMENT } from './announcements'

export interface Announcement {
  text: string
  id: string
  updatedAt: number
}

/** Checks and tidies the announcement text. The empty string is valid and
 *  means the popup is off. */
export function validateAnnouncement(text: unknown): { text: string } | { error: string } {
  if (typeof text !== 'string') return { error: 'The announcement must be text.' }
  const t = text.trim()
  if (t.length > MAX_ANNOUNCEMENT) {
    return { error: `The announcement can be at most ${MAX_ANNOUNCEMENT} characters.` }
  }
  return { text: t }
}

const idOf = (text: string) =>
  crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12)

export class AnnouncementStore {
  private memo: { mtimeMs: number; announcement: Announcement | null } | null = null

  constructor(private file: string) {}

  /** Null when there is no announcement: no file, an unreadable or malformed
   *  one, or text that is empty once trimmed. */
  read(): Announcement | null {
    try {
      const { mtimeMs } = fs.statSync(this.file)
      if (this.memo?.mtimeMs === mtimeMs) return this.memo.announcement
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as {
        version?: unknown
        text?: unknown
        id?: unknown
        updatedAt?: unknown
      }
      if (parsed.version !== 1 || typeof parsed.text !== 'string') throw new Error('bad shape')
      const text = parsed.text.trim()
      const announcement: Announcement | null = text
        ? {
            text,
            id: typeof parsed.id === 'string' && parsed.id ? parsed.id : idOf(text),
            updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
          }
        : null
      this.memo = { mtimeMs, announcement }
      return announcement
    } catch {
      // No file yet, or an unreadable one: no announcement.
      this.memo = null
      return null
    }
  }

  /** Saves the text, returning the new announcement, or null when the text is
   *  empty and the popup is therefore off. */
  write(text: string): Announcement | null {
    const trimmed = text.trim()
    const announcement: Announcement | null = trimmed
      ? { text: trimmed, id: idOf(trimmed), updatedAt: Date.now() }
      : null
    const stored = announcement ?? { text: '', id: '', updatedAt: Date.now() }
    const tmp = `${this.file}.${process.pid}.tmp`
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, ...stored }, null, 1), 'utf8')
    fs.renameSync(tmp, this.file)
    this.memo = null
    return announcement
  }
}

let store: AnnouncementStore | null = null
let storeFile: string | null = null
/** The process-wide store. Re-created when the working directory changes, so
 *  tests that chdir into a temp directory get their own file. */
export function announcementStore(): AnnouncementStore {
  const file = path.join(process.cwd(), '.cache', 'announcement.json')
  if (!store || storeFile !== file) {
    store = new AnnouncementStore(file)
    storeFile = file
  }
  return store
}
