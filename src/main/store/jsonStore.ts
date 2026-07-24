import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'

/** Minimal atomic JSON file store in the app's userData directory.
 *  Replaces electron-store (which is ESM-only and awkward in a CJS main). */
export class JsonStore<T extends object> {
  private filePath: string
  private cache: T | null = null
  // Serializes all reads/mutations so concurrent IPC calls can't clobber each
  // other's in-place edits to the shared cached object.
  private queue: Promise<unknown> = Promise.resolve()

  constructor(fileName: string, private defaults: T) {
    this.filePath = join(app.getPath('userData'), fileName)
  }

  private async load(): Promise<T> {
    if (this.cache) return this.cache
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8')
      this.cache = { ...this.defaults, ...(JSON.parse(raw) as T) }
    } catch {
      this.cache = { ...this.defaults }
    }
    return this.cache
  }

  private enqueue<R>(task: () => Promise<R>): Promise<R> {
    const run = this.queue.then(task, task)
    this.queue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  async get<K extends keyof T>(key: K): Promise<T[K]> {
    return this.enqueue(async () => (await this.load())[key])
  }

  async set<K extends keyof T>(key: K, value: T[K]): Promise<void> {
    await this.enqueue(async () => {
      const data = (await this.load()) as T
      data[key] = value
      await this.persist(data)
    })
  }

  async update(mutator: (data: T) => void): Promise<T> {
    return this.enqueue(async () => {
      const data = await this.load()
      mutator(data)
      await this.persist(data)
      return data
    })
  }

  private async persist(data: T): Promise<void> {
    this.cache = data
    const tmp = `${this.filePath}.tmp`
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8')
    await fs.rename(tmp, this.filePath)
  }
}
