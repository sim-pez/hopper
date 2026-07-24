import { readdirSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'

/** Expands a single `*` wildcard in the last path segment of `pattern`, if any.
 *  Enough for common `Include conf.d/*` style directives — not full glob semantics. */
function expandGlob(pattern: string): string[] {
  if (!pattern.includes('*')) return [pattern]
  const dir = dirname(pattern)
  const base = pattern.slice(dir.length + 1)
  const re = new RegExp(`^${base.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  return entries.filter((e) => re.test(e)).map((e) => join(dir, e))
}

/** Parses `Host` aliases out of an ssh_config-style file, following one level
 *  of `Include` globs. Enough to populate a picker — not a full ssh_config parser. */
function parseHosts(path: string, seen = new Set<string>()): string[] {
  if (seen.has(path)) return []
  seen.add(path)

  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return []
  }

  const hosts: string[] = []
  for (const rawLine of text.split('\n')) {
    // Strip inline comments (a `#` starting a new whitespace-separated token).
    const line = rawLine.replace(/(^|\s)#.*$/, '').trim()
    if (!line) continue
    const [keyword, ...rest] = line.split(/\s+/)
    const value = rest.join(' ')
    if (!keyword) continue

    if (keyword.toLowerCase() === 'host') {
      for (const alias of value.split(/\s+/)) {
        if (alias && !alias.includes('*') && !alias.includes('?')) hosts.push(alias)
      }
    } else if (keyword.toLowerCase() === 'include') {
      for (const pattern of value.split(/\s+/)) {
        if (!pattern) continue
        const absPattern = pattern.startsWith('/') || pattern.startsWith('~') ? pattern : join(dirname(path), pattern)
        const expanded = absPattern.startsWith('~') ? join(homedir(), absPattern.slice(1)) : absPattern
        for (const included of expandGlob(expanded)) {
          hosts.push(...parseHosts(included, seen))
        }
      }
    }
  }
  return hosts
}

export function listSshHosts(): string[] {
  const configPath = join(homedir(), '.ssh', 'config')
  const hosts = parseHosts(configPath)
  return [...new Set(hosts)].sort((a, b) => a.localeCompare(b))
}
