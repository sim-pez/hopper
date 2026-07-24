import type { ConnectionConfig, ConnectionStatus } from '@shared/types'
import { getConnection } from '../store/connectionStore'
import { getPassword } from '../store/secrets'
import { preScriptRunner } from '../process/preScriptRunner'
import { resolvePreConnection } from '../ssh/resolvePreConnection'
import type { Driver } from './types'
import { PostgresDriver } from './postgres'
import { MysqlDriver } from './mysql'

interface Live {
  driver: Driver
  /** Fingerprint of the settings this driver was connected with, to detect
   *  edits made to the saved connection while it's live. */
  signature: string
}

const live = new Map<string, Live>()
const states = new Map<string, ConnectionStatus>()
const healthTimers = new Map<string, NodeJS.Timeout>()
const HEALTH_INTERVAL_MS = 20_000

function signatureOf(cfg: ConnectionConfig, password: string | undefined): string {
  return JSON.stringify({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    ssl: cfg.ssl,
    readOnly: cfg.readOnly,
    preScript: cfg.preScript,
    preScriptReadyRegex: cfg.preScriptReadyRegex,
    password
  })
}

type StatusListener = (status: ConnectionStatus) => void
const listeners = new Set<StatusListener>()

export function onStatusChange(cb: StatusListener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function setStatus(id: string, patch: Partial<ConnectionStatus>): ConnectionStatus {
  const prev = states.get(id) ?? { id, state: 'disconnected', scriptRunning: false }
  const next: ConnectionStatus = { ...prev, ...patch, id, scriptRunning: preScriptRunner.isRunning(id) }
  states.set(id, next)
  for (const l of listeners) l(next)
  return next
}

export function getStatus(id: string): ConnectionStatus {
  return states.get(id) ?? { id, state: 'disconnected', scriptRunning: preScriptRunner.isRunning(id) }
}

function createDriver(kind: string): Driver {
  switch (kind) {
    case 'postgres':
      return new PostgresDriver()
    case 'mysql':
      return new MysqlDriver()
    default:
      throw new Error(`Unsupported driver: ${kind}`)
  }
}

export async function connect(id: string): Promise<ConnectionStatus> {
  const stored = await getConnection(id)
  if (!stored) throw new Error(`Connection ${id} not found`)

  const cfg = await resolvePreConnection(stored)
  const password = await getPassword(id)
  const signature = signatureOf(cfg, password)

  const existing = live.get(id)
  if (existing) {
    // Already connected with the same settings — nothing to do.
    if (existing.signature === signature) return setStatus(id, { state: 'connected', error: undefined })
    // The saved connection was edited since we connected — drop the stale
    // driver and reconnect below with the current settings.
    await disconnect(id)
  }

  try {
    setStatus(id, { state: 'starting-script', error: undefined })
    await preScriptRunner.start(cfg)

    setStatus(id, { state: 'connecting' })
    const driver = createDriver(cfg.driver)
    await driver.connect(cfg, password)

    live.set(id, { driver, signature })
    startHealthCheck(id)
    return setStatus(id, { state: 'connected', error: undefined })
  } catch (err) {
    preScriptRunner.stop(id)
    return setStatus(id, { state: 'error', error: (err as Error).message })
  }
}

export async function disconnect(id: string): Promise<ConnectionStatus> {
  stopHealthCheck(id)
  const entry = live.get(id)
  if (entry) {
    try {
      await entry.driver.end()
    } catch {
      /* ignore */
    }
    live.delete(id)
  }
  preScriptRunner.stop(id)
  return setStatus(id, { state: 'disconnected', error: undefined })
}

export function getDriver(id: string): Driver {
  const entry = live.get(id)
  if (!entry) throw new Error('Not connected')
  return entry.driver
}

export async function cancelQuery(id: string): Promise<void> {
  await live.get(id)?.driver.cancelCurrent()
}

function startHealthCheck(id: string): void {
  stopHealthCheck(id)
  healthTimers.set(
    id,
    setInterval(() => {
      void runHealthCheck(id)
    }, HEALTH_INTERVAL_MS)
  )
}

function stopHealthCheck(id: string): void {
  const timer = healthTimers.get(id)
  if (timer) {
    clearInterval(timer)
    healthTimers.delete(id)
  }
}

async function runHealthCheck(id: string): Promise<void> {
  const entry = live.get(id)
  if (!entry) return stopHealthCheck(id)
  try {
    await entry.driver.ping()
  } catch (err) {
    await killLiveConnection(id, `Connection lost: ${(err as Error).message}`)
  }
}

/** Tear down a live driver whose underlying connection died on its own
 *  (pre-connection script exited, or a health-check ping failed) — as
 *  opposed to `disconnect()`, which is a deliberate user action. */
async function killLiveConnection(id: string, message: string): Promise<void> {
  stopHealthCheck(id)
  const entry = live.get(id)
  if (entry) {
    live.delete(id)
    try {
      await entry.driver.end()
    } catch {
      /* ignore */
    }
  }
  preScriptRunner.stop(id)
  setStatus(id, { state: 'error', error: message })
}

// If the pre-connection script (e.g. a `kubectl port-forward`) dies while a
// connection is live, the driver would otherwise keep reporting "connected"
// until the next query fails. Surface it immediately instead.
preScriptRunner.on('exit', (id: string) => {
  if (live.has(id)) void killLiveConnection(id, 'Pre-connection script exited unexpectedly')
})

export async function shutdownAll(): Promise<void> {
  for (const id of [...live.keys()]) await disconnect(id)
  preScriptRunner.stopAll()
}
