import fs from 'fs'
import path from 'path'
import { DEFAULT_ALIASES } from './searchAliasDefaults'

// Server-side home of the search aliases managed on /bmstats. Starts from the
// built-in list and, once anything is changed, lives in
// .cache/search-aliases.json (not in Git, so a deploy doesn't touch it).

export const MAX_ALIASES = 500
const MAX_KEY = 40
const MAX_VALUE = 100

/** Checks and tidies one alias. `&` and `|` are the search box's own AND / OR
 *  separators, so neither side may contain them. */
export function validateAlias(
  key: unknown,
  value: unknown,
): { key: string; value: string } | { error: string } {
  if (typeof key !== 'string' || typeof value !== 'string') return { error: 'Both fields must be text.' }
  const k = key.trim().toLowerCase()
  const v = value.trim()
  if (k.length < 2) return { error: 'The short name needs at least 2 characters.' }
  if (k.length > MAX_KEY) return { error: `The short name can be at most ${MAX_KEY} characters.` }
  if (!v) return { error: 'The full name cannot be empty.' }
  if (v.length > MAX_VALUE) return { error: `The full name can be at most ${MAX_VALUE} characters.` }
  if (/[&|]/.test(k) || /[&|]/.test(v)) return { error: 'Names cannot contain & or |.' }
  return { key: k, value: v }
}

export class AliasStore {
  private memo: { mtimeMs: number; aliases: Record<string, string> } | null = null

  constructor(private file: string) {}

  list(): Record<string, string> {
    try {
      const { mtimeMs } = fs.statSync(this.file)
      if (this.memo?.mtimeMs === mtimeMs) return { ...this.memo.aliases }
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as { aliases?: unknown }
      if (!parsed.aliases || typeof parsed.aliases !== 'object') throw new Error('bad shape')
      const aliases: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed.aliases)) {
        if (typeof v === 'string') aliases[k] = v
      }
      this.memo = { mtimeMs, aliases }
      return { ...aliases }
    } catch {
      // No file yet, or an unreadable one: the built-ins.
      this.memo = null
      return { ...DEFAULT_ALIASES }
    }
  }

  set(key: string, value: string): void {
    this.write({ ...this.list(), [key]: value })
  }

  /** Returns false if there was no such alias. */
  remove(key: string): boolean {
    const aliases = this.list()
    if (!(key in aliases)) return false
    delete aliases[key]
    this.write(aliases)
    return true
  }

  private write(aliases: Record<string, string>): void {
    const tmp = `${this.file}.${process.pid}.tmp`
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, aliases }, null, 1), 'utf8')
    fs.renameSync(tmp, this.file)
    this.memo = null
  }
}

let store: AliasStore | null = null
export function aliasStore(): AliasStore {
  return (store ??= new AliasStore(path.join(process.cwd(), '.cache', 'search-aliases.json')))
}
